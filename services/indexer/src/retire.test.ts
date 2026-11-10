import assert from "node:assert/strict";
import test from "node:test";
import { readKeep, retiredSql, stalePairSql } from "./retire.ts";

test("retired rows are other launchers, or unmarked coins from before this deploy", () => {
  const sql = retiredSql();
  assert.match(sql, /launcher IS NOT NULL AND launcher <> \$2/);
  assert.match(sql, /launcher IS NULL AND launch_block < \$3/);
  const keep = readKeep({
    chainId: 99801,
    startBlock: 27047311,
    contracts: { launcher: "0xeDE448d4325763C7CcBaae75FcdCC6cC6b75fc3e" },
    tokens: { whype: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234" },
  });
  assert.equal(keep.launcher, "0xeDE448d4325763C7CcBaae75FcdCC6cC6b75fc3e");
  assert.deepEqual(keep.tokens, ["cd57f65c2b0e5881cfc2e609f7cd53b746e1f234"]);
  assert.match(stalePairSql(), /pairs.address/);
  assert.match(stalePairSql(), /\$4::text\[\]/);
  assert.throws(() => readKeep({ chainId: 1, startBlock: 1, contracts: { launcher: "0x1" } }));
});
