/** Shared EIP-712 types for logo upload and attach. Chain id is set by the signer. */
export const logoDomainName = { name: "Seedix", version: "1" } as const;

export const logoUploadTypes = {
  LogoUpload: [
    { name: "contentHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const logoAttachTypes = {
  LogoAttach: [
    { name: "poolId", type: "bytes32" },
    { name: "url", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const LOGO_EXPIRY_SECONDS = 10 * 60;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_RATE_LIMIT = 6;
export const LOGO_RATE_WINDOW_MS = 10 * 60 * 1000;
