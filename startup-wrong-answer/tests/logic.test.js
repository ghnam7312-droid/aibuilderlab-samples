// 오답지도 핵심 규칙 테스트 — npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const Q = { no: 1, unit: "일차부등식", tag: "개념형", ans: 3, trap: 2 };

test("샘플 반은 늘 같은 40명 × 12문항, 답은 1~5", () => {
  const a = L.makeSample(); const b = L.makeSample();
  assert.equal(a.students.length, 40);
  assert.equal(a.qs.length, 12);
  assert.deepEqual(a.students[5], b.students[5]);
  assert.ok(a.students.every((s) => s.ans.every((x) => x >= 1 && x <= 5)));
  assert.ok(a.qs.every((q) => q.ans !== q.trap), "정답과 계산 실수 보기는 다르다");
});

test("채점: 정답이면 null", () => {
  assert.equal(L.classify(Q, 3), null);
});

test("오답 유형: 계산 실수 보기 > 문항 태그", () => {
  assert.equal(L.classify(Q, 2), "s");
  assert.equal(L.classify(Q, 5), "k");
  assert.equal(L.classify({ ...Q, tag: "서술·활용형" }, 5), "m");
  assert.equal(L.classify({ ...Q, tag: "계산형" }, 1), "s");
  assert.equal(L.classify({ ...Q, tag: "모르는태그" }, 1), "k");
  assert.match(L.reason(Q, 2), /계산 실수 보기/);
});

test("반 통계: 문항별 정답률·유형 합계·학생 점수가 서로 맞는다", () => {
  const { qs, students } = L.makeSample();
  const st = L.stats(qs, students);
  assert.equal(st.qRate.length, 12);
  assert.equal(st.score.length, 40);
  const totalWrong = students.length * qs.length - st.score.reduce((a, b) => a + b, 0);
  assert.equal(st.wrong, totalWrong);
  assert.equal(st.cnt.k + st.cnt.s + st.cnt.m, totalWrong);
  qs.forEach((q, i) => assert.equal(st.qRate[i], students.filter((s) => s.ans[i] === q.ans).length / 40));
});

test("단원별 정답률은 낮은 순, 다시 다룰 문항은 60% 미만", () => {
  const qs = [{ unit: "A" }, { unit: "A" }, { unit: "B" }];
  const u = L.unitRates(qs, [0.5, 0.7, 0.4]);
  assert.deepEqual(u.map((x) => x.unit), ["B", "A"]);
  assert.equal(u[1].v, 0.6);
  assert.deepEqual(L.retestItems([0.5, 0.6, 0.59]).map((x) => x.i), [0, 2]);
});

test("검수 일치율: 확인한 건만 센다", () => {
  assert.deepEqual(L.agreement({}), { y: 0, n: 0, total: 0, rate: null });
  const a = L.agreement({ a: "y", b: "y", c: "n", d: "skip", e: "y" });
  assert.equal(a.total, 4);
  assert.equal(a.rate, 0.75);
});

test("선생님 확정 유형: 맞음이면 규칙 유형, 틀림이면 고친 유형", () => {
  assert.equal(L.teacherType({ x: "y" }, {}, "x", "s"), "s");
  assert.equal(L.teacherType({ x: "n" }, { x: "m" }, "x", "s"), "m");
  assert.equal(L.teacherType({ x: "n" }, {}, "x", "s"), null);
  assert.equal(L.teacherType({}, {}, "x", "s"), null);
});

test("가장 큰 오답 유형: 동점이면 개념 부족 우선, 없으면 null", () => {
  assert.equal(L.mainType(["s", "s", "m"]), "s");
  assert.equal(L.mainType(["k", "s"]), "k");
  assert.equal(L.mainType([]), null);
  assert.equal(L.mainType([null, undefined]), null);
});

test("Claude 진단 일치율은 AI가 쓴 학생 중 선생님 검수와 비교 가능한 학생만", () => {
  const coach = { 0: { mode: "ai", main: "s" }, 1: { mode: "ai", main: "k" }, 2: { mode: "rule", main: "k" }, 3: { mode: "ai", main: "m" } };
  const r = L.coachAgreement(coach, { 0: "s", 1: "m", 2: "k" });
  assert.deepEqual(r, { same: 1, total: 2, rate: 0.5 });
});

