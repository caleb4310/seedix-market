import assert from "node:assert/strict";
import test from "node:test";
import { logoAttachPath, logoSrc } from "./logoUrl.ts";

test("logo urls load through the API prefix", () => {
  assert.equal(logoSrc("/logos/abc.png"), "/api/logos/abc.png");
  assert.equal(logoSrc("/api/logos/abc.png"), "/api/logos/abc.png");
  assert.equal(logoSrc("blob:http://local/1"), "blob:http://local/1");
  assert.equal(logoSrc("https://cdn.example/a.png"), "https://cdn.example/a.png");
  assert.equal(logoSrc(null), null);
});

test("attach keeps the path the API stored", () => {
  assert.equal(logoAttachPath("/api/logos/abc.png", "/api"), "/api/logos/abc.png");
  assert.equal(logoAttachPath("/logos/abc.png", "/api"), "/logos/abc.png");
  assert.equal(logoAttachPath("/api/logos/abc.png", ""), "/api/logos/abc.png");
  assert.equal(logoAttachPath("blob:http://local/1", "/api"), null);
});
