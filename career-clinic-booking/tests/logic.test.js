// 천천예약 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-24"; // 토요일

test("진료 시간표: 평일 점심시간 빼고, 토요일은 오전만, 일요일 휴진", () => {
  const wk = L.hoursOf("2026-10-26"); // 월
  assert.equal(wk[0], "09:00");
  assert.ok(!wk.includes("13:00") && !wk.includes("13:30"));
  assert.equal(wk[wk.length - 1], "17:30");
  assert.equal(L.hoursOf(TODAY).at(-1), "12:30");
  assert.equal(L.hoursOf("2026-10-25").length, 0);
  assert.equal(L.days(TODAY, 7)[1].closed, true);
  assert.equal(L.days(TODAY, 7)[0].label, "10/24(토)");
});

test("시간 칸: 이미 예약된 시간과 지난 시간은 막는다", () => {
  const s = L.slots(TODAY, "int", [{ date: TODAY, dept: "int", time: "10:00" }, { date: TODAY, dept: "ent", time: "10:30" }], { date: TODAY, time: "09:30" });
  const by = Object.fromEntries(s.map((x) => [x.time, x]));
  assert.equal(by["09:00"].open, false);
  assert.equal(by["10:00"].taken, true);
  assert.equal(by["10:30"].open, true); // 다른 과의 예약은 상관없다
});

test("본인 정보 검사: 쉬운 말로 무엇이 틀렸는지 알려 준다", () => {
  assert.deepEqual(L.checkPatient({ name: "김영숙", phone: "010-2345-6789" }), {});
  const e = L.checkPatient({ name: "", phone: "02-123" });
  assert.equal(e.name, "이름을 적어 주세요");
  assert.match(e.phone, /10~11자리/);
  assert.equal(L.fmtPhone("01023456789"), "010-2345-6789");
});

test("가리기: 확인 화면·기록에는 가린 이름과 번호만", () => {
  assert.equal(L.maskName("김영숙"), "김*숙");
  assert.equal(L.maskName("남궁민수"), "남**수");
  assert.equal(L.maskName("이솔"), "이*");
  assert.equal(L.maskPhone("010-2345-6789"), "010-****-6789");
});

test("예약: 같은 칸은 두 번 잡히지 않고, 저장 기록에 전체 번호가 없다", () => {
  const req = { dept: "int", date: "2026-10-26", time: "10:00", name: "김영숙", phone: "01023456789" };
  const a = L.book([], req);
  assert.ok(a.ok);
  assert.equal(a.booking.code, "1026-1000");
  assert.ok(!JSON.stringify(a.bookings).includes("23456789"));
  const b = L.book(a.bookings, { ...req, name: "박정호", phone: "01099998888" });
  assert.equal(b.ok, false);
  assert.match(b.error, /다른 분이 예약/);
  const c = L.book(a.bookings, { ...req, time: "11:00" });
  assert.equal(c.ok, false);
  assert.match(c.error, /같은 날 예약/);
  assert.equal(L.book([], { ...req, time: "13:00" }).ok, false);
});

test("배치 점검: 처음 시안(v1)은 320px에서 아래 버튼이 겹친다", () => {
  const issues = L.layoutIssues(320, "v1", 1);
  assert.ok(issues.some((i) => i.kind === "overlap" && i.where.includes("버튼")));
  assert.ok(issues.some((i) => i.kind === "small"));
});

test("배치 점검: 고친 시안(v2)은 320~430px, 글자 크게에서도 겹침 0", () => {
  for (const w of [320, 360, 375, 390, 430]) for (const s of [1, 1.3]) {
    assert.deepEqual(L.layoutIssues(w, "v2", s), [], `${w}px × ${s}`);
  }
});

test("배치 계산: v2는 폭과 글자 크기에 따라 칸 수를 줄인다", () => {
  assert.equal(L.slotLayout(375, "v1", 1).cols, 4);
  assert.equal(L.slotLayout(320, "v2", 1).cols, 3);
  assert.equal(L.slotLayout(320, "v2", 1.3).cols, 2);
  assert.ok(L.slotLayout(320, "v2", 1).h >= 44);
  assert.equal(L.barLayout(375, "v2", 1).rows, 2);
});

test("완료율과 단계별 이탈", () => {
  const trials = [
    { version: "v1", done: true }, { version: "v1", done: false, quit: "time" }, { version: "v1", done: false, quit: "info" },
    { version: "v2", done: true }, { version: "v2", done: true },
  ];
  assert.deepEqual(L.completion(trials, "v1"), { done: 1, total: 3, pct: 33 });
  assert.equal(L.completion(trials, "v2").pct, 100);
  const f = L.funnel(trials, "v1");
  assert.deepEqual(f.map((x) => x.reached), [3, 3, 2, 1]);
  assert.equal(f[1].quit, 1);
});

test("테스트 기록 추가: 포기했으면 멈춘 단계가 있어야 한다", () => {
  assert.equal(L.addTrial([], { pid: "P1", version: "v2", done: false }).ok, false);
  assert.equal(L.addTrial([], { pid: "", version: "v2", done: true }).ok, false);
  const r = L.addTrial([], { pid: "P3", version: "v2", done: false, quit: "time", memo: "  시간 칸이 작아요 " });
  assert.ok(r.ok);
  assert.equal(r.trial.memo, "시간 칸이 작아요");
  assert.equal(r.trials.length, 1);
});

test("CSV: 참가자 코드만, 쉼표·따옴표 이스케이프", () => {
  const csv = L.trialsCsv([{ pid: "P1", version: "v1", done: false, quit: "time", memo: '버튼이 "겹쳐", 잘못 눌림' }]);
  assert.ok(csv.startsWith("﻿참가자,시안"));
  assert.ok(csv.includes('P1,v1,중도 포기,날짜·시간,"버튼이 ""겹쳐"", 잘못 눌림"'));
});

test("메모 규칙 정리: 단계·주제로 묶고 많은 순", () => {
  const out = L.ruleIssues([
    { pid: "P1", version: "v1", done: false, quit: "time", memo: "시간 버튼이 겹쳐서 엉뚱한 시간 눌림" },
    { pid: "P2", version: "v1", done: false, quit: "time", memo: "손가락으로 누르면 옆 칸이 눌려요" },
    { pid: "P3", version: "v1", done: false, quit: "info", memo: "본인 인증이 뭔지 모르겠다" },
    { pid: "P4", version: "v2", done: true, memo: "" },
  ], "v1");
  assert.equal(out[0].problem, "버튼 겹침");
  assert.equal(out[0].count, 2);
  assert.equal(out[0].step, "날짜·시간");
  assert.ok(out[0].evidence.includes("P1"));
});

test("Claude 응답 검사: 형식이 틀리면 null, 의료 판단은 버린다", () => {
  assert.equal(L.normalizeIssues(null), null);
  assert.equal(L.normalizeIssues({ issues: "많음" }), null);
  assert.equal(L.normalizeIssues({ issues: [{ problem: "" }] }), null);
  const n = L.normalizeIssues({ summary: "요약", issues: [
    { step: "날짜·시간", problem: "버튼이 겹침", evidence: "P1", fix: "칸 수 줄이기", count: "3" },
    { step: "없는 단계", problem: "글자 작음", fix: "", count: -1 },
    { step: "진료과", problem: "증상으로 보아 내과 진단이 맞음", fix: "내과 추천" },
  ] });
  assert.equal(n.issues.length, 2);
  assert.equal(n.issues[0].count, 3);
  assert.equal(n.issues[1].step, "전체");
  assert.equal(n.issues[1].count, 1);
  assert.ok(n.issues[1].fix.length > 0);
});
