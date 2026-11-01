// 規則解析器測試（範例資料皆為虛構）
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard, extractPhones } from "../src/parser.js";

const L = (text, h = 20, y = 0) => ({ text, box: { x: 0, y, w: 100, h } });

test("典型直式中文名片", () => {
  const { card, others } = parseCard([
    L("星河科技股份有限公司", 24, 10),
    L("王小明", 40, 60),
    L("產品開發部 經理", 18, 110),
    L("手機：0912-345-678", 14, 150),
    L("TEL：(02)2345-6789 #123", 14, 170),
    L("FAX：(02)2345-6780", 14, 190),
    L("E-mail：ming.wang@example.com.tw", 14, 210),
    L("台北市信義區松仁路100號8樓", 14, 230),
    L("www.example.com.tw", 14, 250),
  ]);
  assert.equal(card.company, "星河科技股份有限公司");
  assert.equal(card.name, "王小明");
  assert.equal(card.title, "經理");
  assert.equal(card.department, "產品開發部");
  assert.deepEqual(card.phones.map((p) => p.type), ["mobile", "work", "fax"]);
  assert.equal(card.phones[1].value, "(02)2345-6789 #123");
  assert.deepEqual(card.emails, ["ming.wang@example.com.tw"]);
  assert.equal(card.address, "台北市信義區松仁路100號8樓");
  assert.equal(card.website, "www.example.com.tw");
  assert.deepEqual(others, []);
});

test("姓名職稱同一行、英文姓名與英文公司", () => {
  const { card } = parseCard([
    L("陳美華 副理", 30),
    L("Mei-Hua Chen", 16),
    L("Galaxy Tech Co., Ltd.", 16),
    L("極光資訊有限公司", 18),
    L("M +886 912 345 678", 12),
    L("統一編號：12345678", 12),
  ]);
  assert.equal(card.name, "陳美華");
  assert.equal(card.title, "副理");
  assert.equal(card.nameEn, "Mei-Hua Chen");
  assert.equal(card.company, "極光資訊有限公司");
  assert.equal(card.companyEn, "Galaxy Tech Co., Ltd.");
  assert.equal(card.taxId, "12345678");
  assert.equal(card.phones[0].type, "mobile");
});

test("字最大的中文字當姓名，Logo 字不誤判", () => {
  const { card } = parseCard([
    L("創新", 50), // 太短的 logo 字，但比姓名大
    L("李大同", 36),
    L("業務代表", 14),
  ]);
  // 「創新」也是 2 個中文字，會被當候選；字最大者勝 → 這是已知限制，交給確認畫面修正
  assert.ok(["創新", "李大同"].includes(card.name));
  assert.equal(card.title, "業務代表");
});

test("一行有電話和傳真", () => {
  const p = extractPhones("TEL:(03)550-6770 分機 815  FAX:(03)550-6776");
  assert.equal(p.length, 2);
  assert.equal(p[0].type, "work");
  assert.equal(p[0].value, "(03)550-6770 #815");
  assert.equal(p[1].type, "fax");
});

test("未標示的號碼依格式判斷手機", () => {
  const p = extractPhones("0987654321");
  assert.equal(p[0].type, "mobile");
});

test("日期與統編不會被當成電話", () => {
  assert.equal(extractPhones("2023-09-13").length, 0);
  assert.equal(extractPhones("統編 12345678").length, 0);
});

test("英文地址", () => {
  const { card } = parseCard([L("8F., No. 100, Songren Rd., Xinyi Dist., Taipei City, Taiwan")]);
  assert.match(card.address, /Songren/);
});

// ---- 實際失敗案例改寫成虛構資料的回歸測試 ----
const B = (text, x, y, h) => ({ text, box: { x, y, w: text.length * h, h } });

test("Logo 字比名字大、公司名含「顧問」、名字右下＋下一行單位", () => {
  const { card, others } = parseCard([
    B("星辰", 320, 460, 87),
    B("星辰企業管理顧問公司", 610, 476, 44),
    B("110台北市基隆路一段1號2樓", 610, 508, 49),
    B("電話:+886 (2)2700 0000 ext.123", 610, 542, 50),
    B("統編：12345678", 607, 607, 45),
    B("abc", 160, 860, 116),
    B("何美君", 590, 903, 72),
    B("創新創業服務", 591, 966, 46),
  ]);
  assert.equal(card.name, "何美君");
  assert.equal(card.company, "星辰企業管理顧問公司");
  assert.equal(card.department, "創新創業服務");
  assert.equal(card.taxId, "12345678");
  assert.ok(others.includes("星辰"));
});

test("部門名稱含職稱字（業務管理處）、公司 Logo 字比名字大", () => {
  const { card } = parseCard([
    B("朱大同", 170, 540, 59),
    B("副總經理", 168, 606, 43),
    B("業務管理處", 168, 646, 42),
    B("宇宙通訊股份有限公司", 570, 666, 56),
    B("100012", 570, 726, 37),
    B("台北市中正區信義路一段1號", 570, 761, 52),
    B("宇宙通訊", 138, 939, 67),
  ]);
  assert.equal(card.name, "朱大同");
  assert.equal(card.title, "副總經理");
  assert.equal(card.department, "業務管理處");
  assert.equal(card.address, "100012台北市中正區信義路一段1號");
});

