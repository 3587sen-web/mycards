import { test } from "node:test";
import assert from "node:assert/strict";
import * as OpenCC from "opencc-js/cn2t";
import { makeToTraditional } from "../src/s2t.js";

const f = makeToTraditional(OpenCC.Converter({ from: "cn", to: "tw" }));
test("簡體轉繁體，繁體維持不變，「台」不改成「臺」", () => {
  assert.equal(f("林晓雯"), "林曉雯");
  assert.equal(f("发明家科技开发股份有限公司"), "發明家科技開發股份有限公司");
  assert.equal(f("台北市中正區信義路一段"), "台北市中正區信義路一段");
  assert.equal(f("群創光電 業務經理"), "群創光電 業務經理");
  assert.equal(f("TEL 02-2700-0000"), "TEL 02-2700-0000");
});
