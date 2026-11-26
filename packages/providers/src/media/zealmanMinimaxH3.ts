// zealman 镜像 MiniMax H3 视频生成适配器（Toonflow 供应商文件）
// 调用自托管 ComfyUI 面板（zealman 镜像 API v9.0），与 RunningHub 供应商完全独立：
//   参考素材上传 POST /api/comfy/upload/file（multipart）→ 返回 name
//   提交任务 POST /api/workflow/generate → prompt_id
//   轮询结果 GET /api/workflow/result?prompt_id= → pending=false 后取 results 里视频的 url（相对路径，拼服务地址下载）
// 参数映射（面板工作流 input_values）：
//   prompt → prompt；比例 → aspect；分辨率档 → megapixels（0.2-1.0）；时长 → duration_seconds；
//   参考图 → param_ref_image_1..9；参考视频 → param_ref_video_1..3；参考音频 → param_ref_audio_1..3；
//   gh_state_json 固定传空字符串（节点会用工作流内置旧状态覆盖 API 传入的提示词和参考素材，不清空不生效）。
// 一采/二采关联：cache_id 是一采的标记，工作流里有 cache_id / cache_id_2 / cache_id_3 三个字段，
//   三个都传同一个值。每次一采自动生成唯一 cache_id，随结果以 providerData 回传给宿主保存；
//   二采时宿主经 request.other.__zealmanSecondPass 带回同一 cache_id 和放大倍数，插件复用提交：
//   value_2=true（是否二采）、value=放大倍数，其余参数（含 megapixels）与一采一致，放大由工作流内部完成。
// 随机种子：配置里的种子字段名（默认 noise_seed）非空时，一采每次提交生成一个随机种子（0～10^15）
//   填入该 input_values 字段，避免同参数批量生成因种子相同（randomize 只对 ComfyUI 网页手动运行
//   有效，API 提交时工作流里保存的种子原样发送）而出完全相同的视频；二采不传种子（靠 cache_id 关联）。
// 上传文件名用素材在 Toonflow 里的原始文件名（即生成该素材的节点保存的文件名，宿主随素材
//   带过来的是工作区相对路径，取最后一段）；拿不到原始文件名时回退内容哈希+字节数命名
//   （同内容同名、不同内容不撞名）。生成前先拉面板 input 目录清单（GET /api/input-assets）：
//   同名同大小、且文件修改时间（≈上传时间）距现在没超过配置「过期时长（小时）」的文件直接
//   复用、跳过上传；过期、大小对不上或清单拿不到时重新上传（overwrite 覆盖同名）。插件没有
//   跨请求保存的上传记录（每次调用全新加载），复用判断全靠面板清单里的文件时间。
// 首帧/尾帧折进参考图前列（首帧=图1、尾帧=图2），因为该工作流没有单独的首尾帧参数。
// prompt_id 只存在于面板 ComfyUI 内存中，面板重启即失效；插件在任务完成时立即取走结果 URL。
// 取消生成只停止本地轮询，面板端没有单机中断接口，远端任务会继续跑完。

type ZmMediaInput =
  | { type: "url"; url: string; mimeType?: string; name?: string }
  | { type: "base64"; data: string; mimeType: string; name?: string }
  | { type: "binary"; data: Uint8Array; mimeType: string; name?: string };

type ZmVideoRequest = {
  model: string;
  prompt: string;
  mode?: unknown;
  images?: ZmMediaInput[];
  videos?: ZmMediaInput[];
  audios?: ZmMediaInput[];
  firstFrame?: ZmMediaInput;
  lastFrame?: ZmMediaInput;
  duration?: number;
  ratio?: string;
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  other?: Record<string, unknown>;
};

type ZmMediaAsset = { mediaType: "video"; type: "url"; url: string };

type ZmProviderContext = {
  config: Record<string, unknown>;
  signal?: AbortSignal;
  tool: { fetch: typeof fetch; hash: (data: string | Uint8Array) => number };
};

