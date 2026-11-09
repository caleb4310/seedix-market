export type Hex = `0x${string}`;

export function isAddress(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isPoolId(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function toBuffer(hex: string): Buffer {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) throw new Error("bad hex");
  return Buffer.from(body, "hex");
}

export function fromBuffer(value: Buffer): Hex {
  return `0x${value.toString("hex")}`;
}

export function lower(hex: string): string {
  return hex.toLowerCase();
}
