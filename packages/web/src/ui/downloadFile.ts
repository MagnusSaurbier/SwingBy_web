// Saves a string to disk as a file. Prefers a native "Save As" dialog (File System Access API,
// Chromium-only — not in this repo's `lib.dom.d.ts`, hence the local types below) so the user picks
// where the file goes; falls back to a plain `<a download>` click everywhere else, which still
// downloads the file but to the browser's configured downloads folder with no location prompt.
//
// DOM/browser-only, so untestable under this repo's no-jsdom vitest setup — verified with a real
// browser pass instead (see the "run" skill).

interface SaveFilePickerAccept {
  description?: string;
  accept: Record<string, string[]>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: SaveFilePickerAccept[];
}
interface FileSystemWritableStream {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableStream>;
}
type ShowSaveFilePicker = (
  options?: SaveFilePickerOptions,
) => Promise<FileSystemFileHandleLike>;

function showSaveFilePicker(): ShowSaveFilePicker | null {
  const fn = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;
  return typeof fn === "function" ? fn : null;
}

function downloadViaAnchor(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Saves `content` to a file named `filename`. Asks the user where to save it when the browser's
 * File System Access API is available; otherwise falls back to a normal browser download. Never
 * throws — a picker error other than the user cancelling (`AbortError`) falls back to the anchor
 * download rather than losing the export.
 */
export async function saveTextFile(
  content: string,
  filename: string,
  mimeType = "application/json",
): Promise<void> {
  const picker = showSaveFilePicker();
  if (picker) {
    try {
      const extension = filename.includes(".")
        ? `.${filename.split(".").pop()}`
        : "";
      const handle = await picker({
        suggestedName: filename,
        types: extension
          ? [
              {
                description: "SwingBy level file",
                accept: { [mimeType]: [extension] },
              },
            ]
          : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return;
      // Any other picker failure (e.g. a browser that half-implements the API): fall through.
    }
  }
  downloadViaAnchor(content, filename, mimeType);
}
