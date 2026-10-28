/* 당일결과 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Dangil, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름: 설문 CSV → parseCsv → anonymize(이름·연락처 가리기) → aggregate(집계)
 *       → ruleSummary(규칙 요약, 즉시) / Claude 요약(normalizeSummary로 검사)
 *       → reportText(보고용 문구) → leakCheck(이름이 남았는지 마지막 검사)
 *
 * 원칙: 리포트에는 집계와 가린 의견만 들어간다. 응답자 이름은 리포트·AI 입력·내보내기 어디에도 없다.
 *       부서별 집계는 응답 MIN_GROUP명 미만이면 합치거나 숨긴다(누가 썼는지 짐작할 수 없게).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Dangil = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const QUESTIONS = [
    ["content", "내용이 업무에 유익했다"],
    ["trainer", "강사 설명이 이해하기 쉬웠다"],
    ["apply", "배운 것을 현업에 적용할 수 있다"],
    ["time", "시간 배분이 적절했다"],
    ["material", "교재·자료가 도움이 됐다"],
  ];
  const HEADER = ["이름", "부서", "내용", "강사", "적용", "시간", "자료", "사전", "사후", "추천", "의견"];
  const MIN_GROUP = 5;
  const MASK = "○○○";

  /* ---------- CSV ---------- */
  /** 따옴표 안의 쉼표·줄바꿈을 지키는 CSV 한 덩어리 파서 */
  function splitCsv(text) {
    const rows = []; let row = []; let cell = ""; let q = false;
    const s = String(text || "").replace(/\r\n?/g, "\n");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  const score = (v, lo, hi) => { const n = Number(String(v).trim()); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

  /** CSV → 응답 목록. 잘못된 줄은 버리고 '몇 번째 응답'으로만 알린다(이름을 오류 문구에 쓰지 않는다) */
  function parseCsv(text) {
    const all = splitCsv(text);
    const errors = [];
    if (!all.length) return { rows: [], errors: ["응답이 없어요"] };
    const body = all[0][0].trim() === "이름" ? all.slice(1) : all;
    const rows = [];
    body.forEach((c, i) => {
      const no = i + 1;
      if (c.length < 10) { errors.push(`${no}번째 응답: 칸이 모자라요 (${c.length}/11)`); return; }
      const q = [2, 3, 4, 5, 6].map((k) => score(c[k], 1, 5));
      const pre = score(c[7], 1, 5), post = score(c[8], 1, 5), rec = score(c[9], 0, 10);
      if (q.includes(null) || pre === null || post === null || rec === null) { errors.push(`${no}번째 응답: 점수가 범위를 벗어났어요`); return; }
      rows.push({ name: c[0].trim(), dept: c[1].trim() || "미기재", q, pre, post, rec, comment: (c[10] || "").trim() });
    });
    return { rows, errors };
  }

  /* ---------- 익명 처리 ---------- */
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  const TITLES = "님|씨|과장|차장|부장|대리|팀장|주임|사원|매니저|책임|선임|수석|선배|이";

  /** 문장에서 응답자 이름(성+이름, 이름+호칭)과 연락처를 가린다 → {text, hits} */
  function maskText(text, names) {
    let t = String(text || ""); let hits = 0;
    const rep = (re, to) => { t = t.replace(re, (...a) => { hits++; return typeof to === "function" ? to(...a) : to; }); };
    rep(/[\w.+-]+@[\w-]+\.[\w.]+/g, "(이메일)");
    rep(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, "(연락처)");
    const full = [...new Set(names.filter((n) => n && n.length >= 2))].sort((a, b) => b.length - a.length);
    full.forEach((n) => rep(new RegExp(escRe(n), "g"), MASK));
    // 성을 뺀 이름 + 호칭 ("도현 팀장님", "서연님")
    full.filter((n) => n.length === 3).forEach((n) => rep(new RegExp(`${escRe(n.slice(1))}(?=\\s?(${TITLES}))`, "g"), MASK));
    // 성 + 호칭 ("김 팀장님") 은 짐작이 쉬워 함께 가린다
    [...new Set(full.map((n) => n[0]))].forEach((s) => rep(new RegExp(`(^|[^가-힣])${escRe(s)}(?=\\s?(과장|차장|부장|대리|팀장|주임|매니저|책임|선임|수석))`, "g"), (m, p1) => p1 + MASK));
    return { text: t, hits };
  }

  /** 문자열로 순서를 섞는다(같은 입력이면 같은 순서). 응답 순서로 사람을 짐작하지 못하게 */
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** 응답 → 가린 의견 목록. 의견에는 부서도 붙이지 않는다 */
  function anonymize(rows) {
    const names = rows.map((r) => r.name);
    let masked = 0;
    const comments = rows.map((r, i) => [r, i]).filter(([r]) => r.comment).map(([r, i]) => {
      const m = maskText(r.comment, names); masked += m.hits;
      return { text: m.text, rec: r.rec, key: hash(`${i}#${r.comment}`) };
    }).sort((a, b) => a.key - b.key).map(({ text, rec }) => ({ text, rec }));
    return { comments, masked };
  }

  /** 리포트·문구에 이름이 남았는지 마지막으로 본다 → 찾은 이름 목록(화면엔 개수만) */
  function leakCheck(text, names) {
    const s = String(text || "");
    return [...new Set(names.filter((n) => n && n.length >= 2 && s.includes(n)))];
  }

  /* ---------- 집계 ---------- */
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const r1 = (x) => Math.round(x * 10) / 10;
  /** 화면·문구용: 늘 소수 한 자리 (4 → "4.0") */
  const f1 = (x) => Number(x || 0).toFixed(1);

  function aggregate(rows) {
    const n = rows.length;
    const byQ = QUESTIONS.map(([key, label], i) => ({ key, label, avg: r1(avg(rows.map((r) => r.q[i]))) }));
    const overall = r1(avg(rows.map((r) => avg(r.q))));
    const pre = r1(avg(rows.map((r) => r.pre))), post = r1(avg(rows.map((r) => r.post)));
    const improved = n ? Math.round((rows.filter((r) => r.post > r.pre).length / n) * 100) : 0;
    const prom = rows.filter((r) => r.rec >= 9).length, det = rows.filter((r) => r.rec <= 6).length;
    const nps = n ? Math.round(((prom - det) / n) * 100) : 0;
    return { n, overall, byQ, pre, post, delta: r1(post - pre), improved, nps, groups: groupBy(rows) };
  }

  /** 부서별 평균. MIN_GROUP명 미만 부서는 '기타'로 합치고, 합쳐도 모자라면 숨긴다 */
  function groupBy(rows) {
    const m = new Map();
    rows.forEach((r) => { if (!m.has(r.dept)) m.set(r.dept, []); m.get(r.dept).push(r); });
    const out = []; const small = []; const hiddenDepts = [];
    [...m.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([dept, rs]) => {
      if (rs.length >= MIN_GROUP) out.push({ dept, n: rs.length, overall: r1(avg(rs.map((r) => avg(r.q)))), delta: r1(avg(rs.map((r) => r.post - r.pre))) });
      else { small.push(...rs); hiddenDepts.push(dept); }
    });
    let hidden = 0;
    if (small.length >= MIN_GROUP) out.push({ dept: `기타 (${hiddenDepts.length}개 부서 합산)`, n: small.length, overall: r1(avg(small.map((r) => avg(r.q)))), delta: r1(avg(small.map((r) => r.post - r.pre))), merged: true });
    else hidden = small.length;
    return { list: out, hidden };
  }

  /* ---------- 의견 주제 (규칙) ---------- */
  const THEMES = [
    ["실습·사례", /실습|사례|롤플|역할극|예시|케이스/],
    ["시간 배분", /시간|짧|빠듯|쉬는|길었|늘어/],
    ["현업 적용", /현업|적용|바로|실무|써먹|팀에서/],
    ["교재·자료", /자료|교재|슬라이드|워크시트|PPT/i],
    ["강사 전달", /강사|설명|전달|진행|말씀/],
    ["후속 학습", /후속|복습|심화|다음|한 번 더|2차/],
  ];
  const NEG = /아쉬|부족|짧았|짧아|어려|길었|힘들|지루|빠듯|많았|늘려/;

  function themes(comments) {
    return THEMES.map(([theme, re]) => {
      const hit = comments.filter((c) => re.test(c.text));
      const neg = hit.filter((c) => NEG.test(c.text)).length;
      return { theme, count: hit.length, neg, example: (hit.find((c) => NEG.test(c.text)) || hit[0] || {}).text || "" };
    }).filter((t) => t.count).sort((a, b) => b.count - a.count);
  }

  /** 규칙 요약: 숫자에서 바로 나오는 문장만 쓴다 */
  function ruleSummary(agg, comments) {
    if (!agg.n) return { headline: "응답이 없어 요약할 수 없어요", strengths: [], improvements: [], themes: [], nextSteps: [] };
    const sorted = [...agg.byQ].sort((a, b) => b.avg - a.avg);
    const th = themes(comments);
    const strengths = sorted.slice(0, 2).map((q) => `‘${q.label}’ ${f1(q.avg)}점으로 높음`);
    const low = sorted.filter((q) => q.avg < 4.0);
    const improvements = (low.length ? low : sorted.slice(-1)).map((q) => `‘${q.label}’ ${f1(q.avg)}점${q.avg < 4.0 ? " — 4.0 미만" : " — 상대적으로 가장 낮음"}`);
    th.filter((t) => t.neg >= 2).slice(0, 2).forEach((t) => improvements.push(`의견 중 ‘${t.theme}’ 아쉬움 ${t.neg}건`));
    const nextSteps = [];
    if (low.some((q) => q.key === "time") || th.some((t) => t.theme === "시간 배분" && t.neg >= 2)) nextSteps.push("다음 차수는 실습 시간을 늘리고 이론 분량을 줄인 일정안 검토");
    if (low.some((q) => q.key === "apply")) nextSteps.push("현업 적용 과제를 교육 2주 뒤 한 번 더 확인");
    if (th.some((t) => t.theme === "후속 학습")) nextSteps.push("후속 학습 요청이 있어 심화·복습 과정 제안 검토");
    if (!nextSteps.length) nextSteps.push("같은 구성으로 다음 차수 진행, 4주 뒤 현업 적용 여부 확인");
    return {
      headline: `${agg.n}명 응답, 전체 만족도 ${f1(agg.overall)}/5 · 역량 자가진단 ${f1(agg.pre)} → ${f1(agg.post)}(+${f1(agg.delta)})`,
      strengths, improvements, themes: th.slice(0, 4).map(({ theme, count, example }) => ({ theme, count, example })), nextSteps,
    };
  }

  /** Claude에 보낼 입력: 집계와 가린 의견만. 이름·부서별 원자료는 보내지 않는다 */
  function buildAiInput(meta, agg, comments) {
    return {
      course: meta.course, client: meta.client, n: agg.n, overall: agg.overall,
      questions: agg.byQ.map((q) => ({ label: q.label, avg: q.avg })),
      selfAssessment: { pre: agg.pre, post: agg.post, improvedPercent: agg.improved }, nps: agg.nps,
      comments: comments.slice(0, 60).map((c) => c.text.slice(0, 200)),
    };
  }

  /* ---------- Claude 응답 검사 ---------- */
  const strArr = (a, max) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, max) : []);

  /** 형식이 틀리면 null. 이름이 섞여 오면 다시 가린다 */
  function normalizeSummary(d, names) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    if (typeof d.headline !== "string" || !d.headline.trim()) return null;
    const strengths = strArr(d.strengths, 3), improvements = strArr(d.improvements, 3), nextSteps = strArr(d.nextSteps, 3);
    if (!strengths.length && !improvements.length) return null;
    const th = (Array.isArray(d.commentThemes) ? d.commentThemes : [])
      .filter((t) => t && typeof t.theme === "string" && t.theme.trim())
      .map((t) => ({ theme: t.theme.trim(), count: Math.max(0, Math.round(Number(t.count) || 0)), example: typeof t.example === "string" ? t.example.trim() : "" }))
      .slice(0, 4);
    const nm = names || [];
    const m = (s) => maskText(s, nm).text;
    return { headline: m(d.headline.trim()), strengths: strengths.map(m), improvements: improvements.map(m), themes: th.map((t) => ({ ...t, example: m(t.example) })), nextSteps: nextSteps.map(m) };
  }

  /* ---------- 보고용 문구 ---------- */
  function reportText(meta, agg, sum) {
    const L = [];
    L.push(`[교육 결과 보고] ${meta.client} · ${meta.course} (${meta.date})`);
    L.push(`응답 ${agg.n}명${meta.total ? ` / 참석 ${meta.total}명 (응답률 ${Math.round((agg.n / meta.total) * 100)}%)` : ""}`);
    L.push("");
    L.push(`■ 요약: ${sum.headline}`);
    L.push(`■ 추천 지수(NPS): ${agg.nps > 0 ? "+" : ""}${agg.nps} · 사후 역량이 오른 응답 ${agg.improved}%`);
    L.push("■ 문항별 평균 (5점)");
    agg.byQ.forEach((q) => L.push(`  - ${q.label}: ${f1(q.avg)}`));
    if (agg.groups.list.length) {
      L.push(`■ 부서별 (응답 ${MIN_GROUP}명 이상만 표시)`);
      agg.groups.list.forEach((g) => L.push(`  - ${g.dept} ${g.n}명: 만족도 ${f1(g.overall)}, 역량 +${f1(g.delta)}`));
    }
    if (sum.strengths.length) L.push(`■ 잘된 점: ${sum.strengths.join(" / ")}`);
    if (sum.improvements.length) L.push(`■ 보완할 점: ${sum.improvements.join(" / ")}`);
    if (sum.nextSteps.length) L.push(`■ 다음 단계: ${sum.nextSteps.join(" / ")}`);
    L.push("");
    L.push("※ 응답자 이름은 수집 단계에서 분리했고, 이 보고에는 집계와 가린 의견만 담았습니다.");
    return L.join("\n");
  }

  return { f1, QUESTIONS, HEADER, MIN_GROUP, MASK, splitCsv, parseCsv, maskText, anonymize, leakCheck, aggregate, groupBy, themes, ruleSummary, buildAiInput, normalizeSummary, reportText };
});
