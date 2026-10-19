// 회의끝 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-20"; // 화요일

test("날짜 도우미: 더하기·요일 표기·차이", () => {
  assert.equal(L.addDays(TODAY, 4), "2026-10-24");
  assert.equal(L.addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(L.withDay(TODAY), "10/20(화)");
  assert.equal(L.daysBetween(TODAY, "2026-10-19"), -1);
});

test("'금요일까지'는 이번 주 금요일, 오늘이 금요일이면 다음 주", () => {
  assert.equal(L.findDue("공지 올리기 금요일까지", TODAY).due, "2026-10-23");
  assert.equal(L.findDue("공지 올리기 금요일까지", "2026-10-23").due, "2026-10-30");
});

test("'다음 주 월요일까지'는 7일 이상 뒤", () => {
  assert.equal(L.findDue("다음 주 월요일까지 올리기", TODAY).due, "2026-11-02");
});

test("월/일 표기: 두 달 넘게 지난 날짜는 내년, 없는 날짜는 버린다", () => {
  assert.equal(L.parseMD(TODAY, 10, 24), "2026-10-24");
  assert.equal(L.parseMD("2026-12-20", 1, 5), "2027-01-05");
  assert.equal(L.parseMD(TODAY, 2, 30), "");
});

test("오늘·내일·모레", () => {
  assert.equal(L.findDue("문의 내일", TODAY).due, "2026-10-21");
  assert.equal(L.findDue("아무 표시 없음", TODAY).due, "");
});

test("규칙 정리: @담당, 결정:, 참석, 제목을 읽는다", () => {
  const r = L.parse(`[운영진 회의] 10/20
참석: 민지, 준호
- 결정: 발표는 10분
- @준호 공지 올리기 금요일까지
- 장소 비교함`, TODAY);
  assert.equal(r.title, "운영진 회의");
  assert.deepEqual(r.attendees, ["민지", "준호"]);
  assert.equal(r.decisions.length, 1);
  assert.equal(r.decisions[0].text, "발표는 10분");
  assert.equal(r.tasks.length, 1);
  assert.deepEqual([r.tasks[0].who, r.tasks[0].what, r.tasks[0].due], ["준호", "공지 올리기", "2026-10-23"]);
  assert.equal(r.notes.length, 1);
});

test("대괄호가 없어도 '참석:' 앞 첫 줄은 제목", () => {
  const r = L.parse(`동아리 운영진 회의 10/20(화) 저녁 7시 (기록: 민지)
참석: 민지, 준호
장소 얘기함`, TODAY);
  assert.equal(r.lines[0].type, "head");
  assert.equal(r.title, "동아리 운영진 회의");
  assert.equal(r.notes.length, 1);
});

test("참석자가 주어인 '~하기로 함'은 결정이 아니다", () => {
  const r = L.parse(`회의
참석: 서연, 도윤
도윤이가 내일 학과 사무실에 물어보기로 함
예산은 18만 원 안에서 쓰기로 함`, TODAY);
  assert.equal(r.lines[2].type, "note");
  assert.equal(r.lines[3].type, "dec");
  assert.ok(L.hasActor("서연이가 낸다", ["서연"]));
  assert.ok(!L.hasActor("서연 학생회관", ["서연"]));
});

test("빈 회의록도 멈추지 않는다", () => {
  const r = L.parse("", TODAY);
  assert.equal(r.lines.length, 0);
  assert.equal(L.parse(null, TODAY).tasks.length, 0);
});

test("Claude 응답 검증: 마감 형식이 틀리면 비우고, 담당이 없으면 '미정'", () => {
  const n = L.normalizeExtract({ title: "회의", attendees: ["@민지"], decisions: ["10분으로"], tasks: [{ owner: "", task: "공지", due: "금요일" }, { owner: "@서연", task: "대관", due: "2026-10-23" }, { task: "" }], discussion: [] });
  assert.equal(n.tasks.length, 2);
  assert.equal(n.tasks[0].who, "미정");
  assert.equal(n.tasks[0].due, "");
  assert.equal(n.tasks[1].who, "서연");
  assert.equal(n.attendees[0], "민지");
});

test("Claude 응답 검증: 결정도 할 일도 없으면 버린다", () => {
  assert.equal(L.normalizeExtract({ decisions: [], tasks: [] }), null);
  assert.equal(L.normalizeExtract("텍스트"), null);
  assert.equal(L.normalizeExtract({ tasks: [{ owner: "a", task: "b", due: "2026-02-30" }] }).tasks[0].due, "");
});

test("출처 줄 찾기: 표현이 달라도 겹치는 줄을 고른다", () => {
  const lines = L.parse(`참석: 민지
대관 신청서는 서연이가 이번 주 금요일까지 내 주기로 했고
뒤쪽에서 마이크 안 들린다는 말이 꽤 있어서 도윤이가 내일 물어보기로 함`, TODAY).lines;
  assert.equal(L.matchLine("학생회관 대관 신청서 제출", lines, null, "서연"), 1);
  assert.equal(L.matchLine("무선 마이크 대여 가능한지 문의", lines, null, "도윤"), 2);
  assert.equal(L.matchLine("전혀 관계없는 문장입니다", lines), -1);
});

test("Claude 결과 얹기: 줄 종류를 다시 칠하고 출처를 붙인다", () => {
  const rule = L.parse(`참석: 민지, 서연
장소는 결국 학생회관으로 정함
대관 신청서는 서연이가 금요일까지 내 주기로 했고
예산 얘기도 함`, TODAY);
  assert.equal(rule.tasks.length, 0); // 규칙은 못 찾는다
  const ai = L.normalizeExtract({ decisions: ["장소는 학생회관으로"], tasks: [{ owner: "서연", task: "대관 신청서 제출", due: "2026-10-23" }], discussion: ["예산 논의"] });
  const m = L.mergeAi(rule, ai);
  assert.equal(m.mode, "ai");
  assert.equal(m.tasks[0].line, 2);
  assert.equal(m.lines[2].type, "task");
  assert.equal(m.lines[1].type, "dec");
  assert.deepEqual(m.lines[2].refs, ["task:0"]);
  const c = L.compare(rule, m);
  assert.deepEqual([c.rule.task, c.ai.task, c.extraTasks], [0, 1, 1]);
});

test("마감 상태와 알림: 지난 것 먼저, 끝낸 일은 빼고", () => {
  assert.deepEqual(L.dueStatus("", TODAY), { kind: "none", n: null });
  assert.equal(L.dueStatus("2026-10-22", TODAY).kind, "soon");
  assert.equal(L.dueStatus("2026-10-30", TODAY).kind, "ok");
  const r = L.reminders([
    { id: 1, due: "2026-10-21", status: "todo" },
    { id: 2, due: "2026-10-18", status: "doing" },
    { id: 3, due: "2026-10-19", status: "done" },
    { id: 4, due: "2026-11-30", status: "todo" },
    { id: 5, due: TODAY, status: "todo" },
  ], TODAY);
  assert.deepEqual(r.map((x) => x.id), [2, 5, 1]);
});

test(".ics: 마감 있는 미완료 일만 종일 일정으로, 특수문자 이스케이프", () => {
  const ics = L.buildIcs([
    { id: "a", who: "서연", what: "대관; 신청, 제출", due: "2026-10-23", status: "todo" },
    { id: "b", who: "준호", what: "끝난 일", due: "2026-10-22", status: "done" },
    { id: "c", who: "민지", what: "마감 없음", due: "", status: "todo" },
  ], "운영진 회의", "20261020T100000Z");
  const flat = ics.replace(/\r\n /g, ""); // 접힌 줄 펴기
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(flat.includes("DTSTART;VALUE=DATE:20261023"));
  assert.ok(flat.includes("DTEND;VALUE=DATE:20261024"));
  assert.ok(flat.includes(String.raw`[서연] 대관\; 신청\, 제출`));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "줄바꿈은 모두 CRLF");
});

test(".ics 줄 접기: 한 줄이 75바이트를 넘지 않는다 (한글 포함)", () => {
  const long = `SUMMARY:${"가".repeat(60)}`;
  const folded = L.fold(long);
  for (const part of folded.split("\r\n")) assert.ok(Buffer.byteLength(part) <= 75, part);
  assert.equal(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join(""), long);
});

test("Notion 마크다운: 단계별 체크리스트", () => {
  const out = L.toNotionMd("회의", [{ text: "10분으로" }], [
    { who: "서연", what: "대관", due: "2026-10-23", status: "todo" },
    { who: "준호", what: "공지", due: "", status: "done" },
  ], [["todo", "할 일"], ["doing", "진행 중"], ["done", "완료"]]);
  assert.ok(out.includes("### 결정사항\n- 10분으로"));
  assert.ok(out.includes("- [ ] 대관 @서연 (마감 10/23)"));
  assert.ok(out.includes("- [x] 공지 @준호"));
  assert.ok(!out.includes("진행 중"));
});
