/* 하루치 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Haruchi, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다.
 *
 * 계획은 두 길로 만든다.
 *   Claude: 서버 작업 study.plan 이 7일 계획을 JSON 으로 돌려준다.
 *   규칙: makePlan() — 기획서 v3 프롬프트의 규칙을 그대로 코드로 옮긴 것.
 * Claude 계획은 validatePlan()을 통과해야만 쓴다. 날짜가 어긋나거나, 하루 시간을 넘기거나,
 * 하루 3과목 이상이면 버리고 규칙 계획으로 바꾼다. (그 이유를 화면에 보여 준다)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Haruchi = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const WD = "일월화수목금토";
  const HOURS = [1, 1.5, 2, 3];
  const DAY_MS = 86400000;

  /* ---------- 날짜 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function label(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function weekday(s) { return WD[d0(s).getDay()]; }
  function daysLeft(exam, today) { return Math.round((d0(exam) - d0(today)) / DAY_MS); }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;

  /* ---------- 규칙 계획 (v3 프롬프트의 규칙) ---------- */
  /** 남은 기간으로 단계를 정한다 */
  function phaseOf(left) { return left <= 7 ? "마무리" : left <= 21 ? "문제 풀이" : "개념 정리"; }
  const ACT = {
    "개념 정리": ["핵심 개념 정리", "기출 10문제"],
    "문제 풀이": ["기출 1회분 풀기", "오답 노트"],
    "마무리": ["모의고사", "약점 단원 복습"],
  };
  /** 0.5시간 단위로 반올림 (1.5시간 ÷ 2과목 = 0.75 → 0.5 + 1.0 처럼 합을 맞춘다) */
  function splitHours(hrs, n) {
    const halves = Math.round(hrs * 2);
    const base = Math.floor(halves / n), extra = halves % n;
    return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 2);
  }
  function makePlan(start, exam, hrs, subs, today) {
    const phase = phaseOf(daysLeft(exam, today || start));
    const days = [];
    let k = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const items = [];
      if (i === 6) {
        items.push({ sub: "주간 복습", act: "틀린 문제 다시 풀기", h: hrs, done: false });
      } else {
        const per = Math.min(2, subs.length);
        const hs = splitHours(hrs, per);
        for (let j = 0; j < per; j++) items.push({ sub: subs[k++ % subs.length], act: ACT[phase][j % 2], h: hs[j], done: false });
      }
      days.push({ date, items });
    }
    return { start, phase, days, mode: "rule" };
  }

  /* ---------- Claude 계획 검사 ---------- */
  /** 통과하면 {ok:true, plan}, 아니면 {ok:false, reason} */
  function validatePlan(d, opt) {
    const bad = (reason) => ({ ok: false, reason });
    if (!d || typeof d !== "object" || !Array.isArray(d.days)) return bad("계획 형식이 아님");
    if (d.days.length !== 7) return bad(`7일이 아니라 ${d.days.length}일`);
    const cap = Math.round(opt.hrs * 60);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = d.days[i] || {};
      const want = addDays(opt.start, i);
      if (day.date !== want) return bad(`${i + 1}일째 날짜가 ${day.date || "없음"} (기대 ${want})`);
      const items = (Array.isArray(day.items) ? day.items : []).filter((x) => x && typeof x.subject === "string" && x.subject.trim());
      if (!items.length) return bad(`${label(want)}에 할 일이 없음`);
      const subjects = new Set(items.map((x) => x.subject.trim()));
      if (i < 6 && subjects.size > 2) return bad(`${label(want)}에 과목이 ${subjects.size}개 (최대 2개)`);
      let total = 0;
      const out = items.map((x) => {
        const m = Math.round(Number(x.minutes));
        if (!(m > 0)) throw new Error("시간 없음");
        total += m;
        return { sub: x.subject.trim().slice(0, 30), act: String(x.task || "").trim().slice(0, 40) || "공부", h: Math.round((m / 60) * 100) / 100, done: false };
      });
      if (total > cap + 5) return bad(`${label(want)} 계획이 ${total}분 — 하루 ${opt.hrs}시간(${cap}분)을 넘김`);
      days.push({ date: want, items: out });
    }
    return {
      ok: true,
      plan: { start: opt.start, phase: typeof d.phase === "string" && d.phase.trim() ? d.phase.trim().slice(0, 12) : phaseOf(daysLeft(opt.exam, opt.start)), days, mode: "ai", coach: typeof d.coach === "string" ? d.coach.trim().slice(0, 140) : "" },
    };
  }
  /** validatePlan 이 던지는 오류(숫자 아닌 시간)도 잡는다 */
  function checkPlan(d, opt) {
    try { return validatePlan(d, opt); } catch (e) { return { ok: false, reason: "시간 값이 숫자가 아님" }; }
  }

  /** 시간 표기: 30분 단위면 '1.5시간', 아니면 '72분' */
  function fmtH(h) {
    const m = Math.round(h * 60);
    return m % 30 === 0 ? `${m / 60}시간` : `${m}분`;
  }

  /* ---------- 진행 ---------- */
  function stats(plan, today) {
    const all = plan ? plan.days.flatMap((d) => d.items) : [];
    const done = all.filter((x) => x.done).length;
    const missed = plan ? plan.days.filter((d) => d.date < today).flatMap((d) => d.items).filter((x) => !x.done).length : 0;
    const todayDay = plan ? plan.days.find((d) => d.date === today) || null : null;
    return { total: all.length, done, pct: all.length ? Math.round((done / all.length) * 100) : 0, missed, todayDay };
  }

  /** 지난 날의 못 한 일을 오늘부터 남은 날에 돌려 담는다. 원본은 건드리지 않는다 */
  function replan(plan, today) {
    const p = JSON.parse(JSON.stringify(plan));
    const past = p.days.map((d, i) => (d.date < today ? i : -1)).filter((i) => i >= 0);
    const future = p.days.map((d, i) => (d.date >= today ? i : -1)).filter((i) => i >= 0);
    const missed = past.flatMap((i) => p.days[i].items.filter((x) => !x.done));
    if (!missed.length) return { plan: p, moved: [], reason: "none" };
    if (!future.length) return { plan: p, moved: [], reason: "nofuture" };
    past.forEach((i) => { p.days[i].items = p.days[i].items.filter((x) => x.done); });
    // 가장 가벼운 날부터 채운다 (하루에 몰리지 않게)
    const load = (i) => p.days[i].items.reduce((a, x) => a + x.h, 0);
    const moved = [];
    missed.forEach((x) => {
      const di = future.slice().sort((a, b) => load(a) - load(b) || a - b)[0];
      p.days[di].items.push({ ...x, moved: true });
      moved.push([di, p.days[di].items.length - 1]);
    });
    return { plan: p, moved, reason: "ok" };
  }

  /** 코치 한마디 (진행 상황 규칙) — HTML 이 아니라 조각 배열로 돌려준다: [글, 굵게?] */
  function coachParts(plan, s, today) {
    if (!plan) return [["목표와 시험일을 넣으면 이번 주 몫을 나눠 드릴게요.", false]];
    const t = s.todayDay;
    const left = t ? t.items.filter((x) => !x.done) : [];
    if (s.missed) return [["지난 날에 못 한 일이 ", false], [`${s.missed}개`, true], [" 있어요. 몰아서 하지 말고 '밀린 일 다시 나누기'로 남은 날에 나눠요.", false]];
    if (t && !left.length) {
      const next = plan.days.find((d) => d.date > t.date);
      return [["오늘 몫 끝! 이번 주 ", false], [`${s.pct}%`, true], [`예요. 내일은 ${next && next.items[0] ? next.items[0].sub : "복습"}부터 시작해요.`, false]];
    }
    if (s.pct >= 60) return [["이번 주 ", false], [`${s.pct}%`, true], [" — 목표(60%)를 넘었어요. 이대로면 충분해요.", false]];
    if (t) {
      const h = left.reduce((a, x) => a + x.h, 0);
      return [["오늘은 ", false], [left[0].sub, true], [`부터. ${left.length}개, 합쳐서 ${fmtH(h)}이면 끝나요.`, false]];
    }
    return plan.days[0].date > today ? [["계획은 ", false], [label(plan.days[0].date), true], ["부터 시작해요.", false]] : [["계획한 주가 지났어요. 새 계획을 만들어 주세요.", false]];
  }

  /** 서버로 보낼 입력 */
  function planInput(o) {
    return { goal: o.goal, examDate: o.exam, hoursPerDay: o.hrs, subjects: o.subs, today: o.start, daysLeft: daysLeft(o.exam, o.start) };
  }

  /** 입력 검사: 오류 문구 또는 "" */
  function checkForm(o, today) {
    if (!o.goal || !o.goal.trim()) return { field: "goal", msg: "목표를 써 주세요. 예) 토익 800점" };
    if (!isIso(o.exam)) return { field: "exam", msg: "시험일을 골라 주세요." };
    if (daysLeft(o.exam, today) < 1) return { field: "exam", msg: "시험일은 내일 이후여야 해요." };
    if (!o.subs || !o.subs.length) return { field: "subIn", msg: "과목을 하나 이상 넣어 주세요." };
    if (!HOURS.includes(o.hrs)) return { field: "hrs", msg: "하루 공부 시간을 골라 주세요." };
    return null;
  }

  return { WD, HOURS, fmtH, d0, iso, addDays, label, weekday, daysLeft, isIso, phaseOf, splitHours, makePlan, validatePlan, checkPlan, stats, replan, coachParts, planInput, checkForm };
});
