/* 사실먼저 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Sasilmeonjeo, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 * 이 도구는 상담 전에 '사실관계'만 정리한다.
 *   - 근무 기간, 임금, 근무 시간, 근로계약서, 사업장 인원, 상담 주제
 *   - 빠진 사실은 '상담 전에 확인할 질문'으로 바꾼다
 *   - 의뢰인의 질문("받을 수 있나요?")은 답하지 않고 '노무사 상담에서 확인'으로 넘긴다
 *   - AI가 판단하는 문장(위법이다, 받을 수 있다 …)을 쓰면 그 문장은 버리고 노무사 상담 항목으로 옮긴다
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Sasilmeonjeo = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /** 정리하는 사실 항목 (순서 = 화면 순서) */
  const FIELDS = [
    { key: "start", label: "입사일", ask: "언제부터 일하셨나요? (입사일, 연·월·일)" },
    { key: "end", label: "퇴사일 · 재직 여부", ask: "지금도 일하고 계신가요? 그만두셨다면 마지막 근무일은 언제인가요?" },
    { key: "wage", label: "임금", ask: "임금은 월급·시급 중 어떤 방식이고, 얼마를 받으셨나요? (세전/세후 구분)" },
    { key: "hours", label: "근무 시간", ask: "일주일에 며칠, 하루 몇 시부터 몇 시까지 일하셨나요?" },
    { key: "contract", label: "근로계약서", ask: "근로계약서를 쓰셨나요? 있다면 사본을 가지고 계신가요?" },
    { key: "size", label: "사업장 인원", ask: "사장님을 빼고 함께 일하는 사람은 몇 명인가요?" },
    { key: "issue", label: "상담 주제", ask: "가장 먼저 상담받고 싶은 일은 무엇인가요?" },
  ];
  const KEYS = FIELDS.map((f) => f.key);
  const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

  /* ---------- 판단 문장 막기 ----------
   * 사실 정리 도구가 '답'처럼 말하면 안 된다. 단정형 판단 표현을 찾는다.
   * 의뢰인의 질문(…나요? …까요?)은 판단이 아니라 넘길 질문이므로 여기서 걸리지 않는다. */
  const JUDGE = /(위법|불법|합법|부당(해고|하다|합니다|해요)|받을 수 있(습니다|어요|다)|청구할 수 있|청구 가능|지급(해야|하여야|할 의무)|줘야 (합니다|해요|한다)|의무가 있|권리가 있|승소|이길 수 있|문제(가)? 없(습니다|어요|다)|대상(입니다|이에요|이다)|해당(합니다|돼요|됩니다|한다)|가능(합니다|해요)|위반(입니다|이에요|이다|됩니다))/;
  const QUESTION = /(\?|？|나요|까요|건가요|되나요|있나요|인가요)\s*[.!]?\s*$/;
  function isQuestion(s) { return QUESTION.test(String(s || "").trim()); }
  function isJudgement(s) {
    const t = String(s || "").trim();
    if (!t || isQuestion(t)) return false;
    return JUDGE.test(t);
  }
  /** 문장 목록을 판단 / 사실로 나눈다 */
  function guard(list) {
    const kept = [], blocked = [];
    (list || []).forEach((s) => (isJudgement(s) ? blocked : kept).push(s));
    return { kept, blocked };
  }

  /* ---------- 날짜 ---------- */
  function d0(isoStr) { const [y, m, d] = isoStr.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;
  /** 문장에서 날짜 하나 → {date, approx} ("2025년 3월" 처럼 일이 없으면 1일 + approx) */
  function findDate(text) {
    const m = String(text).match(/(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(?:(\d{1,2})\s*일?)?/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1;
    const x = new Date(y, mo - 1, d);
    if (x.getMonth() !== mo - 1 || x.getDate() !== d) return null;
    return { date: iso(x), approx: !m[3], text: m[0].trim() };
  }
  /** 두 날짜 사이 → "1년 6개월" (끝 날짜가 없으면 오늘까지) */
  function period(start, end) {
    if (!isIso(start) || !isIso(end) || end < start) return "";
    const a = d0(start), b = d0(end);
    let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) months--;
    const y = Math.floor(months / 12), mo = months % 12;
    if (months < 1) return `${Math.round((b - a) / 86400000) + 1}일`;
    return [y ? `${y}년` : "", mo ? `${mo}개월` : ""].filter(Boolean).join(" ");
  }

  /* ---------- 금액 · 시간 ---------- */
  function won(n) { return `${Math.round(n).toLocaleString("ko-KR")}원`; }
  function findAmount(text) {
    const m = String(text).match(/([\d,]+(?:\.\d+)?)\s*(만)?\s*원/);
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/,/g, ""));
    return m[2] ? n * 10000 : n;
  }
  /** "오전 9시부터 오후 6시까지" → 9 (시간). 오후·저녁이면 12를 더한다 */
  function hoursOfDay(text) {
    const m = String(text).match(/(오전|오후|저녁|아침|밤)?\s*(\d{1,2})\s*시\s*(?:부터|~|-)\s*(오전|오후|저녁|아침|밤)?\s*(\d{1,2})\s*시/);
    if (!m) { const h = String(text).match(/하루\s*(\d{1,2})\s*시간/); return h ? +h[1] : 0; }
    const pm = (p) => p === "오후" || p === "저녁" || p === "밤";
    let a = +m[2], b = +m[4];
    if (pm(m[1]) && a < 12) a += 12;
    if (pm(m[3]) && b < 12) b += 12;
    if (b <= a) b += 12;
    return b - a;
  }

  /* ---------- 원문 나누기 ---------- */
  function sentences(story) {
    return String(story || "").replace(/\r/g, "").split(/(?<=[.!?。？])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  }

  const ISSUES = [
    ["해고·계약 종료", /나오지 말|해고|잘렸|그만두라|계약.*끝/],
    ["퇴직금", /퇴직금/],
    ["임금 미지급", /(월급|임금|급여).*(안|못|절반|덜|밀)|체불/],
    ["주휴수당", /주휴/],
    ["임금 변경", /(연봉|월급|임금|급여).*(깎|삭감|줄이|낮추)/],
    ["연장근로", /야근|연장\s*근로|초과\s*근무/],
    ["4대보험", /4대\s*보험/],
  ];

  /** 규칙으로 정리: 문장마다 읽어 사실 항목을 채운다 → {facts, questions, timeline, sentences} */
  function extract(story, today) {
    const sents = sentences(story);
    const facts = {};
    const put = (key, value, i) => { if (!facts[key]) facts[key] = { value, quote: i, by: "rule" }; };
    const timeline = [];
    let days = 0, perDay = 0, hoursAt = -1, startIso = "", endIso = "";
    const issues = [];
    sents.forEach((s, i) => {
      const dt = findDate(s);
      if (dt) timeline.push({ date: dt.date, approx: dt.approx, text: s, quote: i });
      if (dt && /(부터|입사|시작|들어가|들어왔|채용)/.test(s) && !startIso) { startIso = dt.date; put("start", dt.approx ? `${dt.text} (일자 미상)` : dt.date, i); }
      else if (dt && /(그만|퇴사|해고|나오지 말|마지막|나왔|끝났)/.test(s) && !endIso) { endIso = dt.date; put("end", `${dt.date} (마지막 근무일, 본인 설명)`, i); }
      const claim = s.match(/(\d+)\s*년\s*(넘게|째|정도|가까이|이상)?\s*(다녔|일했|근무)/);
      if (claim && !facts.start) put("start", `날짜 미상 · '${claim[0]}' (본인 설명)`, i);
      if (/(지금도|아직|계속)\s*.*(일하|다니|근무)|일하고 있/.test(s) && !facts.end) put("end", "재직 중", i);
      const wk = s.match(/(월급|급여|시급|연봉|일당)/);
      const amt = findAmount(s);
      if (wk && amt && !facts.wage) put("wage", `${wk[1] === "급여" ? "월급" : wk[1]} ${won(amt)} (본인 설명)`, i);
      const dm = s.match(/주\s*(\d)\s*일/);
      if (dm) { days = +dm[1]; hoursAt = i; }
      const h = hoursOfDay(s);
      if (h) { perDay = h; if (hoursAt < 0) hoursAt = i; }
      if (/계약서/.test(s) && !facts.contract) {
        if (/(안|못)\s*(썼|쓰|작성|받)|없(어|었|습|음)|미작성/.test(s)) put("contract", "작성 안 함 (본인 설명)", i);
        else if (/(썼|작성했|작성함|작성해|받았|있어요|있습니다)/.test(s)) put("contract", "작성함 (사본 확인 필요)", i);
      }
      const sz = s.match(/(\d+)\s*명/);
      if (sz && /(직원|근로자|사람|알바|아르바이트|일하는)/.test(s) && !facts.size) put("size", `${sz[1]}명${/포함/.test(s) ? " · 사장님 포함" : ""} (본인 설명)`, i);
      ISSUES.forEach(([label, re]) => { if (re.test(s) && !issues.some((x) => x.label === label)) issues.push({ label, quote: i }); });
    });
    if (days || perDay) {
      const parts = [days ? `주 ${days}일` : "", perDay ? `하루 ${perDay}시간` : ""].filter(Boolean);
      const extra = sents.some((s) => /쉬는\s*시간.*(없|따로)/.test(s)) ? " · 쉬는 시간 따로 없음(본인 설명)" : "";
      put("hours", `${parts.join(" · ")}${days && perDay ? ` → 주 ${days * perDay}시간` : ""}${extra}`, hoursAt);
    }
    if (startIso && !facts.end) put("end", "재직 중인지 확인 필요", -1);
    if (issues.length) put("issue", issues.map((x) => x.label).join(" · "), issues[0].quote);
    if (startIso && (endIso || facts.end?.value === "재직 중")) facts.period = { value: period(startIso, endIso || today), quote: -1, by: "rule" };
    const questions = sents.map((s, i) => ({ text: s, quote: i })).filter((q) => isQuestion(q.text));
    timeline.sort((a, b) => a.date.localeCompare(b.date));
    return { facts, questions, timeline, sentences: sents, blocked: [], mode: "rule" };
  }

  /** 빠진 항목 → 상담 전에 의뢰인에게 물을 질문 */
  function missing(facts) {
    return FIELDS.filter((f) => !facts[f.key] || (f.key !== "contract" && /확인 필요|미상/.test(facts[f.key].value))).map((f) => ({ key: f.key, label: f.label, ask: f.ask }));
  }
  /** 정리된 정도: 7개 중 몇 개 */
  function coverage(facts) {
    return { done: FIELDS.length - missing(facts).length, total: FIELDS.length };
  }

  /* ---------- AI 결과 검사 ---------- */
  function grams(s) {
    const t = String(s || "").replace(/[\s\p{P}\p{S}]/gu, "");
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  }
  /** 근거 문장이 원문 몇 번째 문장인지. 겹침이 너무 적으면 -1 (원문에 없는 근거) */
  function findQuote(quote, sents) {
    const g = grams(quote);
    if (g.size < 2) return -1;
    let best = -1, score = 0;
    sents.forEach((s, i) => {
      const sg = grams(s);
      let hit = 0;
      g.forEach((x) => { if (sg.has(x)) hit++; });
      if (hit / g.size > score) { score = hit / g.size; best = i; }
    });
    return score >= 0.5 ? best : -1;
  }
  /** Claude 응답 → 쓸 수 있으면 {facts, blocked, dropped, missingAsk, note}, 아니면 null
   *  - key가 정해진 항목이 아니면 버린다
   *  - 근거(quote)가 원문에서 찾아지지 않으면 지어낸 것으로 보고 버린다
   *  - 값이나 메모에 판단 문장이 있으면 버리고 blocked 에 담는다 (→ 노무사 상담에서 확인) */
  function normalizeAi(d, sents) {
    if (!d || typeof d !== "object" || !Array.isArray(d.facts)) return null;
    const facts = {}, blocked = [];
    let dropped = 0;
    d.facts.slice(0, 20).forEach((f) => {
      if (!f || typeof f.key !== "string" || typeof f.value !== "string" || !f.value.trim()) return;
      const key = f.key.trim();
      if (!KEYS.includes(key)) { dropped++; return; }
      const value = f.value.trim().slice(0, 100);
      if (isJudgement(value)) { blocked.push(value); return; }
      const quote = findQuote(typeof f.quote === "string" ? f.quote : "", sents);
      if (quote < 0) { dropped++; return; }
      if (!facts[key]) facts[key] = { value, quote, by: "ai" };
    });
    const note = typeof d.note === "string" ? d.note.trim().slice(0, 160) : "";
    if (note && isJudgement(note)) blocked.push(note);
    if (!Object.keys(facts).length) return null;
    return { facts, blocked, dropped, note: note && !isJudgement(note) ? note : "" };
  }
  /** 규칙 결과 위에 Claude 결과를 얹는다. Claude가 못 찾은 항목은 규칙 값을 그대로 둔다 */
  function merge(rule, ai) {
    const facts = { ...rule.facts };
    Object.entries(ai.facts).forEach(([k, v]) => { facts[k] = v; });
    return { ...rule, facts, blocked: ai.blocked, dropped: ai.dropped, note: ai.note, mode: "ai" };
  }

  /* ---------- 개인정보 가리기 · 내보내기 ---------- */
  function maskName(n) {
    const s = String(n || "").trim();
    if (s.length <= 1) return s ? "*" : "";
    if (s.length === 2) return s[0] + "*";
    return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
  }
  /** 글 안의 전화번호·이메일을 가린다 */
  function maskText(t) {
    return String(t || "")
      .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?(\d{4})/g, "010-****-$1")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "(이메일 가림)");
  }
  /** 상담 준비 메모 (노무사가 상담 전에 보는 한 장) */
  function memo(intake, result, answers) {
    const lines = [`[상담 준비 메모] ${maskName(intake.name)} · ${intake.side}`, ""];
    lines.push("■ 정리한 사실");
    FIELDS.forEach((f) => {
      const v = result.facts[f.key];
      const a = answers && answers[f.key];
      lines.push(`- ${f.label}: ${v ? maskText(v.value) : a ? `${maskText(a)} (접수 후 확인)` : "(미확인)"}`);
    });
    if (result.facts.period?.value) lines.push(`- 근무 기간(계산): ${result.facts.period.value}`);
    const miss = missing(result.facts).filter((m) => !(answers && answers[m.key]));
    if (miss.length) { lines.push("", "■ 상담 전에 확인할 것"); miss.forEach((m) => lines.push(`- ${m.ask}`)); }
    const ask = result.questions.map((q) => q.text).concat(result.blocked || []);
    if (ask.length) { lines.push("", "■ 노무사 상담에서 확인 (이 도구는 답하지 않음)"); ask.forEach((q) => lines.push(`- ${maskText(q)}`)); }
    lines.push("", "※ 의뢰인 설명을 옮긴 사실 정리이며, 법적 판단을 담고 있지 않습니다.");
    return lines.join("\n");
  }

  return { FIELDS, KEYS, LABEL, JUDGE, isQuestion, isJudgement, guard, d0, iso, isIso, findDate, period, won, findAmount, hoursOfDay, sentences, extract, missing, coverage, grams, findQuote, normalizeAi, merge, maskName, maskText, memo };
});
