// 챙김 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-28"; // 수요일
const NOTE = `- 발주 시스템 교체, 공장 2곳 동시 사용 원함
- 공장별 사용자 권한을 따로 나눌 수 있는지 질문 받음
- 도입 사례 자료 내일까지 보내드리기로 함
- 수정 견적서 다음 주 화요일까지 전달하기로
- (내부) 할인은 최대 8%, 마지노선 2,950만
- 경쟁사 단가가 우리보다 10% 낮다고 들음 → 팀장님께 보고
- 1월 초 도입 희망`;
const M = { date: TODAY, contact: "오세진 팀장", customer: "가람식품", sender: { company: "온결솔루션", name: "이서윤" } };

test("기한 읽기: 내일 · 다음 주 화요일 · 11/5", () => {
  assert.equal(L.findDue("자료 내일까지", TODAY).due, "2026-10-29");
  assert.equal(L.findDue("다음 주 화요일까지 전달", TODAY).due, "2026-11-03");
  assert.equal(L.findDue("11/5까지 회신", TODAY).due, "2026-11-05");
  assert.equal(L.findDue("기한 없음", TODAY).due, "");
});

test("영업일 더하기는 주말을 건너뛴다", () => {
  assert.equal(L.addBizDays("2026-10-30", 1), "2026-11-02"); // 금 → 월
  assert.equal(L.addBizDays(TODAY, 2), "2026-10-30");
});

test("분류: '(내부)' 표시와 민감 낱말 줄은 내부 전용", () => {
  const k = L.classify(NOTE).map((l) => l.kind);
  assert.deepEqual(k, ["ext", "ext", "ext", "ext", "int", "int", "ext"]);
  assert.equal(L.classify("원가 대비 마진 30%")[0].kind, "int");
  assert.equal(L.classify("[사내] 결재 일정 확인")[0].kind, "int");
});

test("사람이 바꾼 분류가 이긴다", () => {
  const lines = L.applyOverrides(L.classify(NOTE), { 0: "int", 4: "ext" });
  assert.equal(lines[0].kind, "int");
  assert.equal(lines[4].kind, "ext");
  assert.equal(lines[0].why, "직접 바꿈");
});

test("약속 찾기: 보내기로 한 자료와 기한, 기한이 없으면 영업일 2일 뒤", () => {
  const p = L.findPromises(L.classify(NOTE), TODAY);
  assert.deepEqual(p.map((x) => [x.item, x.due, x.auto]), [["도입 사례 자료", "2026-10-29", false], ["수정 견적서", "2026-11-03", false]]);
  const q = L.findPromises(L.classify("회사 소개서 공유하기로 함"), "2026-10-30");
  assert.equal(q[0].due, "2026-11-03");
  assert.equal(q[0].auto, true);
});

test("내부 줄의 약속은 고객 약속으로 올리지 않는다", () => {
  const p = L.findPromises(L.classify("(내부) 팀장님께 할인안 보내기로"), TODAY);
  assert.equal(p.length, 0);
});

test("규칙 초안에는 고객 공유 줄만 들어간다", () => {
  const lines = L.classify(NOTE);
  const d = L.buildDraft(M, lines, L.findPromises(lines, TODAY));
  assert.ok(d.subject.includes("자료 2건"));
  assert.ok(d.body.startsWith("오세진 팀장님"));
  assert.ok(d.body.includes("도입 사례 자료: 10/29(목)까지"));
  assert.ok(!/마지노선|8%|경쟁사|2,950/.test(d.body));
  assert.deepEqual(L.leakCheck(d.body, lines.filter((l) => l.kind === "int")), []);
});

test("섞임 검사: 민감 낱말·내부 숫자·겹치는 문장을 잡는다", () => {
  const int = L.classify(NOTE).filter((l) => l.kind === "int");
  assert.ok(L.leakCheck("가격은 2,950만 원까지 맞춰 드릴 수 있습니다.", int).some((h) => h.why.includes("2,950만")));
  assert.ok(L.leakCheck("마지노선을 알려 드립니다", int).some((h) => h.why.includes("마지노선")));
  assert.ok(L.leakCheck("경쟁사 단가가 우리보다 10% 낮다고 들었습니다", int).length >= 1);
  assert.deepEqual(L.leakCheck("도입 사례 자료를 내일 보내드리겠습니다.", int), []);
});

test("Claude 응답 검사: 제목·본문이 없거나 짧으면 버린다", () => {
  assert.equal(L.normalizeDraft(null), null);
  assert.equal(L.normalizeDraft({ subject: "", body: "본문이 충분히 깁니다. 감사합니다. 자료 보내드립니다." }), null);
  assert.equal(L.normalizeDraft({ subject: "감사합니다", body: "짧음" }), null);
  assert.equal(L.normalizeDraft({ subject: ["x"], body: 3 }), null);
  const ok = L.normalizeDraft({ subject: "  미팅   감사드립니다 ", body: "오세진 팀장님, 오늘 미팅 감사드립니다.\r\n자료는 내일 보내드리겠습니다." });
  assert.equal(ok.subject, "미팅 감사드립니다");
  assert.ok(!ok.body.includes("\r"));
});

test("후속 상태와 이번 달 놓친 후속", () => {
  assert.equal(L.dueStatus("2026-10-27", TODAY, false).kind, "late");
  assert.equal(L.dueStatus(TODAY, TODAY, false).kind, "today");
  assert.equal(L.dueStatus("2026-10-30", TODAY, false).kind, "soon");
  assert.equal(L.dueStatus("2026-10-27", TODAY, true).kind, "sent");
  const s = L.monthStats([{ due: "2026-10-27", sent: true }, { due: "2026-10-26", sent: false }, { due: "2026-10-30", sent: false }, { due: "2026-11-02", sent: false }], TODAY);
  assert.deepEqual(s, { total: 3, sent: 1, missed: 1 });
});

test("같은 미팅·같은 자료는 알림에 한 번만", () => {
  const p = [{ item: "도입 사례 자료", due: "2026-10-29", line: 2 }];
  const a = L.addPromises([], "m1", p);
  assert.equal(a.added, 1);
  const b = L.addPromises(a.list, "m1", p);
  assert.equal(b.added, 0);
  assert.equal(b.list.length, 1);
});

test(".ics: 보낸 것은 빼고, 이스케이프·75바이트 접기", () => {
  const ics = L.buildIcs([{ id: "a", item: "도입 사례 자료, 견적서; 일정표를 모두 한 번에 정리해서 보내기로 한 긴 제목입니다", due: "2026-10-29", sent: false }, { id: "b", item: "보냄", due: "2026-10-27", sent: true }], () => "가람식품");
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261029"));
  assert.ok(ics.includes("\\,"));
  assert.ok(!ics.includes("UID:b@"));
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
});
