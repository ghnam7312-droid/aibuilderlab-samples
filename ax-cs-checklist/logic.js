/* 본보기 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Bonbogi, Node(테스트)에서는 require('./logic.js').
 *
 * 하는 일
 *   ITEMS          상담 품질 체크리스트 10항목 (우리 팀 우수 응답을 분석해 뽑은 것)
 *   review()       답변 하나를 10항목으로 점검 → 통과/고칠 점/해당 없음 + 근거 문장
 *   checkPolicy()  답변 속 기한·금액이 회사 정책과 같은지
 *   exemplars()    항목별 예시: 팀장이 4.5점 이상 준 '실제' 응답만. AI가 만든 모범 답안은 쓰지 않는다
 *   normalizeReview() Claude 응답 검사: 근거가 답변에 없는 말이면 지우고, 정책·약속·쉬운 말은 규칙이 정한다
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Bonbogi = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 회사 정책 (가상의 쇼핑몰 '솔담리빙') ---------- */
  const POLICY = [
    { key: "반품·교환 신청", text: "상품을 받은 날부터 7일 이내" },
    { key: "환불 처리", text: "반품 상품 확인 후 영업일 3~5일" },
    { key: "단순 변심 배송비", text: "왕복 6,000원 (고객 부담)" },
    { key: "불량·파손", text: "배송비 없이 교환 또는 반품" },
  ];
  const sentences = (s) => String(s || "").split(/(?<=[.!?。])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  /** 정책과 다른 안내 → [{text, rule}] */
  function checkPolicy(text) {
    const out = [];
    sentences(text).forEach((s) => {
      const days = [...s.matchAll(/(\d+)\s*(?:~\s*(\d+))?\s*(영업)?일/g)];
      if (/반품|교환/.test(s) && /받으신|받은|수령/.test(s) && !/환불/.test(s)) days.filter((m) => !m[3]).forEach((m) => { if (+m[1] !== 7) out.push({ text: s, rule: "반품·교환 신청은 7일 이내" }); });
      if (/환불/.test(s)) days.forEach((m) => { const a = +m[1], b = m[2] ? +m[2] : a; if (a < 3 || b > 5) out.push({ text: s, rule: "환불은 영업일 3~5일" }); });
      if (/배송비/.test(s)) {
        const won = [...s.matchAll(/(\d{1,2}),?(\d{3})\s*원/g)].map((m) => +(m[1] + m[2]));
        if (/불량|파손|깨/.test(s)) { if (won.length) out.push({ text: s, rule: "불량·파손은 배송비 없음" }); }
        else if (won.some((w) => w !== 6000)) out.push({ text: s, rule: "단순 변심 배송비는 왕복 6,000원" });
        else if (/무료|없이|안 내/.test(s) && /변심|색|마음/.test(s)) out.push({ text: s, rule: "단순 변심 배송비는 왕복 6,000원" });
      }
    });
    return out;
  }

  /* ---------- 약속 표현 (첫답과 같은 기준) ---------- */
  const PROMISES = [/환불(을)?\s*(처리)?\s*해\s*드리/, /보상(을)?\s*(해)?\s*드리/, /무료로\s*(교환|배송|보내|처리|해)/, /전액/, /책임지고/, /반드시[^.!?\n]{0,15}드리/, /쿠폰(을)?\s*(지급|드리|드릴)/, /약속드립/, /100\s*%/];
  const findPromises = (t) => PROMISES.map((re) => (String(t || "").match(re) || [])[0]).filter(Boolean);
  const JARGON = ["귀책", "회수", "반송장", "익일", "CS", "RMA", "SKU", "출고지시", "이관", "처리불가", "당사"];
  const NEGATIVE = /늦|안 와|깨|파손|불편|화가|실망|고장|삐걱|달라|아직/;

  /* ---------- 체크리스트 10항목 ---------- */
  const find = (re) => (a) => { const m = String(a).match(re); return m ? m[0].trim() : ""; };
  const ITEMS = [
    { id: "greet", label: "첫 인사와 소속", why: "누가 답하는지 알면 고객이 안심해요.", test: (a) => (/안녕하세요/.test(a) && /(솔담리빙|고객지원팀|상담원)/.test(a) ? find(/안녕하세요[^.!?\n]*/)(a) : "") },
    { id: "restate", label: "문의 내용 다시 짚기", why: "제대로 읽었다는 신호예요. 엇갈린 답을 막아요.", test: find(/[^.!?\n]*(문의(하신|주신|하셨)|말씀(하신|주신|하셨)|남겨 주신|관련(해서|하여))[^.!?\n]*/) },
    { id: "empathy", label: "불편에 공감", why: "불편을 겪은 고객에게 먼저 마음을 받아 줘요.", applies: (a, q) => NEGATIVE.test(q), test: find(/[^.!?\n]*(불편|죄송|속상|기다리시게)[^.!?\n]*/) },
    { id: "policy", label: "회사 정책과 같은 안내", why: "기한·배송비·환불 기간은 정책 그대로만 말해요.", applies: (a, q) => /반품|교환|환불|배송비|깨|파손/.test(`${a} ${q}`), rule: true },
    { id: "deadline", label: "처리 시점 알려 주기", why: "‘언제’가 없으면 고객은 다시 문의해요.", test: find(/[^.!?\n]*(\d+\s*(일|시간)|오늘|내일|이번 주|까지)[^.!?\n]*/) },
    { id: "next", label: "고객이 할 다음 단계", why: "고객이 무엇을 누르고 보내야 하는지 한 번에.", test: find(/[^.!?\n]*(해\s?주시면|해\s?주세요|눌러|신청해|보내\s?주|첨부해|선택해)[^.!?\n]*/) },
    { id: "promise", label: "확정 안 된 약속 없음", why: "환불·보상·무료 처리는 확정된 뒤에만 말해요.", rule: true },
    { id: "plain", label: "쉬운 말", why: "회수·익일·귀책 같은 사내 말 대신 고객의 말로.", rule: true },
    { id: "channel", label: "더 물어볼 곳", why: "추가 문의 창구를 알려 주면 재문의가 빨라져요.", test: find(/[^.!?\n]*(채팅|고객센터|1:1|답장|문의 주시면|연락 주시면|말씀해\s?주)[^.!?\n]*/) },
    { id: "close", label: "마무리 인사", why: "끝인사로 대화를 닫아요.", test: find(/[^.!?\n]*(감사합니다|좋은 하루|편안한|고맙습니다)[^.!?\n]*/) },
  ];
  const itemOf = (id) => ITEMS.find((i) => i.id === id);

  /** 한 항목 점검 → {id, status: pass|fail|na, evidence, note} */
  function checkItem(item, answer, inquiry) {
    const a = String(answer || ""), q = String(inquiry || "");
    if (item.applies && !item.applies(a, q)) return { id: item.id, status: "na", evidence: "", note: "이 문의에는 해당 없음" };
    if (item.id === "policy") {
      const mis = checkPolicy(a);
      if (mis.length) return { id: item.id, status: "fail", evidence: mis[0].text, note: `정책: ${mis[0].rule}` };
      const hit = find(/[^.!?\n]*(\d+\s*(영업)?일|배송비|[\d,]+원)[^.!?\n]*/)(a) || find(/[^.!?\n]*(교환|반품)[^.!?\n]*/)(a);
      return hit ? { id: item.id, status: "pass", evidence: hit, note: "" } : { id: item.id, status: "fail", evidence: "", note: "기한이나 배송비를 정책대로 알려 주세요" };
    }
    if (item.id === "promise") { const p = findPromises(a); return p.length ? { id: item.id, status: "fail", evidence: p[0], note: "확정되기 전에는 ‘확인 후 안내드리겠습니다’로" } : { id: item.id, status: "pass", evidence: "", note: "" }; }
    if (item.id === "plain") { const j = JARGON.filter((w) => a.includes(w)); return j.length ? { id: item.id, status: "fail", evidence: j.join(", "), note: "사내 말 대신 쉬운 말로" } : { id: item.id, status: "pass", evidence: "", note: "" }; }
    const ev = item.test(a).trim();
    return ev ? { id: item.id, status: "pass", evidence: ev, note: "" } : { id: item.id, status: "fail", evidence: "", note: "" };
  }
  function review(answer, inquiry) {
    const items = ITEMS.map((it) => checkItem(it, answer, inquiry));
    const applicable = items.filter((r) => r.status !== "na").length;
    const passed = items.filter((r) => r.status === "pass").length;
    return { items, applicable, passed, score: applicable ? Math.round((passed / applicable) * 100) : 0, mode: "rule" };
  }

  /* ---------- 예시: 실제 우수 응답만 ---------- */
  const MIN_RATING = 4.5;
  /** 예시로 쓸 수 있는 응답인가 → {ok, why} */
  function usable(r) {
    if (!r || r.source !== "real") return { ok: false, why: "AI가 만든 답안은 예시로 쓰지 않아요" };
    if (!(r.rating >= MIN_RATING)) return { ok: false, why: `팀장 평가 ${r.rating}점 — 4.5점 이상만 예시로 써요` };
    const mis = checkPolicy(r.text);
    if (mis.length) return { ok: false, why: `정책과 다름: ${mis[0].rule}` };
    return { ok: true, why: "" };
  }
  /** 항목별 예시 (점수 높은 순) → [{resp, evidence}] */
  function exemplars(itemId, responses, n) {
    const it = itemOf(itemId);
    if (!it) return [];
    return (responses || []).filter((r) => usable(r).ok)
      .map((r) => ({ resp: r, res: checkItem(it, r.text, r.inquiry) }))
      .filter((x) => x.res.status === "pass" && x.res.evidence)
      .sort((a, b) => b.resp.rating - a.resp.rating)
      .slice(0, n || 2)
      .map((x) => ({ resp: x.resp, evidence: x.res.evidence }));
  }

  /* ---------- Claude 응답 검사 ---------- */
  function normalizeReview(d, answer) {
    if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
    const a = String(answer || "");
    const seen = new Set();
    const items = d.items.filter((x) => x && itemOf(x.id) && typeof x.pass === "boolean" && !seen.has(x.id) && seen.add(x.id))
      .map((x) => ({
        id: x.id, pass: x.pass,
        // 근거는 답변에 실제로 있는 말만 (지어낸 인용은 지운다)
        evidence: typeof x.evidence === "string" && x.evidence.trim() && a.includes(x.evidence.trim()) ? x.evidence.trim().slice(0, 120) : "",
        tip: typeof x.tip === "string" ? x.tip.trim().slice(0, 60) : "",
      })); // 모범 답안·예시 같은 다른 칸은 버린다
    return items.length >= 5 ? { items } : null;
  }
  /** 규칙 결과 위에 Claude 판단을 얹는다. 정책·약속·쉬운 말, 해당 없음은 규칙 그대로 */
  function mergeReview(rule, ai) {
    const items = rule.items.map((r) => {
      const x = ai.items.find((i) => i.id === r.id);
      if (!x || r.status === "na" || itemOf(r.id).rule) return r;
      return { ...r, status: x.pass ? "pass" : "fail", evidence: x.evidence || (x.pass ? r.evidence : ""), note: x.tip || r.note };
    });
    const applicable = items.filter((r) => r.status !== "na").length;
    const passed = items.filter((r) => r.status === "pass").length;
    return { items, applicable, passed, score: applicable ? Math.round((passed / applicable) * 100) : 0, mode: "ai" };
  }

  /* ---------- 연습 기록 ---------- */
  function progress(attempts) {
    const list = (attempts || []).filter((x) => Number.isFinite(x.score));
    if (!list.length) return { count: 0, first: null, last: null, best: null, steady: false };
    const avg = (xs) => Math.round(xs.reduce((s, x) => s + x.score, 0) / xs.length);
    const last3 = list.slice(-3);
    return { count: list.length, first: list[0].score, last: list[list.length - 1].score, best: Math.max(...list.map((x) => x.score)), recent: avg(last3), steady: last3.length === 3 && last3.every((x) => x.score >= 80) };
  }

  /* ---------- 교육 자료 ---------- */
  function buildBooklet(responses) {
    const parts = ["# 솔담리빙 상담 품질 체크리스트 (신입 교육 자료)", "", "## 회사 정책", ...POLICY.map((p) => `- ${p.key}: ${p.text}`), ""];
    ITEMS.forEach((it, i) => {
      parts.push(`## ${i + 1}. ${it.label}`, it.why);
      exemplars(it.id, responses, 1).forEach((e) => parts.push(`> ${e.evidence || e.resp.text.slice(0, 80)}`, `> — ${e.resp.by} · 팀장 평가 ${e.resp.rating}점`));
      parts.push("");
    });
    parts.push("예시는 모두 우리 팀의 실제 우수 응답(팀장 평가 4.5점 이상)에서 가져왔습니다. AI가 만든 모범 답안은 쓰지 않습니다.");
    return parts.join("\n");
  }

  return { POLICY, ITEMS, JARGON, MIN_RATING, sentences, checkPolicy, findPromises, itemOf, checkItem, review, usable, exemplars, normalizeReview, mergeReview, progress, buildBooklet };
});
