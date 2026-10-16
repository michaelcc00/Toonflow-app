import type { BrowserFfmpegCommand, BrowserFfmpegFactory } from "@toonflow/ffmpeg/browser";

function normalizePath(path: string) {
  if (!path || /[\x00-\x1f]/.test(path) || /^(?:[\\/]|[a-z][a-z\d+.-]*:)/i.test(path) || path.split(/[\\/]+/).includes("..")) {
    throw new Error("视频合成必须使用工作区相对路径");
  }
  return path.split(/[\\/]+/).filter(part => part && part !== ".").join("/");
}

function runCommand(command: BrowserFfmpegCommand, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const cancel = () => command.kill();
  signal?.addEventListener("abort", cancel, { once: true });
  return new Promise<void>((resolve, reject) => {
    command.on("start", () => { if (signal?.aborted) command.kill(); });
    command.on("error", error => reject(signal?.aborted ? signal.reason : error));
    command.on("end", () => signal?.aborted ? reject(signal.reason) : resolve());
    command.run();
  }).finally(() => signal?.removeEventListener("abort", cancel));
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
  command.concat(output);
  await runCommand(command, signal);
}
