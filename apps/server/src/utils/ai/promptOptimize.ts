import type { Request } from "express";
import { getConfiguredModel, readAiReferences, streamAi } from "@/utils/ai";
import { resolveWorkspace } from "@/utils/workspace";

export interface PromptOptimizeArgs {
  req: Request;
  providerId: string;
  modelId: string;
  prompt: string;
  /** 工作区相对路径的图片引用，顺序即 <Picture N> 编号 */
  imagePaths: { path: string; mimeType: string }[];
  language: "zh" | "en";
  readMedia: boolean;
  /** 提示词模板，可用占位符 {{lang}} {{mediaNote}} {{imageCount}}；不传用内置 */
  systemTemplate?: string;
  directory?: string;
  signal?: AbortSignal;
}

const builtinTemplate = `You are a professional video-generation prompt optimizer. Rewrite the user's raw prompt into a structured video prompt for a reference-driven video model.

{{mediaNote}}

Output language: {{lang}}. Output ONLY the optimized prompt, no explanations, no markdown fences.

Output format (exact, keep the English section headers):

subject_definitions:
<Subject 1>: <concise visual description>, as shown in <Picture 1>.
<Subject 2>: <concise visual description>, as shown in <Picture 2>.

summary:
[reference generation] <one-paragraph video description>

Rules:
- subject_definitions lists each distinct subject (person, vehicle, key object, scene) once, numbered <Subject 1>, <Subject 2>, ...
- Every definition ends with "，如<Picture N>所示。" binding it to its reference image; without a reference image, describe from text only and omit the binding.
- In summary, after first mention refer to subjects with the shorthand (S1), (S2), ...
- summary starts with the literal tag [reference generation], then one paragraph: scene, subject actions and interactions, camera movement, lighting and atmosphere.
- Preserve ALL dialogue lines verbatim, wrapped as <d>dialogue</d> inside summary. Never invent dialogue.
- Preserve the user's intent; enrich visual and cinematic detail but do not add new plot elements.
- <Picture N> always refers to the Nth reference image, 1-based. Never renumber.`;

function systemPrompt(template: string, imageCount: number, language: "zh" | "en", readMedia: boolean): string {
  const lang = language === "en" ? "English" : "中文";
  const mediaNote = readMedia && imageCount > 0
    ? `本次共传入 ${imageCount} 张参考图（<Picture 1>..<Picture ${imageCount}>），已按顺序附在后面。请观察每张图中的主体，在 subject_definitions 中为每个不同的主体建定义。`
    : "本次没有可读的参考图，只根据用户文字改写；subject_definitions 只写文字中明确提到的主体。";
  return template
    .replace(/\{\{lang\}\}/g, lang)
    .replace(/\{\{mediaNote\}\}/g, mediaNote)
    .replace(/\{\{imageCount\}\}/g, String(imageCount));
}

/** 用用户自配的文本模型做提示词优化，返回优化后的完整文本。 */
export async function optimizePrompt(args: PromptOptimizeArgs): Promise<string> {
  const { req, providerId, modelId, prompt, imagePaths, language, readMedia, systemTemplate, directory, signal } = args;
  if (!prompt.trim()) throw Object.assign(new Error("提示词不能为空"), { status: 400 });
  const configured = getConfiguredModel(providerId, modelId);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const count = readMedia ? imagePaths.length : 0;
    const dir = count ? await resolveWorkspace(req, directory ?? "") : undefined;
    const references = dir
      ? await readAiReferences(dir, imagePaths.map(item => ({
        dataType: "IMAGE" as const,
        value: { url: item.path, mimeType: item.mimeType },
      })), controller.signal)
      : [];
    const refs = count ? `\n\nReference images: ${Array.from({ length: count }, (_, i) => `<Picture ${i + 1}>`).join(", ")} (attached below in order).` : "";
    const stream = streamAi(configured, {
      systemPrompt: systemPrompt(systemTemplate || builtinTemplate, count, language, readMedia),
      messages: [{ role: "user", content: `Raw user prompt:\n${prompt}${refs}`, timestamp: Date.now() }],
    }, controller.signal, references);
    let text = "";
    for await (const event of stream) {
      if (event.type === "text_delta") text += event.delta;
    }
    const message = await stream.result();
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw new Error((message as { errorMessage?: string }).errorMessage || "模型请求失败");
    }
    if (!text.trim() && Array.isArray((message as { content?: unknown }).content)) {
      for (const part of (message as { content: { type: string; text?: string }[] }).content) {
        if (part.type === "text" && part.text) text += part.text;
      }
    }
    const optimized = text.trim();
    if (!optimized) throw new Error("优化模型未返回文本，请更换模型或重试");
    return optimized;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
