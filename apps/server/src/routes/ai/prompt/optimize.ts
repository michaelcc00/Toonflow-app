import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const imageSchema = z.object({
  path: z.string().min(1).max(4096),
  mimeType: z.string().startsWith("image/"),
});

export default Router().post("/", validateFields({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(20000),
  imagePaths: z.array(imageSchema).max(9).optional(),
  language: z.enum(["zh", "en"]).optional(),
  readMedia: z.boolean().optional(),
  systemTemplate: z.string().min(1).max(20000).optional(),
  templateId: z.string().min(1).max(128).optional(),
  task: z.enum(["T2VA", "I2VA", "L2VA", "FL2VA", "REF2VA", "HYBRID"]).optional(),
  duration: z.number().positive().max(3600).optional(),
  directory: z.string().min(1).max(4096).optional(),
}), async (req, res) => {
  const body = req.body as {
    providerId: string; modelId: string; prompt: string;
    imagePaths?: { path: string; mimeType: string }[];
    language?: "zh" | "en"; readMedia?: boolean; systemTemplate?: string;
    templateId?: string; task?: "T2VA" | "I2VA" | "L2VA" | "FL2VA" | "REF2VA" | "HYBRID";
    duration?: number; directory?: string;
  };
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  try {
    const optimized = await u.ai.optimizePrompt({
      req,
      providerId: body.providerId,
      modelId: body.modelId,
      prompt: body.prompt,
      imagePaths: body.imagePaths ?? [],
      language: body.language ?? "zh",
      readMedia: body.readMedia ?? true,
      systemTemplate: body.systemTemplate,
      templateId: body.templateId,
      task: body.task ?? "REF2VA",
      duration: body.duration ?? 5,
      directory: body.directory,
      signal: controller.signal,
    });
    res.json(success({ optimized }));
  } finally {
    res.off("close", close);
  }
});
