import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const withoutQueries = css.replace(/@media[^{]+/g, "");
const raw = withoutQueries.match(/\d+px/g);
if (raw) {
  console.error("globals.css must use tokens.ts variables, not raw px:");
  console.error(raw.join(", "));
  process.exit(1);
}
console.log("globals.css uses token variables only");
