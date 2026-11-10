import { createServer } from "node:http";
import pg from "pg";
import { elysiumTestnet } from "@seedix/shared";
import { readLogo, saveLogo } from "./logos.ts";
import { handleRequest } from "./routes.ts";

export const apiConfig = {
  chainId: elysiumTestnet.id,
  port: Number(process.env.API_PORT ?? 3001),
  host: process.env.API_HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "",
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
    if (req.method === "GET" && pathname.startsWith("/logos/")) {
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
        saveLogo(body)
          .then((saved) => {
            if (!saved) {
              res.writeHead(415, { "content-type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: "png, jpeg, or webp under 512kb" }));
              return;
            }
            const payload = JSON.stringify({ url: `/logos/${saved.file}` });
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
      handleRequest(pool, req.method ?? "GET", url.pathname, url.searchParams, { body: parsed })
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

if (process.argv[1]?.endsWith("index.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "api failed");
    process.exitCode = 1;
  });
}
