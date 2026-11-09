import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const withoutQueries = css.replace(/@media[^{]+/g, "");
const problems = [];

const px = withoutQueries.match(/\d+px/g);
if (px) problems.push(`raw px: ${px.join(", ")}`);

const relative = withoutQueries.match(/\d*\.?\d+(?:rem|em)\b/g);
if (relative) problems.push(`rem/em: ${relative.join(", ")}`);

const lengthProps = new Set([
  "font-size",
  "line-height",
  "margin",
  "padding",
  "gap",
  "row-gap",
  "column-gap",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "letter-spacing",
  "border-radius",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
]);

for (const match of withoutQueries.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
  const prop = match[1];
  if (!lengthProps.has(prop)) continue;
  const value = match[2]
    .replace(/var\([^)]*\)/g, " ")
    .replace(/minmax\([^)]*\)/g, " ")
    .replace(/calc\([^)]*\)/g, " ")
    .replace(/\b(?:min|max)\([^)]*\)/g, " ")
    .replace(/\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|ch|ex|ms|s|deg|turn|fr|%)(?![a-z0-9.])/g, " ");
  for (const raw of value.match(/-?\d*\.?\d+/g) ?? []) {
    if (Number(raw) !== 0) problems.push(`unitless ${prop}: ${raw.trim()}`);
  }
}

if (problems.length > 0) {
  console.error("globals.css must use tokens.ts variables, not raw px, rem, em, or unitless lengths:");
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log("globals.css uses token variables only");
