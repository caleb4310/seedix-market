import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 1024 * 1024;

/** A logo uploaded for a launch can bind to a pool that starts within this window. */
export const LOGO_PENDING_WINDOW_SEC = 2 * 60 * 60;
/** A launch timestamp may sit this far behind the upload clock. Older coins are left alone. */
export const LOGO_PENDING_SKEW_SEC = 30;

const links = new Map<string, string>();
let indexStamp = "";

type PendingLogo = { url: string; uploadedAt: number };
const pending = new Map<string, PendingLogo>();
let pendingStamp = "";

function indexPath(): string {
  return path.join(logoDir(), "index.json");
}

function pendingPath(): string {
  return path.join(logoDir(), "pending.json");
}

function remember(poolId: string, url: string): boolean {
  if (!/^0x[0-9a-fA-F]{64}$/.test(poolId)) return false;
  const stored = storedLogo(url);
  if (!stored) return false;
  links.set(poolId.toLowerCase(), stored);
  return true;
}

/**
 * Read the pool map from disk.
 * A missing or unreadable index is not treated as an empty map forever: the next call tries again.
 * A newer index.json (another write, or the file appearing after boot) replaces the in-memory map.
 */
export function loadLogoIndex(): void {
  const file = indexPath();
  let stamp = "";
  try {
    const stat = statSync(file);
    stamp = `${file}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    if (indexStamp && !indexStamp.startsWith(`${file}:`)) {
      links.clear();
      indexStamp = "";
    }
    return;
  }
  if (stamp === indexStamp) return;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const next = new Map<string, string>();
    for (const [id, url] of Object.entries(parsed)) {
      if (typeof url !== "string" || !rememberInto(next, id, url)) continue;
    }
    links.clear();
    for (const [id, url] of next) links.set(id, url);
    indexStamp = stamp;
  } catch {
    /* unreadable: try again on the next read */
  }
}

function rememberInto(target: Map<string, string>, poolId: string, url: string): boolean {
  if (!/^0x[0-9a-fA-F]{64}$/.test(poolId)) return false;
  const stored = storedLogo(url);
  if (!stored) return false;
  target.set(poolId.toLowerCase(), stored);
  return true;
}

function persistIndex(): void {
  const dir = logoDir();
  mkdirSync(dir, { recursive: true });
  const body: Record<string, string> = {};
  for (const [id, url] of links) body[id] = url;
  writeFileSync(indexPath(), JSON.stringify(body));
  const stat = statSync(indexPath());
  indexStamp = `${indexPath()}:${stat.mtimeMs}:${stat.size}`;
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

/** Returns false when the pool id or URL is rejected, so the route can answer 4xx. */
export function attachLogo(poolId: string, url: string): boolean {
  loadLogoIndex();
  if (!remember(poolId, url)) return false;
  persistIndex();
  return true;
}

export function logoFor(poolId: string): string | null {
  loadLogoIndex();
  return loadableLogo(links.get(poolId.toLowerCase()) ?? null);
}

function loadPending(): void {
  const file = pendingPath();
  let stamp = "";
  try {
    const stat = statSync(file);
    stamp = `${file}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    if (pendingStamp && !pendingStamp.startsWith(`${file}:`)) {
      pending.clear();
      pendingStamp = "";
    }
    return;
  }
  if (stamp === pendingStamp) return;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const next = new Map<string, PendingLogo>();
    for (const [address, row] of Object.entries(parsed)) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !row || typeof row !== "object") continue;
      const record = row as { url?: unknown; uploadedAt?: unknown };
      if (typeof record.url !== "string" || typeof record.uploadedAt !== "number") continue;
      const stored = storedLogo(record.url);
      if (!stored || !Number.isFinite(record.uploadedAt)) continue;
      next.set(address.toLowerCase(), { url: stored, uploadedAt: record.uploadedAt });
    }
    pending.clear();
    for (const [address, row] of next) pending.set(address, row);
    pendingStamp = stamp;
  } catch {
    /* unreadable: try again on the next read */
  }
}

function persistPending(): void {
  const dir = logoDir();
  mkdirSync(dir, { recursive: true });
  const body: Record<string, PendingLogo> = {};
  for (const [address, row] of pending) body[address] = row;
  writeFileSync(pendingPath(), JSON.stringify(body));
  const stat = statSync(pendingPath());
  pendingStamp = `${pendingPath()}:${stat.mtimeMs}:${stat.size}`;
}

/** The LogoUpload signer is the only address that can later receive this file on a pool. */
export function rememberPending(signer: string, url: string, uploadedAt = Date.now()): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer)) return false;
  const stored = storedLogo(url);
  if (!stored) return false;
  loadPending();
  pending.set(signer.toLowerCase(), { url: stored, uploadedAt });
  persistPending();
  return true;
}

/**
 * Bind a pending upload to a pool whose on-chain fee recipient is the upload signer.
 * The logo must have been uploaded shortly before that pool launched. A different creator's pool is ignored.
 */
export function claimPending(input: { poolId: string; feeRecipient: string; launchTime: number }): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.feeRecipient)) return false;
  loadPending();
  const row = pending.get(input.feeRecipient.toLowerCase());
  if (!row) return false;
  const launch = input.launchTime;
  if (!Number.isFinite(launch) || launch <= 0) return false;
  const uploadedSec = Math.floor(row.uploadedAt / 1000);
  if (uploadedSec > launch + LOGO_PENDING_SKEW_SEC) return false;
  if (launch - uploadedSec > LOGO_PENDING_WINDOW_SEC) return false;
  const existing = logoFor(input.poolId);
  const wanted = loadableLogo(row.url);
  if (existing) {
    if (existing !== wanted) return false;
    pending.delete(input.feeRecipient.toLowerCase());
    persistPending();
    return true;
  }
  if (!attachLogo(input.poolId, row.url)) return false;
  pending.delete(input.feeRecipient.toLowerCase());
  persistPending();
  return true;
}

/** Earliest launch after the upload wins, so a later coin does not take a logo meant for the first one. */
export function bindPendingLogos(rows: Array<{ poolId: string; feeRecipient: string; launchTime: number }>): string[] {
  const ordered = [...rows].sort((a, b) => a.launchTime - b.launchTime);
  const bound: string[] = [];
  for (const row of ordered) {
    if (claimPending(row)) bound.push(row.poolId.toLowerCase());
  }
  return bound;
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
