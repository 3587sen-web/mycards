// Worker 邏輯測試（用假的 env.AI）
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/worker.js";

const ORIGIN = "https://3587sen-web.github.io";
const env = {
  APP_KEY: "secret",
  AI: { run: async (model, input) => ({ response: input.max_tokens === 20 ? "OK" : '{"name":"王小明"}' }) },
};
const req = (path, { origin = ORIGIN, key = "secret", method = "POST", body } = {}) =>
  new Request("https://mycards-ai.example.workers.dev" + path, {
    method, headers: { Origin: origin, "X-App-Key": key, "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
  });

test("其他網址的請求被拒絕", async () => {
  const r = await worker.fetch(req("/ping", { origin: "https://evil.example" }), env);
  assert.equal(r.status, 403);
});
test("CORS 預檢通過", async () => {
  const r = await worker.fetch(req("/ping", { method: "OPTIONS" }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});
test("通行碼錯誤被拒絕", async () => {
  const r = await worker.fetch(req("/ping", { key: "wrong" }), env);
  assert.equal(r.status, 401);
});
test("ping 與 parse", async () => {
  const p = await (await worker.fetch(req("/ping"), env)).json();
  assert.equal(p.reply, "OK");
  const r = await (await worker.fetch(req("/parse", { body: { lines: ["王小明", "經理"] } }), env)).json();
  assert.match(r.content, /王小明/);
});
test("沒綁定 AI 時給出清楚錯誤", async () => {
  const r = await worker.fetch(req("/ping"), { APP_KEY: "secret" });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /綁定/);
});
