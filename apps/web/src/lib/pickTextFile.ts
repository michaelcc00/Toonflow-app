// ACT: 桌面端 WebView 会拦截隐藏文件输入的程序化点击，优先用 File System Access API 弹系统选择框，不支持时降级为临时 file input。
type OpenFilePicker = (options: unknown) => Promise<{ getFile: () => Promise<File> }[]>;

export async function pickTextFile(): Promise<{ name: string; text: string } | undefined> {
  const picker = (window as Window & { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (typeof picker === "function") {
    try {
      const handles = await picker.call(window, {
        types: [{ description: "JSON 文件", accept: { "application/json": [".json"] } }],
        multiple: false,
      });
      const handle = handles?.[0];
      if (!handle) return undefined;
      const file = await handle.getFile();
      return { name: file.name, text: await file.text() };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      // 降级到文件输入框。
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { name: file.name, text: await file.text() } : undefined);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(undefined);
    });
    document.body.appendChild(input);
    input.click();
  });
}
