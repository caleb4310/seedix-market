import { createServer } from "node:http";
import pg from "pg";
import { elysiumTestnet } from "@seedix/shared";
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
    handleRequest(pool, req.method ?? "GET", url.pathname, url.searchParams)
      .then((result) => {
        const body = JSON.stringify(result.json);
        res.writeHead(result.status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
        res.end(body);
      })
      .catch((err: unknown) => {
        console.error("api request failed", err instanceof Error ? err.message : "unknown error");
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "unavailable" }));
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
