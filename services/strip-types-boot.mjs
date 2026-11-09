/**
 * Load every service module the way Compose does, then call main().
 * Node's --check flag does not walk imports and does not reject parameter
 * properties, so this imports the files under --experimental-strip-types.
 *
 * Run from the repo root:
 *   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON services/strip-types-boot.mjs
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

delete process.env.DATABASE_URL;
delete process.env.KEEPER_PRIVATE_KEY;
delete process.env.KEEPER_KEY_FILE;

const root = path.resolve(import.meta.dirname, "..");

async function tsFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...(await tsFiles(full)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

const serviceFiles = await tsFiles(path.join(root, "services"));
for (const file of serviceFiles) {
  await import(pathToFileURL(file).href);
}

const entrypoints = [
  "services/api/src/index.ts",
  "services/indexer/src/index.ts",
  "services/keeper/src/index.ts",
  "services/kickback/src/index.ts",
];

for (const entry of entrypoints) {
  const loaded = await import(pathToFileURL(path.join(root, entry)).href);
  if (typeof loaded.main !== "function") throw new Error(`${entry} does not export main`);
  await loaded.main();
  console.log(`booted ${entry}`);
}

for (const entry of ["apps/web/lib/amounts.ts", "apps/web/lib/api.ts"]) {
  await import(pathToFileURL(path.join(root, entry)).href);
  console.log(`loaded ${entry}`);
}
