// ACT: 桌面端 WebView 会拦截 Blob 下载链接，优先用 File System Access API 让用户选保存位置，不支持时降级为浏览器下载。
type SaveFilePicker = (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> } | null>;

export async function saveTextFile(fileName: string, content: string, description = "JSON 文件"): Promise<"saved" | "downloaded" | "cancelled"> {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker.call(window, { suggestedName: fileName, types: [{ description, accept: { "application/json": [".json"] } }] });
      if (!handle) return "cancelled";
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // 降级到 Blob 下载。
    }
  }
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