type ZmInputAsset = { path: string; size?: number; mtimeMs?: number };

type ZmUploadState = {
  /** 面板 input 目录清单；undefined = 没拿到清单，一律重新上传。 */
  assets: ZmInputAsset[] | undefined;
  expireMs: number;
  /** 本次生成内已处理过的素材（键=文件名+字节数），同名同内容只传一次。 */
  done: Map<string, string>;
};

function zmStr(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function zmBaseUrl(ctx: ZmProviderContext): string {
  const url = zmStr(ctx.config.baseUrl).replace(/\/+$/, "");
  if (!url) throw new Error("请先在供应商配置里填写 zealman 面板服务地址");
  if (!/^https?:\/\//i.test(url)) throw new Error("服务地址需以 http:// 或 https:// 开头：" + url);
  return url;
}

/** 截断打印响应，避免错误信息过长。 */
function zmSafeText(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return String(v).slice(0, 300);
  }
}

/** 可取消的等待。 */
function zmSleep(ms: number, signal?: AbortSignal): Promise<void> {
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

function zmExtOf(mimeType: string): string {
  const m: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
    "video/x-msvideo": "avi",
    "video/webm": "webm",
    // 音频：必须映射到节点允许的扩展名（.aac/.flac/.m4a/.mp3/.ogg/.wav），否则节点校验会报错
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/x-mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/x-wave": "wav",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/aac": "aac",
    "audio/x-aac": "aac",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/ogg": "ogg",
    "audio/x-ogg": "ogg",
    "application/ogg": "ogg",
  };
  return m[mimeType.toLowerCase()] || "";
}

/** 节点允许的音频扩展名（与 Goohai-MiniMax-H3_Integration 的 AUDIO_EXTENSIONS 一致）。 */
const ZM_ALLOWED_AUDIO_EXTS = ["aac", "flac", "m4a", "mp3", "ogg", "wav"];

/** 手工构造 multipart/form-data 请求体（宿主不保证有 FormData）。含 file 与 overwrite 两个字段。 */
function zmBuildMultipart(fileName: string, mimeType: string, bytes: Uint8Array): { body: Uint8Array; contentType: string } {
  const boundary = "----ToonflowBoundary" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  const head = Buffer.from(
    "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="file"; filename="' + fileName + '"\r\n' +
      "Content-Type: " + mimeType + "\r\n\r\n",
  );
  const mid = Buffer.from(
    "\r\n--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="overwrite"\r\n\r\n' +
      "true",
  );
  const tail = Buffer.from("\r\n--" + boundary + "--\r\n");
  return { body: Buffer.concat([head, Buffer.from(bytes), mid, tail]), contentType: "multipart/form-data; boundary=" + boundary };
}

/** 把 Toonflow 的媒体输入转成字节 + mime。 */
async function zmToBytes(ctx: ZmProviderContext, input: ZmMediaInput, signal: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (input.type === "binary") return { bytes: input.data, mimeType: input.mimeType || "application/octet-stream" };
  if (input.type === "base64") return { bytes: Buffer.from(input.data, "base64"), mimeType: input.mimeType || "application/octet-stream" };
  const res = await ctx.tool.fetch(input.url, { signal });
  if (!res.ok) throw new Error("参考素材下载失败，HTTP " + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  const mimeType = input.mimeType || (ct ? ct.split(";")[0] : "application/octet-stream");
  return { bytes: buf, mimeType };
}

/** 配置里的过期时长（小时）→ 毫秒；缺失/非法时默认 10 小时，0 表示每次都重新上传。 */
function zmExpireMs(ctx: ZmProviderContext): number {
  const raw = Number.parseFloat(zmStr(ctx.config.uploadExpireHours, "10"));
  const hours = Number.isFinite(raw) && raw >= 0 ? raw : 10;
  return hours * 60 * 60 * 1000;
}

/**
 * 拉面板 input 目录清单（GET /api/input-assets），用于判断同名文件是否已上传、是否过期。
 * 清单条目的字段名/时间单位按面板文档与同模块接口的常见形状宽容解析（relativePath/path/name、
 * size、mtime 秒或毫秒或时间字符串）。返回 undefined 表示清单不可用（接口失败或结构对不上）
 * ——调用方一律按“重新上传”处理，宁可多传一次，也不能引用不存在或已过期的文件让工作流拿错素材。
 */
async function zmListInputAssets(ctx: ZmProviderContext, baseUrl: string, signal: AbortSignal): Promise<ZmInputAsset[] | undefined> {
  try {
    const res = await ctx.tool.fetch(baseUrl + "/api/input-assets", { signal });
    if (!res.ok) return undefined;
    const data: any = await res.json().catch(() => undefined);
    const rawList: unknown = Array.isArray(data) ? data : data?.assets ?? data?.files ?? data?.data;
    if (!Array.isArray(rawList)) return undefined;
    return rawList.flatMap((item): ZmInputAsset[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const path = (zmStr(record.relativePath) || zmStr(record.path) || zmStr(record.name)).replace(/\\/g, "/");
      if (!path) return [];
      const size = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : undefined;
      const rawTime = record.mtime ?? record.modifiedAt ?? record.updatedAt ?? record.time;
      let mtimeMs: number | undefined;
      if (typeof rawTime === "number" && Number.isFinite(rawTime)) mtimeMs = rawTime > 1e12 ? rawTime : rawTime * 1000;
      else if (typeof rawTime === "string") {
        const parsed = Date.parse(rawTime);
        if (Number.isFinite(parsed)) mtimeMs = parsed;
      }
      return [{ path, size, mtimeMs }];
    });
  } catch {
    return undefined;
  }
}

/**
 * 定上传文件名：优先用素材在 Toonflow 里的原始文件名（宿主带过来的是工作区相对路径，取最后
 * 一段），也就是生成该素材的节点保存的文件名，面板上同名即同一文件；拿不到时回退内容哈希
 * 命名（旧版曾从“地址|哈希”截前 12 个字符当文件名，截到的全是地址前缀，不同图片同名互相
 * 覆盖串图，所以回退名也必须带全哈希与字节数）。
 */
function zmUploadFileName(input: ZmMediaInput, mimeExt: string, kindPrefix: "image/" | "video/" | "audio/", hash: string, byteLength: number): string {
  const raw = zmStr(input.name);
  const base = raw ? raw.split(/[\\/]/).pop()?.replace(/["\r\n]/g, "").trim() : "";
  if (!base || base === "." || base === "..") return "zm-" + hash + "-" + byteLength + "." + mimeExt;
  const dot = base.lastIndexOf(".");
  const nameExt = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (!nameExt) return base + "." + mimeExt;
  // 音频的工作流节点按扩展名校验：原始扩展名不在允许列表里时换成按内容类型推出的扩展名
  if (kindPrefix === "audio/" && !ZM_ALLOWED_AUDIO_EXTS.includes(nameExt)) return base.slice(0, dot + 1) + mimeExt;
  return base;
}

/**
 * 上传一个参考素材到面板 ComfyUI input 目录，返回填给 input_values 的 name。
 * 复用判定：面板清单里已有同名同大小的文件，且它的修改时间（≈上传时间）距现在没超过
 * 配置的过期时长 → 直接复用该文件名、跳过上传；否则上传（overwrite=true 覆盖同名）。
 */
async function zmUploadMedia(
  ctx: ZmProviderContext,
  baseUrl: string,
  input: ZmMediaInput,
  label: string,
  kindPrefix: "image/" | "video/" | "audio/",
  signal: AbortSignal,
  state: ZmUploadState,
): Promise<string> {
  const data = await zmToBytes(ctx, input, signal);
  if (!data.mimeType.toLowerCase().startsWith(kindPrefix)) throw new Error(label + "的格式不对：" + data.mimeType);
  if (!data.bytes.length) throw new Error(label + "内容为空");
  let ext = zmExtOf(data.mimeType);
  if (kindPrefix === "audio/") {
    if (!ZM_ALLOWED_AUDIO_EXTS.includes(ext)) {
      throw new Error(label + "格式不受支持（" + (data.mimeType || "未知") + "）；节点只允许：" + ZM_ALLOWED_AUDIO_EXTS.map(e => "." + e).join("、"));
    }
  } else if (!ext) {
    ext = kindPrefix === "image/" ? "png" : "mp4";
  }
  const hash = String(ctx.tool.hash(data.bytes));
  const fileName = zmUploadFileName(input, ext, kindPrefix, hash, data.bytes.length);
  const doneKey = fileName + "|" + data.bytes.length;
  const doneName = state.done.get(doneKey);
  if (doneName) return doneName;
  if (state.expireMs > 0 && state.assets) {
    const existing = state.assets.find((item) => item.path === fileName);
    if (existing && existing.size === data.bytes.length && existing.mtimeMs !== undefined && Date.now() - existing.mtimeMs < state.expireMs) {
      state.done.set(doneKey, fileName);
      return fileName;
    }
  }
  const part = zmBuildMultipart(fileName, data.mimeType, data.bytes);
  const res = await ctx.tool.fetch(baseUrl + "/api/comfy/upload/file", {
    method: "POST",
    headers: { "Content-Type": part.contentType },
    body: part.body,
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(label + "上传失败，HTTP " + res.status + (text ? "：" + text.slice(0, 200) : ""));
  }
  const result: any = await res.json().catch(() => undefined);
  const name = zmStr(result?.name);
  if (!name) throw new Error(label + "上传失败：" + zmSafeText(result));
  const value = zmStr(result?.subfolder) ? zmStr(result.subfolder).replace(/\/+$/, "") + "/" + name : name;
  state.done.set(doneKey, value);
  return value;
}

/**
 * {{ref N}} → <Picture N>：仅当只传图片时无歧义（第 N 个引用 = 第 N 张参考图，含折入的首/尾帧）；
 * 混传视频/音频时报错，提示改用显式标签。规则与 RunningHub H3 插件一致。
 */
function zmResolveRefTags(prompt: string, imageCount: number, videoCount: number, audioCount: number): string {
  if (!/\{\{\s*ref\s+\d+\s*\}\}/i.test(prompt)) return prompt;
  if (videoCount > 0 || audioCount > 0) {
    throw new Error("提示词中使用了 {{ref N}}，但同时传入了视频/音频素材，无法确定 N 对应第几个。请直接写 <Picture N>、<Video N>、<Audio N> 标签。");
  }
  return prompt.replace(/\{\{\s*ref\s+(\d+)\s*\}\}/gi, (_m, num) => {
    const n = parseInt(num, 10);
    if (n < 1 || n > imageCount) {
      throw new Error(`提示词中的 {{ref ${n}}} 超出范围：本次只传入了 ${imageCount} 张图片。`);
    }
    return `<Picture ${n}>`;
  });
}

export default {
  id: "zealmanMinimaxH3",
  label: "zealman MiniMax H3 视频生成",
  version: "1.6.1",
  readme: "## zealman MiniMax H3 视频生成\n\n调用自托管 ComfyUI 面板（zealman 镜像 API）的视频生成适配器，与 RunningHub 供应商完全独立，不需要 API Key。\n\n**配置**\n- 服务地址：zealman 面板地址，如 https://xxxx.bjb1.seetacloud.com:8443\n- 工作流名称：面板「API 生成」页里已保存的工作流名称，如 MiniMaxH3_一二采\n- 生成前清显存：默认开启。连续跑 H3 这类重模型时，先调面板的清显存接口，避免第二次生成显存不足（OOM）；最多只等 5 秒，超时直接提交；不需要时可关闭\n- 随机种子字段：默认 noise_seed，一采每次提交自动生成随机种子，避免同参数批量生成出完全相同的视频；清空则不传种子（工作流使用保存的固定种子）；二采不传种子\n- 参考素材过期时长（小时，默认 10）：上传文件名用素材在 Toonflow 里的原始文件名（即生成该素材的节点保存的文件名）。每次生成前先查面板 input 目录：已有同名同大小的文件、且它的时间（≈上传时间）距现在没超过这个时长，就直接复用、不再上传；超过了、或大小对不上，就重新上传覆盖。填 0 表示每次都重新上传。插件本身不保存任何上传记录，判断全靠面板上文件的时间；本机与面板机器时钟差太多会影响判断\n\n**一采 / 二采**\n- cache_id 是一采的标记：工作流里有 cache_id、cache_id_2、cache_id_3 三个字段，三个都传同一个值；每次一采自动生成唯一 cache_id，随结果回传给宿主，宿主把这次的参数和 cache_id 一起保存到视频节点\n- 视频节点上点「二采」时，只需填放大倍数：宿主用一采保存的参数重跑，插件复用同一 cache_id，并传 value_2=true（是否二采）和 value=放大倍数，放大由工作流内部完成，megapixels 与一采保持一致\n- 只有一采的视频能二采；二采结果会在历史记录里标明，并注明来自哪条一采\n\n**参数**\n- 时长：5–16 秒（逐秒可选），也可输入任意正数秒\n- 分辨率：像素档 0.2–1.0（每 0.1 一档，对应工作流的 megapixels），默认 0.4\n- 比例：节点上选的比例直接传给工作流的 aspect\n- 提示词：引用标签请直接写 <Picture N> / <Video N> / <Audio N>（N 为该类型下的序号）；{{ref N}} 仅在只传图片时自动转 <Picture N>\n- 参考图最多 9 张（含首/尾帧）→ param_ref_image_1..9；参考视频最多 3 个 → param_ref_video_1..3；参考音频最多 3 个 → param_ref_audio_1..3\n- 首帧/尾帧模式下，首帧作为图1、尾帧作为图2 传给工作流\n\n**说明**\n- 参考素材先上传到面板 input 目录再提交任务；上传文件名用素材在 Toonflow 里的原始文件名，拿不到原始文件名时才按内容哈希和大小生成，不同内容绝不撞名（旧版文件名截断写错，同一台机器上所有素材会同名互相覆盖，已修复）\n- 每次提交会自动清空 gh_state_json（节点会用工作流里存的旧提示词/旧参考图覆盖传入值，不清空会导致提示词和参考图不生效）\n- 生成为异步轮询（每 3 秒一次，最长约 60 分钟）；prompt_id 只存在于面板内存中，面板重启后无法再查询，插件会在完成时立即取走结果\n- 在 Toonflow 里取消生成只停止本地等待，面板端任务会继续跑完（面板没有单机中断接口）",
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
      value: "MiniMaxH3_一二采",
      validate: [{ required: true, message: "请填写面板里保存的工作流名称", trigger: "blur" }],
    },
    {
      type: "select",
      field: "clearVram",
      title: "生成前清显存（连续跑 H3 防 OOM）",
      value: "on",
      options: [
        { label: "开启", value: "on" },
        { label: "关闭", value: "off" },
      ],
    },
    {
      type: "input",
      field: "uploadExpireHours",
      title: "参考素材过期时长（小时）：面板上同名文件的上传时间距现在超过这个时长就重新上传，没超过直接复用、不再上传；填 0 表示每次都重新上传",
      value: "10",
    },
    {
      type: "input",
      field: "seedField",
      title: "随机种子字段名（面板参数名，一采每次随机；清空则不传种子）",
      value: "noise_seed",
    },
  ],
  models: [
    {
      id: "minimaxH3Zealman",
      label: "MiniMax H3 视频生成",
      type: "video",
      mode: ["text", "singleImage", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      durationResolutionMap: [
        { duration: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1.0"] },
      ],
    },
  ],
  async generateVideo(this: ZmProviderContext, request: ZmVideoRequest): Promise<ZmMediaAsset[] | { assets: ZmMediaAsset[]; providerData: Record<string, unknown> }> {
    this.signal?.throwIfAborted();
    const baseUrl = zmBaseUrl(this);
    const workflowId = zmStr(this.config.workflowId);
    if (!workflowId) throw new Error("请先在供应商配置里填写工作流名称");
    if (request.model !== "minimaxH3Zealman")
      throw new Error("该供应商只提供「MiniMax H3 视频生成」模型，当前请求模型为「" + zmStr(request.model, "（空）") + "」");
    const rawPrompt = zmStr(request.prompt);
    if (!rawPrompt) throw new Error("请输入提示词");

    const duration = request.duration ?? 10;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("时长无效：" + String(request.duration));
    const megapixels = Number.parseFloat(zmStr(request.resolution, "0.4"));
    const mp = Number.isFinite(megapixels) ? megapixels : 0.4;
    if (mp < 0.2 || mp > 1.0) throw new Error("像素档需在 0.2–1.0 之间，当前：" + zmStr(request.resolution, "0.4"));

    // 首/尾帧折进参考图前列：首帧=图1、尾帧=图2，其后是普通参考图。
    const images: ZmMediaInput[] = [];
    if (request.firstFrame) images.push(request.firstFrame);
    if (request.lastFrame) images.push(request.lastFrame);
    images.push(...(request.images ?? []));
    const videos = request.videos ?? [];
    const audios = request.audios ?? [];
    if (images.length > 9) throw new Error("参考图最多 9 张（含首/尾帧）");
    if (videos.length > 3) throw new Error("参考视频最多 3 个");
    if (audios.length > 3) throw new Error("参考音频最多 3 个");

    const prompt = zmResolveRefTags(rawPrompt, images.length, videos.length, audios.length);

    // 一采/二采关联：二采时宿主带回一采的 cache_id 和放大倍数复用；一采则生成唯一 cache_id，
    // 随结果以 providerData 回传，宿主把一采参数与它一起保存，供之后二采。
    // 工作流里 cache_id / cache_id_2 / cache_id_3 三个字段都传同一个值；value_2 是是否二采，value 是放大倍数。
    const secondPass = (request.other as Record<string, unknown> | undefined)?.__zealmanSecondPass as { cacheId?: unknown; multiplier?: unknown } | undefined;
    const secondCacheId = zmStr(secondPass?.cacheId);
    const isSecondPass = !!secondCacheId;
    const cacheId = secondCacheId || "tf-" + Date.now().toString(36) + Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    // 随机种子：种子字段名配置非空且是一采时，每次提交生成一个新种子（0～10^15，与工作流现有
    // 15 位种子同量级，JSON 传输不丢精度）；二采不生成、不传，靠 cache_id 关联一采。
    const seedField = zmStr(this.config.seedField);
    const seed = !isSecondPass && seedField ? Math.floor(Math.random() * 1e15) : undefined;
    let multiplier = 1;
    if (isSecondPass) {
      multiplier = Number(secondPass?.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("二采放大倍数无效：" + String(secondPass?.multiplier));
    }

    const timeoutSignal = AbortSignal.timeout(60 * 60 * 1000);
    const signal = this.signal ? AbortSignal.any([timeoutSignal, this.signal]) : timeoutSignal;

    // 上传前先拉一次面板 input 目录清单：同名同大小且未过期的文件直接复用、跳过上传
    const uploadState: ZmUploadState = {
      assets: await zmListInputAssets(this, baseUrl, signal),
      expireMs: zmExpireMs(this),
      done: new Map<string, string>(),
    };

    // 先上传全部参考素材，拿到 name（顺序与 param_ref_image_1.. / param_ref_video_1.. / param_ref_audio_1.. 对应）
    const imageFiles: string[] = [];
    const videoFiles: string[] = [];
    const audioFiles: string[] = [];
    for (let i = 0; i < images.length; i++) {
      imageFiles.push(await zmUploadMedia(this, baseUrl, images[i], "第 " + (i + 1) + " 张参考图", "image/", signal, uploadState));
    }
    for (let i = 0; i < videos.length; i++) {
      videoFiles.push(await zmUploadMedia(this, baseUrl, videos[i], "第 " + (i + 1) + " 个参考视频", "video/", signal, uploadState));
    }
    for (let i = 0; i < audios.length; i++) {
      audioFiles.push(await zmUploadMedia(this, baseUrl, audios[i], "第 " + (i + 1) + " 个参考音频", "audio/", signal, uploadState));
    }

    // 生成前清显存（尽力而为，失败不拦截生成）：与面板 U 系列快捷生成的默认行为一致。
    // 最多只等 5 秒——面板忙时 /free 可能干等到超时才放行，拖住提交；清显存只是尽力而为，超时直接提交。
    if (zmStr(this.config.clearVram, "on") === "on") {
      await this.tool.fetch(baseUrl + "/api/comfy/proxy/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }

    const inputValues: Record<string, unknown> = {
      prompt: prompt.slice(0, 4000),
      megapixels: mp,
      duration_seconds: duration,
      // 关键：节点会用 gh_state_json 里存的旧提示词/旧参考图覆盖传入值，必须清空
      gh_state_json: "",
      // 三个 cache 字段是同一个标记，全部要传
      cache_id: cacheId,
      cache_id_2: cacheId,
      cache_id_3: cacheId,
      // 放大倍数：一采传 1，二采传实际倍数，由工作流内部放大
      value: isSecondPass ? multiplier : 1,
      // 是否二采
      value_2: isSecondPass,
    };
    const aspect = zmStr(request.ratio);
    if (aspect) inputValues.aspect = aspect;
    if (seed !== undefined) inputValues[seedField] = seed;
    imageFiles.forEach((name, i) => { inputValues["param_ref_image_" + (i + 1)] = name; });
    videoFiles.forEach((name, i) => { inputValues["param_ref_video_" + (i + 1)] = name; });
    audioFiles.forEach((name, i) => { inputValues["param_ref_audio_" + (i + 1)] = name; });

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
      throw new Error("提交任务失败：" + zmSafeText(created?.error ?? created));
    }
    const promptId = String(created.prompt_id);

    // 轮询：每 3 秒查一次，最长约 60 分钟（超时信号兜底）
    for (let i = 0; i < 1200; i++) {
      await zmSleep(3000, this.signal);
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
      if (data.error) throw new Error("任务执行失败：" + zmSafeText(data.error));
      const results = Array.isArray(data.results) ? data.results : [];
      const video = results.find((r: any) => r && r.type === "video" && typeof r.url === "string" && r.url);
      if (!video) {
        throw new Error("任务已完成，但结果里没有视频。结果：" + zmSafeText(results.map((r: any) => r?.type)));
      }
      const url = /^https?:\/\//i.test(video.url) ? video.url : baseUrl + (video.url.startsWith("/") ? video.url : "/" + video.url);
      signal.throwIfAborted();
      const assets: ZmMediaAsset[] = [{ mediaType: "video", type: "url", url }];
      // cache_id 随结果回传宿主保存：一采时是本次新生成的标记，二采时是复用的一采标记；
      // 一采实际用的种子也一并回传，方便事后查证/复现（宿主现有逻辑不受影响）。
      return { assets, providerData: { zealmanH3: { cacheId, pass: isSecondPass ? 2 : 1, ...(seed !== undefined ? { seed } : {}) } } };
    }
    throw new Error("任务等待超时（约 60 分钟）。prompt_id 只存在于面板内存中，请到面板确认任务状态");
  },
};
