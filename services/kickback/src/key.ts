import path from "node:path";

export type Hex = `0x${string}`;

/** The publisher key is a file path. A raw key in the environment is refused. */
export function publisherKeyPath(env: { PUBLISHER_PRIVATE_KEY?: string }): string {
  const raw = (env.PUBLISHER_PRIVATE_KEY ?? "").trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) throw new Error("PUBLISHER_PRIVATE_KEY must be a file path, not the key");
  return raw;
}

export function assertKeyFile(filePath: string, mode: number, uid: number): void {
  const resolved = path.resolve(filePath);
  const cwd = process.cwd();
  if (resolved === cwd || resolved.startsWith(cwd + path.sep)) {
    throw new Error("publisher key must not live in the working tree");
  }
  const bits = mode & 0o777;
  if (resolved.startsWith("/run/secrets/")) {
    if ((bits & 0o022) !== 0) throw new Error("Docker secret must not be writable by group or others");
    return;
  }
  if (uid !== 0 || (bits & 0o077) !== 0) throw new Error("publisher key file must be owned by root and mode 600");
}

export function loadKey(text: string): Hex {
  const line = text.trim().split(/\s+/)[0] ?? "";
  const hex = line.startsWith("0x") ? line : `0x${line}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("publisher key file must contain one hex private key");
  return hex as Hex;
}
