import { test } from "node:test";
import assert from "node:assert/strict";
import { englishNameFromEmail } from "../src/names-en.js";
import { parseCard } from "../src/parser.js";

test("從 Email 推測英文名：像英文名的才採用", () => {
  assert.equal(englishNameFromEmail("kenny.cw.chang@example.com.tw"), "Kenny Chang");
  assert.equal(englishNameFromEmail("wendyhuang@example.com"), "Wendy Huang");
  assert.equal(englishNameFromEmail("rosanna@example.com.tw"), "Rosanna");
  assert.equal(englishNameFromEmail("brian@example.io"), "Brian");
  assert.equal(englishNameFromEmail("chang.kenny@example.com"), "Kenny Chang");
  assert.equal(englishNameFromEmail("joy_ye@example.com.tw"), "Joy Ye");
  // 不像英文名 → 不填
  assert.equal(englishNameFromEmail("chiao3.su@example.com"), "");
  assert.equal(englishNameFromEmail("jt@example.com"), "");
  assert.equal(englishNameFromEmail("invni_service@example.com.tw"), "");
  assert.equal(englishNameFromEmail("info@example.com"), "");
  assert.equal(englishNameFromEmail("julia.c.ho@example.com"), "Julia Ho");
  assert.equal(englishNameFromEmail("ycwang@example.com"), "");
  assert.equal(englishNameFromEmail("jonathan@example.com.tw"), "Jonathan");
});

const B = (text, x, y, h) => ({ text, box: { x, y, w: text.length * h, h } });
test("名片上的英文字離中文名很遠，但和 Email 吻合 → 當英文名", () => {
  const { card } = parseCard([B("葉小梅", 646, 459, 87), B("業務主任", 656, 410, 40), B("Joy", 912, 700, 30), B("joy_ye@example.com.tw", 651, 900, 30)]);
  assert.equal(card.nameEn, "Joy");
});
test("名片上沒有英文名 → 從 Email 推測並提示", () => {
  const { card, notes } = parseCard([B("何美君", 590, 903, 72), B("julia.c.ho@example.com", 601, 642, 30)]);
  assert.equal(card.nameEn, "Julia Ho");
  assert.equal(notes.length, 1);
});
test("Email 是拼音 → 不推測", () => {
  const { card } = parseCard([B("蘇巧君", 590, 903, 72), B("chiao3.su@example.com", 601, 642, 30)]);
  assert.equal(card.nameEn, "");
});
