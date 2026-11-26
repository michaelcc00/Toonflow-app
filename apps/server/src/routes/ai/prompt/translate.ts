import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  text: z.string().min(1).max(200000),
}), async (req, res) => {
  const body = req.body as { providerId: string; modelId: string; text: string };
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  try {
    const translated = await u.ai.translatePromptText({
      providerId: body.providerId,
      modelId: body.modelId,
      text: body.text,
      signal: controller.signal,
    });
    res.json(success({ translated }));
  } finally {
    res.off("close", close);
  }
});
