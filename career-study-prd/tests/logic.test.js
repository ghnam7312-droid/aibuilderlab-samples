// 하루치 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../logic.js");

const TODAY = "2026-10-20";
const SUBS = ["설계", "개발", "DB", "언어", "구축"];
const OPT = { start: TODAY, exam: "2026-11-15", hrs: 2, subs: SUBS };

/** Claude 가 보낼 법한 정상 계획 */
function goodAi() {
  return {
    phase: "기출 반복",
    days: Array.from({ length: 7 }, (_, i) => ({
      date: H.addDays(TODAY, i),
      items: i === 6 ? [{ subject: "주간 복습", task: "오답 다시 풀기", minutes: 120 }]
        : [{ subject: SUBS[i % 5], task: "기출 1회분", minutes: 60 }, { subject: SUBS[(i + 1) % 5], task: "오답 노트", minutes: 60 }],
    })),
    coach: "오답 노트는 틀린 이유를 한 줄로만 적어요.",
  };
}

test("시간 표기: 30분 단위는 시간, 아니면 분", () => {
  assert.equal(H.fmtH(1.5), "1.5시간");
  assert.equal(H.fmtH(2), "2시간");
  assert.equal(H.fmtH(1.2), "72분");
});

test("남은 기간으로 단계가 바뀐다", () => {
  assert.equal(H.phaseOf(30), "개념 정리");
  assert.equal(H.phaseOf(21), "문제 풀이");
  assert.equal(H.phaseOf(7), "마무리");
});

test("하루 시간을 0.5시간 단위로 나누고 합은 그대로", () => {
  assert.deepEqual(H.splitHours(2, 2), [1, 1]);
  assert.deepEqual(H.splitHours(1.5, 2), [1, 0.5]);
  assert.deepEqual(H.splitHours(3, 1), [3]);
});

test("규칙 계획: 7일, 하루 2과목 이하, 7일째는 복습, 하루 시간 지킴", () => {
  const p = H.makePlan(TODAY, "2026-11-15", 1.5, SUBS, TODAY);
  assert.equal(p.days.length, 7);
  assert.equal(p.days[0].date, TODAY);
  assert.equal(p.days[6].items[0].sub, "주간 복습");
  for (const d of p.days.slice(0, 6)) {
    assert.ok(d.items.length <= 2);
    assert.equal(d.items.reduce((a, x) => a + x.h, 0), 1.5);
  }
  assert.equal(p.mode, "rule");
});

test("과목이 하나면 하루 한 과목", () => {
  const p = H.makePlan(TODAY, "2026-11-15", 2, ["토익"], TODAY);
  assert.equal(p.days[0].items.length, 1);
  assert.equal(p.days[0].items[0].h, 2);
});

test("Claude 계획 검사: 정상 계획은 통과하고 분을 시간으로 바꾼다", () => {
  const c = H.checkPlan(goodAi(), OPT);
  assert.ok(c.ok, c.reason);
  assert.equal(c.plan.mode, "ai");
  assert.equal(c.plan.days[0].items[0].h, 1);
  assert.equal(c.plan.coach.length > 0, true);
});

test("Claude 계획 검사: 하루 시간을 넘기면 버린다", () => {
  const d = goodAi();
  d.days[2].items[0].minutes = 150;
  const c = H.checkPlan(d, OPT);
  assert.equal(c.ok, false);
  assert.match(c.reason, /넘김/);
});

test("Claude 계획 검사: 날짜가 하루라도 어긋나면 버린다", () => {
  const d = goodAi();
  d.days[3].date = H.addDays(TODAY, 4);
  assert.match(H.checkPlan(d, OPT).reason, /날짜/);
});

test("Claude 계획 검사: 7일이 아니거나 형식이 틀리면 버린다", () => {
  assert.equal(H.checkPlan({ days: [] }, OPT).ok, false);
  assert.equal(H.checkPlan(null, OPT).ok, false);
  const d = goodAi(); d.days[1].items[0].minutes = "한 시간";
  assert.equal(H.checkPlan(d, OPT).ok, false);
});

