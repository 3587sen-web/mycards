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
// 以這些字結尾的一定是公司名，就算裡面有「顧問」「業務」等職稱字
const COMPANY_END = /(股份有限公司|有限公司|公司|事務所|工作室|銀行|基金會|協會|學會|大學|學院|醫院|診所|研究院|集團|企業社|商行)$/;
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
const PHONE_CHUNK = /(\(?\+?\(?\d[\d\s\-()#.]{6,}\d)(\s*(ext\.?|分機|轉|#|x)\s*\d{1,6})?/gi;
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
  if (/^09\d{8}$/.test(digits) || /^8869\d{8}$/.test(digits) || /^(86)?1[3-9]\d{9}$/.test(digits)) return "mobile";
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
    // 000 開頭（會員編號、ID 之類）→ 不是電話
    if (/^000/.test(digits)) continue;
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
  const text = (l.text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const box = l.box || { x: 0, y: 0, w: 0, h: 0 };
  return { text, box, score: l.score ?? 1, used: false };
}

const CJK = /[㐀-鿿]/;
const CJK_ALL = /^[㐀-鿿·．]+$/;

// 台灣常見姓氏（含複姓）：名字第一個字是常見姓氏 → 加分；可排除「創新」「資誠」這類 Logo / 標語字
const COMPOUND_SURNAMES = ["歐陽", "司馬", "諸葛", "上官", "司徒", "張簡", "范姜", "周黃", "徐辜", "陳李", "江謝", "簡李", "東方", "皇甫", "公孫", "長孫", "慕容"];
const SURNAMES = new Set(("陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董温温唐藍蔣石古紀姚連馮歐程湯黃田康姜白汪鄒尤巫鐘黎涂龔嚴韓袁金童陸夏柳凃邵錢伍倪溫于譚駱熊任甘秦顧毛章史官萬俞雷粘饒張闕凌崔尹孔辛武辜陶段龍韋葛池孟褚殷麥賀賈莫文管關向包丘梅華利裴樊房全佘左花易鄔鄞喬苗卜閻成岳常耿聶牛時湛符尚龐冉祝盛翟艾鄺鄢戚荘錡").split(""));
function hasSurname(t) {
  const s = t.replace(/\s+/g, "");
  return COMPOUND_SURNAMES.some((c) => s.startsWith(c)) || SURNAMES.has(s[0]);
}

function isLikelyName(t) {
  const s = t.replace(/\s+/g, "");
  return CJK_ALL.test(s) && s.length >= 2 && s.length <= 4;
}

function isLikelyEnglishName(t) {
  return /^[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z'.-]+){1,3}$/.test(t) && !COMPANY_EN.test(t) && !TITLE_EN.test(t) && !ADDR_EN.test(t);
}

function isEnglishNameShape(t) {
  if (/[\u3400-\u9fff\d@]/.test(t)) return false;
  const words = t.replace(/[|丨]/g, " ").split(/[\s,]+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  if (!words.every((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w))) return false;
  if (TITLE_EN.test(t) || ADDR_EN.test(t) || DEPT_EN.test(t)) return false;
  if (COMPANY_EN.test(t) && words.length >= 2) return false;
  return /^[A-Z]/.test(words[0]);
}

// 判斷 Logo 時用：第一個字是常見姓氏，而且是 2~3 個字（像人名）
function hasSurnameStrict(t) {
  return hasSurname(t) && t.length <= 3;
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

  // ---- 1.5 中英混排拆開：「黃韻潔 Wendy Huang」「Brian Chen陳子龍」「匯智…公司WiSECURE Technologies Inc.」 ----
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.used || !CJK.test(l.text) || !/[A-Za-z]{2,}/.test(l.text) || ADDR_RE.test(l.text) || l.text.includes("@")) continue;
    const segs = l.text.split(/(?<=[\u3400-\u9fff)）])\s*(?=[A-Za-z])|(?<=[A-Za-z.])\s*(?=[\u3400-\u9fff(（])/)
      .map((x) => x.replace(/^[\s|丨I]+(?=[\u3400-\u9fff])|(?<=\.)\s*[|丨I]$|[\s|丨]+$/g, "").trim())
      .filter(Boolean);
    if (segs.length < 2) continue;
    let offset = 0;
    const subs = segs.map((t) => {
      const start = l.text.indexOf(t, offset);
      offset = start + t.length;
      const ratio = l.text.length ? Math.max(0, start) / l.text.length : 0;
      return { ...l, text: t, box: { ...l.box, x: l.box.x + l.box.w * ratio, w: l.box.w * (t.length / l.text.length) }, split: true };
    });
    lines.splice(i, 1, ...subs);
    i += subs.length - 1;
  }

  // ---- 2. 關鍵字 ----
  for (const l of lines) {
    if (l.used) continue;
    const t = l.text;
    if (LABEL_STRIP.test(t) || (ADDR_RE.test(t) && CJK.test(t) && t.length >= 6) || (ADDR_EN.test(t) && /\d/.test(t) && t.length >= 12)) {
      const v = t.replace(LABEL_STRIP, "").replace(/^[〒亍丅]\s*(?=\d)/, "").trim();
      l.role = "address";
      if (!card.address) card.address = v;
      else if (CJK.test(v) && !CJK.test(card.address)) card.address = v; // 優先中文地址
      l.used = true;
      continue;
    }
  }
  for (const l of lines) {
    if (l.used) continue;
    const t = l.text;
    if (CJK.test(t) && t.length >= 4 && (COMPANY_END.test(t) || (COMPANY_RE.test(t) && !findTitle(t)))) {
      if (!card.company) card.company = t;
      l.used = true;
    } else if (!CJK.test(t) && COMPANY_EN.test(t) && t.trim().split(/\s+/).length >= 2) {
      if (!card.companyEn) card.companyEn = t;
      l.used = true;
    }
  }
  for (const l of lines) {
    if (l.used) continue;
    // 先依分隔符號切開：「創意總監／品牌部」「經理 | 業務部」
    const parts = l.text.split(/\s*[\/／|｜・•·、]\s*|\s+/).map((x) => x.trim()).filter(Boolean);
    const isDept = (p) => CJK.test(p) && DEPT_RE.test(p) && p.length >= 2 && p.length <= 16;
    const titleOf = (p) => {
      const w = findTitle(p);
      // 「業務管理處」以部門字結尾 → 是部門，不是職稱
      if (!w || (isDept(p) && !p.endsWith(w))) return null;
      return w;
    };
    let claimed = false;
    const rest = [];
    for (const p of parts) {
      if (isDept(p) && !titleOf(p)) {
        card.department = card.department ? card.department + " " + p : p;
        claimed = true;
      } else if (titleOf(p)) {
        const w = titleOf(p);
        // 「林祺祥副理」：職稱前面黏著姓名
        const before = p.slice(0, p.indexOf(w));
        const nameOk = before && isLikelyName(before) && hasSurname(before) &&
          (before.length <= 3 || COMPOUND_SURNAMES.some((c) => before.startsWith(c)));
        if (nameOk && !card.name) {
          card.name = before;
          card.title = card.title ? card.title + " " + p.slice(before.length) : p.slice(before.length);
        } else {
          card.title = card.title ? card.title + " " + p : p;
        }
        claimed = true;
      } else if (!CJK.test(p) && DEPT_EN.test(l.text)) {
        rest.push(p);
      } else {
        rest.push(p);
      }
    }
    if (claimed) {
      // 同一行剩下的部分：像姓名的當姓名，其餘放回「其他文字」
      for (const p of rest) {
        if (!card.name && isLikelyName(p) && hasSurname(p) && p.length <= 3) card.name = p;
        else if (CJK.test(p) && !/\d/.test(p) && p.length <= 8) card.title = p + " " + card.title; // 「品牌行銷 總監」
        else l.leftover = (l.leftover ? l.leftover + " " : "") + p;
      }
      l.role = "title";
      l.used = !l.leftover;
      if (l.leftover) { l.text = l.leftover; l.used = true; l.keepAsOther = true; }
      continue;
    }
    const t = l.text;
    if (!CJK.test(t) && DEPT_EN.test(t)) {
      if (!card.department) card.department = t;
      l.used = true; l.role = "title";
      continue;
    }
    if (!CJK.test(t) && TITLE_EN.test(t) && t.length <= 60) {
      if (!card.title) card.title = t;
      l.used = true; l.role = "title";
    }
  }

  // ---- 3. 姓名：多個線索一起打分數 ----
  // 線索：字的大小、第一個字是不是常見姓氏、緊鄰職稱/部門那一行、不是公司名的一部分（Logo）
  if (!card.name) {
    const maxH = Math.max(1, ...lines.map((l) => l.box.h));
    const titleLines = lines.filter((l) => l.role === "title");
    const companyText = (card.company || "") + " " + (card.companyEn || "");
    const scored = lines
      .filter((l) => !l.used && isLikelyName(l.text))
      .map((l) => {
        const t = l.text.replace(/\s+/g, "");
        let score = (l.box.h / maxH) * 3; // 字越大分數越高（最多 3 分）
        if (hasSurname(t)) score += 3;
        if (companyText.includes(t)) score -= 5; // 公司名的一部分 → 多半是 Logo
        if (t.length === 4 && !COMPOUND_SURNAMES.some((c) => t.startsWith(c))) score -= 1; // 四字多半不是人名
        // 職稱/部門就在正下方或右邊 → 加分
        for (const tl of titleLines) {
          const dy = tl.box.y - (l.box.y + l.box.h);
          const xOverlap = Math.min(l.box.x + l.box.w, tl.box.x + tl.box.w) - Math.max(l.box.x, tl.box.x);
          const below = dy > -l.box.h * 0.3 && dy < l.box.h * 1.5 && (xOverlap > 0 || Math.abs(tl.box.x - l.box.x) < l.box.h);
          const right = Math.abs(tl.box.y - l.box.y) < l.box.h && tl.box.x > l.box.x;
          if (below || right) { score += 2; break; }
        }
        return { l, t, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored.length && scored[0].score > 1) {
      card.name = scored[0].t;
      scored[0].l.used = true;
      scored[0].l.role = "name";
    }
  }

  // 姓名正下方、沒被認領的短中文 → 多半是部門或職務（例如「創新創業服務」）
  const nameLine = lines.find((l) => l.role === "name");
  if (nameLine) {
    for (const l of lines) {
      if (l.used || !CJK.test(l.text) || /\d/.test(l.text) || l.text.length > 14) continue;
      const dy = l.box.y - (nameLine.box.y + nameLine.box.h);
      if (dy > -nameLine.box.h * 0.3 && dy < nameLine.box.h * 1.5 && Math.abs(l.box.x - nameLine.box.x) < nameLine.box.h) {
        if (!card.department) card.department = l.text;
        else if (!card.title) card.title = l.text;
        else continue;
        l.used = true;
      }
    }
  }

  // 郵遞區號（3~6 位數字單獨一行）→ 加到地址前面
  const addrLine = lines.find((l) => l.role === "address");
  for (const l of lines) {
    const near = addrLine && Math.abs(l.box.x - addrLine.box.x) < addrLine.box.h * 1.5 && l.box.y <= addrLine.box.y + 2 && addrLine.box.y - l.box.y < addrLine.box.h * 2.2;
    if (!l.used && near && /^\d{3,6}$/.test(l.text) && card.address && !/^\d/.test(card.address)) {
      card.address = l.text + card.address;
      l.used = true;
    }
  }

  // ---- 英文姓名：緊鄰中文姓名的英文字最可能是英文名（Rosanna、Wendy Huang、TANG, YaoChung Joseph） ----
  {
    const nameL = lines.find((l) => l.role === "name") || lines.find((l) => card.name && l.text.includes(card.name));
    const maxH = Math.max(1, ...lines.map((l) => l.box.h));
    const scored = lines
      .filter((l) => !l.used && isEnglishNameShape(l.text))
      .map((l) => {
        const t = l.text;
        let score = l.box.h / maxH;
        if (/^[A-Z][a-z]/.test(t) || /[a-z]/.test(t)) score += 1; // 有小寫字母，不是全大寫的品牌字
        if (/^[A-Z]+$/.test(t)) score -= 2; // 單一全大寫字（TONSUN、FIPS）多半是 Logo
        if (/,/.test(t) && /^[A-Z]+,/.test(t)) score += 1.5; // 「TANG, YaoChung」姓氏在前的寫法
        if (nameL) {
          const sameRow = Math.abs(l.box.y - nameL.box.y) < Math.max(l.box.h, nameL.box.h) * 0.8;
          const vgap = Math.min(Math.abs(l.box.y - (nameL.box.y + nameL.box.h)), Math.abs(nameL.box.y - (l.box.y + l.box.h)));
          const stacked = vgap < nameL.box.h * 1.2 && Math.abs(l.box.x - nameL.box.x) < nameL.box.w + l.box.h;
          if (sameRow || stacked) score += 3;
        }
        return { l, t, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored.length && scored[0].score >= 2.5) {
      card.nameEn = scored[0].t.replace(/\s*[|丨]\s*/g, " ").replace(/\s+/g, " ").trim();
      scored[0].l.used = true;
    }
  }
  // 沒有中文姓名、只有英文姓名的名片：英文名放進姓名欄
  if (!card.name && card.nameEn) { card.name = card.nameEn; card.nameEn = ""; }

  // ---- 公司名稱沒寫出來時：大字 Logo（例如上下兩行「東昇」「空調」）當公司名稱 ----
  if (!card.company) {
    const nameH = (lines.find((l) => l.role === "name") || { box: { h: 0 } }).box.h;
    const logo = lines.filter((l) => !l.used && CJK_ALL.test(l.text) && l.text.length >= 2 && l.text.length <= 8 && l.box.h >= nameH * 0.9 && !hasSurnameStrict(l.text));
    if (logo.length) {
      logo.sort((a, b) => a.box.y - b.box.y);
      const groups = [];
      for (const l of logo) {
        const g = groups.find((g) => { const last = g[g.length - 1]; return Math.abs(last.box.x - l.box.x) < l.box.h && l.box.y - (last.box.y + last.box.h) < l.box.h * 0.6; });
        if (g) g.push(l); else groups.push([l]);
      }
      groups.sort((a, b) => Math.max(...b.map((l) => l.box.h)) - Math.max(...a.map((l) => l.box.h)));
      card.company = groups[0].map((l) => l.text).join("");
      groups[0].forEach((l) => { l.used = true; });
    }
  }

  // 公司名稱沒找到時，用英文公司名
  if (!card.company && card.companyEn) {
    card.company = card.companyEn;
    card.companyEn = "";
  }

  // 單獨一個字母或符號（例如 Email 標籤「E」、分隔線被讀成「」」）不列入
  const junk = (t) => /^[A-Za-z]$|^[\p{P}\p{S}\s]+$/u.test(t);
  const others = lines.filter((l) => (!l.used || l.keepAsOther) && l.text.length > 0 && !junk(l.text)).map((l) => l.text);
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
