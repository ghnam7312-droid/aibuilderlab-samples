// 오늘수업 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const ROSTER = [
  { name: "민서", to: "parent", phone: "010-0000-2841" },
  { name: "도현", to: "self", phone: "010-0000-5170" },
  { name: "하윤", to: "parent", phone: "010-0000-9033" },
  { name: "서아", to: "parent", phone: "010-0000-4412" },
];
const MEMO = `공통: 여행 계획 말하기. will과 be going to 차이 연습
민서: be going to를 자연스럽게 씀. 숙제 2번 다시 해 오기
도현: 질문을 먼저 많이 함. 하윤이랑 짝 활동 때 설명을 잘 해 줌.
과거형 실수 2번, 다음 시간에 복습
서아: 오늘 결석
지민: 체험 수업`;
const LESSON = { className: "회화 B반", topic: "오늘 수업", tutor: "튜터" };
const P = L.parseMemo(MEMO, ROSTER);

test("메모 나누기: 이름 줄 · 공통 줄 · 이어지는 줄 · 명단에 없는 이름", () => {
  assert.equal(P.common.length, 1);
  assert.equal(P.by["민서"].length, 1);
  assert.equal(P.by["도현"].length, 2); // 다음 줄이 도현에게 이어 붙는다
  assert.equal(P.by["하윤"].length, 0);
  assert.deepEqual(P.unknown, ["지민"]);
});

test("규칙 초안: 받는 사람(보호자/본인)에 따라 인사가 다르고, 숙제는 '다음 수업 전까지'로", () => {
  const m = L.draftRule(ROSTER[0], LESSON, P);
  assert.ok(m.startsWith("안녕하세요, 민서 학생 보호자님."));
  assert.ok(m.includes("다음 수업 전까지: 숙제 2번 다시 해 오기"));
  assert.ok(m.includes("will과 be going to 차이 연습"));
  const d = L.draftRule(ROSTER[1], LESSON, P);
  assert.ok(d.startsWith("도현 님,"));
});

test("결석한 학생은 결석 안내로", () => {
  const m = L.draftRule(ROSTER[3], LESSON, P);
  assert.ok(m.includes("함께하지 못했어요"));
  assert.ok(!m.includes("결석"));
});

test("다른 학생 이름이 섞이면 보내기를 막는다", () => {
  const card = { name: "도현", text: L.draftRule(ROSTER[1], LESSON, P) };
  const issues = L.checkMessage(card, ROSTER, P);
  assert.equal(issues[0].kind, "other");
  assert.equal(issues[0].name, "하윤");
  assert.ok(issues[0].block);
  assert.equal(L.canSend({ ...card, confirmed: true }, ROSTER), false);
});

test("받는 학생 이름이 없는 메시지도 막는다 (다른 학생에게 쓴 글일 수 있다)", () => {
  const issues = L.checkMessage({ name: "민서", text: "안녕하세요, 하윤 학생 보호자님. 오늘 잘했어요." }, ROSTER);
  assert.deepEqual(issues.map((i) => i.kind).sort(), ["noself", "other"]);
  assert.ok(L.checkMessage({ name: "민서", text: "  " }, ROSTER)[0].kind === "empty");
});

test("미리보기 확인을 해야만 보낼 수 있다", () => {
  const card = { name: "민서", text: L.draftRule(ROSTER[0], LESSON, P) };
  assert.equal(L.canSend(card, ROSTER), false);
  assert.equal(L.canSend({ ...card, confirmed: true }, ROSTER), true);
  assert.equal(L.canSend({ ...card, confirmed: true, sent: true }, ROSTER), false); // 두 번 보내지 않는다
});

test("'그 문장 지우기'는 이름이 든 문장만, '의도한 언급'은 그 이름만 풀어 준다", () => {
  const text = L.draftRule(ROSTER[1], LESSON, P);
  const cleaned = L.removeName(text, "하윤");
  assert.ok(!cleaned.includes("하윤"));
  assert.ok(cleaned.includes("질문을 먼저 많이 함"));
  assert.equal(L.canSend({ name: "도현", text: cleaned, confirmed: true }, ROSTER), true);
  assert.equal(L.canSend({ name: "도현", text, confirmed: true, acked: ["하윤"] }, ROSTER), true);
  assert.equal(L.removeName("오늘 민서랑 하윤이 짝. 도현 잘함.", "하윤"), "도현 잘함.");
});

test("메모가 없는 학생은 확인 필요(막지는 않음)", () => {
  const card = { name: "하윤", text: L.draftRule(ROSTER[2], LESSON, P) };
  const issues = L.checkMessage(card, ROSTER, P);
  assert.deepEqual(issues.map((i) => [i.kind, i.block]), [["nomemo", false]]);
});

test("진행 상황: 확인 · 막힘 · 보낼 수 있음 · 보냄", () => {
  const cards = [
    { name: "민서", text: "민서 학생 잘했어요", confirmed: true },
    { name: "도현", text: "도현 님, 하윤과 짝", confirmed: false },
    { name: "하윤", text: "하윤 학생", confirmed: true, sent: true },
  ];
  assert.deepEqual(L.progress(cards, ROSTER), { total: 3, confirmed: 2, blocked: 1, ready: 1, sent: 1 });
});

test("Claude 초안 검사: 이름 없음·너무 짧음·메모에 없던 다른 학생 이름은 버린다", () => {
  const ok = L.normalizeDraft({ message: "안녕하세요, 민서 학생 보호자님. 오늘 be going to를 자연스럽게 썼어요.", highlights: ["be going to"], next: "숙제 2번" }, ROSTER[0], ROSTER, P.by["민서"]);
  assert.equal(ok.highlights.length, 1);
  assert.equal(L.normalizeDraft({ message: "짧음" }, ROSTER[0], ROSTER, []), null);
  assert.equal(L.normalizeDraft({ message: "안녕하세요 보호자님, 오늘 수업 소식을 전해 드려요. 잘했어요." }, ROSTER[0], ROSTER, []), null);
  assert.equal(L.normalizeDraft({ message: "민서 학생은 오늘 서아보다 발표를 잘했어요. 다음에도 기대해요." }, ROSTER[0], ROSTER, P.by["민서"]), null);
  assert.equal(L.normalizeDraft("문자열", ROSTER[0], ROSTER, []), null);
  // 메모에 있던 이름이면 받아 두고, 화면 검사에서 튜터가 판단한다
  assert.ok(L.normalizeDraft({ message: "도현 님, 오늘 하윤 님과 짝 활동에서 설명을 잘 해 주셨어요." }, ROSTER[1], ROSTER, P.by["도현"]));
});

test("개인정보: 번호는 가운데를 가리고, 발송 기록에는 본문을 남기지 않는다", () => {
  assert.equal(L.maskPhone("010-1234-5678"), "010-****-5678");
  assert.equal(L.maskPhone(""), "번호 없음");
  const e = L.logEntry({ id: "c1", name: "민서", text: "비밀 내용" }, ROSTER[0], "21:40");
  assert.equal(e.phone, "010-****-2841");
  assert.equal(e.to, "보호자");
  assert.ok(!JSON.stringify(e).includes("비밀"));
});

test("걸린 시간과 이름 강조 조각", () => {
  assert.equal(L.minutes(0, 1000), 0);
  assert.equal(L.minutes(1000, 1000 + 14 * 60000 + 1), 15);
  const parts = L.splitByNames("도현 님, 하윤과 짝", ["하윤"]);
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.s), ["하윤"]);
});
