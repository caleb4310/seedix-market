/** Browser policy for the web app. Nginx repeats the non-CSP headers. */
export function contentSecurityPolicy(nonce: string): string {
  return [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://testnet-rpc.elysium.kinetiq.xyz https://rpc.elysium.kinetiq.xyz https://api.coingecko.com https://explorer-elysium-testnet.t.conduit.xyz https://elyscan.live https://rpc.walletconnect.com https://relay.walletconnect.com wss://relay.walletconnect.com https://pulse.walletconnect.org https://api.web3modal.org https://explorer-api.walletconnect.com",
  "frame-src https://verify.walletconnect.com https://secure.walletconnect.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  ].join("; ");
}

export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
] as const;
