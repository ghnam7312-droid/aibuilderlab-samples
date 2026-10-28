// 차곡퀴즈 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const SRC = `## 1차시 물질의 상태
고체는 모양과 부피가 일정한 상태이다. 액체는 담는 그릇에 따라 모양이 변하는 상태이다. 기체는 모양과 부피가 모두 일정하지 않은 상태이다. 물질을 이루는 매우 작은 알갱이를 입자라고 한다.

## 2차시 상태 변화
고체가 액체로 변하는 현상을 융해라고 한다. 액체가 기체로 변하는 현상을 기화라고 한다. 액체 표면에서 기화가 일어나는 현상을 증발이라고 한다. 융해와 기화가 일어날 때 물질은 주변에서 열에너지를 흡수한다.`;
const LS = L.splitLessons(SRC);
const choice = (o) => ({ kind: "choice", stem: "고체가 액체로 변하는 현상을 무엇이라고 하나요?", options: ["융해", "응고", "기화", "액화"], answer: 0, evidence: "고체가 액체로 변하는 현상을 융해라고 한다.", ...o });

test("차시 나누기: '## n차시' 줄로 나누고, 표시가 없으면 한 차시", () => {
  assert.deepEqual(LS.map((l) => [l.no, l.title, l.sentences.length]), [[1, "물질의 상태", 4], [2, "상태 변화", 4]]);
  const one = L.splitLessons("입자는 아주 작은 알갱이이다. 두 번째 문장입니다.");
  assert.equal(one.length, 1);
  assert.equal(one[0].no, 1);
  assert.equal(L.splitLessons("").length, 0);
});

test("용어 찾기: 'A를 B라고 한다'와 'B는 A이다', 조사는 받침에 맞게", () => {
  assert.deepEqual(L.fact("고체가 액체로 변하는 현상을 융해라고 한다.").term, "융해");
  assert.equal(L.fact("고체가 녹기 시작하는 온도를 녹는점이라고 한다.").stem, "고체가 녹기 시작하는 온도를 무엇이라고 하나요?");
  assert.equal(L.fact("고체는 모양과 부피가 일정한 상태이다.").term, "고체");
  assert.equal(L.fact("물질은 고체, 액체, 기체의 세 가지 상태로 존재한다."), null);
  assert.equal(L.josa("현상", "을", "를"), "을");
  assert.equal(L.josa("온도", "을", "를"), "를");
});

test("문항 만들기: 차시당 개수, 선지 4개 중복 없음, 정답 위치가 고르게", () => {
  const qs = L.makeQuestions(LS, 3);
  assert.equal(qs.filter((q) => q.lesson === 1).length, 3);
  for (const q of qs) {
    assert.ok(q.evidence, `${q.id} 근거`);
    if (q.kind === "choice") { assert.equal(q.options.length, 4); assert.equal(new Set(q.options).size, 4); }
  }
  assert.ok(new Set(qs.filter((q) => q.kind === "choice").map((q) => q.answer)).size >= 3);
});

test("객관식이 모자라면 OX로 채우고, 근거 문장을 그대로 단다", () => {
  const qs = L.makeQuestions(LS, 4).filter((q) => q.lesson === 2);
  const ox = qs.find((q) => q.kind === "ox");
  assert.ok(ox);
  assert.deepEqual(ox.options, ["O", "X"]);
  assert.equal(ox.evidence, "융해와 기화가 일어날 때 물질은 주변에서 열에너지를 흡수한다.");
  assert.equal(L.flip("열에너지를 흡수한다."), "열에너지를 방출한다.");
});

test("자동 확인: 근거가 자료에 있고 정답이 근거에 있으면 통과", () => {
  assert.deepEqual(L.checkQuestion(choice(), LS), { flags: [], ok: true });
  // 띄어쓰기·마침표가 달라도 같은 문장으로 본다
  assert.ok(L.checkQuestion(choice({ evidence: "고체가 액체로 변하는  현상을 융해라고 한다" }), LS).ok);
});

test("자동 확인: 정답이 틀린 문항을 잡는다 (근거에 정답 없음)", () => {
  const c = L.checkQuestion(choice({ answer: 1 }), LS); // 정답을 '응고'로 잘못 표시
  assert.deepEqual(c.flags, ["answerMissing", "multi"], "진짜 정답 '융해'가 오답 선지로 근거에 나온다");
});

test("자동 확인: 근거 문장이 자료에 없으면 잡는다 (지어낸 근거)", () => {
  const c = L.checkQuestion(choice({ evidence: "융해는 물질이 열을 받아 녹는 현상으로 교과서 12쪽에 나온다." }), LS);
  assert.ok(c.flags.includes("noEvidence"));
});

test("자동 확인: 다른 선지가 근거에 따로 나오면 '정답이 둘인지 확인'", () => {
  const q = { kind: "choice", stem: "액체 표면에서 기화가 일어나는 현상은?", options: ["기화", "증발", "융해", "액화"], answer: 1, evidence: "액체 표면에서 기화가 일어나는 현상을 증발이라고 한다." };
  assert.deepEqual(L.checkQuestion(q, LS).flags, ["multi"]);
});

test("자동 확인: 형식이 틀리면(선지 중복·정답 범위 밖) shape", () => {
  assert.deepEqual(L.checkQuestion(choice({ options: ["융해", "융해", "기화", "액화"] }), LS).flags, ["shape"]);
  assert.deepEqual(L.checkQuestion(choice({ answer: 7 }), LS).flags, ["shape"]);
  const ox = { kind: "ox", stem: "융해와 기화가 일어날 때 물질은 주변에서 열에너지를 방출한다.", options: ["O", "X"], answer: 0, evidence: "융해와 기화가 일어날 때 물질은 주변에서 열에너지를 흡수한다." };
  assert.deepEqual(L.checkQuestion(ox, LS).flags, ["answerMissing"], "뒤집은 문장인데 O로 표시");
  assert.ok(L.checkQuestion({ ...ox, answer: 1 }, LS).ok);
});

test("Claude 응답 검사: 없는 차시·형식이 틀린 문항은 버리고, 남는 게 없으면 null", () => {
  const n = L.normalizeGenerated({ questions: [
    { lesson: 2, stem: "고체가 액체로 변하는 현상은?", options: ["융해", "응고", "기화", "액화"], answer: 0, evidence: "고체가 액체로 변하는 현상을 융해라고 한다." },
    { lesson: 9, stem: "없는 차시", options: ["a", "b", "c", "d"], answer: 0 },
    { lesson: 1, stem: "선지 3개", options: ["a", "b", "c"], answer: 0 },
    { lesson: 1, stem: "정답 범위 밖", options: ["a", "b", "c", "d"], answer: 4 },
  ] }, LS);
  assert.equal(n.length, 1);
  assert.deepEqual([n[0].id, n[0].source, n[0].kind], ["L2-1", "ai", "choice"]);
  assert.equal(L.normalizeGenerated({ questions: [] }, LS), null);
  assert.equal(L.normalizeGenerated("문항입니다", LS), null);
});

test("검토 통과율: 손대지 않고 통과한 문항 / 검토한 문항", () => {
  const qs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const s = L.reviewStats(qs, { a: "pass", b: "pass", c: "fix", d: "drop" });
  assert.deepEqual([s.done, s.todo, s.rate], [4, 1, 50]);
  assert.equal(L.reviewStats(qs, {}).rate, 0);
});

test("내보내기: 통과·고친 문항만, 학생용엔 정답 없음, 교사용엔 근거", () => {
  const qs = [{ ...choice(), id: "L1-1", lesson: 1 }, { ...choice({ stem: "제외할 문항" }), id: "L1-2", lesson: 1 }];
  const review = { "L1-1": "pass", "L1-2": "drop" };
  const txt = L.toStudentText("퀴즈", qs, review);
  assert.ok(txt.includes("① 융해"));
  assert.ok(!txt.includes("정답") && !txt.includes("제외할 문항"));
  const csv = L.toCsv(qs, review);
  assert.ok(csv.startsWith("﻿차시,번호"));
  assert.ok(csv.includes("고체가 액체로 변하는 현상을 융해라고 한다."));
  assert.equal(csv.trim().split("\r\n").length, 2);
});
