// 이수함 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const APPS = `사번,이름,부서
M19022,김민준,영업1팀
M23107,김민준,재무팀
M20311,이서윤,인사팀
M21045,박지호,영업1팀`;

const apps = () => L.parseApplicants(APPS).list;

test("사번 표기 통일: 소문자·하이픈·공백을 같은 사번으로 본다", () => {
  assert.equal(L.normId(" m21-045 "), "M21045");
  assert.ok(L.isId("M21045"));
  assert.ok(!L.isId("김민준"));
});

test("신청 목록: 머리줄은 건너뛰고, 같은 사번 중복 신청은 한 명으로", () => {
  const r = L.parseApplicants(APPS + "\nM21045,박지호,영업1팀\n없음,홍길동,인사팀");
  assert.equal(r.list.length, 4);
  assert.equal(r.dupes, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].why, "사번 형식이 아님");
});

test("동명이인: 이름이 같아도 사번이 다르면 따로 센다", () => {
  const att = L.parseAttendance(`1,M19022,김민준,13:50
2,M19022,김민준,13:50
1,M23107,김민준,13:55`, 2).list;
  const m = L.merge(apps(), att, { sessions: 2, passRate: 100 });
  const kims = m.roster.filter((p) => p.name === "김민준");
  assert.equal(kims.length, 2);
  assert.deepEqual(kims.find((p) => p.id === "M19022").marks, ["O", "O"]);
  assert.deepEqual(kims.find((p) => p.id === "M23107").marks, ["O", ""]);
  assert.equal(m.homonyms.length, 1);
  // 예전처럼 이름으로 합쳤다면 신청자를 3명으로 셌다
  assert.equal(L.countByName(apps()), 3);
});

test("사번 없는 출석: 같은 이름이 둘이면 합치지 않고 '확인 필요'", () => {
  const att = L.parseAttendance(`1,,김민준,13:50`, 2).list;
  const m = L.merge(apps(), att, { sessions: 2 });
  assert.equal(m.unresolved.length, 1);
  assert.equal(m.unresolved[0].candidates.length, 2);
  // 그 회차에 이미 출석한 사람은 후보 뒤로
  const m2 = L.merge(apps(), L.parseAttendance(`1,M19022,김민준,13:50\n1,,김민준,13:52`, 2).list, { sessions: 2 });
  assert.deepEqual(m2.unresolved[0].candidates.map((c) => [c.id, c.already]), [["M23107", false], ["M19022", true]]);
  assert.ok(m.roster.every((p) => p.marks.every((x) => !x)));
});

test("사번 없는 출석: 이름이 한 명뿐이면 연결하고 표시를 남긴다", () => {
  const att = L.parseAttendance(`1,,이서윤,13:50`, 2).list;
  const p = L.merge(apps(), att, { sessions: 2 }).roster.find((x) => x.id === "M20311");
  assert.equal(p.marks[0], "O");
  assert.ok(p.flags.includes("사번 없이 이름으로 연결"));
});

test("담당자가 직접 연결한 출석은 그 사번으로 들어간다", () => {
  const att = L.parseAttendance(`2,,김민준,13:50`, 2).list;
  const m = L.merge(apps(), att, { sessions: 2, links: { [att[0].key]: "M23107" } });
  assert.equal(m.unresolved.length, 0);
  const p = m.roster.find((x) => x.id === "M23107");
  assert.equal(p.marks[1], "O");
  assert.ok(p.flags.includes("담당자가 직접 연결"));
});

test("같은 회차 두 번 찍힘은 한 번, 시작 10분 뒤는 지각", () => {
  const att = L.parseAttendance(`1,M21045,박지호,13:58
1,M21045,박지호,13:59
2,M21045,박지호,14:11`, 2).list;
  const m = L.merge(apps(), att, { sessions: 2, start: "14:00" });
  const p = m.roster.find((x) => x.id === "M21045");
  assert.deepEqual(p.marks, ["O", "L"]);
  assert.equal(m.dupCheckins, 1);
  assert.equal(p.rate, 100);
});

test("신청 없이 온 사람과 이름이 다르게 찍힌 사람을 표시한다", () => {
  const att = L.parseAttendance(`1,M22050,박도현,13:50
1,M20311,이서운,13:50`, 2).list;
  const m = L.merge(apps(), att, { sessions: 2 });
  const walk = m.roster.find((x) => x.id === "M22050");
  assert.equal(walk.applied, false);
  assert.ok(m.roster.find((x) => x.id === "M20311").flags.some((f) => f.startsWith("이름 다름")));
  assert.equal(L.stats(m).walkIns, 1);
});

test("이수 기준: 4회 중 3회 출석은 75%면 이수, 전 회차 기준이면 미이수", () => {
  const att = L.parseAttendance([1, 2, 3].map((s) => `${s},M19022,김민준,13:50`).join("\n"), 4).list;
  const at = (rate) => L.merge(apps(), att, { sessions: 4, passRate: rate }).roster.find((x) => x.id === "M19022").pass;
  assert.equal(at(75), true);
  assert.equal(at(100), false);
});

test("회차가 범위를 넘거나 사번·이름이 모두 없으면 읽지 않는다", () => {
  const r = L.parseAttendance(`5,M19022,김민준,13:50
1,,,13:50`, 4);
  assert.equal(r.list.length, 0);
  assert.equal(r.errors.length, 2);
});

test("AI 입력에는 이름·사번이 없다", () => {
  const att = L.parseAttendance(`1,M19022,김민준,13:50`, 2).list;
  const json = JSON.stringify(L.aiInput("교육", L.stats(L.merge(apps(), att, { sessions: 2 }))));
  assert.ok(!json.includes("김민준"));
  assert.ok(!json.includes("M19022"));
});

test("Claude 응답 검산: 집계에 없는 숫자가 있으면 버린다", () => {
  const input = { course: "교육 2기", applied: 17, pass: 13, fail: 4, passPct: 76, perSession: [16, 14] };
  assert.ok(L.normalizeReport({ lines: ["17명 중 13명 이수(76%)", "2회차 14명"], followups: ["미이수 4명 안내"] }, input));
  assert.equal(L.normalizeReport({ lines: ["17명 중 15명 이수", "좋음"] }, input), null);
  assert.equal(L.normalizeReport({ lines: "17명" }, input), null);
  assert.equal(L.normalizeReport(null, input), null);
});

test("규칙 보고 문장은 그대로 검산을 통과한다", () => {
  const att = L.parseAttendance(`1,M19022,김민준,13:50\n2,M23107,김민준,13:50\n1,,김민준,13:50`, 2).list;
  const s = L.stats(L.merge(apps(), att, { sessions: 2 }));
  const r = L.ruleReport("AI 활용 실무 과정", s);
  assert.equal(r.lines.length, 3);
  assert.ok(L.normalizeReport(r, L.aiInput("AI 활용 실무 과정", s)));
});

test("내보내기: 사번은 가리고, 엑셀에서 한글이 깨지지 않게 BOM을 붙인다", () => {
  assert.equal(L.maskId("M19022"), "M1***2");
  const att = L.parseAttendance(`1,M20311,이서운,13:50`, 2).list;
  const csv = L.toCsv(L.merge(apps(), att, { sessions: 2 }));
  assert.ok(!csv.includes("M20311"));
  assert.ok(csv.includes("M2***1"));
  assert.ok(csv.startsWith("﻿부서,이름"));
});