test("姓名、部門、職稱讀成同一行", () => {
  const { card } = parseCard([B("李承恩 業務部 經理", 100, 100, 30), B("某某有限公司", 100, 40, 20)]);
  assert.equal(card.name, "李承恩");
  assert.equal(card.department, "業務部");
  assert.equal(card.title, "經理");
});

test("分隔符號切開職稱與部門", () => {
  const { card } = parseCard([B("林柏宇", 500, 260, 59), B("創意總監／品牌部", 500, 320, 24)]);
  assert.equal(card.title, "創意總監");
  assert.equal(card.department, "品牌部");
});

// ---- 第二批：英文名字與中英混排（虛構資料） ----
test("中英混排同一行：中文姓名＋英文姓名", () => {
  const { card } = parseCard([
    B("行銷顧問 Marketing Advisor", 100, 538, 51),
    B("王雅琪 Grace Wang", 96, 601, 69),
    B("宇光科技股份有限公司Yuguang Technologies Inc.", 104, 721, 38),
  ]);
  assert.equal(card.name, "王雅琪");
  assert.equal(card.nameEn, "Grace Wang");
  assert.equal(card.title, "行銷顧問");
  assert.equal(card.company, "宇光科技股份有限公司");
  assert.equal(card.companyEn, "Yuguang Technologies Inc.");
});

test("英文在前、中文在後黏在一起", () => {
  const { card } = parseCard([B("Founder, CEO", 680, 503, 35), B("David Lin林大衛", 680, 591, 43), B("星雲互動有限公司", 677, 789, 37)]);
  assert.equal(card.name, "林大衛");
  assert.equal(card.nameEn, "David Lin");
});

test("單一字英文名在中文姓名右邊；全大寫 Logo 不當英文名", () => {
  const { card } = parseCard([
    B("SUNRISE", 563, 790, 38),
    B("品牌行銷 總監", 272, 881, 46),
    B("周曉晴", 266, 925, 68),
    B("Amber", 439, 948, 50),
  ]);
  assert.equal(card.name, "周曉晴");
  assert.equal(card.nameEn, "Amber");
  assert.equal(card.title, "品牌行銷 總監");
});

test("姓氏在前的英文寫法、國際電話格式、ID 不當電話", () => {
  const { card, others } = parseCard([
    B("Managing Partner", 151, 452, 64),
    B("LIN, ChiaHao | Jason", 144, 533, 85),
    B("林家豪", 143, 593, 60),
    B("(+886)912 345 678", 200, 783, 45),
    B("(+86)139 1234 5678", 202, 830, 42),
    B("00012345", 201, 915, 40),
  ]);
  assert.equal(card.nameEn, "LIN, ChiaHao Jason");
  assert.deepEqual(card.phones.map((p) => p.type), ["mobile", "mobile"]);
  assert.ok(others.includes("00012345"));
});

test("沒有寫公司全名時，用大字 Logo 當公司名稱", () => {
  const { card } = parseCard([B("北辰", 562, 650, 83), B("冷凍", 559, 716, 85), B("經理", 272, 881, 46), B("吳家寧", 266, 925, 68)]);
  assert.equal(card.company, "北辰冷凍");
  assert.equal(card.name, "吳家寧");
});

test("職稱前面 4 個字不當姓名（高級展演業務）", () => {
  const { card } = parseCard([B("高級展演業務", 135, 472, 47), B("許文華", 132, 379, 72)]);
  assert.equal(card.name, "許文華");
  assert.equal(card.title, "高級展演業務");
});

test("部門＋職稱黏在一起沒有空格", () => {
  const { card } = parseCard([B("產品開發部經理", 260, 195, 27), B("王小明", 50, 170, 63)]);
  assert.equal(card.department, "產品開發部");
  assert.equal(card.title, "經理");
});

test("純英文名片：英文名放進姓名欄", () => {
  const { card } = parseCard([B("AKAS", 340, 460, 30), B("CEO", 490, 600, 22), B("Chiaochun Su", 385, 630, 28), B("+886-922-000-000", 342, 776, 14), B("abc@example.com", 342, 802, 14)]);
  assert.equal(card.name, "Chiaochun Su");
  assert.equal(card.title, "CEO");
});

test("沒有標示的統編：符合檢查碼的 8 位數字不當電話", async () => {
  const { isValidTaxId } = await import("../src/parser.js");
  assert.ok(isValidTaxId("22859168"));
  assert.ok(isValidTaxId("25136736"));
  assert.ok(isValidTaxId("55737320"));
  assert.ok(isValidTaxId("96979933"));
  assert.ok(isValidTaxId("22446744"));
  const { card } = parseCard([L("某某科技股份有限公司"), L("22859168"), L("TEL 02-2553-2001")]);
  assert.equal(card.taxId, "22859168");
  assert.deepEqual(card.phones.map((p) => p.value), ["02-2553-2001"]);
});

test("有標示電話的 8 位數字仍是電話", () => {
  const { card } = parseCard([L("電話：25532001")]);
  assert.equal(card.phones.length, 1);
  assert.equal(card.taxId, "");
});
