import { createServer, type IncomingMessage } from "node:http";
import pg from "pg";
import { activeChain, deployment99801 } from "@seedix/shared";
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { verifyAttach, verifyUpload } from "./logoAuth.ts";
import { publicLogoUrl, readLogo, saveLogo, shrinkLogo } from "./logos.ts";
import { handleRequest } from "./routes.ts";

const hookConfigAbi = parseAbi([
  "function config(bytes32) view returns (address coin, address pair, bool coinIsToken0, uint8 mode, bool isPlatform, uint40 launchTime, address feeRecipient)",
]);

const chain = activeChain();

async function feeRecipientOf(poolId: Hex): Promise<Address | null> {
  const client = createPublicClient({
    transport: http(chain.rpcUrls[0]),
  });
  const hook = (process.env.HOOK_ADDRESS || (chain.id === 99801 ? deployment99801.hook : "0xF76b84C90c49a785322f110c66d1155bc26228cC")) as Address;
  const row = await client.readContract({ address: hook, abi: hookConfigAbi, functionName: "config", args: [poolId] });
  const recipient = row[6];
  if (!recipient || /^0x0{40}$/i.test(recipient)) return null;
  return recipient;
}

export const apiConfig = {
  chainId: chain.id,
  port: Number(process.env.API_PORT ?? 3001),
  host: process.env.API_HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "",
  rpcUrl: chain.rpcUrls[0],
};

export async function main(): Promise<void> {
  if (!apiConfig.databaseUrl) {
    console.log("api: set DATABASE_URL to the host launchpad database");
    return;
  }
  const pool = new pg.Pool({ connectionString: apiConfig.databaseUrl });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    if (req.method === "GET" && pathname.startsWith("/logos/") && pathname !== "/logos/nonce") {
      const file = pathname.slice("/logos/".length);
      readLogo(file)
        .then((logo) => {
          if (!logo) {
            res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "not found" }));
            return;
          }
          res.writeHead(200, { "content-type": logo.type, "cache-control": "public, max-age=86400" });
          res.end(logo.bytes);
        })
        .catch(() => {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "unavailable" }));
        });
      return;
    }
    req.on("end", () => {
      if (req.method === "POST" && pathname === "/logos") {
        const body = Buffer.concat(chunks);
        const nonce = header(req, "x-seedix-nonce");
        const expiry = header(req, "x-seedix-expiry");
        const signature = header(req, "x-seedix-signature");
        let parsedNonce = 0n;
        let parsedExpiry = 0n;
        try {
          parsedNonce = BigInt(nonce);
          parsedExpiry = BigInt(expiry);
        } catch {
          res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "signature required" }));
          return;
        }
        verifyUpload({ bytes: body, nonce: parsedNonce, expiry: parsedExpiry, signature: signature as Hex })
          .then(async (auth) => {
            if (!auth.ok) {
              const status = auth.error === "rate limited" ? 429 : 401;
              res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: auth.error }));
              return null;
            }
            const shrunk = await shrinkLogo(body);
            if (!shrunk) return null;
            return saveLogo(shrunk);
          })
          .then((saved) => {
            if (res.writableEnded) return;
            if (!saved) {
              res.writeHead(415, { "content-type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: "png, jpeg, or webp under 1mb" }));
              return;
            }
            const payload = JSON.stringify({ url: publicLogoUrl(saved.file) });
            res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
            res.end(payload);
          })
          .catch(() => {
            res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "unavailable" }));
          });
        return;
      }
      let parsed: unknown;
      if (chunks.length > 0) {
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          parsed = undefined;
        }
      }
      handleRequest(pool, req.method ?? "GET", url.pathname, url.searchParams, {
        body: parsed,
        authorizeAttach: async (input) => {
          if (!input.poolId.startsWith("0x") || !input.signature.startsWith("0x")) {
            return { ok: false, status: 401, error: "signature required" };
          }
          let creator: Address | null;
          try {
            creator = await feeRecipientOf(input.poolId as Hex);
          } catch {
            return { ok: false, status: 503, error: "chain unavailable" };
          }
          if (!creator) return { ok: false, status: 404, error: "unknown coin" };
          const auth = await verifyAttach({
            poolId: input.poolId as Hex,
            url: input.url,
            nonce: input.nonce,
            expiry: input.expiry,
            signature: input.signature as Hex,
            creator,
          });
          return auth.ok ? { ok: true } : { ok: false, status: auth.error === "rate limited" ? 429 : 401, error: auth.error };
        },
      })
        .then((result) => {
          const payload = JSON.stringify(result.json);
          res.writeHead(result.status, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(payload),
          });
          res.end(payload);
        })
        .catch((err: unknown) => {
          console.error("api request failed", err instanceof Error ? err.message : "unknown error");
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "unavailable" }));
        });
    });
  });
  // Compose publishes this port on 127.0.0.1. Inside the container the process listens on all interfaces.
  server.listen(apiConfig.port, apiConfig.host, () => {
    console.log(`api for chain ${apiConfig.chainId} on ${apiConfig.host}:${apiConfig.port}`);
  });
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

if (process.argv[1]?.endsWith("index.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "api failed");
    process.exitCode = 1;
  });
}
