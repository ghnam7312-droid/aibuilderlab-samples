/* 분수콕 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Bunsukok, Node(테스트)에서는 require('./logic.js').
 *
 * 문항의 오답 선지마다 '어떤 오개념이면 이걸 고르는지'를 미리 붙여 둔다.
 * 아이가 고른 번호만으로 채점과 오개념 분류가 동시에 끝난다 (채점 1시간 → 즉시).
 *
 * 개인정보: 학생은 '번호'로만 다룬다. 이름은 교사 화면의 명단에만 있고,
 * 화면 주소·CSV·AI 입력에는 들어가지 않는다 (studentLink, addressSafe, toCsv, aiInput).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Bunsukok = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 오개념 유형 5개 ---------- */
  const TYPES = {
    add: { label: "분자·분모 따로 더하기", short: "따로 더하기", hint: "1/2 + 1/3 을 2/5 로 계산한다" },
    denom: { label: "분모가 크면 큰 분수", short: "분모 크기", hint: "1/8 이 1/3 보다 크다고 본다" },
    equal: { label: "똑같이 나누지 않아도 분수", short: "등분 무시", hint: "크기가 다른 조각도 1/4 이라고 본다" },
    equiv: { label: "크기가 같은 분수를 다르게 봄", short: "같은 크기", hint: "2/4 와 1/2 이 다르다고 본다" },
    mixed: { label: "대분수·가분수 바꾸기 오류", short: "대분수", hint: "2와 1/3 을 5/3 으로 바꾼다" },
  };
  const TYPE_KEYS = Object.keys(TYPES);

  /* ---------- 문항 10개 (o: 선지, t: 선지별 판정 — ok 정답, etc 단순 실수) ---------- */
  const QUESTIONS = [
    { id: 1, ask: "1/2 + 1/3 = ?", o: ["5/6", "2/5", "1/6", "2/6"], t: ["ok", "add", "etc", "add"] },
    { id: 2, ask: "1/4 + 2/4 = ?", o: ["3/4", "3/8", "2/4", "1/8"], t: ["ok", "add", "etc", "etc"] },
    { id: 3, ask: "1/3 과 1/8 중 더 큰 분수는?", o: ["1/3", "1/8", "둘이 같다"], t: ["ok", "denom", "etc"] },
    { id: 4, ask: "가장 작은 분수는?", o: ["1/9", "1/2", "1/5", "1/7"], t: ["ok", "denom", "etc", "etc"] },
    { id: 5, ask: "색칠한 부분이 1/4 인 것은?", fig: true, o: ["q4", "u4", "q3", "q4b"], t: ["ok", "equal", "etc", "etc"] },
    { id: 6, ask: "피자를 크기가 다른 3조각으로 잘라 1조각을 먹었어요. 먹은 양을 1/3 이라고 할 수 있나요?", o: ["말할 수 없다 (똑같이 나누지 않았다)", "1/3 이다", "1/2 이다"], t: ["ok", "equal", "etc"] },
    { id: 7, ask: "2/4 와 1/2 의 크기를 비교하면?", o: ["같다", "2/4 가 더 크다", "1/2 이 더 크다"], t: ["ok", "equiv", "equiv"] },
    { id: 8, ask: "3/6 ○ 1/2 — ○ 에 알맞은 기호는?", o: ["=", ">", "<"], t: ["ok", "equiv", "equiv"] },
    { id: 9, ask: "2와 1/3 을 가분수로 나타내면?", o: ["7/3", "5/3", "6/3", "2/3"], t: ["ok", "mixed", "mixed", "etc"] },
    { id: 10, ask: "11/4 를 대분수로 나타내면?", o: ["2와 3/4", "2와 1/4", "3과 3/4", "1과 7/4"], t: ["ok", "etc", "etc", "mixed"] },
  ];
  // 유형마다 그 유형을 드러낼 수 있는 문항 수 (분류 기준에 쓴다)
  const CHANCES = TYPE_KEYS.reduce((m, k) => ((m[k] = QUESTIONS.filter((q) => q.t.includes(k)).length), m), {});

  /* ---------- 채점 + 분류 ---------- */
  /** answers: 문항 순서대로 고른 선지 번호(0부터), 안 풀었으면 -1 또는 null */
  function grade(answers) {
    const a = Array.isArray(answers) ? answers : [];
    const counts = TYPE_KEYS.reduce((m, k) => ((m[k] = 0), m), {});
    const items = QUESTIONS.map((q, i) => {
      const p = Number.isInteger(a[i]) && a[i] >= 0 && a[i] < q.o.length ? a[i] : -1;
      const tag = p < 0 ? "blank" : q.t[p];
      if (counts[tag] !== undefined) counts[tag]++;
      return { q: q.id, picked: p, tag, ok: tag === "ok" };
    });
    const correct = items.filter((x) => x.ok).length;
    const answered = items.filter((x) => x.picked >= 0).length;
    // 같은 유형 오답이 2번 이상이면 '확실', 1번이면 '의심'
    const found = TYPE_KEYS.filter((k) => counts[k] > 0)
      .map((k) => ({ type: k, n: counts[k], level: counts[k] >= 2 ? "sure" : "maybe" }))
      .sort((x, y) => y.n - x.n || TYPE_KEYS.indexOf(x.type) - TYPE_KEYS.indexOf(y.type));
    return { score: correct * 10, correct, answered, items, counts, found, main: found.length && found[0].level === "sure" ? found[0].type : "" };
  }

  /** 반 전체: 유형별로 '확실'인 학생 수 */
  function classSummary(students) {
    const list = (students || []).filter((s) => Array.isArray(s.answers));
    const byType = TYPE_KEYS.reduce((m, k) => ((m[k] = { sure: 0, maybe: 0, nos: [] }), m), {});
    let total = 0;
    for (const s of list) {
      const g = grade(s.answers);
      total += g.score;
      for (const f of g.found) { byType[f.type][f.level]++; if (f.level === "sure") byType[f.type].nos.push(s.no); }
    }
    const top = TYPE_KEYS.slice().sort((a, b) => byType[b].sure - byType[a].sure)[0];
    return { n: list.length, avg: list.length ? Math.round(total / list.length) : 0, byType, top: list.length && byType[top].sure ? top : "" };
  }

  /* ---------- 번호 · 주소 (이름 노출 방지) ---------- */
  const pad = (no) => String(Math.max(0, Math.floor(Number(no) || 0))).padStart(2, "0");
  /** 학생 풀이 주소: 번호만 들어간다 */
  function studentLink(base, no) { return `${String(base || "").split("#")[0]}#/solve/${pad(no)}`; }
  /** 주소(또는 내보낼 글)에 명단의 이름이 들어 있지 않은지 — 인코딩된 형태까지 본다 */
  function addressSafe(text, roster) {
    const raw = String(text || "");
    let dec = raw;
    try { dec = decodeURIComponent(raw.replace(/\+/g, " ")); } catch (e) { /* 깨진 인코딩은 원문으로 본다 */ }
    return !(roster || []).some((r) => r && r.name && (dec.includes(r.name) || raw.includes(encodeURIComponent(r.name))));
  }
  /** "#/solve/07" → 7, 이름 같은 다른 글자면 0 */
  function parseHash(hash) {
    const m = String(hash || "").match(/^#\/solve\/(\d{1,3})$/);
    if (m) return { view: "solve", no: Number(m[1]) };
    return { view: "teacher", no: 0 };
  }

  /* ---------- 내보내기 (번호·점수·유형만) ---------- */
  function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function toCsv(students) {
    const head = ["번호", "점수", ...QUESTIONS.map((q) => `${q.id}번`), ...TYPE_KEYS.map((k) => TYPES[k].short)];
    const rows = (students || []).filter((s) => Array.isArray(s.answers)).map((s) => {
      const g = grade(s.answers);
      return [pad(s.no), g.score, ...g.items.map((x) => (x.picked < 0 ? "" : x.ok ? "O" : x.picked + 1)), ...TYPE_KEYS.map((k) => (g.counts[k] >= 2 ? "확실" : g.counts[k] ? "의심" : ""))];
    });
    return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  /* ---------- AI 입력 · 응답 검사 · 규칙 설명 ---------- */
  /** Claude에 보내는 것: 번호와 고른 선지, 규칙 분류. 이름은 넣지 않는다 */
  function aiInput(student) {
    const g = grade(student.answers);
    return {
      no: pad(student.no),
      score: g.score,
      wrong: g.items.filter((x) => !x.ok && x.picked >= 0).map((x) => {
        const q = QUESTIONS[x.q - 1];
        return { q: x.q, ask: q.ask, picked: q.fig ? FIG_LABEL[q.o[x.picked]] : q.o[x.picked], answer: q.fig ? FIG_LABEL[q.o[0]] : q.o[0], tag: x.tag };
      }),
      counts: g.counts,
      types: TYPE_KEYS.map((k) => ({ key: k, label: TYPES[k].label })),
    };
  }
  const FIG_LABEL = { q4: "똑같이 4칸 중 1칸", u4: "크기가 다른 4칸 중 1칸", q3: "똑같이 3칸 중 1칸", q4b: "똑같이 4칸 중 2칸" };

  /** Claude 응답 검사: 규칙이 근거를 찾지 못한 유형은 버린다 (없는 오개념을 붙이지 않게) */
  function normalizeExplain(d, counts) {
    if (!d || typeof d !== "object") return null;
    const s = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const seen = new Set();
    const types = (Array.isArray(d.types) ? d.types : [])
      .filter((t) => t && TYPES[t.type] && counts && counts[t.type] > 0 && !seen.has(t.type) && seen.add(t.type))
      .map((t) => ({ type: t.type, why: s(t.why, 200), activity: s(t.activity, 200) }))
      .filter((t) => t.why && t.activity);
    const summary = s(d.summary, 240);
    if (!summary || (!types.length && Object.values(counts || {}).some((n) => n > 0))) return null;
    return { summary, types, talk: s(d.talk, 200) };
  }

  const ACT = {
    add: { why: "분모가 다른 분수를 더할 때 분자끼리, 분모끼리 따로 더했어요.", activity: "같은 크기 띠 그림 두 장에 1/2, 1/3을 칠해 보고, 6칸으로 다시 나눠 합을 세게 해 보세요.", talk: "“1/2 컵에 1/3 컵을 부으면 1컵보다 많을까, 적을까?”" },
    denom: { why: "분모가 큰 분수를 더 크다고 골랐어요. 자연수처럼 숫자 크기로 비교한 것으로 보여요.", activity: "같은 피자를 3명, 8명이 나눠 먹는 그림으로 한 사람 몫을 비교해 보세요.", talk: "“피자 한 판을 8명이 나누면 3명이 나눌 때보다 내 몫이 어떻게 될까?”" },
    equal: { why: "똑같이 나누지 않은 그림이나 조각도 분수로 보았어요.", activity: "종이를 접어 4칸으로 나눈 뒤, 크기가 같은지 겹쳐 확인하는 활동을 해 보세요.", talk: "“이 네 조각을 겹치면 크기가 똑같을까?”" },
    equiv: { why: "2/4와 1/2처럼 크기가 같은 분수를 서로 다르다고 보았어요.", activity: "같은 띠를 2칸, 4칸, 6칸으로 나눠 칠한 부분이 같은지 나란히 놓고 비교해 보세요.", talk: "“두 띠를 나란히 놓으면 칠한 길이가 같을까?”" },
    mixed: { why: "대분수를 가분수로 바꿀 때 자연수 부분을 분모와 곱하지 않았어요.", activity: "2와 1/3을 1/3 조각으로 몇 개인지 직접 세어 보게 하세요 (3+3+1).", talk: "“케이크 2판과 1/3판을 1/3 조각으로 자르면 몇 조각일까?”" },
  };
  /** 규칙 설명: 확실·의심 유형마다 정해 둔 설명과 활동 */
  function ruleExplain(student) {
    const g = grade(student.answers);
    const types = g.found.map((f) => ({ type: f.type, why: ACT[f.type].why + (f.level === "maybe" ? " (1번만 나와 의심 단계)" : ""), activity: ACT[f.type].activity }));
    const summary = g.answered < QUESTIONS.length ? `${QUESTIONS.length}문항 중 ${g.answered}문항만 풀었어요. 다 푼 뒤 다시 보세요.`
      : !g.found.length ? `${g.score}점. 오개념으로 볼 만한 오답이 없어요${g.correct < 10 ? " (단순 실수만 있어요)" : ""}.`
      : `${g.score}점. ${g.found.filter((f) => f.level === "sure").map((f) => TYPES[f.type].short).join(", ") || "뚜렷한 유형 없음"}${g.found.some((f) => f.level === "maybe") ? ` · 의심 ${g.found.filter((f) => f.level === "maybe").map((f) => TYPES[f.type].short).join(", ")}` : ""}`;
    return { summary, types, talk: g.found.length ? ACT[g.found[0].type].talk : "" };
  }

  return { TYPES, TYPE_KEYS, QUESTIONS, CHANCES, FIG_LABEL, grade, classSummary, pad, studentLink, addressSafe, parseHash, csvCell, toCsv, aiInput, normalizeExplain, ruleExplain };
});
