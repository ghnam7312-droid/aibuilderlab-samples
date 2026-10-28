// 빠짐없이 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const SRC = `점수\t의견
5\t강사님 설명이 쉽고 명확해서 좋았습니다. 다만 실습 시간이 너무 짧았어요.
3\t실습 시간이 부족했어요.
4\t실습이 짧아 끝까지 못 만들었어요.
4\t실습을 더 하고 싶었는데 시간이 부족했습니다.
3\t교육장 모니터가 작아서 잘 안 보였어요.
4\t뒷자리라 모니터 화면이 잘 안 보였습니다.
3\t교육장 의자가 불편하고 모니터가 작았어요.
4\t쉬는 시간이 조금 더 있었으면 합니다.
5\t설명이 친절하고 이해가 잘 됐습니다.
5\t수고하셨습니다.`;
const R = () => L.parseResponses(SRC);

test("응답 읽기: 머리줄은 건너뛰고 점수와 의견을 나눈다", () => {
  const r = R();
  assert.equal(r.length, 10);
  assert.deepEqual([r[0].id, r[0].score], [1, 5]);
  assert.equal(L.parseResponses("의견만 있는 줄")[0].score, null);
});

test("개인정보 가리기: 전화번호·메일·사번", () => {
  assert.equal(L.maskPII("010-2345-6789로 연락"), "[전화번호]로 연락");
  assert.equal(L.maskPII("a.b@test.co.kr 로"), "[메일] 로");
  assert.equal(L.maskPII("사번 M21045 입니다"), "사번 [사번] 입니다");
  assert.ok(!JSON.stringify(L.aiInput("교육", L.parseResponses("3\t01023456789 연락 주세요"), 3)).includes("01023456789"));
});

test("한 응답에 좋음과 아쉬움이 같이 있으면 둘 다 센다", () => {
  const tags = L.tagResponse("강사님 설명이 쉽고 명확해서 좋았습니다. 다만 실습 시간이 너무 짧았어요.");
  assert.deepEqual(tags.map((t) => `${t.topic}:${t.tone}`).sort(), ["practice:아쉬움", "teacher:좋음"]);
});

test("'~있으면 좋겠다'는 요청이므로 아쉬움", () => {
  assert.equal(L.toneOf("녹화본이 있으면 복습할 때 좋을 것 같아요"), "아쉬움");
  assert.equal(L.toneOf("실무 예제가 많아서 만족합니다"), "좋음");
});

test("의견 묶음: 많은 순, 분류 안 되는 응답은 따로", () => {
  const g = L.group(R());
  assert.deepEqual([g.groups[0].label, g.groups[0].tone, g.groups[0].count], ["실습 시간", "아쉬움", 4]);
  assert.equal(g.groups.find((x) => x.topic === "room").count, 3);
  assert.deepEqual(g.unclassified, [10]);
});

test("소수 의견 기준: 3명 이상은 모두 주요 의견, 그 아래는 기타로 남긴다", () => {
  const s = L.ruleSummary(R(), 3);
  assert.deepEqual(s.themes.map((t) => t.label), ["실습 시간", "교육장 환경"]);
  assert.ok(s.minor.some((t) => t.label === "쉬는 시간"));
  assert.ok(s.minor.some((t) => t.label === "강사 설명"));
  assert.ok(s.improvements.includes("교육장 모니터·좌석 점검"));
});

test("기준을 2명으로 낮추면 강사 설명(2명)도 주요 의견", () => {
  assert.ok(L.ruleSummary(R(), 2).themes.some((t) => t.label === "강사 설명"));
});

test("많은 순 n개만 남기는 방식이면 빠졌을 3명 이상 의견을 찾는다", () => {
  const groups = [{ label: "a", count: 8 }, { label: "b", count: 5 }, { label: "c", count: 3 }, { label: "d", count: 2 }];
  assert.deepEqual(L.droppedByTopN(groups, 3, 2).map((g) => g.label), ["c"]);
  assert.equal(L.droppedByTopN(groups, 3, 3).length, 0);
});

test("Claude 응답 검사: 없는 id는 지우고, 결이 틀리거나 비면 버린다", () => {
  const n = L.normalizeSummary({ themes: [{ topic: "실습", tone: "아쉬움", ids: [2, 3, 3, 99], summary: "짧음" }, { topic: "기타", tone: "보통", ids: [1] }], lines: ["요약"] }, R());
  assert.equal(n.themes.length, 1);
  assert.deepEqual(n.themes[0].ids, [2, 3]);
  assert.equal(n.themes[0].count, 2);
  assert.equal(L.normalizeSummary({ themes: [], lines: ["a"] }, R()), null);
  assert.equal(L.normalizeSummary("문장", R()), null);
});

test("Claude가 3명 의견을 빠뜨리면 규칙 묶음을 되살린다", () => {
  const rule = L.ruleSummary(R(), 3);
  const ai = L.normalizeSummary({ themes: [{ topic: "실습 시간 부족", tone: "아쉬움", ids: [1, 2, 3, 4] }, { topic: "강사", tone: "좋음", ids: [1, 9] }], lines: ["실습이 짧았다는 의견이 가장 많습니다."] }, R());
  const out = L.ensureKept(ai, rule, R(), 3);
  assert.equal(out.restored, 1);
  const room = out.themes.find((t) => t.label === "교육장 환경");
  assert.ok(room && room.restored);
  // AI 묶음 중 기준 미만(강사 2명)은 기타로 내려간다
  assert.ok(out.minor.some((t) => t.label === "강사"));
  assert.ok(!out.themes.some((t) => t.label === "강사"));
});

test("Claude가 다 담았으면 되살릴 것이 없다 (절반 이상 겹치면 같은 의견)", () => {
  const rule = L.ruleSummary(R(), 3);
  const ai = L.normalizeSummary({ themes: [{ topic: "실습", tone: "아쉬움", ids: [1, 2, 3] }, { topic: "모니터", tone: "아쉬움", ids: [5, 6] }], lines: ["a"] }, R());
  assert.equal(L.ensureKept(ai, rule, R(), 3).restored, 0);
});

test("보고서: 검수 개수, 미검수·되살림 표시, 반영 항목", () => {
  const sum = { ...L.ruleSummary(R(), 3), restored: 0 };
  sum.themes[1] = { ...sum.themes[1], restored: true };
  const text = L.toReport("교육", L.scoreStats(R()), sum, { checked: { [L.key(sum.themes[0])]: true }, adopt: { "실습 시간 늘리기": true } }, 3);
  assert.ok(text.includes("검수 1/2"));
  assert.ok(text.includes("(AI 요약에서 빠져 되살림) · 미검수"));
  assert.ok(text.includes("다음 교육 반영\n- 실습 시간 늘리기"));
});

test("점수 통계: 평균은 소수 한 자리, 분포 5칸", () => {
  const s = L.scoreStats(R());
  assert.equal(s.avg, 4);
  assert.deepEqual(s.dist, [0, 0, 3, 4, 3]);
});
