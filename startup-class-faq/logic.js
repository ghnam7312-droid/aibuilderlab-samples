/* 답해둠 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Dapaedum, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다.
 *
 * 문의 한 건은 세 갈래로 간다.
 *   환불: AI를 쓰지 않는다. 환불 규정 문서(POLICY)만 보고 refundCalc()가 금액과 조항을 정한다.
 *   사람: 분쟁·신고 같은 말이 있거나 규정에 없는 사정이면 운영자가 직접 답한다 (초안 없음).
 *   그 밖: FAQ에서 가장 가까운 답을 찾아 초안을 쓴다(규칙). Claude가 다시 쓰면 normalizeReply()로 검사한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Dapaedum = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAY_MS = 86400000;
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((d0(b) - d0(a)) / DAY_MS); }
  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;

  /* ---------- 분류 ---------- */
  const CATS = [
    { id: "refund", label: "환불", words: ["환불", "환급", "취소", "돌려받", "결제 취소", "그만두"] },
    { id: "material", label: "재료", words: ["재료", "키트", "물감", "붓", "종이", "스케치북", "연필", "배송", "택배"] },
    { id: "period", label: "수강 기간", words: ["수강 기간", "기간", "연장", "언제까지", "만료", "몇 달", "평생"] },
    { id: "video", label: "영상·접속", words: ["영상", "재생", "로그인", "접속", "안 열", "소리", "화질", "앱", "다운로드"] },
    { id: "etc", label: "기타", words: [] },
  ];
  const catLabel = (id) => (CATS.find((c) => c.id === id) || { label: id }).label;

  function classify(text) {
    const s = String(text || "");
    const scores = CATS.filter((c) => c.words.length).map((c) => ({ id: c.id, hits: c.words.filter((w) => s.includes(w)) }));
    // 돈이 걸린 말이 하나라도 있으면 환불로 본다 (다른 범주보다 먼저)
    const refund = scores.find((x) => x.id === "refund");
    if (refund.hits.length) return { cat: "refund", hits: refund.hits };
    const best = scores.filter((x) => x.hits.length).sort((a, b) => b.hits.length - a.hits.length)[0];
    return best ? { cat: best.id, hits: best.hits } : { cat: "etc", hits: [] };
  }

  /** 운영자가 직접 답해야 하는 문의 */
  const HUMAN_WORDS = ["소비자원", "신고", "소송", "변호사", "분쟁", "고소", "사기", "카드사", "민원", "입원", "아파서", "사고", "예외"];
  function needsHuman(text) {
    const s = String(text || "");
    const hit = HUMAN_WORDS.filter((w) => s.includes(w));
    return { yes: hit.length > 0, words: hit };
  }

  /* ---------- 개인정보 가리기 ---------- */
  function maskName(name) {
    const s = String(name || "").trim();
    if (s.length <= 1) return s ? "○" : "";
    return s[0] + "○".repeat(Math.min(2, s.length - 1));
  }
  function maskText(text) {
    return String(text || "")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "(이메일 가림)")
      .replace(/01[016789][- .]?\d{3,4}[- .]?\d{4}/g, "(전화번호 가림)")
      .replace(/\d{2,6}-\d{2,6}-\d{2,8}/g, "(번호 가림)");
  }

  /* ---------- 환불 규정 (샘플 클래스가 정한 문서) ---------- */
  const KIT_COST = 25000;
  const POLICY = [
    { no: 1, text: "결제 후 7일 이내이고 시청한 강의가 2개 이하이면 결제 금액 전액을 환불합니다." },
    { no: 2, text: "그 밖의 수강 기간 중에는 결제 금액에 (남은 강의 수 ÷ 전체 강의 수)를 곱한 금액을 환불하며, 1,000원 미만은 버립니다." },
    { no: 3, text: `재료 키트가 발송된 경우 재료비 ${KIT_COST.toLocaleString("ko-KR")}원을 빼고 환불합니다. 키트를 뜯지 않고 반송하면 빼지 않습니다.` },
    { no: 4, text: "수강 기간이 끝난 뒤에는 환불하지 않습니다." },
    { no: 5, text: "이 규정에 없는 사정은 운영자가 직접 확인해 답변합니다." },
  ];
  const clause = (no) => POLICY.find((p) => p.no === no);

  /** 주문 정보만으로 계산한다. 규정 밖이면 human:true */
  function refundCalc(order, today) {
    const o = order || {};
    if (!o.paidAt || !o.endsAt || !(o.price > 0) || !(o.total > 0)) return { ok: false, human: true, clauses: [5], amount: 0, steps: ["주문 정보가 없어 규정을 적용할 수 없어요"] };
    const watched = Math.max(0, Math.min(o.total, Math.floor(o.watched || 0)));
    if (daysBetween(o.endsAt, today) > 0) return { ok: true, human: false, clauses: [4], amount: 0, steps: ["수강 기간이 끝났어요 → 환불 없음"] };
    const steps = [];
    const clauses = [];
    let amount;
    const since = daysBetween(o.paidAt, today);
    if (since <= 7 && watched <= 2) {
      amount = o.price; clauses.push(1);
      steps.push(`결제 ${since}일째 · 시청 ${watched}강 → 전액 ${won(o.price)}`);
    } else {
      const left = o.total - watched;
      amount = Math.floor((o.price * left) / o.total / 1000) * 1000; clauses.push(2);
      steps.push(`${won(o.price)} × 남은 ${left}강 ÷ 전체 ${o.total}강 = ${won(amount)} (1,000원 미만 버림)`);
    }
    if (o.kitShipped && !o.kitReturned) {
      amount = Math.max(0, amount - KIT_COST); clauses.push(3);
      steps.push(`재료 키트 발송됨 → 재료비 ${won(KIT_COST)} 빼기`);
    } else if (o.kitShipped && o.kitReturned) {
      clauses.push(3); steps.push("키트를 뜯지 않고 반송 → 재료비 빼지 않음");
    }
    return { ok: true, human: false, clauses, amount, steps };
  }
  function refundReply(calc) {
    const quote = calc.clauses.map((n) => `· 규정 ${n}항: ${clause(n).text}`).join("\n");
    if (!calc.ok || calc.human) return null;
    const head = calc.amount > 0 ? `규정에 따라 환불 금액은 ${won(calc.amount)}입니다.` : "규정에 따라 이번에는 환불이 어렵습니다.";
    return `안녕하세요, 그림한스푼 클래스입니다.\n${head}\n\n${quote}\n\n계산: ${calc.steps.join(" / ")}\n확인해 주시면 처리 후 다시 알려 드릴게요.`;
  }


  /* ---------- 샘플 FAQ (운영자가 쓴 답) ---------- */
  const SAMPLE_FAQ = [
    { id: "F01", cat: "material", q: "재료는 무엇이 필요한가요?", keys: "재료 준비물 필요 물감 붓 종이 뭘 사야 스케치북 색연필", a: "기본 키트(연필 2B·4B, 수채 물감 12색, 붓 2자루, 수채 종이 10장)면 모든 과제를 할 수 있어요. 집에 있는 재료를 써도 괜찮고, 1강에 대신 쓸 수 있는 재료 목록이 있어요." },
    { id: "F02", cat: "material", q: "재료 키트는 언제 오나요?", keys: "키트 배송 언제 와요 택배 도착 발송 주문", a: "키트는 결제 다음 평일에 보내고 보통 2~3일 안에 도착해요. 보내면 문자로 송장 번호를 알려 드려요." },
    { id: "F03", cat: "period", q: "수강 기간은 얼마나 되나요?", keys: "수강 기간 언제까지 몇 달 볼 수 있", a: "수강 기간은 결제일부터 90일이에요. 마이페이지에서 남은 날짜를 볼 수 있어요." },
    { id: "F04", cat: "period", q: "수강 기간을 연장할 수 있나요?", keys: "연장 기간 늘리 만료 바빠서 미루", a: "만료 전에 한 번, 30일 연장할 수 있어요. 마이페이지 → 수강 연장에서 신청해 주세요." },
    { id: "F05", cat: "video", q: "영상이 재생되지 않아요", keys: "영상 재생 안 돼 끊겨 소리 화질 검은 화면", a: "브라우저를 최신으로 바꾸고 새로 고침해 보세요. 그래도 안 되면 쓰는 기기와 브라우저 이름을 알려 주시면 확인해 드릴게요." },
    { id: "F06", cat: "video", q: "영상을 내려받을 수 있나요?", keys: "다운로드 내려받 오프라인 저장 비행기", a: "영상은 내려받을 수 없어요. 대신 수강 기간 동안 앱과 웹에서 몇 번이든 다시 볼 수 있어요." },
    { id: "F07", cat: "etc", q: "과제 피드백은 언제 받나요?", keys: "피드백 과제 언제 답 올렸는데", a: "과제를 올리면 보통 1일 안에 작가가 직접 피드백을 드려요." },
    { id: "F08", cat: "etc", q: "그림을 처음 그려도 따라갈 수 있나요?", keys: "처음 초보 왕초보 그림 못 그려 따라갈", a: "1강은 선 긋기부터 시작해요. 처음 그리는 분도 따라올 수 있게 순서를 짰어요." },
  ];

  /* ---------- FAQ 찾기 (두 글자 조각 겹침) ---------- */
  function grams(s) {
    const t = String(s || "").replace(/[\s\p{P}\p{S}]/gu, "");
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  }
  function similarity(a, b) {
    const A = grams(a), B = grams(b);
    if (!A.size || !B.size) return 0;
    let hit = 0; A.forEach((g) => { if (B.has(g)) hit++; });
    return hit / Math.min(A.size, B.size);
  }
  function findFaq(text, faq, cat) {
    let best = null;
    for (const f of faq) {
      if (f.cat === "refund") continue; // 환불 답은 FAQ가 아니라 규정에서
      const score = similarity(text, f.q + " " + f.keys) + (f.cat === cat ? 0.15 : 0);
      if (!best || score > best.score) best = { faq: f, score: Math.round(score * 100) / 100 };
    }
    return best && best.score >= 0.3 ? best : null;
  }

  /* ---------- 한 건 처리: 규칙 ---------- */
  function route(inq, faq, today) {
    const c = classify(inq.text);
    const h = needsHuman(inq.text);
    if (h.yes) return { cat: c.cat, kind: "human", escalated: true, reason: `‘${h.words.join("’, ‘")}’ → 운영자가 직접 답변`, reply: "", faqId: "" };
    if (c.cat === "refund") {
      const calc = refundCalc(inq.order, today);
      if (calc.human) return { cat: "refund", kind: "human", escalated: true, reason: "규정 5항 · 주문 정보를 직접 확인", reply: "", faqId: "", calc };
      return { cat: "refund", kind: "policy", reason: `환불 규정 ${calc.clauses.join("·")}항`, reply: refundReply(calc), faqId: "", calc };
    }
    const m = findFaq(inq.text, faq, c.cat);
    if (!m) return { cat: c.cat, kind: "human", reason: "맞는 FAQ가 없어 직접 답변", reply: "", faqId: "" };
    return { cat: c.cat, kind: "faq", reason: `FAQ ${m.faq.id} · 겹침 ${Math.round(m.score * 100)}%`, reply: `안녕하세요, 그림한스푼 클래스입니다.\n${m.faq.a}\n더 궁금한 점은 편하게 남겨 주세요.`, faqId: m.faq.id };
  }
  /** AI에게 맡겨도 되는 문의인가: 환불·사람 갈래는 절대 보내지 않는다 */
  const aiAllowed = (r) => !!r && r.cat !== "refund" && r.kind !== "policy" && !r.escalated;

  const MONEY = ["환불", "환급", "돌려드", "돌려 드", "차감", "위약금", "보상"];
  /** Claude 응답 검사: 돈 얘기가 들어가거나 형식이 틀리면 null */
  function normalizeReply(data, faqIds) {
    if (!data || typeof data !== "object") return null;
    const reply = typeof data.reply === "string" ? data.reply.trim() : "";
    const cat = typeof data.category === "string" ? data.category.trim() : "";
    if (reply.length < 10 || reply.length > 700) return null;
    if (cat === "환불" || cat === "refund") return null;
    if (MONEY.some((w) => reply.includes(w))) return null;
    const faqId = typeof data.faqId === "string" ? data.faqId.trim().toUpperCase() : "";
    if (faqId && !(faqIds || []).includes(faqId)) return null;
    return { reply, faqId };
  }

  /* ---------- 정리 ---------- */
  function faqStats(inqs, faq) {
    const byFaq = {}, byCat = {};
    faq.forEach((f) => { byFaq[f.id] = 0; });
    CATS.forEach((c) => { byCat[c.id] = 0; });
    inqs.forEach((q) => {
      if (q.route) { byCat[q.route.cat] = (byCat[q.route.cat] || 0) + 1; if (q.route.faqId) byFaq[q.route.faqId] = (byFaq[q.route.faqId] || 0) + 1; }
    });
    const top = faq.map((f) => ({ ...f, n: byFaq[f.id] || 0 })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
    return { byCat, top };
  }
  /** 손으로 답하던 시간과 초안을 확인하는 시간 (한 건 3분 → 45초) */
  function timeSaved(n) {
    return { before: n * 3, after: Math.round(n * 0.75 * 10) / 10 };
  }
  function faqMarkdown(stats) {
    const lines = ["# 자주 묻는 질문", ""];
    CATS.filter((c) => c.id !== "etc").forEach((c) => {
      const xs = stats.top.filter((f) => f.cat === c.id);
      if (!xs.length) return;
      lines.push(`## ${c.label}`, "");
      xs.forEach((f) => lines.push(`**Q. ${f.q}**`, "", f.a, ""));
    });
    lines.push("## 환불", "", ...POLICY.map((p) => `${p.no}. ${p.text}`), "");
    return lines.join("\n");
  }

  return { SAMPLE_FAQ, d0, iso, addDays, daysBetween, won, CATS, catLabel, classify, HUMAN_WORDS, needsHuman, maskName, maskText, KIT_COST, POLICY, clause, refundCalc, refundReply, similarity, findFaq, route, aiAllowed, normalizeReply, faqStats, timeSaved, faqMarkdown };
});
