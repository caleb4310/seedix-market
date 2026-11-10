import assert from "node:assert/strict";
import test from "node:test";
import { attachLogo, loadableLogo, logoFor, publicLogoUrl } from "./logos.ts";

test("uploaded logos are addressed where the web can load them", () => {
  assert.equal(publicLogoUrl("abc.png"), "/api/logos/abc.png");
  assert.equal(loadableLogo("/logos/abc.png"), "/api/logos/abc.png");
  assert.equal(loadableLogo("/api/logos/abc.png"), "/api/logos/abc.png");
  const pool = `0x${"ab".repeat(32)}`;
  attachLogo(pool, "/logos/abc.png");
  assert.equal(logoFor(pool), "/api/logos/abc.png");
  attachLogo(pool, publicLogoUrl("def.png"));
  assert.equal(logoFor(pool), "/api/logos/def.png");
});
