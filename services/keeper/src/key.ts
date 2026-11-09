import path from "node:path";

export type Hex = `0x${string}`;

/**
 * A Docker secret may be mode 444, which is how the engine mounts `/run/secrets`.
 * Any other file must be owned by root and unreadable by group and others.
 * The working tree is never an acceptable place for the key.
 */
export function assertKeyFile(filePath: string, mode: number, uid: number): void {
  const resolved = path.resolve(filePath);
  const cwd = process.cwd();
  if (resolved === cwd || resolved.startsWith(cwd + path.sep)) {
    throw new Error("keeper key must not live in the working tree");
  }
  const bits = mode & 0o777;
  if (resolved.startsWith("/run/secrets/")) {
    if ((bits & 0o022) !== 0) throw new Error("Docker secret must not be writable by group or others");
    return;
  }
  if (uid !== 0 || (bits & 0o077) !== 0) throw new Error("keeper key file must be owned by root and mode 600");
}

/** `KEEPER_PRIVATE_KEY` is a path. A raw key in the environment is refused. */
export function keyFilePath(env: { KEEPER_PRIVATE_KEY?: string; KEEPER_KEY_FILE?: string }): string {
  const raw = (env.KEEPER_PRIVATE_KEY ?? env.KEEPER_KEY_FILE ?? "").trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) throw new Error("KEEPER_PRIVATE_KEY must be a file path, not the key");
  return raw;
}

/** One hex line. The error never repeats the file contents. */
export function loadKey(text: string): Hex {
  const line = text.trim().split(/\s+/)[0] ?? "";
  const hex = line.startsWith("0x") ? line : `0x${line}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("keeper key file must contain one hex private key");
  return hex as Hex;
}
