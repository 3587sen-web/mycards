// 規則式名片欄位解析器
// 輸入：OCR 讀出的每一行（文字＋在名片上的位置、大小）
// 輸出：姓名、職稱、公司、電話……等欄位，以及沒被認領的「其他文字」
//
// 判斷順序（越確定的越先認領）：
//   1. 格式固定：Email、網址、電話/傳真、統一編號
//   2. 關鍵字：公司、地址、部門、職稱
//   3. 刪去法＋字體大小：剩下的行裡，字最大、2~4 個中文字的 → 姓名

export const PHONE_TYPES = {
  mobile: "手機",
  work: "公司電話",
  fax: "傳真",
  other: "其他電話",
};

const TITLE_WORDS = [
  // 中文職稱（長的放前面，比對時優先）
  "董事長", "副董事長", "執行董事", "董事", "監察人", "總裁", "副總裁", "執行長", "營運長", "財務長", "技術長", "資訊長", "行銷長",
  "總經理", "副總經理", "協理", "資深經理", "經理", "副理", "襄理", "主任", "副主任", "課長", "組長", "副組長", "股長", "科長", "處長", "副處長", "部長", "副部長",
  "廠長", "店長", "所長", "院長", "副院長", "校長", "會長", "理事長", "秘書長", "社長", "總編輯", "主編", "編輯", "記者", "總監", "副總監", "創辦人", "共同創辦人", "負責人", "合夥人",
  "特助", "特別助理", "助理", "秘書", "專員", "資深專員", "高級專員", "業務代表", "業務", "顧問", "資深顧問", "工程師", "資深工程師", "主任工程師", "研究員", "設計師", "分析師", "律師", "會計師", "建築師", "醫師", "講師", "教授", "副教授", "助理教授", "博士",
  "主管", "專案經理", "產品經理", "業務經理", "行銷經理", "副總", "總監",
];
const TITLE_EN = /\b(CEO|CTO|CFO|COO|CIO|CMO|VP|AVP|SVP|EVP|President|Vice President|Director|Manager|Engineer|Specialist|Consultant|Assistant|Supervisor|Representative|Executive|Officer|Founder|Co-Founder|Partner|Chairman|Designer|Analyst|Sales|Lead|Head of|Associate|Coordinator|Editor|Reporter|Professor|Researcher)\b/i;

