import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { t } from "@/lib/i18n";

const mediaTypes: Record<string, string> = {
  ".avif": "image/avif", ".bmp": "image/bmp", ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".aac": "audio/aac", ".flac": "audio/flac", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
  ".avi": "video/x-msvideo", ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".mp4": "video/mp4", ".webm": "video/webm",
};

function clipboardPaths(text: string) {
  const paths = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    let value = line.trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (/^file:/i.test(value)) {
      try { value = fileURLToPath(value); }
      catch { continue; }
    }
    if (/^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/")) paths.add(value);
  }
  return [...paths];
}

async function readClipboardFile(path: string) {
  const info = await stat(path);
  if (!info.isFile()) return;
  if (info.size > 100 * 1024 * 1024) throw new Error(t`剪贴板文件“${basename(path)}”超过 100 MB`);
  const mimeType = mediaTypes[extname(path).toLowerCase()];
  if (!mimeType) throw new Error(t`剪贴板文件“${basename(path)}”不是支持的图片、视频或音频`);
  const bytes = await readFile(path);
  return { name: basename(path), mimeType, data: bytes.toString("base64") };
}

// ACT: Windows 原生剪贴板图像常是无文件头的 DIB，补上 14 字节 BITMAPFILEHEADER 组成合法 BMP。
function dibToBmp(dib: Buffer) {
  const headerSize = dib.readUInt32LE(0);
  const bitCount = headerSize === 12 ? dib.readUInt16LE(10) : dib.readUInt16LE(14);
  const compression = headerSize === 12 ? 0 : dib.readUInt32LE(16);
  const colorsUsed = headerSize >= 40 ? dib.readUInt32LE(32) : 0;
  const paletteBytes = bitCount <= 8
    ? (colorsUsed || 2 ** bitCount) * (headerSize === 12 ? 3 : 4)
    : compression === 3 ? 12 : 0;
  const dataOffset = 14 + headerSize + paletteBytes;
  const header = Buffer.alloc(14);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(dib.length + 14, 2);
  header.writeUInt32LE(dataOffset, 10);
  return Buffer.concat([header, dib]);
}

// ACT: 桌面运行时返回的剪贴板图像字节不保证是 PNG，按文件头嗅探真实格式并纠正 mime 与扩展名，否则浏览器无法解码预览。
function normalizeClipboardImage(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  if (data.length >= 4 && data.readUInt32BE(0) === 0x89504e47) return { data, mimeType: "image/png", extension: "png" };
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { data, mimeType: "image/jpeg", extension: "jpg" };
  if (data.length >= 3 && data.toString("ascii", 0, 3) === "GIF") return { data, mimeType: "image/gif", extension: "gif" };
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return { data, mimeType: "image/webp", extension: "webp" };
  if (data.length >= 2 && data.toString("ascii", 0, 2) === "BM") return { data, mimeType: "image/bmp", extension: "bmp" };
  const headerSize = data.length >= 4 ? data.readUInt32LE(0) : 0;
  if (headerSize === 40 || headerSize === 108 || headerSize === 124 || headerSize === 12) {
    return { data: dibToBmp(data), mimeType: "image/bmp", extension: "bmp" };
  }
  return { data, mimeType: "image/png", extension: "png" };
}

// ACT: 读取也使用 POST，复用 desktopRequest 的同源校验。
export default Router().post("/", validateFields({ format: z.enum(["image", "files"]).optional() }), async (req, res) => {
  const desktop = u.desktop.getDesktopRuntime(req);
  if (req.body.format === "image") {
    const image = desktop.readClipboardImage();
    if (!image) {
      res.json(success({ image: null, mimeType: "image/png" }));
      return;
    }
    const normalized = normalizeClipboardImage(image);
    res.json(success({ image: normalized.data.toString("base64"), mimeType: normalized.mimeType }));
    return;
  }
  if (req.body.format === "files") {
    const paths = clipboardPaths(desktop.readClipboardText() ?? "");
    const files = [];
    for (const path of paths) {
      const file = await readClipboardFile(path);
      if (file) files.push(file);
    }
    if (!files.length) {
      const image = desktop.readClipboardImage();
      if (image) {
        const normalized = normalizeClipboardImage(image);
        files.push({ name: `clipboard-image.${normalized.extension}`, mimeType: normalized.mimeType, data: normalized.data.toString("base64") });
      }
    }
    res.json(success({ files }));
    return;
  }
  res.json(success({ text: desktop.readClipboardText() ?? "" }));
});
