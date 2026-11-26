// zealman 镜像文生图适配器（Toonflow 供应商文件）
// 调用自托管 ComfyUI 面板（zealman 镜像 API v9.0），与 RunningHub 供应商完全独立，不需要 API Key：
//   提交任务 POST /api/workflow/generate → prompt_id
//   轮询结果 GET /api/workflow/result?prompt_id= → pending=false 后取 results 里图片的 url（相对路径，拼服务地址下载）
// 参数映射（面板工作流 input_values）：
//   seed → 每次提交自动生成的随机种子（0～10^15）；提示词 → Text；
//   尺寸 → latent_width / latent_height（1K/2K/4K 为长边 1024/2048/4096，按比例算另一边，对齐 32 的倍数）。
//   其余工作流参数（如 value=是否三视图、value_2=是否放大、upscale=放大倍数）走供应商「自定义参数」：
//   定义由节点经 request.other.__customParamDefs 透传，插件只按字段名（fieldName）把值写进
//   input_values，节点 ID 不参与传参（宿主表单需要，随意填）。
// prompt_id 只存在于面板 ComfyUI 内存中，面板重启即失效；插件在任务完成时立即取走结果 URL。
// 取消生成只停止本地轮询，面板端没有单机中断接口，远端任务会继续跑完。

type ZtImageRequest = {
  model: string;
  prompt: string;
  images?: unknown[];
  mask?: unknown;
  n?: number;
  ratio?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  other?: Record<string, unknown>;
};

type ZtMediaAsset = { mediaType: "image"; type: "url"; url: string };

type ZtProviderContext = {
  config: Record<string, unknown>;
  signal?: AbortSignal;
  tool: { fetch: typeof fetch };
};

