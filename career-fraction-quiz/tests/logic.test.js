// 분수콕 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const ALL_OK = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const ROSTER = [{ no: 7, name: "배시우" }, { no: 12, name: "유태오" }];

test("문항 10개, 선지와 판정 개수가 같고 정답은 하나", () => {
  assert.equal(L.QUESTIONS.length, 10);
  for (const q of L.QUESTIONS) {
    assert.equal(q.o.length, q.t.length, `${q.id}번`);
    assert.equal(q.t.filter((t) => t === "ok").length, 1, `${q.id}번 정답 1개`);
    for (const t of q.t) assert.ok(t === "ok" || t === "etc" || L.TYPES[t], `${q.id}번 판정 ${t}`);
  }
});

test("오개념 유형 5개, 유형마다 드러낼 문항이 2개 이상", () => {
  assert.equal(L.TYPE_KEYS.length, 5);
  for (const k of L.TYPE_KEYS) assert.ok(L.CHANCES[k] >= 2, k);
});

test("채점: 모두 맞으면 100점, 오개념 없음", () => {
  const g = L.grade(ALL_OK);
  assert.equal(g.score, 100);
  assert.equal(g.found.length, 0);
  assert.equal(g.main, "");
});

test("분류: 같은 유형 오답 2번이면 '확실', 1번이면 '의심'", () => {
  const g = L.grade([1, 1, 1, 0, 0, 0, 0, 0, 0, 0]); // 1·2번 따로 더하기, 3번 분모 크기
  assert.equal(g.score, 70);
  assert.deepEqual(g.found.map((f) => [f.type, f.level]), [["add", "sure"], ["denom", "maybe"]]);
  assert.equal(g.main, "add");
});

test("단순 실수(etc)와 안 푼 문항은 오개념으로 세지 않는다", () => {
  const g = L.grade([2, 2, 2, null, -1, 0, 0, 0, 0, 0]);
  assert.equal(g.found.length, 0);
  assert.equal(g.answered, 8);
  assert.equal(g.items[3].tag, "blank");
  assert.equal(L.grade([9, 0, 0, 0, 0, 0, 0, 0, 0, 0]).items[0].tag, "blank", "없는 선지 번호는 안 푼 것으로");
});

test("반 요약: 유형별 '확실' 학생 수와 가장 많은 유형", () => {
  const s = L.classSummary([
    { no: 1, answers: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
    { no: 2, answers: [3, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
    { no: 3, answers: [0, 0, 1, 1, 0, 0, 0, 0, 0, 0] },
    { no: 4, answers: ALL_OK },
  ]);
  assert.equal(s.n, 4);
  assert.equal(s.byType.add.sure, 2);
  assert.deepEqual(s.byType.add.nos, [1, 2]);
  assert.equal(s.top, "add");
  assert.equal(L.classSummary([]).top, "");
});

test("풀이 주소에는 번호만 들어간다", () => {
  const link = L.studentLink("https://aibuilderlab.kr/demo/career-fraction-quiz/index.html#/teacher", 7);
  assert.equal(link, "https://aibuilderlab.kr/demo/career-fraction-quiz/index.html#/solve/07");
  assert.ok(L.addressSafe(link, ROSTER));
  assert.deepEqual(L.parseHash("#/solve/07"), { view: "solve", no: 7 });
  assert.equal(L.parseHash("#/solve/배시우").view, "teacher", "이름 같은 주소는 받지 않는다");
});

test("주소 검사: 이름이 그대로든 인코딩됐든 잡아낸다", () => {
  assert.equal(L.addressSafe("index.html?name=배시우", ROSTER), false);
  assert.equal(L.addressSafe("index.html?name=" + encodeURIComponent("유태오"), ROSTER), false);
  assert.equal(L.addressSafe("index.html?n=%E0%A4", ROSTER), true, "깨진 인코딩도 멈추지 않는다");
});

test("CSV: 번호·점수·문항·유형만, 이름은 없다", () => {
  const csv = L.toCsv([{ no: 7, name: "배시우", answers: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0] }]);
  assert.ok(csv.startsWith("﻿번호,점수,1번"));
  assert.ok(csv.includes("07,80,2,2,O"));
  assert.ok(csv.includes("확실"));
  assert.ok(L.addressSafe(csv, ROSTER));
  assert.equal(L.csvCell('a,"b"'), '"a,""b"""');
});

test("AI 입력에는 이름이 없고 오답과 규칙 분류만 있다", () => {
  const inp = L.aiInput({ no: 12, name: "유태오", answers: [1, 1, 0, 0, 1, 0, 0, 0, 0, 0] });
  assert.equal(inp.no, "12");
  assert.equal(inp.wrong.length, 3);
  assert.equal(inp.wrong[2].picked, "크기가 다른 4칸 중 1칸", "그림 선지는 글로 바꿔 보낸다");
  assert.ok(!JSON.stringify(inp).includes("유태오"));
  assert.equal("name" in inp, false);
});

test("Claude 응답 검사: 규칙 근거 없는 유형은 버리고, 형식이 틀리면 null", () => {
  const counts = L.grade([1, 1, 0, 0, 0, 0, 0, 0, 0, 0]).counts;
  const n = L.normalizeExplain({ summary: "따로 더하기", types: [{ type: "add", why: "분모끼리 더함", activity: "띠 그림" }, { type: "mixed", why: "지어낸 이유", activity: "x" }, { type: "add", why: "중복", activity: "중복" }] }, counts);
  assert.deepEqual(n.types.map((t) => t.type), ["add"]);
  assert.equal(L.normalizeExplain({ summary: "요약", types: [{ type: "mixed", why: "a", activity: "b" }] }, counts), null, "남은 유형이 없으면 버린다");
  assert.equal(L.normalizeExplain("글", counts), null);
  assert.equal(L.normalizeExplain({ types: [] }, counts), null);
});

test("규칙 설명: 확실·의심 유형마다 이유와 지도 활동, 다 안 풀면 안내", () => {
  const r = L.ruleExplain({ answers: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(r.types.length, 2);
  assert.ok(r.summary.includes("70점"));
  assert.ok(r.types[1].why.includes("의심"));
  assert.ok(r.talk.length > 0);
  assert.ok(L.ruleExplain({ answers: [0, 0] }).summary.includes("2문항만"));
  assert.ok(L.ruleExplain({ answers: ALL_OK }).summary.includes("없어요"));
});