const COMPANY_RE = /(股份有限公司|有限公司|有限責任|公司|集團|企業社|工作室|事務所|銀行|協會|學會|基金會|大學|學院|醫院|診所|研究院|研究所|中心$|商行|實業|科技$)/;
const COMPANY_EN = /\b(Co\.?,?\s*Ltd\.?|Co\.|Ltd\.?|Inc\.?|Corp\.?|Corporation|Company|Limited|LLC|GmbH|Group|Technology|Technologies|Tech|Bank|University|Studio)\b/i;
const DEPT_RE = /(部|處|課|室|組|中心|事業群|事業部|事業處|本部|分公司|辦事處)$/;
const DEPT_EN = /\b(Department|Dept\.?|Division|Div\.?)\b/i;
const ADDR_RE = /(市|縣).{0,8}(區|鄉|鎮|市)|(路|街|大道).{0,6}(段|巷|弄|號)|\d+\s*號|\d+\s*樓|[0-9]{3,6}\s*(台|臺)/;
const ADDR_EN = /\b(Rd\.?|Road|St\.?|Street|Ave\.?|Avenue|Sec\.?|Section|Lane|Ln\.?|Alley|Aly\.?|No\.|Fl\.?|Floor|Dist\.?|District|City|Taiwan|R\.O\.C)\b/i;
const LABEL_STRIP = /^(地址|住址|公司地址|Add(ress)?|Addr)\s*[:：]?\s*/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /((https?:\/\/)?(www\.)[^\s，、]+|https?:\/\/[^\s，、]+|\b[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.(com|net|org|tw|io|co|biz|info)(\.[a-z]{2})?(\/[^\s]*)?\b)/i;
const TAXID_RE = /(統一編號|統編|統一編號|VAT|Tax\s*ID|公司統編)\s*[:：]?\s*(\d{8})/i;

// 電話：標籤 + 號碼。號碼允許 + ( ) - 空白 # 分機
const PHONE_CHUNK = /(\+?\(?\d[\d\s\-()#.]{6,}\d)(\s*(ext\.?|分機|轉|#|x)\s*\d{1,6})?/gi;
const LABELS = [
  { type: "mobile", re: /(手機|行動|行動電話|Mobile|Mob|Cell|M)\s*[:：.]?\s*$/i },
  { type: "fax", re: /(傳真|FAX|F)\s*[:：.]?\s*$/i },
  { type: "work", re: /(電話|市話|專線|總機|TEL|Tel|Phone|T|O|Office|直撥|Direct|D)\s*[:：.]?\s*$/i },
];

export function emptyCard() {
  return {
    name: "", nameEn: "", title: "", department: "", company: "", companyEn: "", taxId: "",
    phones: [], emails: [], website: "", address: "",
  };
}

function cleanPhone(raw) {
  return raw.replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").replace(/[.]/g, "-").trim();
}

function guessPhoneType(num) {
  const digits = num.replace(/\D/g, "");
  if (/^09\d{8}$/.test(digits) || /^8869\d{8}$/.test(digits)) return "mobile";
  return "work";
}

// 從一行文字中取出所有電話（依前面的標籤判斷種類）
export function extractPhones(text) {
  const found = [];
  let m;
  PHONE_CHUNK.lastIndex = 0;
  while ((m = PHONE_CHUNK.exec(text))) {
    const num = m[1];
    const digits = num.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    // 8 位數字且前面有統編字樣 → 不是電話
    const before = text.slice(0, m.index);
    if (/(統一編號|統編|VAT|Tax)\s*[:：]?\s*$/i.test(before)) continue;
    // 像日期 2023-09-13 → 跳過
    if (/^(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(num.trim())) continue;
    const tail = before.slice(-14);
    let type = null;
    for (const l of LABELS) if (l.re.test(tail)) { type = l.type; break; }
    if (!type) type = guessPhoneType(num);
    let value = cleanPhone(num);
    if (m[2]) value += " #" + m[2].replace(/\D/g, "");
    found.push({ type, value });
  }
  return found;
}

function normalizeLine(l) {
  const text = (l.text || "").replace(/\s+/g, " ").trim();
  const box = l.box || { x: 0, y: 0, w: 0, h: 0 };
  return { text, box, score: l.score ?? 1, used: false };
}

const CJK = /[㐀-鿿]/;
const CJK_ALL = /^[㐀-鿿·．]+$/;

function isLikelyName(t) {
  const s = t.replace(/\s+/g, "");
  return CJK_ALL.test(s) && s.length >= 2 && s.length <= 4;
}

function isLikelyEnglishName(t) {
  return /^[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z'.-]+){1,3}$/.test(t) && !COMPANY_EN.test(t) && !TITLE_EN.test(t) && !ADDR_EN.test(t);
}

function findTitle(t) {
  // 回傳最長的職稱關鍵字
  let best = null;
  for (const w of TITLE_WORDS) if (t.includes(w) && (!best || w.length > best.length)) best = w;
  return best;
}

/**
 * @param {{text:string, box?:{x:number,y:number,w:number,h:number}, score?:number}[]} rawLines
 * @returns {{card: ReturnType<typeof emptyCard>, others: string[]}}
 */
export function parseCard(rawLines) {
  const card = emptyCard();
  const lines = rawLines.map(normalizeLine).filter((l) => l.text);
  const addUnique = (arr, v, key = (x) => x) => {
    if (!arr.some((x) => key(x) === key(v))) arr.push(v);
  };

  // ---- 1. 格式固定 ----
  for (const l of lines) {
    let t = l.text;
    // Email
    const emails = t.match(EMAIL_RE);
    if (emails) {
      emails.forEach((e) => addUnique(card.emails, e.replace(/\s+/g, "").toLowerCase()));
      t = t.replace(EMAIL_RE, " ").replace(/(E-?mail|電子(郵件|信箱)|信箱)\s*[:：]?/gi, " ");
    }
    // 統一編號
    const tax = t.match(TAXID_RE);
    if (tax) {
      card.taxId = tax[2];
      t = t.replace(TAXID_RE, " ");
    }
    // 網址
    const url = t.match(URL_RE);
    if (url && !card.website && !/@/.test(url[0])) {
      card.website = url[0].replace(/[，。,;]+$/, "");
      t = t.replace(url[0], " ").replace(/(Web(site)?|網址|官網)\s*[:：]?/gi, " ");
    }
    // 電話
    const phones = extractPhones(t);
    if (phones.length) {
      phones.forEach((p) => addUnique(card.phones, p, (x) => x.value.replace(/\D/g, "")));
      t = t.replace(PHONE_CHUNK, " ");
      t = t.replace(/(手機|行動電話|行動|Mobile|Mob|Cell|傳真|FAX|電話|市話|專線|總機|TEL|Phone|Office|直撥|Direct|分機|ext)\s*[:：.]?/gi, " ");
      t = t.replace(/(^|\s)[MTFOD]\s*[:：.]?(?=\s|$)/g, " ");
    }
    t = t.replace(/\s+/g, " ").replace(/^[\s|:：/、,，-]+|[\s|:：/、,，-]+$/g, "").trim();
    if (t !== l.text) {
      // 這行有被認領一部分；剩下的文字保留給後續判斷
      l.text = t;
      if (!t) l.used = true;
    }
  }

  // ---- 2. 關鍵字 ----
  for (const l of lines) {
    if (l.used) continue;
    const t = l.text;
    if (LABEL_STRIP.test(t) || (ADDR_RE.test(t) && CJK.test(t) && t.length >= 6) || (ADDR_EN.test(t) && /\d/.test(t) && t.length >= 12)) {
      const v = t.replace(LABEL_STRIP, "").trim();
      if (!card.address) card.address = v;
      else if (CJK.test(v) && !CJK.test(card.address)) card.address = v; // 優先中文地址
      l.used = true;
      continue;
    }
  }
  for (const l of lines) {
    if (l.used) continue;
    const t = l.text;
    if (CJK.test(t) && COMPANY_RE.test(t) && t.length >= 4 && !findTitle(t)) {
      if (!card.company) card.company = t;
      l.used = true;
    } else if (!CJK.test(t) && COMPANY_EN.test(t) && t.length >= 4) {
      if (!card.companyEn) card.companyEn = t;
      l.used = true;
    }
  }
  for (const l of lines) {
    if (l.used) continue;
    const t = l.text;
    // 「林祺祥 副理」「林祺祥副理」：姓名＋職稱在同一行
    const title = findTitle(t);
    if (title) {
      const rest = t.replace(title, " ").replace(/\s+/g, " ").trim();
      const parts = rest.split(" ").filter(Boolean);
      const namePart = parts.find((p) => isLikelyName(p));
      if (namePart && !card.name && parts.length === 1) {
        card.name = namePart;
        card.title = card.title ? card.title : title;
        l.used = true;
        continue;
      }
      // 部門＋職稱：「產品開發部 經理」
      const deptPart = parts.find((p) => DEPT_RE.test(p));
      if (deptPart && !card.department) card.department = deptPart;
      if (!card.title) card.title = deptPart ? title : t.replace(deptPart || "", "").trim() || title;
      else card.title += " " + t;
      l.used = true;
      continue;
    }
    if (CJK.test(t) && DEPT_RE.test(t) && t.length <= 16 && !isLikelyName(t)) {
      if (!card.department) card.department = t;
      l.used = true;
      continue;
    }
    if (!CJK.test(t) && DEPT_EN.test(t)) {
      if (!card.department) card.department = t;
      l.used = true;
      continue;
    }
    if (!CJK.test(t) && TITLE_EN.test(t) && t.length <= 60) {
      if (!card.title) card.title = t;
      l.used = true;
    }
  }

  // ---- 3. 姓名：字最大的 2~4 個中文字 ----
  const nameCandidates = lines.filter((l) => !l.used && isLikelyName(l.text));
  if (!card.name && nameCandidates.length) {
    nameCandidates.sort((a, b) => b.box.h - a.box.h);
    const n = nameCandidates[0];
    card.name = n.text.replace(/\s+/g, "");
    n.used = true;
  }
  const enCandidates = lines.filter((l) => !l.used && isLikelyEnglishName(l.text));
  if (enCandidates.length) {
    enCandidates.sort((a, b) => b.box.h - a.box.h);
    card.nameEn = enCandidates[0].text;
    enCandidates[0].used = true;
  }
  // 公司名稱沒找到時，用英文公司名
  if (!card.company && card.companyEn) {
    card.company = card.companyEn;
    card.companyEn = "";
  }

  const others = lines.filter((l) => !l.used && l.text.length > 0).map((l) => l.text);
  return { card, others };
}

// 把 OCR SDK 的結果（poly 四點座標）轉成 parseCard 需要的格式
export function linesFromOcr(items) {
  return items.map((it) => {
    const xs = it.poly.map((p) => p[0]);
    const ys = it.poly.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { text: it.text, score: it.score, box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
  }).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}
