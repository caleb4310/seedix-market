import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 1024 * 1024;

const links = new Map<string, string>();
let indexLoaded = false;

function indexPath(): string {
  return path.join(logoDir(), "index.json");
}

function remember(poolId: string, url: string): boolean {
  if (!/^0x[0-9a-fA-F]{64}$/.test(poolId)) return false;
  const stored = storedLogo(url);
  if (!stored) return false;
  links.set(poolId.toLowerCase(), stored);
  return true;
}

/** The pool-to-logo map used to live only in memory, so a restart showed the letter fallback. */
export function loadLogoIndex(): void {
  if (indexLoaded) return;
  indexLoaded = true;
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), "utf8")) as Record<string, unknown>;
    for (const [id, url] of Object.entries(parsed)) {
      if (typeof url === "string") remember(id, url);
    }
  } catch {
    /* first boot, or a directory that is not writable yet */
  }
}

function persistIndex(): void {
  const dir = logoDir();
  mkdirSync(dir, { recursive: true });
  const body: Record<string, string> = {};
  for (const [id, url] of links) body[id] = url;
  writeFileSync(indexPath(), JSON.stringify(body));
}

/** Canonical URL the browser can load through the `/api/` proxy. */
export function publicLogoUrl(file: string): string {
  return `/api/logos/${file}`;
}

function storedLogo(url: string): string | null {
  if (url.startsWith("/api/logos/") || url.startsWith("/logos/")) return url;
  return null;
}

export function loadableLogo(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/logos/")) return `/api${url}`;
  if (url.startsWith("/api/logos/")) return url;
  return null;
}

export function attachLogo(poolId: string, url: string): void {
  loadLogoIndex();
  if (!remember(poolId, url)) return;
  persistIndex();
}

export function logoFor(poolId: string): string | null {
  loadLogoIndex();
  return loadableLogo(links.get(poolId.toLowerCase()) ?? null);
}

export function logoDir(): string {
  return process.env.LOGOS_DIR && process.env.LOGOS_DIR.length > 0 ? process.env.LOGOS_DIR : "/tmp/seedix-logos";
}

/** Shrink to 512px on the long side. PNG, JPEG, and WEBP only. */
export async function shrinkLogo(bytes: Buffer): Promise<Buffer | null> {
  if (!imageKind(bytes)) return null;
  const sharp = (await import("sharp")).default;
  let image = sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
  const meta = await image.metadata();
  if ((meta.width ?? 0) > 512 || (meta.height ?? 0) > 512) {
    image = image.resize(512, 512, { fit: "inside", withoutEnlargement: true });
  }
  if (meta.format === "png") return image.png().toBuffer();
  if (meta.format === "webp") return image.webp().toBuffer();
  return image.jpeg({ quality: 85 }).toBuffer();
}

/** PNG, JPEG, or WEBP only. SVG and anything else is rejected before it is stored. */
export function imageKind(bytes: Buffer): "png" | "jpg" | "webp" | null {
  if (bytes.length < 12 || bytes.length > MAX_BYTES) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export async function saveLogo(bytes: Buffer): Promise<{ file: string; type: string } | null> {
  const kind = imageKind(bytes);
  if (!kind) return null;
  const dir = logoDir();
  await mkdir(dir, { recursive: true });
  const file = `${Date.now().toString(16)}-${bytes.length}.${kind === "jpg" ? "jpg" : kind}`;
  await writeFile(path.join(dir, file), bytes);
  const type = kind === "png" ? "image/png" : kind === "jpg" ? "image/jpeg" : "image/webp";
  return { file, type };
}

export async function readLogo(file: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^[0-9a-f]+-\d+\.(png|jpg|webp)$/.test(file)) return null;
  try {
    const bytes = await readFile(path.join(logoDir(), file));
    const kind = imageKind(bytes);
    if (!kind) return null;
    const type = kind === "png" ? "image/png" : kind === "jpg" ? "image/jpeg" : "image/webp";
    return { bytes, type };
  } catch {
    return null;
  }
}
