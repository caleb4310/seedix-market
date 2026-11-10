import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 512 * 1024;

export function logoDir(): string {
  return process.env.LOGOS_DIR && process.env.LOGOS_DIR.length > 0 ? process.env.LOGOS_DIR : "/tmp/seedix-logos";
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
