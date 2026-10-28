// 십분설계 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const lesson = (o) => ({ title: "피드백 말하기", objective: "상황-행동-영향 순서로 피드백 문장을 작성할 수 있다.", content: "", assess: { type: "실습 과제", stem: "제시된 상황에 맞게 피드백 문장을 작성하시오." }, seg: { video: 4, practice: 4, quiz: 2 }, ...o });

test("목표 읽기: 행동 동사 하나면 측정 가능", () => {
  const a = L.analyzeObjective("닫힌 질문과 열린 질문을 구분할 수 있다.");
  assert.deepEqual(a.verbs, ["구분한다"]);
  assert.equal(a.measurable, true);
  assert.deepEqual(L.analyzeObjective("팀원별 다음 면담 계획을 세울 수 있다.").verbs, ["세운다"]);
});

test("목표 읽기: ‘이해한다’, ‘안다’는 관찰할 수 없는 동사", () => {
  assert.deepEqual(L.analyzeObjective("1:1 면담의 목적을 이해한다.").vague, ["이해한다"]);
  assert.equal(L.analyzeObjective("경청의 중요성을 안다.").measurable, false);
  const two = L.analyzeObjective("면담 기록의 필요성을 인식하고 기록 양식을 익힌다.");
  assert.deepEqual(two.vague, ["인식하고", "익힌다"]);
});

test("차시 검사: 목표·평가·분량이 모두 맞으면 통과, 짝도 맞음", () => {
  const c = L.checkLesson(lesson());
  assert.deepEqual(c.flags, []);
  assert.equal(c.pair, true);
  assert.equal(c.total, 10);
});

test("차시 검사: 작성 목표에 선택형 문항이면 짝이 안 맞는다", () => {
  const c = L.checkLesson(lesson({ assess: { type: "선택형", stem: "다음 중 올바른 피드백 문장을 고르시오." } }));
  assert.deepEqual(c.flags, ["mismatch", "noAct"]);
  assert.equal(c.pair, false);
  // 유형은 맞아도 문항에 그 행동이 없으면
  assert.deepEqual(L.checkLesson(lesson({ assess: { type: "실습 과제", stem: "피드백 양식을 채워 보시오." } })).flags, ["noAct"]);
});

test("차시 검사: 관찰 불가 동사 · 평가 없음 · 행동 둘 · 동사 없음", () => {
  assert.deepEqual(L.checkLesson(lesson({ objective: "1:1 면담의 목적을 이해한다.", assess: { type: "서술형", stem: "" } })).flags, ["vague", "noAssess"]);
  assert.ok(L.checkLesson(lesson({ objective: "면담 기록의 필요성을 인식하고 기록 양식을 익힌다." })).flags.includes("multiVerb"));
  assert.deepEqual(L.checkLesson(lesson({ objective: "면담에 대하여." })).flags, ["noVerb"]);
});

test("분량: 영상+실습+퀴즈가 10분을 넘거나 5분보다 짧으면 표시", () => {
  assert.ok(L.checkLesson(lesson({ seg: { video: 7, practice: 3, quiz: 2 } })).flags.includes("tooLong"));
  assert.ok(L.checkLesson(lesson({ seg: { video: 2, practice: 1, quiz: 1 } })).flags.includes("tooShort"));
  assert.equal(L.minutes({ seg: { video: "5", practice: -3, quiz: null } }), 5, "음수·빈 값은 0으로");
});

test("과정 요약: 측정 가능 목표 수, 짝 수, 10분 넘는 차시 수", () => {
  const s = L.summary([lesson(), lesson({ objective: "경청의 중요성을 안다.", seg: { video: 7, practice: 3, quiz: 2 } })]);
  assert.deepEqual([s.n, s.measurable, s.paired, s.long, s.ready, s.total], [2, 1, 1, 1, 1, 22]);
});

test("규칙 고치기: ‘이해한다’ → 행동 동사 + 짝 맞는 평가", () => {
  const r = L.ruleRewrite(lesson({ title: "1:1 면담은 왜 하나", objective: "1:1 면담의 목적을 이해한다.", assess: { type: "서술형", stem: "" } }));
  assert.equal(r.objective, "1:1 면담의 목적을 설명할 수 있다.");
  assert.equal(r.verb, "설명한다");
  assert.deepEqual(r.assessment, { type: "서술형", stem: "1:1 면담의 목적을 2~3문장으로 설명하시오." });
  const after = L.checkLesson(lesson({ objective: r.objective, assess: r.assessment }));
  assert.equal(after.pair, true);
});

test("규칙 고치기: 행동이 둘이면 동사 단서가 있는 쪽 하나로", () => {
  const r = L.ruleRewrite(lesson({ title: "면담 기록 남기기", objective: "면담 기록의 필요성을 인식하고 기록 양식을 익힌다." }));
  assert.equal(r.objective, "기록 양식을 작성할 수 있다.");
  assert.equal(r.assessment.type, "실습 과제");
  assert.equal(L.analyzeObjective(r.objective).measurable, true);
});

test("규칙 고치기: 목표가 이미 측정 가능하면 동사는 두고 평가만 짝 맞춤", () => {
  const r = L.ruleRewrite(lesson({ assess: { type: "선택형", stem: "다음 중 올바른 피드백 문장을 고르시오." } }));
  assert.equal(r.objective, "상황-행동-영향 순서로 피드백 문장을 작성할 수 있다.");
  assert.deepEqual(r.assessment, { type: "실습 과제", stem: "제시된 상황에 맞게 상황-행동-영향 순서로 피드백 문장을 작성하시오." });
  assert.equal(L.ruleRewrite(lesson()).reason, "목표와 평가가 이미 짝이 맞아요.");
});

test("Claude 응답 검사: 측정 가능 목표 + 짝 맞는 평가만 받는다", () => {
  const good = { objective: "경청 신호 세 가지를 짝과 시연할 수 있다.", verb: "시연한다", level: "적용", assessment: { type: "실습 과제", stem: "짝과 역할을 나눠 경청 신호 세 가지를 2분 동안 시연하시오." }, reason: "관찰 가능" };
  const n = L.normalizeRewrite(good);
  assert.equal(n.verb, "시연한다");
  assert.equal(n.level, "적용");
  assert.equal(L.normalizeRewrite({ ...good, objective: "경청의 중요성을 이해할 수 있다." }), null, "여전히 이해한다");
  assert.equal(L.normalizeRewrite({ ...good, assessment: { type: "선택형", stem: "시연한 것을 고르시오." } }), null, "유형이 안 맞음");
  assert.equal(L.normalizeRewrite({ ...good, verb: "설명한다" }), null, "말한 동사와 목표가 다름");
  assert.equal(L.normalizeRewrite({ ...good, assessment: { type: "실습 과제", stem: "짝과 연습하시오." } }), null, "문항에 행동이 없음");
  assert.equal(L.normalizeRewrite("목표"), null);
});

test("설계서 마크다운: 과정 요약과 차시 표, 표 안의 | 는 이스케이프", () => {
  const md = L.toMarkdown({ title: "면담 기술", audience: "신임 파트장" }, [lesson(), lesson({ title: "A|B", objective: "경청의 중요성을 안다." })]);
  assert.ok(md.startsWith("# 면담 기술"));
  assert.ok(md.includes("측정 가능한 목표 1/2 · 목표-평가 짝 1/2"));
  assert.ok(md.includes("| 1 | 피드백 말하기 |"));
  assert.ok(md.includes("A\\|B"));
  assert.ok(md.includes("관찰할 수 없는 동사"));
});
