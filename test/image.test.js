import { test } from "node:test";
import assert from "node:assert/strict";
import { cardCropRect } from "../src/image.js";

const B = (x, y, w, h, score = 1) => ({ text: "x", score, box: { x, y, w, h } });
test("依文字範圍算出名片裁切框，並往外留邊", () => {
  const r = cardCropRect([B(400, 600, 300, 40), B(400, 700, 200, 30), B(400, 800, 350, 30)], 1200, 1600);
  assert.ok(r.x < 400 && r.y < 600);
  assert.ok(r.x + r.w > 750 && r.y + r.h > 830);
  assert.ok(r.w * r.h < 1200 * 1600 * 0.5);
});
test("文字太少或名片佔滿畫面時不裁切", () => {
  assert.equal(cardCropRect([B(10, 10, 100, 20), B(10, 40, 100, 20)], 1200, 1600), null);
  assert.equal(cardCropRect([B(0, 0, 1200, 50), B(0, 800, 1100, 50), B(0, 1550, 1200, 50)], 1200, 1600), null);
});
test("低信心的雜訊不影響裁切範圍", () => {
  const r = cardCropRect([B(400, 600, 300, 40), B(400, 700, 200, 30), B(400, 800, 350, 30), B(0, 0, 20, 20, 0.2)], 1200, 1600);
  assert.ok(r.x > 300);
});
