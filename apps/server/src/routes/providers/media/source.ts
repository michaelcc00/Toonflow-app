import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";
import { getMediaProvider } from "@/utils/media/provider";

export default Router().get("/", validateFields({ fileName: z.string().min(1).max(128) }, "query"), async (req, res) => {
  try {
    const fileName = String(req.query.fileName);
    const id = fileName.replace(/\.ts$/, "");
    const provider = await getMediaProvider(id);
    if (provider.fileName !== fileName) {
      res.status(404).json(error("供应商不存在", null, 404));
      return;
    }
    res.json(success({ fileName, source: provider.source }));
  } catch {
    res.status(404).json(error("供应商不存在", null, 404));
  }
});