function ztStr(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function ztBaseUrl(ctx: ZtProviderContext): string {
  const url = ztStr(ctx.config.baseUrl).replace(/\/+$/, "");
  if (!url) throw new Error("请先在供应商配置里填写 zealman 面板服务地址");
  if (!/^https?:\/\//i.test(url)) throw new Error("服务地址需以 http:// 或 https:// 开头：" + url);
  return url;
}

/** 截断打印响应，避免错误信息过长。 */
function ztSafeText(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return String(v).slice(0, 300);
  }
}

/** 解析开关：el-switch 存布尔值，兼容历史字符串写法。 */
function ztBool(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

function ztRound32(v: number): number {
  return Math.max(32, Math.round(v / 32) * 32);
}

/**
 * 解析尺寸。
 * - "1K"/"2K"/"4K"：长边 1024/2048/4096，按比例算另一边
 * - "1024x1024"：直接用给定宽高
 * 结果四舍五入到 32 的倍数。
 */
function ztResolveSize(size: string | undefined, ratio: string | undefined): { width: number; height: number } {
  const s = ztStr(size, "1K");
  const wh = s.match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
  if (wh) {
    const w = Number(wh[1]);
    const h = Number(wh[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 32 || h < 32) throw new Error("尺寸数值无效: " + s);
    return { width: ztRound32(w), height: ztRound32(h) };
  }
  const longSide = ({ "1k": 1024, "2k": 2048, "4k": 4096 } as Record<string, number>)[s.toLowerCase()];
  if (!longSide) throw new Error("不支持的尺寸「" + s + "」，请选择 1K / 2K / 4K，或直接填写 宽x高（如 1024x1024）");
  const r = ztStr(ratio, "16:9");
  const m = r.match(/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error("不支持的比例「" + r + "」，请使用 宽:高 格式（如 16:9）");
  const rw = parseFloat(m[1]);
  const rh = parseFloat(m[2]);
  if (!(rw > 0) || !(rh > 0)) throw new Error("不支持的比例「" + r + "」");
  let width: number;
  let height: number;
  if (rw >= rh) {
    width = longSide;
    height = (longSide * rh) / rw;
  } else {
    height = longSide;
    width = (longSide * rw) / rh;
  }
  return { width: ztRound32(width), height: ztRound32(height) };
}

/** 可取消的等待。 */
function ztSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("已取消"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("已取消"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// 插件内置参数名，自定义参数不允许覆盖（防止误配把提示词/尺寸/种子冲掉）
const ZT_RESERVED_FIELDS = ["seed", "Text", "latent_width", "latent_height"];

export default {
  id: "zealmanTextToImage",
  label: "zealman 文生图",
  version: "1.0.1",
  readme: "## zealman 文生图\n\n调用自托管 ComfyUI 面板（zealman 镜像 API）的文生图适配器，与 RunningHub 供应商完全独立，不需要 API Key。\n\n**配置**\n- 服务地址：zealman 面板地址，如 https://xxxx.bjb1.seetacloud.com:8443（与 zealman H3 供应商填同一个）\n- 工作流名称：面板「API 生成」页里已保存的工作流名称，默认 文生图\n- 生成前清显存：默认开启。连续跑重模型时，先调面板的清显存接口，避免下一次生成显存不足（OOM）；最多只等 5 秒，超时直接提交；不需要时可关闭\n\n**参数**\n- 提示词 → Text；seed 每次提交自动生成随机值，不用配\n- 尺寸：1K / 2K / 4K 为长边 1024 / 2048 / 4096 像素，按所选比例算出另一边，四舍五入到 32 的倍数；也可以直接写 宽x高\n- 比例：16:9、9:16、1:1、4:3、3:4、3:2、2:3、21:9\n\n**三视图 / 放大（自定义参数）**\n在供应商编辑对话框的「自定义参数」里加三项，插件只按字段名把值写进 input_values（节点 ID 仅宿主表单需要，填工作流里对应节点 ID 或任意值均可）：\n- 标签带「三视图」三字、类型开关、字段名 value（智能体开关三视图靠标签识别）\n- 标签如「是否放大」、类型开关、字段名 value_2\n- 标签如「放大倍数」、类型数字、字段名 upscale、默认值 2\n图片节点弹窗里会动态显示这三项，节点上的值优先于默认值。\n\n**说明**\n- 只支持纯文字生成，单次 1 张；不支持参考图、遮罩\n- 生成为异步轮询（每 3 秒一次，最长约 30 分钟）；prompt_id 只存在于面板内存中，面板重启后无法再查询，插件会在完成时立即取走结果\n- 在 Toonflow 里取消生成只停止本地等待，面板端任务会继续跑完（面板没有单机中断接口）",
  rules: [
    {
      type: "input",
      field: "baseUrl",
      title: "服务地址（zealman 面板）",
      value: "",
      validate: [{ required: true, message: "请填写 zealman 面板服务地址", trigger: "blur" }],
    },
    {
      type: "input",
      field: "workflowId",
      title: "工作流名称（面板 API 生成页）",
      value: "文生图",
      validate: [{ required: true, message: "请填写面板里保存的工作流名称", trigger: "blur" }],
    },
    {
      type: "select",
      field: "clearVram",
      title: "生成前清显存（连续跑重模型防 OOM）",
      value: "on",
      options: [
        { label: "开启", value: "on" },
        { label: "关闭", value: "off" },
      ],
    },
    // 自定义参数在供应商编辑对话框的“自定义参数”区域配置，不在这里硬编码。
  ],
  models: [
    {
      id: "textToImageZealman",
      label: "文生图",
      type: "image",
      mode: ["text"],
      imageSizes: ["1K", "2K", "4K"],
      imageRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"],
    },
  ],
  async generateImage(this: ZtProviderContext, request: ZtImageRequest): Promise<ZtMediaAsset[]> {
    this.signal?.throwIfAborted();
    const baseUrl = ztBaseUrl(this);
    const workflowId = ztStr(this.config.workflowId);
    if (!workflowId) throw new Error("请先在供应商配置里填写工作流名称");
    if (request.model !== "textToImageZealman")
      throw new Error("该供应商只提供「文生图」模型，当前请求模型为「" + ztStr(request.model, "（空）") + "」");
    const prompt = ztStr(request.prompt);
    if (!prompt) throw new Error("请输入提示词");
    if (request.images && request.images.length) throw new Error("该工作流只支持纯文字生成，不支持参考图");
    if (request.mask) throw new Error("该工作流不支持遮罩");
    if (request.n !== undefined && request.n !== 1) throw new Error("该工作流单次只生成 1 张图");
    if (request.quality !== undefined) throw new Error("该工作流不支持画质档位");
    if (request.outputFormat !== undefined) throw new Error("该工作流不支持指定输出格式");

    const dims = ztResolveSize(request.size, request.ratio);

    const inputValues: Record<string, unknown> = {
      // 每次提交生成新种子：同参数批量生成才不会因种子相同而出完全相同的图
      seed: Math.floor(Math.random() * 1e15),
      Text: prompt.slice(0, 4000),
      latent_width: dims.width,
      latent_height: dims.height,
    };

    // 自定义参数：定义由节点通过 request.other.__customParamDefs 透传（不依赖插件配置，避免过期）；
    // 回退到插件配置里的 customParams（兼容旧版）。只按字段名写进 input_values，内置参数名不许覆盖。
    const other = (request.other ?? {}) as Record<string, unknown>;
    const defsFromNode = (other as any).__customParamDefs;
    const customParams = Array.isArray(defsFromNode) && defsFromNode.length
      ? defsFromNode
      : Array.isArray(this.config.customParams) ? this.config.customParams : [];
    for (const param of customParams) {
      if (!param || typeof param.id !== "string" || typeof param.fieldName !== "string") continue;
      if (ZT_RESERVED_FIELDS.includes(param.fieldName)) continue;
      const raw = param.id in other ? other[param.id] : param.defaultValue;
      if (param.type === "switch") inputValues[param.fieldName] = ztBool(raw);
      else if (param.type === "number") {
        const num = Number(raw);
        inputValues[param.fieldName] = Number.isFinite(num) ? num : 0;
      } else inputValues[param.fieldName] = ztStr(raw as string);
    }

    const timeoutSignal = AbortSignal.timeout(30 * 60 * 1000);
    const signal = this.signal ? AbortSignal.any([timeoutSignal, this.signal]) : timeoutSignal;

    // 生成前清显存（尽力而为，失败不拦截生成）：与面板快捷生成的默认行为一致。
    // 最多只等 5 秒——面板忙时 /free 可能干等到超时才放行，拖住提交；清显存只是尽力而为，超时直接提交。
    if (ztStr(this.config.clearVram, "on") === "on") {
      await this.tool.fetch(baseUrl + "/api/comfy/proxy/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }

    // 提交任务
    const createdRes = await this.tool.fetch(baseUrl + "/api/workflow/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow_id: workflowId, input_values: inputValues }),
      signal,
    });
    if (!createdRes.ok) {
      const text = await createdRes.text().catch(() => "");
      throw new Error("提交任务失败，HTTP " + createdRes.status + (text ? "：" + text.slice(0, 200) : ""));
    }
    const created: any = await createdRes.json().catch(() => undefined);
    if (!created || created.success !== true || !created.prompt_id) {
      throw new Error("提交任务失败：" + ztSafeText(created?.error ?? created));
    }
    const promptId = String(created.prompt_id);

    // 轮询：每 3 秒查一次，最长约 30 分钟（超时信号兜底）
    for (let i = 0; i < 600; i++) {
      await ztSleep(3000, this.signal);
      let data: any;
      try {
        const res = await this.tool.fetch(baseUrl + "/api/workflow/result?prompt_id=" + encodeURIComponent(promptId), { signal });
        if (!res.ok) continue;
        data = await res.json().catch(() => undefined);
      } catch (error) {
        if (this.signal?.aborted) throw error;
        continue;
      }
      if (!data) continue;
      if (data.pending) continue;
      if (data.error) throw new Error("任务执行失败：" + ztSafeText(data.error));
      const results = Array.isArray(data.results) ? data.results : [];
      const image = results.find((r: any) => r && r.type === "image" && typeof r.url === "string" && r.url);
      if (!image) {
        throw new Error("任务已完成，但结果里没有图片。结果：" + ztSafeText(results.map((r: any) => r?.type)));
      }
      const url = /^https?:\/\//i.test(image.url) ? image.url : baseUrl + (image.url.startsWith("/") ? image.url : "/" + image.url);
      signal.throwIfAborted();
      return [{ mediaType: "image", type: "url", url }];
    }
    throw new Error("任务等待超时（约 30 分钟）。prompt_id 只存在于面板内存中，请到面板确认任务状态");
  },
};
