import { extForMime } from './mime';

export type ClipboardItemLike<TFile> = {
  kind: string;
  type: string;
  getAsFile: () => TFile | null;
};

/**
 * Return the first supported image file in a synchronous paste item list.
 * Non-file items and unsupported formats are left for normal paste handling.
 */
export function selectClipboardImage<TFile>(
  items: Iterable<ClipboardItemLike<TFile>>,
): TFile | null {
  for (const item of items) {
    if (item.kind !== 'file' || !extForMime(item.type)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}
