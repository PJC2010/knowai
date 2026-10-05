export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_BUCKET = "brief-images";

// Publisher CDNs can differ from the article host. Images are displayed directly;
// the server never follows these URLs or proxies arbitrary image origins.
export function safeImageUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value.trim(), base);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") ||
      host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export async function validateImageUpload(file: File): Promise<{ bytes: Uint8Array; contentType: string; extension: string }> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error("Choose an image up to 3 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  const kind = starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a) ? {contentType:"image/png",extension:"png"} :
    starts(0xff,0xd8,0xff) ? {contentType:"image/jpeg",extension:"jpg"} :
    text(0,4) === "RIFF" && text(8,12) === "WEBP" ? {contentType:"image/webp",extension:"webp"} : null;
  if (!kind || file.type !== kind.contentType) throw new Error("Choose a valid JPEG, PNG, or WebP image.");
  return {bytes,...kind};
}

export function validFeaturedWeek(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value && date.getUTCDay() === 1;
}