test("Claude 계획 검사: 하루 3과목 이상이면 버린다 (복습일 제외)", () => {
  const d = goodAi();
  d.days[0].items = [{ subject: "설계", minutes: 40 }, { subject: "개발", minutes: 40 }, { subject: "DB", minutes: 40 }];
  assert.match(H.checkPlan(d, OPT).reason, /과목이 3개/);
});

test("진행 통계: 지난 날 못 한 일은 밀림으로 센다", () => {
  const p = H.makePlan(H.addDays(TODAY, -2), "2026-11-15", 2, SUBS, TODAY);
  p.days[0].items[0].done = true;
  const s = H.stats(p, TODAY);
  assert.equal(s.done, 1);
  assert.equal(s.missed, 3); // 이틀 × 2개 − 1
  assert.equal(s.todayDay.date, TODAY);
  assert.equal(s.pct, Math.round((1 / 13) * 100));
});

test("밀린 일 다시 나누기: 원본은 그대로, 가장 가벼운 날부터 채운다", () => {
  const p = H.makePlan(H.addDays(TODAY, -2), "2026-11-15", 2, SUBS, TODAY);
  const r = H.replan(p, TODAY);
  assert.equal(r.reason, "ok");
  assert.equal(r.moved.length, 4);
  assert.equal(p.days[0].items.length, 2, "원본은 바뀌지 않는다");
  assert.equal(r.plan.days[0].items.length, 0);
  // 한 날에 두 개 이상 몰리지 않는다 (남은 날 5일, 옮길 일 4개)
  const per = r.moved.map(([di]) => di);
  assert.equal(new Set(per).size, 4);
  assert.ok(r.plan.days[r.moved[0][0]].items.at(-1).moved);
});

test("밀린 일이 없거나 남은 날이 없을 때", () => {
  const p = H.makePlan(TODAY, "2026-11-15", 2, SUBS, TODAY);
  assert.equal(H.replan(p, TODAY).reason, "none");
  const old = H.makePlan("2026-10-01", "2026-11-15", 2, SUBS, "2026-10-01");
  assert.equal(H.replan(old, TODAY).reason, "nofuture");
});

test("코치 한마디: 밀린 일이 있으면 그 수부터 말한다", () => {
  const p = H.makePlan(H.addDays(TODAY, -2), "2026-11-15", 2, SUBS, TODAY);
  const parts = H.coachParts(p, H.stats(p, TODAY), TODAY);
  assert.deepEqual(parts[1], ["4개", true]);
  assert.match(H.coachParts(null, {}, TODAY)[0][0], /목표와 시험일/);
});

test("입력 검사: 빈 목표, 지난 시험일, 과목 없음", () => {
  assert.equal(H.checkForm({ goal: " ", exam: "2026-11-01", subs: SUBS, hrs: 2 }, TODAY).field, "goal");
  assert.equal(H.checkForm({ goal: "합격", exam: TODAY, subs: SUBS, hrs: 2 }, TODAY).field, "exam");
  assert.equal(H.checkForm({ goal: "합격", exam: "2026-13-01", subs: SUBS, hrs: 2 }, TODAY).field, "exam");
  assert.equal(H.checkForm({ goal: "합격", exam: "2026-11-01", subs: [], hrs: 2 }, TODAY).field, "subIn");
  assert.equal(H.checkForm({ goal: "합격", exam: "2026-11-01", subs: SUBS, hrs: 2 }, TODAY), null);
});

test("서버로 보낼 입력에는 남은 날 수가 들어간다", () => {
  const i = H.planInput({ goal: "합격", exam: "2026-11-15", hrs: 2, subs: SUBS, start: TODAY });
  assert.equal(i.daysLeft, 26);
  assert.equal(i.today, TODAY);
  assert.equal(i.hoursPerDay, 2);
});
