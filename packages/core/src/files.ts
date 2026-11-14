import { WARP_FILE_EXTENSION, type WarpSnapshot } from "./schema";

/** Pretty-printed, stable JSON for committing to a repository. */
export function serializeSnapshot(snapshot: WarpSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Suggested file name, e.g. `checkout-with-coupon.warp.json`. */
export function snapshotFileName(snapshot: WarpSnapshot): string {
  const fromMeta = snapshot.meta?.name ? slugify(snapshot.meta.name) : "";
  const current = snapshot.router.entries[snapshot.router.index] ?? "/";
  const fromRoute = slugify(current.split(/[?#]/)[0] ?? "") || "root";
  return `${fromMeta || fromRoute}${WARP_FILE_EXTENSION}`;
}

/** Triggers a browser download of the snapshot. */
export function downloadSnapshot(snapshot: WarpSnapshot, fileName = snapshotFileName(snapshot)): void {
  const blob = new Blob([serializeSnapshot(snapshot)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Copies the snapshot JSON to the clipboard. Resolves to `false` when the clipboard is unavailable. */
export async function copySnapshot(snapshot: WarpSnapshot): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(serializeSnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
}
