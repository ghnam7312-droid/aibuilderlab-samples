/* 첫그림 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Cheotgeurim, Node(테스트)에서는 require('./logic.js').
 *
 * 면적은 들어오는 순간 ㎡ 하나로 바꾼다. 견적 계산은 ㎡만 받는다.
 *   예전 버전은 거실은 ㎡, 방은 평으로 받아 적은 값을 그대로 더해 견적이 두 배로 나왔다.
 *   그래서 toM2() 를 거친 값만 buildQuote() 에 들어가고, 화면에는 늘 "112.4㎡ (34.0평)"처럼 둘 다 보인다.
 *
 * 단가는 모두 가상의 샘플 단가다. 실제 자재·시공 단가가 아니다.
 * AI(moodboard.brief)는 스타일·색·고객에게 보낼 첫 문단만 쓴다. 금액은 쓰지 않는다(normalizeBrief 가 막는다).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Cheotgeurim = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 면적 ---------- */
  const M2_PER_PY = 400 / 121; // 1평 = 3.3058㎡
  const round1 = (n) => Math.round(n * 10) / 10;
  function toM2(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return round1(unit === "평" ? v * M2_PER_PY : v);
  }
  const toPy = (m2) => round1(Number(m2) / M2_PER_PY);
  const areaLabel = (m2) => `${round1(m2).toFixed(1)}㎡ (${toPy(m2).toFixed(1)}평)`;

  /** 글 속 면적 표현 → [{value, unit, m2, raw}] ("34평", "112㎡", "59m2", "84 제곱미터") */
  function parseAreas(text) {
    const out = [];
    const re = /(\d+(?:\.\d+)?)\s*(평|㎡|m2|m²|제곱미터)/g;
    let m;
    while ((m = re.exec(String(text || "")))) {
      const unit = m[2] === "평" ? "평" : "㎡";
      out.push({ value: Number(m[1]), unit, m2: toM2(m[1], unit), raw: m[0] });
    }
    return out;
  }

  const SPACES = {
    apt: { name: "아파트", range: [40, 230] },
    villa: { name: "빌라", range: [30, 135] },
    studio: { name: "오피스텔·원룸", range: [15, 66] },
    shop: { name: "상가", range: [20, 330] },
  };

  /**
   * 단위를 잘못 고른 것 같으면 알려 준다.
   * 공간 유형의 보통 면적(㎡)을 벗어났는데, 다른 단위로 읽으면 범위 안에 들어오면 → 단위 실수로 본다.
   * 메모에 적힌 면적과 15% 넘게 다르면 → 메모 확인.
   */
  function checkArea(value, unit, space, memo) {
    const out = [];
    const sp = SPACES[space] || SPACES.apt;
    const m2 = toM2(value, unit);
    if (!m2) return [{ level: "err", msg: "면적을 숫자로 넣어 주세요." }];
    const [lo, hi] = sp.range;
    const other = unit === "평" ? "㎡" : "평";
    const alt = toM2(value, other);
    if ((m2 < lo || m2 > hi) && alt >= lo && alt <= hi) {
      out.push({ level: "warn", msg: `${value}${unit}${unit === "평" ? ` (= ${round1(m2)}㎡)` : ""}는 ${sp.name}치고 ${m2 < lo ? "작아요" : "커요"}. ${value}${other} (= ${round1(alt)}㎡) 아닌가요?`, suggest: { value: Number(value), unit: other } });
    }
    const inMemo = parseAreas(memo);
    if (inMemo.length) {
      const near = inMemo.reduce((a, b) => (Math.abs(b.m2 - m2) < Math.abs(a.m2 - m2) ? b : a));
      const dup = out.some((w) => w.suggest && w.suggest.value === near.value && w.suggest.unit === near.unit);
      if (Math.abs(near.m2 - m2) / near.m2 > 0.15 && !dup) {
        out.push({ level: "warn", msg: `메모에 적힌 면적은 ${near.raw} (= ${near.m2}㎡). 입력한 면적과 달라요.`, suggest: { value: near.value, unit: near.unit } });
      }
    }
    return out;
  }

  /* ---------- 견적 (가상의 샘플 단가) ---------- */
  const GRADES = [["basic", "기본"], ["mid", "중급"], ["high", "고급"]];
  // basis: floor = 바닥 면적, wall = 벽·천장 추정 면적(바닥 × 2.6), set = 1식 × 개수
  const ITEMS = [
    { id: "demo", name: "철거·폐기물", basis: "floor", price: { basic: 18000, mid: 18000, high: 18000 } },
    { id: "elec", name: "전기·설비 보강", basis: "floor", price: { basic: 15000, mid: 15000, high: 21000 } },
    { id: "wall", name: "도배 (벽·천장)", basis: "wall", price: { basic: 9000, mid: 13000, high: 19000 } },
    { id: "floor", name: "바닥재", basis: "floor", price: { basic: 38000, mid: 62000, high: 98000 } },
    { id: "film", name: "문·몰딩 필름", basis: "floor", price: { basic: 4500, mid: 6500, high: 9000 } },
    { id: "light", name: "조명", basis: "floor", price: { basic: 12000, mid: 18000, high: 28000 } },
    { id: "bath", name: "욕실", basis: "set", price: { basic: 3800000, mid: 5200000, high: 7500000 } },
    { id: "kitchen", name: "주방 (상판·수전 포함)", basis: "set", price: { basic: 4200000, mid: 6500000, high: 9800000 } },
  ];
  const WALL_FACTOR = 2.6;
  const OVERHEAD = 0.08; // 현장 관리·경비
  const VAT = 0.1;

  function bathCount(space, m2) {
    if (space === "apt") return m2 >= 85 ? 2 : 1;
    return 1;
  }

  /** 견적 초안. area 는 반드시 ㎡ (toM2 결과) */
  function buildQuote({ m2, space, scope, grade }) {
    const g = GRADES.some(([k]) => k === grade) ? grade : "mid";
    const area = round1(Number(m2) || 0);
    const lines = ITEMS.filter((it) => (scope || []).includes(it.id)).map((it) => {
      let qty, unit;
      if (it.basis === "wall") { qty = round1(area * WALL_FACTOR); unit = "㎡"; }
      else if (it.basis === "set") { qty = it.id === "bath" ? bathCount(space, area) : 1; unit = "식"; }
      else { qty = area; unit = "㎡"; }
      const price = it.price[g];
      return { id: it.id, name: it.name, qty, unit, price, amount: Math.round((qty * price) / 1000) * 1000, est: it.basis === "wall" };
    });
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const overhead = Math.round((subtotal * OVERHEAD) / 1000) * 1000;
    const vat = Math.round(((subtotal + overhead) * VAT) / 1000) * 1000;
    const total = Math.round((subtotal + overhead + vat) / 10000) * 10000;
    return { m2: area, grade: g, lines, subtotal, overhead, vat, total, low: Math.round((total * 0.9) / 100000) * 100000, high: Math.round((total * 1.1) / 100000) * 100000 };
  }

  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  /** 1,234만 원 */
  const manwon = (n) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만 원`;

  /* ---------- 스타일 · 무드보드 ---------- */
  const MATERIALS = ["paint", "wood", "tile", "fabric", "metal", "stone"];
  const STYLES = [
    { id: "warm", name: "따뜻한 우드", keys: ["우드", "원목", "따뜻", "내추럴", "나무", "아늑", "베이지"], words: ["원목 질감", "낮은 채도", "간접 조명"],
      palette: [["벽", "오트밀 화이트", "#EFE6D8", "paint"], ["바닥", "오크 마루", "#B98A5E", "wood"], ["포인트", "테라코타", "#C0603F", "paint"], ["패브릭", "리넨 베이지", "#D8C8AE", "fabric"], ["금속", "브러시드 골드", "#B89A5A", "metal"], ["상판", "웜 베이지 스톤", "#D9CDBB", "stone"]] },
    { id: "white", name: "화이트 미니멀", keys: ["화이트", "하얀", "깔끔", "미니멀", "넓어", "밝게", "심플"], words: ["넓어 보이게", "숨은 수납", "선 정리"],
      palette: [["벽", "퓨어 화이트", "#F6F5F2", "paint"], ["바닥", "라이트 그레이 타일", "#D9D8D4", "tile"], ["포인트", "웜 그레이", "#A9A39A", "paint"], ["패브릭", "아이보리 부클", "#ECE7DD", "fabric"], ["금속", "무광 실버", "#B9BCBF", "metal"], ["상판", "화이트 세라믹", "#EEEDEA", "stone"]] },
    { id: "gray", name: "모던 그레이", keys: ["모던", "그레이", "회색", "시크", "도시", "차분", "어두운"], words: ["톤 다운", "블랙 라인", "수납 강화"],
      palette: [["벽", "쿨 그레이", "#C9CBCC", "paint"], ["바닥", "차콜 포세린", "#5B5E61", "tile"], ["포인트", "딥 네이비", "#2E3B4E", "paint"], ["패브릭", "그레이 울", "#8F9295", "fabric"], ["금속", "블랙 스틸", "#2B2B2B", "metal"], ["상판", "그레이 테라조", "#B5B3AE", "stone"]] },
    { id: "green", name: "그린 내추럴", keys: ["식물", "그린", "초록", "자연", "숲", "편안", "플랜테리어"], words: ["식물 자리", "자연광", "부드러운 곡선"],
      palette: [["벽", "세이지 그린", "#B7C3A8", "paint"], ["바닥", "애쉬 마루", "#CDB592", "wood"], ["포인트", "올리브", "#6F7A4A", "paint"], ["패브릭", "코튼 크림", "#EFE8D6", "fabric"], ["금속", "브라스", "#A88A4E", "metal"], ["상판", "샌드 스톤", "#D6CBB4", "stone"]] },
  ];
  const styleById = (id) => STYLES.find((s) => s.id === id) || STYLES[0];
  const paletteOf = (s) => s.palette.map(([role, name, hex, material]) => ({ role, name, hex, material }));

  /** 메모에서 스타일 고르기 (규칙). 같은 점수면 앞 순서
   *  "하얀 건 싫다고"처럼 부정하는 구절의 단어는 빼고(-1) 센다 */
  const NEG = /싫|말고|빼고|별로|않|안 좋/;
  function pickStyle(memo) {
    const clauses = String(memo || "").split(/[.\n,!?]|(?:고\s)/).filter((c) => c.trim());
    let best = STYLES[0], bestN = -Infinity, bestHits = [];
    STYLES.forEach((s) => {
      let n = 0; const hits = [];
      clauses.forEach((c) => s.keys.forEach((k) => {
        if (!c.includes(k)) return;
        if (NEG.test(c)) n -= 1; else { n += 1; if (!hits.includes(k)) hits.push(k); }
      }));
      if (n > bestN) { best = s; bestN = n; bestHits = hits; }
    });
    return { style: best, hits: bestHits, score: Math.max(0, bestN) };
  }

  /* ---------- 개인정보 ---------- */
  /** AI로 보내기 전 연락처·메일 지우기 */
  function scrub(text) {
    return String(text || "")
      .replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[연락처]")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[메일]");
  }
  /** 한서윤 → 한*윤, 남궁민수 → 남**수 */
  function maskName(name) {
    const s = String(name || "").trim();
    if (s.length <= 1) return s || "고객";
    if (s.length === 2) return s[0] + "*";
    return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
  }

  /* ---------- 규칙 브리프 · AI 응답 검사 ---------- */
  function ruleBrief(memo) {
    const p = pickStyle(memo);
    const intro = `오늘 상담에서 말씀하신 ${p.hits.length ? `키워드(${p.hits.slice(0, 3).join("·")})` : "분위기"}를 바탕으로 '${p.style.name}' 방향의 무드보드를 먼저 정리했어요.`;
    return { styleId: p.style.id, style: p.style.name, keywords: p.style.words.slice(), palette: paletteOf(p.style), intro, hits: p.hits };
  }

  const PRICE_RE = /\d[\d,.]*\s*(만\s*)?원/;
  /**
   * Claude 응답 검사. 틀리면 null → 화면은 규칙 브리프를 그대로 쓴다.
   * - style 은 4가지 중 하나(이름 또는 id)
   * - palette 3~6개, hex 는 #RRGGBB, material 은 6가지 중 하나(아니면 paint)
   * - message 에 금액이 들어 있으면 버린다 (금액은 견적표만 말한다)
   */
  function normalizeBrief(d) {
    if (!d || typeof d !== "object") return null;
    const s = STYLES.find((x) => x.id === d.style || x.name === String(d.style || "").trim());
    if (!s) return null;
    if (!Array.isArray(d.palette)) return null;
    const palette = d.palette
      .filter((p) => p && typeof p.hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(p.hex.trim()))
      .map((p) => ({ role: String(p.role || "").slice(0, 8) || "색", name: String(p.name || "").slice(0, 16) || p.hex, hex: p.hex.trim().toUpperCase(), material: MATERIALS.includes(p.material) ? p.material : "paint" }))
      .slice(0, 6);
    if (palette.length < 3) return null;
    const msg = typeof d.message === "string" ? d.message.trim() : "";
    if (!msg || msg.length > 400 || PRICE_RE.test(msg)) return null;
    const keywords = (Array.isArray(d.keywords) ? d.keywords : []).filter((k) => typeof k === "string" && k.trim()).map((k) => k.trim().slice(0, 14)).slice(0, 5);
    return { styleId: s.id, style: s.name, keywords: keywords.length ? keywords : s.words.slice(), palette, intro: msg };
  }

  /* ---------- 고객 회신 ---------- */
  const scopeNames = (scope) => ITEMS.filter((it) => scope.includes(it.id)).map((it) => it.name.replace(/ \(.+\)/, ""));
  function replyText({ name, brief, quote, scope, space }) {
    return [
      `${maskName(name)} 고객님, 오늘 상담 감사합니다.`,
      brief.intro,
      "",
      `· 공간: ${(SPACES[space] || SPACES.apt).name} ${areaLabel(quote.m2)} 기준`,
      `· 방향: ${brief.style} — ${brief.keywords.join(", ")}`,
      `· 공사 범위: ${scopeNames(scope).join(", ") || "미정"}`,
      `· 예상 금액: 약 ${manwon(quote.total)} (${manwon(quote.low)}~${manwon(quote.high)}, 부가세 포함)`,
      "",
      "실측 후 자재와 금액이 달라질 수 있어요. 편하신 날짜를 알려 주시면 실측 일정을 잡겠습니다.",
    ].join("\n");
  }

  const TARGET = { replyBefore: "3일", replyAfter: "당일", convBefore: 18, convAfter: 31 };

  return { M2_PER_PY, round1, toM2, toPy, areaLabel, parseAreas, SPACES, checkArea, GRADES, ITEMS, WALL_FACTOR, OVERHEAD, VAT, bathCount, buildQuote, won, manwon, MATERIALS, STYLES, styleById, paletteOf, pickStyle, scrub, maskName, ruleBrief, normalizeBrief, scopeNames, replyText, TARGET };
});
