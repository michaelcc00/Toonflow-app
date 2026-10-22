import type { BrowserFfmpegCommand, BrowserFfmpegFactory } from "@toonflow/ffmpeg/browser";

function normalizePath(path: string) {
  if (!path || /[\x00-\x1f]/.test(path) || /^(?:[\\/]|[a-z][a-z\d+.-]*:)/i.test(path) || path.split(/[\\/]+/).includes("..")) {
    throw new Error("视频合成必须使用工作区相对路径");
  }
  return path.split(/[\\/]+/).filter(part => part && part !== ".").join("/");
}

function runConcat(command: BrowserFfmpegCommand, output: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cancel = () => command.kill();
    signal?.addEventListener("abort", cancel, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    const stderrLines: string[] = [];
    command.on("stderr", (line: string) => {
      stderrLines.push(String(line));
      if (stderrLines.length > 12) stderrLines.shift();
    });
    command.on("start", () => { if (signal?.aborted) command.kill(); });
    command.on("error", (error: Error, _stdout?: string | null, stderr?: string | null) => {
      cleanup();
      if (signal?.aborted) { reject(signal.reason); return; }
      // ACT: fluent 的报错只带 stderr 最后一行；把尾部几行带上，弹窗里能看到失败的真正原因。
      const detail = (typeof stderr === "string" && stderr.trim() ? stderr : stderrLines.join("\n")).trim().split("\n").slice(-6).join("\n");
      reject(detail && !error.message.includes(detail) ? new Error(`${error.message}\n${detail}`) : error);
    });
    command.on("end", () => {
      cleanup();
      if (signal?.aborted) reject(signal.reason);
      else resolve();
    });
    // ACT: concat 是 run 方法，调用即开始执行；不能再调 run()，否则二次启动报错。
    command.concat(output);
  });
}

export function mergedFileName() {
  const now = new Date();
  const parts = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()];
  const stamp = parts.map((value, index) => index === 0 ? String(value) : String(value).padStart(2, "0")).join("");
  return `merged${stamp}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}.mp4`;
}

/** 按给定顺序拼接多个视频；要求同编码同分辨率（如同一模型生成的视频），输出为 H.264 MP4。 */
export async function mergeVideos(ffmpeg: BrowserFfmpegFactory, sources: string[], outputPath: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const inputs = sources.map(normalizePath);
  if (inputs.length < 2) throw new Error("至少需要 2 个视频才能合成");
  if (new Set(inputs).size !== inputs.length) throw new Error("合成列表中有重复视频");
  const output = normalizePath(outputPath);
  if (inputs.includes(output)) throw new Error("输出文件不能覆盖原视频");
  const command = ffmpeg(inputs[0]);
  for (const source of inputs.slice(1)) command.input(source);
  await runConcat(command, output, signal);
}
