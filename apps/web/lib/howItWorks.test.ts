import assert from "node:assert/strict";
import test from "node:test";
import { howItWorks } from "./howItWorks.ts";

test("the how-it-works copy uses the fee numbers from the contracts", () => {
  const text = howItWorks.map((step) => step.body).join(" ");
  assert.equal(howItWorks.length, 5);
  assert.match(text, /80%/);
  assert.match(text, /10 seconds/);
  assert.match(text, /1%/);
  assert.match(text, /0\.1%/);
  assert.match(text, /split in half/);
  assert.doesNotMatch(text, /guaranteed|moon|ape/i);
});
