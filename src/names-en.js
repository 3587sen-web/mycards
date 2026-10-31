// 英文名字判斷用的字典：常見英文名、常見中文姓氏拼音
// 用途：從 Email 推測英文名時，只接受「看起來像英文名」的，例如 kenny.chang → Kenny Chang；
//       chiao3.su（中文名拼音）、jt（縮寫）、service（職能信箱）都不採用。

export const EN_GIVEN = new Set(`
aaron abby abigail ada adam adrian adriana agnes aiden aileen al alan albert alex alexa alexander alexandra alexis alfred alice alicia allan allen allison alvin amanda amber amelia amy ana andrea andrew andy angel angela angelina angie ann anna anne annie anthony antonio april archer ariel arthur ashley astrid audrey austin ava barbara barry bella ben benjamin benny bernard beth betty beverly bill billy blake bob bobby bonnie brad bradley brandon brenda brian bridget brittany brooke bruce bryan caleb calvin cameron camille candice candy carl carla carlos carmen carol caroline carrie casey catherine cathy cecilia cecil celia celine chad charles charlene charlie charlotte chelsea cherry cheryl chloe chris christian christina christine christopher cindy claire clara clark claudia clement cliff clinton coco colin connie constance cora corey craig crystal cynthia daisy dale damon dan dana daniel danny daphne darren dave david dean debbie deborah denise dennis derek diana diane dick dolly dominic don donald donna doris dorothy doug douglas dylan eddie edgar edison edith edmund edward edwin eileen elaine eleanor elena eli elijah elisa elizabeth ella ellen ellie elsa elva emily emma eric erica erin ernest esther ethan eugene eunice eva evan evelyn faith fanny felix fiona flora florence frances francis frank franklin fred freda frederick gabriel gary gavin gene george georgia gerald gina gigi gilbert ginny gloria gordon grace graham grant greg gregory gwen hailey hank hannah harold harry harvey hazel heather hector helen henry herbert howard hugh hugo ian iris irene isaac isabel isabella ivan ivy jack jackie jackson jacky jacob jade james jamie jane janet janice jasmine jason jasper jay jean jeff jeffrey jennifer jenny jeremy jerome jerry jesse jessica jessie jill jim jimmy joan joanna joanne jocelyn joe joel joey john johnny jojo jolin jon jonathan jordan joseph josephine josh joshua joy joyce juan judy julia julian julie june justin karen kate katherine kathy katie katrina kay keith kelly kelvin ken kenneth kenny kent kevin kim kimberly kitty kris kristen kyle lance larry laura lauren lawrence leah lena leo leon leonard leslie lewis lilian lillian lily linda lindsay lisa lucas lucia lucy luis luke lydia lynn mabel maggie mandy marco margaret maria marian marie marilyn mario mark martha martin marvin mary mason matt matthew maureen max maxine maxwell may megan melanie melinda melissa melody mia michael michelle mike miles miranda molly monica morgan nancy naomi natalie nathan neil nelson nicholas nick nicole nina noah noel nora norman olive oliver olivia oscar owen paige pamela patricia patrick patty paul paula pauline peggy penny percy peter phil philip phoebe phyllis polly rachel ralph randy ray raymond rebecca regina rex richard rick ricky rita rob robert robin roger ronald rosa rosanna rose rosie ross roy ruby russell ruth ryan sabrina sally sam samantha samuel sandra sandy sara sarah scott sean selina serena sharon shawn sheila shelly sherry shirley sidney simon sofia sophia sophie stacy stanley stella stephanie stephen steve steven stuart sue summer susan suzy sylvia tammy tanya teresa terry tess thomas tiffany tim timothy tina toby todd tom tommy tony tracy travis trevor trista troy tyler valerie vanessa vera veronica vicky victor victoria vincent violet virginia vivian wallace walter wanda warren wayne wendy wesley whitney will william willy winnie winston yvonne zack zoe
`.trim().split(/\s+/));

// 台灣常見姓氏的拼音（含威妥瑪、漢語拼音、通用拼音常見寫法）
export const ZH_SURNAME_ROMAN = new Set(`
chen chan lin lam huang hwang wong chang cheung zhang li lee wang wu ng liu lau tsai choi cai yang yeung hsu hsueh xu tsui cheng zheng chung hsieh tse xie kuo kwok guo hung hong chiu qiu tseng tsang zeng liao lai chou chow zhou yeh yip ye su so chuang zhuang lu lo luo chiang jiang ho he hsiao siu xiao kao ko gao pan poon chien jian chu zhu yu yue peng fan tu du fu hou tsao cao hsueh xue ting ding cho chuo zhuo juan ruan ma tung dong tang lan lang shih shi ku gu chi ji yao lien lian feng ou chin jin tien tian kang chiang pai bai wan wei sun tai dai sung song teng deng fang shen sheng yen yan
`.trim().split(/\s+/));

const GENERIC_LOCAL = /^(info|service|services|sales|contact|support|admin|office|hello|hi|hr|mkt|marketing|pr|cs|customer|account|accounts|billing|team|mail|webmaster|noreply|no-reply|enquiry|inquiry|business|order|orders|shop|store)\d*$/i;

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * 從 Email 推測英文名。看起來不像英文名就回傳空字串。
 * kenny.cw.chang@ → "Kenny Chang"、wendyhuang@ → "Wendy Huang"、rosanna@ → "Rosanna"
 * chiao3.su@ → ""（拼音名）、jt@ → ""、invni_service@ → ""
 */
export function englishNameFromEmail(email) {
  const local = String(email || "").split("@")[0].toLowerCase();
  if (!local || GENERIC_LOCAL.test(local) || local.split(/[._-]/).some((t) => GENERIC_LOCAL.test(t))) return "";
  const tokens = local.split(/[._-]+/).map((t) => t.replace(/\d+/g, "")).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return "";
  const given = tokens[0];
  // 情況 1：第一段就是英文名（kenny.cw.chang、brian、joy_ye）
  if (EN_GIVEN.has(given)) {
    const sur = tokens.slice(1).find((t) => ZH_SURNAME_ROMAN.has(t) || (t.length >= 3 && /^[a-z]+$/.test(t) && !EN_GIVEN.has(t) && tokens.indexOf(t) === tokens.length - 1));
    return sur ? `${cap(given)} ${cap(sur)}` : cap(given);
  }
  // 情況 2：英文名＋姓氏黏在一起（wendyhuang、kennychang）
  if (tokens.length === 1) {
    for (let i = given.length - 2; i >= 3; i--) {
      const a = given.slice(0, i), b = given.slice(i);
      if (EN_GIVEN.has(a) && ZH_SURNAME_ROMAN.has(b)) return `${cap(a)} ${cap(b)}`;
    }
  }
  // 情況 3：姓氏在前（chang.kenny）
  if (tokens.length >= 2 && ZH_SURNAME_ROMAN.has(tokens[0]) && EN_GIVEN.has(tokens[1])) return `${cap(tokens[1])} ${cap(tokens[0])}`;
  return "";
}

/** Email 的帳號部分是否包含這個英文字（用來確認名片上某個英文字就是這個人的英文名） */
export function emailMatchesWord(email, word) {
  const local = String(email || "").split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  return w.length >= 3 && local.includes(w);
}
