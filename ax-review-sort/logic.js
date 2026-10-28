/* 고객말 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Gogaekmal, Node(테스트)에서는 require('./logic.js').
 *
 * 리뷰 한 건 → 감정(긍정·중립·부정) · 주제(배송·품질 등) · 개선 요청 여부 · 확신도.
 * 핵심: "와 배송 진짜 빠르네요^^ 열흘 만에 왔어요" 같은 반어적 칭찬을 긍정으로 세면 불만이 묻힌다.
 *   그래서 반어 신호 · 별점과 글의 어긋남 · 낮은 확신도 · 안전 관련 말이 있으면 자동으로 끝내지 않고
 *   '사람 확인' 칸으로 따로 모은다. AI(Claude)가 확신해도 이 칸은 사람만 비울 수 있다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gogaekmal = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SENTIMENTS = ["긍정", "중립", "부정"];
  const CATEGORIES = ["배송", "품질·불량", "사이즈·규격", "포장", "설명·조립", "가격", "기타"];
  const CAT_WORDS = {
    "배송": /배송|도착|택배|늦게|열흘|일주일 만|왔어요|출고/,
    "품질·불량": /불량|깨져|깨진|갈라|부서|찢어|새요|새서|샙니다|새네|녹이|녹슬|보풀|냄새|금방|헐거|휘어|벗겨|고장|뜨거워|탄 냄새|가시/,
    "사이즈·규격": /작아|커서|크기|사이즈|안 맞|안맞|용량|길이|두께/,
    "포장": /포장|박스|뽁뽁이|완충/,
    "설명·조립": /설명서|조립|사용법|설명이|방법을 모르/,
    "가격": /비싸|가격|가성비|할인|저렴/,
  };
  const POS = /좋아요|좋네요|좋습니다|만족|튼튼|예뻐|예쁘|최고|추천|잘 쓰|잘쓰|깔끔|편해요|편하고|빠르네요|빨라요|빠르고|감동|훌륭|딱 좋|마음에 들|맘에 들|재구매/g;
  const NEG = /불량|깨져|깨진|갈라|부서|찢어|새요|새서|샙니다|새네|늦게|늦어|안 와|열흘|일주일 만|작아|안 맞|안맞|냄새|별로|실망|환불|교환|녹이|녹슬|보풀|헐거|불편|비싸|휘어|벗겨|고장|없어서|없네요|없어요|아쉬|뜨거워|가시|베였|어렵|닦는|젖었/g;
  const REQUEST = /(?:면|으면) 좋겠|했으면|해 ?주세요|바꿔 ?주|넣어 ?주|개선|추가해|있었으면|부탁/;
  /** 반어 신호: 칭찬하는 말투인데 불만이 같이 있는 경우 */
  const IRONY = /\^\^|ㅎㅎ|ㅋㅋ|참 대단|진짜 대단|기가 막히|덕분에|역시나|하나는|감동이네요|~+$/;
  /** 안전 관련: AI도 규칙도 판단하지 않고 담당자에게 넘긴다 */
  const SAFETY = /다쳤|다쳐|베였|베임|화상|데였|배탈|두드러기|발진|피부 트러블|연기|불꽃|터졌|감전|삼켰|삼킬|탄 냄새|뜨거워져|뜨거워졌/;
  const HUMAN_CONF = 0.6;

  const count = (re, s) => (String(s).match(re) || []).length;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  /* ---------- 개인정보 가리기 ---------- */
  /** 리뷰 본문 속 전화번호·이메일·주문번호를 가린다 (화면·AI 입력·내보내기 모두 이걸 거친다) */
  function maskPII(text) {
    return String(text)
      .replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[전화번호]")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[이메일]")
      .replace(/주문\s?번호\s?:?\s?\d{6,}/g, "주문번호 [가림]");
  }
  /** "김서연" → "김*연", "박준" → "박*" */
  function maskName(name) {
    const n = String(name || "").trim();
    if (n.length <= 1) return n ? "*" : "";
    if (n.length === 2) return n[0] + "*";
    return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
  }

  /* ---------- 규칙 분류 ---------- */
  function sentenceWith(text, re) {
    const parts = String(text).split(/(?<=[.!?。~]|요\s|다\s)\s*/).map((s) => s.trim()).filter(Boolean);
    const hit = parts.find((p) => re.test(p.replace(/\s+$/, "")));
    return (hit || parts[0] || "").slice(0, 70);
  }
  function categoryOf(text) {
    let best = "기타", score = 0;
    Object.entries(CAT_WORDS).forEach(([c, re]) => {
      const n = count(new RegExp(re.source, "g"), text);
      if (n > score) { best = c; score = n; }
    });
    return best;
  }

  function classifyRule(r) {
    const text = String(r.text || "");
    const pos = count(POS, text), neg = count(NEG, text);
    const textSent = pos > neg ? 1 : neg > pos ? -1 : 0;
    const rating = Number(r.rating) || 0;
    const ratingSent = rating >= 4 ? 1 : rating > 0 && rating <= 2 ? -1 : 0;
    const flags = [];
    const irony = neg > 0 && IRONY.test(text) && (pos > 0 || rating >= 4);
    if (irony) flags.push("반어 의심");
    const mismatch = ratingSent !== 0 && textSent !== 0 && ratingSent !== textSent;
    if (mismatch) flags.push("별점·글 어긋남");
    const safety = SAFETY.test(text);
    if (safety) flags.push("안전 관련");
    const short = text.replace(/\s/g, "").length < 8;
    if (short) flags.push("너무 짧음");

    let s = irony ? -1 : textSent !== 0 ? textSent : ratingSent;
    const sentiment = s > 0 ? "긍정" : s < 0 ? "부정" : "중립";
    let conf = 0.5;
    if (textSent !== 0) conf += 0.2;
    if (textSent !== 0 && textSent === ratingSent) conf += 0.2;
    if (Math.abs(pos - neg) >= 2) conf += 0.1;
    if (REQUEST.test(text)) conf += 0.15; // 바라는 점을 분명히 적은 리뷰
    if (irony) conf -= 0.3;
    if (mismatch) conf -= 0.3;
    if (short) conf -= 0.2;
    conf = Math.round(clamp(conf, 0.1, 0.95) * 100) / 100;

    const category = categoryOf(text);
    const asks = REQUEST.test(text);
    const request = asks || (sentiment === "부정" && category !== "기타");
    const requestText = request ? sentenceWith(text, asks ? REQUEST : new RegExp(NEG.source)) : "";
    const why = [];
    if (pos) why.push(`칭찬 말 ${pos}개`);
    if (neg) why.push(`불만 말 ${neg}개`);
    why.push(`별점 ${rating}`);
    return {
      sentiment, category, request, requestText, confidence: conf, flags,
      safety, needsHuman: safety || irony || mismatch || conf < HUMAN_CONF,
      reason: why.join(" · "), by: "rule",
    };
  }

  /* ---------- AI 응답 검사 ---------- */
  /** Claude 응답 → { id: 분류 } 또는 null (절반 넘게 형식이 틀리면 전부 버린다) */
  function normalizeAi(d, reviews) {
    if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
    const ids = new Set(reviews.map((r) => String(r.id)));
    const out = {};
    d.items.forEach((x) => {
      if (!x || !ids.has(String(x.id))) return;
      if (!SENTIMENTS.includes(x.sentiment) || !CATEGORIES.includes(x.category)) return;
      const c = Number(x.confidence);
      if (!Number.isFinite(c) || c < 0 || c > 1) return;
      const req = typeof x.request === "string" ? x.request.trim().slice(0, 80) : "";
      out[String(x.id)] = { sentiment: x.sentiment, category: x.category, request: !!req, requestText: req, confidence: Math.round(c * 100) / 100, reason: typeof x.reason === "string" ? x.reason.trim().slice(0, 100) : "" };
    });
    return Object.keys(out).length * 2 >= reviews.length && Object.keys(out).length ? out : null;
  }

  /** 규칙 분류 위에 AI 분류를 얹는다. 규칙이 잡은 반어·어긋남·안전 신호는 AI가 지울 수 없다 */
  function mergeAi(rule, ai) {
    if (!ai) return rule;
    const keep = rule.flags.filter((f) => f !== "너무 짧음");
    const needsHuman = rule.safety || keep.length > 0 || ai.confidence < HUMAN_CONF;
    return { ...rule, ...ai, flags: ai.confidence < HUMAN_CONF ? [...keep, "AI 확신 낮음"] : keep, safety: rule.safety, needsHuman, by: "ai" };
  }

  /** 사람이 정한 값이 있으면 그것이 최종. decision = { sentiment } */
  function finalize(reviews, results, decisions) {
    return reviews.map((r) => {
      const c = results[r.id] || classifyRule(r);
      const d = decisions && decisions[r.id];
      if (!d) return { ...r, ...c, decided: false };
      const sentiment = d.sentiment;
      const request = sentiment === "부정" ? (c.request || c.category !== "기타") : sentiment === "중립" ? c.request : REQUEST.test(r.text);
      return { ...r, ...c, sentiment, request, requestText: request ? (c.requestText || sentenceWith(r.text, new RegExp(NEG.source))) : "", needsHuman: false, decided: true };
    });
  }

  /* ---------- 모아 보기 ---------- */
  function stats(items) {
    const n = items.length;
    const by = (f) => items.filter(f).length;
    return {
      total: n,
      pos: by((x) => !x.needsHuman && x.sentiment === "긍정"),
      neg: by((x) => !x.needsHuman && x.sentiment === "부정"),
      neutral: by((x) => !x.needsHuman && x.sentiment === "중립"),
      requests: by((x) => !x.needsHuman && x.request),
      human: by((x) => x.needsHuman),
      safety: by((x) => x.safety),
    };
  }
  /** 개선 요청 상위 N개 (상품 · 주제별로 묶음). 사람 확인이 남은 리뷰는 넣지 않는다 */
  function topRequests(items, n = 5) {
    const g = new Map();
    items.filter((x) => x.request && !x.needsHuman).forEach((x) => {
      const key = `${x.product}|${x.category}`;
      if (!g.has(key)) g.set(key, { product: x.product, category: x.category, count: 0, quotes: [], ids: [] });
      const e = g.get(key);
      e.count++; e.ids.push(x.id);
      if (e.quotes.length < 2 && x.requestText) e.quotes.push(maskPII(x.requestText));
    });
    return [...g.values()].sort((a, b) => b.count - a.count || a.product.localeCompare(b.product, "ko")).slice(0, n);
  }

  /** 상품팀에 보낼 글: 작성자 이름·연락처는 넣지 않는다 */
  function toHandoff(top, st, month) {
    const lines = [`[${month} 고객 리뷰 개선 요청 상위 ${top.length}개]`, `리뷰 ${st.total}건 중 개선 요청 ${st.requests}건 · 사람 확인 대기 ${st.human}건(미반영)`, ""];
    top.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.product} — ${t.category} (${t.count}건)`);
      t.quotes.forEach((q) => lines.push(`   “${q}”`));
    });
    if (st.safety) lines.push("", `※ 안전 관련 리뷰 ${st.safety}건은 품질안전 담당자에게 따로 전달했습니다.`);
    return lines.join("\n");
  }

  /** AI 입력: 작성자 이름은 보내지 않고, 본문의 연락처는 가린다 */
  function aiInput(reviews) {
    return { reviews: reviews.slice(0, 40).map((r) => ({ id: String(r.id), rating: r.rating, product: r.product, text: maskPII(r.text).slice(0, 300) })) };
  }

  /* ---------- 리뷰 붙여넣기 ---------- */
  /** "별점 | 상품 | 내용" 줄들 → { reviews, errors } */
  function parsePasted(text, products, startId) {
    const reviews = [], errors = [];
    String(text).split(/\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
      const p = line.split("|").map((x) => x.trim());
      if (p.length < 3) { errors.push(`${i + 1}줄: ‘별점 | 상품 | 내용’ 형식이 아닙니다`); return; }
      const rating = Number(p[0].replace(/[★점]/g, ""));
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) { errors.push(`${i + 1}줄: 별점은 1~5`); return; }
      const product = products.find((x) => x === p[1] || x.includes(p[1]) || p[1].includes(x)) || p[1];
      const body = p.slice(2).join(" | ");
      if (!body) { errors.push(`${i + 1}줄: 내용이 비었습니다`); return; }
      reviews.push({ id: `n${startId + reviews.length}`, rating, product: product.slice(0, 30), text: body.slice(0, 500), author: "", date: "" });
    });
    return { reviews, errors };
  }

  /* ---------- 샘플 (가상의 생활용품 쇼핑몰 '하루살림', 10월 리뷰 일부) ---------- */
  const PRODUCTS = ["스텐 텀블러 500ml", "접이식 수납함", "원목 도마", "실리콘 밀폐용기 3종", "극세사 수건 5장", "휴대용 손 선풍기"];
  function sample() {
    const P = PRODUCTS;
    const rows = [
      [5, P[0], "보온 잘 되고 색도 예뻐요. 출근할 때 매일 들고 다녀요.", "김서연"],
      [2, P[0], "뚜껑 사이로 커피가 새요. 가방이 다 젖었어요. 실리콘 패킹을 더 두껍게 바꿔 주세요.", "이준호"],
      [3, P[0], "덕분에 매일 아침 가방 닦는 운동합니다ㅎㅎ 디자인은 최고~", "박민지"],
      [1, P[0], "뚜껑 닫아도 새요. 교환 원해요. 010-2345-6789로 연락 주세요.", "최도윤"],
      [4, P[0], "보냉은 만족인데 뚜껑을 거꾸로 하면 조금 새네요. 개선되면 좋겠어요.", "정하나"],
      [2, P[1], "조립 설명서가 없어서 30분 헤맸어요. 그림 설명서라도 넣어 주세요.", "한지우"],
      [5, P[1], "튼튼하고 깔끔해요. 옷장 정리 끝!", "오세린"],
      [2, P[1], "설명서가 없네요. 조립 방법을 모르겠어서 결국 영상 찾아봤어요.", "윤태민"],
      [3, P[1], "크기는 딱 좋은데 조립이 어렵고 설명서가 없어요.", "강유진"],
      [4, P[2], "포장 하나는 기가 막히네요. 안에 든 도마는 갈라져 왔지만요.", "서다은"],
      [5, P[2], "원목 향이 좋고 두께도 만족해요. 재구매 의사 있어요.", "임채원"],
      [1, P[2], "모서리 가시에 손가락이 베였어요. 마감 확인 부탁드려요.", "조현우"],
      [2, P[2], "몇 번 썼는데 금방 갈라져요. 실망입니다.", "신예린"],
      [4, P[3], "용량별로 있어서 편해요. 냉장고 정리가 깔끔해졌어요.", "배수아"],
      [2, P[3], "뚜껑이 헐거워서 국물이 새요. 잠금 날개를 넣어 주세요.", "홍지훈"],
      [3, P[3], "뚜껑이 좀 헐거워요. 큰 통은 괜찮아요.", "문가은"],
      [5, P[4], "도톰하고 흡수 잘 돼요. 가성비 최고.", "장민서"],
      [2, P[4], "한 번 빨았는데 보풀이 엄청 나요. 별로예요.", "권도현"],
      [2, P[4], "보풀이 생기고 실밥이 풀려요.", "유하린"],
      [5, P[5], "와 배송 진짜 빠르네요^^ 주문하고 열흘 만에 왔어요", "남궁 솔"],
      [2, P[5], "충전 중에 탄 냄새가 나고 본체가 뜨거워졌어요. 무서워서 안 써요.", "백승민"],
      [4, P[5], "바람 세고 가벼워요. 여름에 잘 쓰겠어요.", "노지아"],
      [2, P[5], "배송이 일주일 만에 왔어요. 출고가 너무 늦어요.", "안시우"],
      [3, P[0], "그냥 그래요", "황보람"],
    ];
    return rows.map(([rating, product, text, author], i) => ({ id: `r${i + 1}`, rating, product, text, author, date: `2026-10-${String(27 - Math.floor(i / 2)).padStart(2, "0")}` }));
  }

  return { SENTIMENTS, CATEGORIES, PRODUCTS, HUMAN_CONF, sample, maskPII, maskName, categoryOf, classifyRule, normalizeAi, mergeAi, finalize, stats, topRequests, toHandoff, aiInput, parsePasted };
});
