/* 첫답 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Cheotdap, Node(테스트)에서는 require('./logic.js').
 * '지금 시각'은 늘 인자(분 단위)로 받는다. 그래서 테스트가 시계에 따라 흔들리지 않는다.
 *
 * 하는 일
 *   classify()      문의 한 건 → 분류 · 신뢰도 · 근거 낱말 (규칙)
 *   handoffOf()     환불·보상, 안전·법률 문의는 초안 없이 사람에게 넘긴다
 *   findPromises()  초안 속 '약속' 표현(환불해 드리겠습니다, 무료로, 전액 …)을 찾는다
 *   normalizeTriage() Claude 응답 검사. 형식이 틀리면 null, 약속이 들어 있으면 초안을 버린다
 *   maskPii()       이름·연락처·이메일·카드번호를 가린다 (AI 입력과 내보내기에 쓴다)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Cheotdap = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 분류와 담당 ---------- */
  // 순서가 곧 동점일 때의 우선순위다
  const CATS = [
    { id: "refund", label: "환불·보상", agent: "doyun", keys: ["환불", "보상", "배상", "돈 돌려", "돌려받", "위약금", "손해", "차액"] },
    { id: "return", label: "교환·반품", agent: "seojun", keys: ["교환", "반품", "바꾸", "수거", "사이즈가 안", "색상이 달", "잘못 왔", "다른 상품"] },
    { id: "ship", label: "배송", agent: "haneul", keys: ["배송", "택배", "도착", "언제 와", "안 와", "출고", "송장", "지연", "아직 안"] },
    { id: "pay", label: "결제·영수증", agent: "yuna", keys: ["결제", "카드", "영수증", "세금계산서", "두 번", "이중", "입금", "승인"] },
    { id: "product", label: "상품 문의", agent: "minjae", keys: ["재질", "소재", "세탁", "재입고", "치수", "사용법", "조립", "크기가", "몇 cm"] },
    { id: "account", label: "계정·로그인", agent: "jiwoo", keys: ["로그인", "비밀번호", "아이디", "탈퇴", "회원", "인증번호"] },
    { id: "etc", label: "기타", agent: "serin", keys: [] },
  ];
  const AGENTS = [
    { id: "haneul", name: "김하늘", role: "배송" },
    { id: "seojun", name: "박서준", role: "교환·반품" },
    { id: "doyun", name: "이도윤", role: "환불·보상 (팀장)" },
    { id: "yuna", name: "최유나", role: "결제" },
    { id: "minjae", name: "정민재", role: "상품" },
    { id: "jiwoo", name: "한지우", role: "계정" },
    { id: "serin", name: "오세린", role: "매니저 · 안전·법률" },
  ];
  // 다치거나 법적 다툼이 걸린 문의는 분류와 상관없이 매니저가 직접 본다
  const SAFETY = ["다쳤", "다침", "상처", "화상", "불이 났", "불꽃", "연기가", "터졌", "소비자원", "소송", "변호사", "고소", "신고하겠"];
  const URGENT = ["오늘", "급해", "급합니다", "내일까지", "선물", "행사", "당장"];
  const TARGET_MIN = 40; // 첫 응답 목표 (분)

  const catOf = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
  const agentOf = (id) => AGENTS.find((a) => a.id === id) || null;
  const hits = (text, keys) => keys.filter((k) => text.includes(k));

  /** 규칙 분류. 제목에 나온 낱말은 두 번 센다 */
  function classify(t) {
    const subject = String((t && t.subject) || "");
    const body = String((t && t.body) || "");
    const all = `${subject} ${body}`;
    const scored = CATS.filter((c) => c.keys.length).map((c) => {
      const words = hits(all, c.keys);
      return { c, words, score: words.length + hits(subject, c.keys).length };
    });
    const sorted = scored.slice().sort((a, b) => b.score - a.score);
    // 환불·보상 낱말이 한 번이라도 나오면 환불·보상으로 본다 (약속이 걸린 문의를 놓치지 않게)
    const refund = scored.find((s) => s.c.id === "refund");
    const top = refund.score > 0 ? refund : sorted[0];
    if (!top || top.score === 0) return { cat: "etc", confidence: 0.3, words: [], reason: "맞는 분류 낱말이 없어 매니저에게 보냄" };
    const second = sorted.find((s) => s !== top);
    const confidence = Math.round((top.score / (top.score + (second ? second.score : 0))) * 100) / 100;
    return { cat: top.c.id, confidence, words: top.words, reason: `‘${top.words.slice(0, 3).join("’, ‘")}’ 낱말` };
  }

  /** 사람에게 바로 넘길 문의인가 → {handoff, kind, why} */
  function handoffOf(t, cat) {
    const all = `${(t && t.subject) || ""} ${(t && t.body) || ""}`;
    const safe = hits(all, SAFETY);
    if (safe.length) return { handoff: true, kind: "safety", why: `안전·법률 관련(‘${safe[0]}’) — 매니저가 직접 확인` };
    if (cat === "refund") return { handoff: true, kind: "refund", why: "환불·보상은 약속이 걸려 있어 초안 없이 담당자가 직접 답함" };
    return { handoff: false, kind: "", why: "" };
  }
  const isUrgent = (t) => hits(`${t.subject || ""} ${t.body || ""}`, URGENT).length > 0;

  /** 담당자: 수동 배정 > 안전·법률(매니저) > 분류 담당 */
  function assign(cat, ho, override) {
    if (override && agentOf(override)) return override;
    if (ho && ho.kind === "safety") return "serin";
    return catOf(cat).agent;
  }

  /* ---------- 약속 표현 ---------- */
  const PROMISES = [
    /환불(을)?\s*(처리)?\s*해\s*드리/, /환불\s*(해|처리해)\s*드릴/, /환불\s*받으실\s*수\s*있(습니다|어요)/,
    /보상(을)?\s*(해)?\s*드리/, /배상(해)?\s*드리/, /무료로\s*(교환|배송|보내|처리|해)/, /배송비(는|를)?\s*(저희가|당사가)?\s*부담/,
    /전액/, /책임지고/, /반드시\s*\S*\s*드리/, /쿠폰(을)?\s*(지급|드리|드릴)/, /약속드립/, /100\s*%/,
  ];
  function findPromises(text) {
    const s = String(text || "");
    const out = [];
    PROMISES.forEach((re) => { const m = s.match(re); if (m) out.push(m[0].trim()); });
    return out;
  }

  /* ---------- 답변 초안 (규칙) ---------- */
  const HEAD = "안녕하세요, 솔담리빙 고객지원팀입니다.";
  const TAIL = "더 궁금하신 점은 이 문의에 답장으로 남겨 주세요.";
  const BODY = {
    ship: (o) => `${o ? `주문 ${o}의 ` : ""}배송 상황을 택배사에 확인하고 있어요. 확인되는 대로 오늘 안에 다시 안내드릴게요. 기다리시게 해서 죄송합니다.`,
    return: () => "교환·반품은 상품을 받으신 날부터 7일 안에 마이페이지 > 주문 내역에서 신청하실 수 있어요. 신청해 주시면 수거 일정을 문자로 안내드립니다.",
    pay: () => "결제 내역을 확인한 뒤 결과를 안내드리겠습니다. 카드사 앱의 승인 내역 화면을 이 문의에 첨부해 주시면 더 빨리 확인할 수 있어요.",
    product: () => "문의하신 상품 정보를 상품 담당자에게 확인해 안내드리겠습니다. 상품 상세 페이지의 ‘상품 정보 고시’에서도 크기와 소재를 보실 수 있어요.",
    account: () => "로그인 화면의 ‘비밀번호 찾기’에서 가입하신 휴대폰 번호로 다시 설정하실 수 있어요. 그래도 안 되시면 이 문의에 알려 주세요.",
    etc: () => "남겨 주신 내용을 담당자에게 전달했고, 확인한 뒤 다시 연락드리겠습니다.",
  };
  const orderNo = (t) => { const m = String(`${t.subject || ""} ${t.body || ""}`).match(/\b(SD\d{6,})\b/); return m ? m[1] : ""; };
  function draftFor(t, cat, ho) {
    if (ho && ho.handoff) return "";
    const f = BODY[cat] || BODY.etc;
    return `${HEAD}\n${f(orderNo(t))}\n${TAIL}`;
  }

  /* ---------- 개인정보 가리기 ---------- */
  const PHONE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const CARD = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;
  function maskPii(text, names) {
    let s = String(text || "");
    s = s.replace(CARD, "[카드번호]").replace(EMAIL, "[이메일]").replace(PHONE, "[연락처]");
    (names || []).filter((n) => n && n.length >= 2).forEach((n) => { s = s.split(n).join("[이름]"); });
    return s;
  }
  /** 화면 목록용: 김민서 → 김○○ */
  const maskName = (n) => (n ? String(n).slice(0, 1) + "○".repeat(Math.max(1, String(n).length - 1)) : "고객");

  /* ---------- Claude 응답 검사 ---------- */
  /** 형식이 틀리면 null. 규칙이 사람에게 넘긴 문의는 AI가 되돌릴 수 없다 */
  function normalizeTriage(d, rule) {
    if (!d || typeof d !== "object") return null;
    const cat = CATS.find((c) => c.label === d.category || c.id === d.category);
    if (!cat) return null;
    const conf = Number(d.confidence);
    const out = {
      cat: cat.id,
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, Math.round(conf * 100) / 100)) : 0.5,
      reason: typeof d.reason === "string" ? d.reason.trim().slice(0, 120) : "",
      urgent: d.urgent === true,
      draft: typeof d.draft === "string" ? d.draft.trim().slice(0, 800) : "",
      promises: [],
    };
    const ruleHo = rule && rule.ho && rule.ho.handoff;
    if (ruleHo || cat.id === "refund") { out.draft = ""; return out; }
    out.promises = findPromises(out.draft);
    if (out.promises.length) out.draft = ""; // 약속이 들어간 초안은 쓰지 않는다
    return out;
  }

  /* ---------- 한 건 · 전체 처리 ---------- */
  function triage(t, override) {
    const c = classify(t);
    const ho = handoffOf(t, c.cat);
    return { id: t.id, cat: c.cat, confidence: c.confidence, words: c.words, reason: c.reason, ho, urgent: isUrgent(t) || ho.kind === "safety", agent: assign(c.cat, ho, override), draft: draftFor(t, c.cat, ho), mode: "rule" };
  }
  /** AI 결과를 규칙 결과 위에 얹는다 */
  function applyAi(rule, ai, t, override) {
    const ho = rule.ho.handoff ? rule.ho : handoffOf(t, ai.cat);
    const blocked = ai.promises.length > 0;
    const ho2 = blocked && !ho.handoff ? { handoff: true, kind: "promise", why: `AI 초안에 약속 표현(‘${ai.promises[0]}’)이 있어 버리고 담당자에게 넘김` } : ho;
    return { ...rule, cat: ai.cat, confidence: ai.confidence, reason: ai.reason || rule.reason, urgent: rule.urgent || ai.urgent, ho: ho2, agent: assign(ai.cat, ho2, override), draft: ho2.handoff ? "" : ai.draft || draftFor(t, ai.cat, ho2), mode: "ai" };
  }

  /* ---------- 시간 ---------- */
  const toMin = (hhmm) => { const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : NaN; };
  const fmtMin = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  /** 첫 응답까지 남은/지난 시간 */
  function sla(at, now, respondedAt) {
    const start = toMin(at);
    if (respondedAt) return { kind: "done", min: toMin(respondedAt) - start };
    const w = now - start;
    return { kind: w > TARGET_MIN ? "late" : w >= TARGET_MIN - 10 ? "soon" : "ok", min: w };
  }

  /** 화면 위쪽 숫자 */
  function stats(list, tickets, overrides) {
    const done = tickets.filter((t) => t.respondedAt);
    const waits = done.map((t) => toMin(t.respondedAt) - toMin(t.at)).filter((n) => n >= 0);
    const fixed = Object.keys(overrides || {}).filter((id) => list.some((r) => r.id === id)).length;
    return {
      total: list.length,
      open: tickets.filter((t) => !t.respondedAt).length,
      handoff: list.filter((r) => r.ho.handoff).length,
      avgFirst: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      fixRate: list.length ? Math.round((fixed / list.length) * 1000) / 10 : 0,
      byCat: CATS.map((c) => ({ id: c.id, label: c.label, n: list.filter((r) => r.cat === c.id).length })),
    };
  }

  /* ---------- 내보내기: 개인정보 없이 ---------- */
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCsv(list, tickets) {
    const head = ["번호", "접수", "채널", "분류", "담당", "사람 확인", "넘긴 이유", "초안", "처리"];
    const rows = list.map((r) => {
      const t = tickets.find((x) => x.id === r.id) || {};
      const a = agentOf(r.agent);
      return [r.id, t.at, t.channel, catOf(r.cat).label, a ? a.name : "", r.ho.handoff ? "예" : "", r.ho.why, r.draft ? "있음" : "없음", r.mode === "ai" ? "Claude" : "규칙"];
    });
    return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  return { CATS, AGENTS, SAFETY, TARGET_MIN, catOf, agentOf, classify, handoffOf, isUrgent, assign, findPromises, draftFor, maskPii, maskName, normalizeTriage, triage, applyAi, toMin, fmtMin, sla, stats, csvCell, toCsv };
});
