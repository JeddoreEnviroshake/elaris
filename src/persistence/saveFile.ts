import type { PortableSave } from './types';

/**
 * Export/import file helpers. Export produces a versioned JSON Blob download
 * (with a Web Share payload where available, falling back to download). Import
 * uses a standard file input — no File System Access API dependency.
 */

export function downloadSave(save: PortableSave): void {
  const json = JSON.stringify(save, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `elaris-save-${stamp}.json`;

  const shareData = { files: [new File([blob], filename, { type: 'application/json' })] };
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (typeof navigator.share === 'function' && nav.canShare?.(shareData)) {
    void navigator.share(shareData).catch(() => downloadBlob(blob, filename));
    return;
  }
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Open a file picker and resolve with the parsed JSON (unvalidated). */
export function pickSaveFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
