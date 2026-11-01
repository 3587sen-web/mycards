// 版型記憶測試（虛構資料）
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../src/parser.js";
import { learnTemplate, findTemplate, applyTemplate, companyKeys } from "../src/template.js";

const B = (text, x, y, h) => ({ text, box: { x, y, w: text.length * h * 0.9, h } });
// 同一間公司的版型：姓名在右下（字小，規則判斷容易漏）、Logo 字很大
const cardOf = (name, title, email, dx = 0, dy = 0, s = 1) => [
  B("曙光", 100 * s + dx, 80 * s + dy, 90 * s),
  B("曙光創意股份有限公司", 100 * s + dx, 200 * s + dy, 30 * s),
  B("台北市大安區復興南路一段1號", 100 * s + dx, 240 * s + dy, 24 * s),
  B("TEL 02-2700-0000", 100 * s + dx, 270 * s + dy, 24 * s),
  B(title, 620 * s + dx, 380 * s + dy, 22 * s),
  B(name, 620 * s + dx, 410 * s + dy, 30 * s),
  B(email, 100 * s + dx, 470 * s + dy, 22 * s),
];

test("公司鑰匙排除 gmail 這類共用網域", () => {
  const k = companyKeys({ emails: ["a@gmail.com", "b@shuguang.example"], website: "www.shuguang.example", taxId: "", company: "曙光" });
  assert.deepEqual(k.domains, ["shuguang.example"]);
});

test("第一張手動修正後，第二張同公司照位置抓到姓名", () => {
  // 第一張：假設規則沒抓到或抓錯，使用者手動修正
  const l1 = cardOf("林曉雯", "專案經理", "amy@shuguang.example");
  const fixed = { ...parseCard(l1).card, name: "林曉雯", title: "專案經理", company: "曙光創意股份有限公司" };
  const templates = learnTemplate({}, fixed, l1);
  assert.equal(Object.values(templates)[0].count, 1);

  // 第二張：不同人、拍照位置和遠近不同
  const l2 = cardOf("鄭宇", "設計師", "yu@shuguang.example", 37, -22, 1.15);
  const parsed = parseCard(l2);
  const found = findTemplate(templates, parsed.card);
  assert.ok(found && found.strong);
  const r = applyTemplate(found, parsed.card, parsed.others, l2);
  assert.equal(r.card.name, "鄭宇");
  assert.equal(r.card.title, "設計師");
  assert.equal(r.card.company, "曙光創意股份有限公司");
});

test("不同公司不套用", () => {
  const l1 = cardOf("林曉雯", "專案經理", "amy@shuguang.example");
  const templates = learnTemplate({}, { ...parseCard(l1).card, name: "林曉雯" }, l1);
  const other = parseCard([B("星河科技有限公司", 10, 10, 30), B("王小明", 10, 60, 40), B("ming@galaxy.example", 10, 120, 20)]);
  assert.equal(findTemplate(templates, other.card), null);
});

test("第二次存檔累加次數，並以最新修正為準", () => {
  const l1 = cardOf("林曉雯", "專案經理", "amy@shuguang.example");
  let t = learnTemplate({}, { ...parseCard(l1).card, name: "林曉雯" }, l1);
  const l2 = cardOf("鄭宇", "設計師", "yu@shuguang.example");
  t = learnTemplate(t, { ...parseCard(l2).card, name: "鄭宇", address: "台北市大安區復興南路一段1號3樓" }, l2);
  const tpl = Object.values(t)[0];
  assert.equal(Object.keys(t).length, 1);
  assert.equal(tpl.count, 2);
  assert.equal(tpl.constants.address, "台北市大安區復興南路一段1號3樓");
});

test("從 Email 推測的英文名不會把 Email 那行記成英文名位置", () => {
  const l1 = cardOf("林曉雯", "專案經理", "amy@shuguang.example");
  const c1 = parseCard(l1).card; // nameEn 會從 Email 推測成 Amy
  assert.equal(c1.nameEn, "Amy");
  const t = learnTemplate({}, { ...c1, name: "林曉雯" }, l1);
  assert.equal(Object.values(t)[0].fields.nameEn, undefined);
  const l2 = cardOf("鄭宇", "設計師", "yu.cheng@shuguang.example");
  const p2 = parseCard(l2);
  const r = applyTemplate(findTemplate(t, p2.card), p2.card, p2.others, l2);
  assert.ok(!r.card.nameEn.includes("@"));
});

test("套用版型不會把第一張的電話加到別人身上，也不覆蓋這張自己的地址", () => {
  const l1 = cardOf("林曉雯", "專案經理", "amy@shuguang.example");
  const c1 = { ...parseCard(l1).card, name: "林曉雯", phones: [{ type: "work", value: "02-2700-0000 #101" }, { type: "mobile", value: "0912-000-111" }] };
  const t = learnTemplate({}, c1, l1);
  assert.equal(Object.values(t)[0].constants.phones, undefined);
  const l2 = cardOf("鄭宇", "設計師", "yu@shuguang.example");
  const p2 = parseCard(l2);
  const before = p2.card.phones.length;
  p2.card.address = "台中市西屯區分公司地址1號";
  const r = applyTemplate(findTemplate(t, p2.card), p2.card, p2.others, l2);
  assert.equal(r.card.phones.length, before);
  assert.equal(r.card.address, "台中市西屯區分公司地址1號");
});