test("Claude 코칭 응답 검사: 한글 유형명 → 코드, 빈 처방은 거절", () => {
  const ok = L.normalizeCoach({ main: "계산 실수", comment: "서연이는 풀이 방향은 맞는데 계산에서 자주 미끄러져요.", prescription: "검산 5문항" });
  assert.equal(ok.main, "s");
  assert.equal(L.normalizeCoach({ main: "계산 실수", comment: "짧음", prescription: "x" }), null);
  assert.equal(L.normalizeCoach({ main: "엉뚱한 유형", comment: "충분히 긴 코멘트입니다 정말로", prescription: "x" }), null);
  assert.equal(L.normalizeCoach({ main: "개념 부족", comment: "충분히 긴 코멘트입니다 정말로", prescription: "" }), null);
  assert.equal(L.normalizeCoach(null), null);
});

test("규칙 코칭: 오답 유형에 맞는 처방, 다 맞았으면 칭찬", () => {
  const c = L.ruleCoach("김서연", ["m", "m", "s"], ["일차부등식", "연립일차방정식"], 10, 12);
  assert.equal(c.main, "m");
  assert.match(c.comment, /^김서연 학생은 기본기는 탄탄해요/);
  assert.equal(c.prescription, L.RX.m);
  assert.equal(L.ruleCoach("이도윤", [], [], 12, 12).main, null);
});

test("코칭 입력에는 틀린 문항만, 선생님이 고친 유형을 함께 보낸다", () => {
  const qs = [Q, { ...Q, no: 2, ans: 1, trap: 4 }];
  const input = L.coachInput(qs, { name: "홍길동", ans: [3, 4] }, 1, 7.25, { "0-1": "n" }, { "0-1": "m" }, 0);
  assert.equal(input.wrongs.length, 1);
  assert.equal(input.wrongs[0].no, 2);
  assert.equal(input.wrongs[0].trapChoice, true);
  assert.equal(input.wrongs[0].teacherLabel, "문제 이해");
  assert.equal(input.classAvg, 7.3);
});

test("학부모 문구: 틀린 문항·유형·처방, 다 맞으면 칭찬 한 줄", () => {
  const t = L.msgText({ exam: "3월 단원 평가", name: "김서연", score: 9, total: 12, classAvg: 7.46, wrongNos: [2, 7, 11], counts: { k: 1, s: 2, m: 0 }, units: ["일차부등식"], coach: { comment: "코멘트", prescription: "처방" } });
  assert.match(t, /^\[3월 단원 평가\] 김서연 학생 결과\n점수 9 \/ 12  \(반 평균 7\.5\)/);
  assert.match(t, /틀린 문항 2번, 7번, 11번/);
  assert.match(t, /오답 유형 개념 부족 1개, 계산 실수 2개$/m);
  assert.match(t, /다음 수업: 처방$/);
  const perfect = L.msgText({ exam: "x", name: "A", score: 12, total: 12, classAvg: 7, wrongNos: [], counts: { k: 0, s: 0, m: 0 }, units: [], coach: null });
  assert.match(perfect, /아주 잘했습니다/);
  assert.doesNotMatch(perfect, /오답 유형/);
});

test("3회 추이: 지난 점수는 이름으로 정해지고 0~만점 사이", () => {
  const p = L.pastScores("김서연", 9, 12);
  assert.deepEqual(p, L.pastScores("김서연", 9, 12));
  assert.ok(p.every((x) => x >= 0 && x <= 12));
  const { qs, students } = L.makeSample();
  const st = L.stats(qs, students);
  const tr = L.classTrend(qs, students, st, "3월");
  assert.deepEqual(tr.map((x) => x.short), ["1월", "2월", "3월"]);
  assert.ok(Math.abs(tr[2].share.k + tr[2].share.s + tr[2].share.m - 1) < 1e-9);
  const mv = L.movers(students, st, 12);
  assert.ok(mv.up.every((r) => r.d > 0) && mv.down.every((r) => r.d < 0));
});

test("답안 붙여 넣기: 공백·쉼표·탭·붙여 쓴 숫자를 모두 읽고 틀린 줄은 알려 준다", () => {
  const r = L.parseAnswerPaste("홍길동 3 5 2\n김철수,1,2,3\n이영희\t4\t4\t4\n박민수 352\n최지우 3 9 2\n정하나 1 2", 3);
  assert.deepEqual(r.rows.map((x) => x.name), ["홍길동", "김철수", "이영희", "박민수"]);
  assert.deepEqual(r.rows[3].ans, [3, 5, 2]);
  assert.deepEqual(r.bad, [5, 6]);
});
