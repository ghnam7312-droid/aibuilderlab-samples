/*
 * logic.js — 들어보니의 규칙 (화면과 분리한 순수 함수)
 *
 * 브라우저에서는 window.DeurLogic, Node(테스트)에서는 require("./logic.js").
 * 가설 판정 · 주제/인용 뽑기 · 유도 질문 점검 · Claude 응답 검사 · 가격 응답 통계.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeurLogic = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const ROLES = ["원장", "강사", "학부모"];

  /* ───────── 가설과 근거 ─────────
     auto: 기록된 숫자로 만드는 '규칙 제안' — y(지지) · n(반증) · x(상관없음) */
  const HYPS = [
    { id: "H1", text: "원장·강사는 학부모 리포트에 한 달 4시간 넘게 쓴다", crit: "지난달 리포트에 쓴 시간 4시간 이상이면 지지",
      auto: (v) => (v.role === "학부모" ? "x" : v.hours >= 4 ? "y" : "n") },
    { id: "H2", text: "원장은 월 10만 원 이하라면 리포트 도구에 돈을 낸다", crit: "낼 수 있는 금액이 1~10만 원이면 지지",
      auto: (v) => (v.role !== "원장" ? "x" : v.price > 0 && v.price <= 10 ? "y" : "n") },
  ];
  const STAMP = { ok: "검증됨", no: "반증됨", wait: "검증 중" };

  /** 확정한 근거만 센다. 지지 3건 이상이고 반증의 2배 이상이면 검증됨, 반증이 더 많으면 반증됨 */
  function tally(ivs, ev, hid) {
    let y = 0, n = 0;
    ivs.forEach((v) => { const e = ev[v.id + "|" + hid]; if (e === "y") y++; else if (e === "n") n++; });
    const st = y >= 3 && y >= n * 2 ? "ok" : n > y ? "no" : "wait";
    return { y, n, st };
  }
  /** 확정 태그를 누를 때 다음 값: 제안 → 확정, 확정 → 지지 → 반증 → 상관없음 → 지지 */
  function nextTag(current, suggested) {
    const order = ["y", "n", "x"];
    return current ? order[(order.indexOf(current) + 1) % 3] : suggested;
  }

  /* ───────── 규칙 요약: 말 사전 + 따옴표 인용 ───────── */
  const DICT = {
    "리포트에 드는 시간": ["시간", "주말", "오래", "미뤘"],
    "엑셀·캡처 수작업": ["엑셀", "손으로", "메모장", "캡처", "출력"],
    "카톡으로 전달": ["카톡"],
    "다음에 뭘 할지": ["다음 주", "다음에", "뭘 시키", "뭘 하는"],
    "단원별로 보기": ["단원"],
    "오답 유형 근거": ["유형", "오답"],
    "가격 부담": ["만 원", "비싸", "넘으면"],
  };
  const topicsOf = (memo) => Object.entries(DICT).filter(([, ws]) => ws.some((w) => String(memo).includes(w))).map(([k]) => k);
  const quotesOf = (memo) => [...String(memo).matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1].trim()).filter(Boolean);
  const plainOf = (memo) => String(memo).replace(/["“][^"”]+["”]/g, "").trim();

  /* ───────── Claude 응답 검사 ───────── */
  const STANCE = { 지지: "y", 반증: "n", 무관: "x", 상관없음: "x" };
  /**
   * interview.analyze 응답 → { keywords, quote, stances: {H1: {s, why}} }
   * - 인용은 메모 안에 실제로 있는 말이어야 한다 (지어낸 인용 막기)
   */
  function normalizeAnalyze(data, memo, hypIds) {
    if (!data || typeof data !== "object") return null;
    const keywords = (Array.isArray(data.keywords) ? data.keywords : []).map((k) => String(k || "").trim()).filter((k) => k && k.length <= 16).slice(0, 5);
    let quote = String(data.quote || "").trim().replace(/^["“]|["”]$/g, "");
    const flat = String(memo).replace(/\s+/g, " ");
    if (quote && !flat.includes(quote.replace(/\s+/g, " "))) quote = "";
    const stances = {};
    (Array.isArray(data.evidence) ? data.evidence : []).forEach((e) => {
      const id = String(e && e.id || "").trim().toUpperCase();
      const s = STANCE[String(e && e.stance || "").trim()];
      if (hypIds.includes(id) && s) stances[id] = { s, why: String(e.why || "").trim().slice(0, 120) };
    });
    if (!keywords.length && !Object.keys(stances).length) return null;
    return { keywords, quote, stances };
  }

  /* ───────── 유도 질문 점검 ───────── */
  const BAD = [/하시겠어요/, /쓰시겠/, /사시겠/, /좋을까요/, /좋겠죠/, /괜찮을까요/, /필요하(다고|신가요|세요)/, /원하(시나요|세요)/, /어떨까요/, /의향/, /않나요/, /이면\s*\S*(괜찮|쓰|사)/];
  const GOOD = [/지난(달|주|번)/, /최근/, /마지막으로/, /실제로/, /얼마(나|를)/, /몇\s*(번|시간|명)/, /어떻게\s*(하셨|판단하셨|만드셨)/, /누가/, /어떤 순서/];
  /** → "" | "bad" | "good" | "mid" */
  function checkQuestion(q) {
    const t = String(q || "").trim();
    if (!t) return "";
    if (BAD.some((r) => r.test(t))) return "bad";
    if (GOOD.some((r) => r.test(t))) return "good";
    return "mid";
  }
  /** 규칙으로 고쳐 쓰기 (Claude에 연결할 수 없을 때) */
  function ruleRewrite(q) {
    const t = String(q || "");
    if (/원|가격|돈|비용|얼마/.test(t)) return "지금 이 일에 매달 얼마를 쓰고 계세요? 무엇에 쓰시나요?";
    if (/분석|오답|채점|틀린|틀렸/.test(t)) return "지난주 학생이 왜 틀렸는지 어떻게 판단하셨어요? 시간이 얼마나 걸렸나요?";
    if (/기능|서비스|앱|도구|프로그램|자동|AI|리포트/.test(t)) return "지난달 이 일을 어떻게 처리하셨어요? 어느 단계가 가장 오래 걸렸나요?";
    return "마지막으로 이 일을 한 날, 어떤 순서로 하셨는지 처음부터 말씀해 주시겠어요?";
  }
  /** interview.question 응답 검사 */
  function normalizeQuestion(data) {
    if (!data || typeof data !== "object") return null;
    const rewrite = String(data.rewrite || "").trim();
    const reason = String(data.reason || "").trim();
    if (typeof data.leading !== "boolean" || !reason) return null;
    return { leading: data.leading, reason: reason.slice(0, 140), rewrite: rewrite.slice(0, 100) };
  }

  /* ───────── 가격 응답 ───────── */
  const BUCKETS = [["안 냄", (p) => p === 0, "zero"], ["5만 원 이하", (p) => p > 0 && p <= 5, ""], ["5~10만 원", (p) => p > 5 && p <= 10, ""], ["10만 원 넘게", (p) => p > 10, "over"]];
  function priceStats(ivs) {
    const own = ivs.filter((v) => v.role === "원장");
    const buckets = BUCKETS.map(([label, f, cls]) => ({ label, cls, n: own.filter((v) => f(v.price)).length }));
    const pay = own.filter((v) => v.price > 0);
    const under = pay.filter((v) => v.price <= 10);
    const sorted = pay.map((v) => v.price).sort((a, b) => a - b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
    return { own: own.length, pay: pay.length, underShare: pay.length ? under.length / pay.length : 0, median, buckets };
  }

  /** 주제별 언급 수 (역할별) — 인사이트·리포트 공통 */
  function topicCounts(ivs, topicsFn = (v) => topicsOf(v.memo)) {
    return Object.keys(DICT).map((k) => {
      const by = ROLES.map((r) => ivs.filter((v) => v.role === r && topicsFn(v).includes(k)).length);
      return { k, by, n: by.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.n - a.n);
  }

  return { ROLES, HYPS, STAMP, tally, nextTag, DICT, topicsOf, quotesOf, plainOf, normalizeAnalyze, BAD, GOOD, checkQuestion, ruleRewrite, normalizeQuestion, priceStats, topicCounts };
});
