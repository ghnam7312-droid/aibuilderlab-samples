// 장비표 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-20"; // 화요일
const EQ = [
  { id: "utm", name: "만능재료시험기", alias: ["UTM", "인장시험기"], lab: "a", training: false },
  { id: "sem", name: "주사전자현미경", alias: ["SEM", "전자현미경"], lab: "a", training: true },
  { id: "cnc", name: "CNC 밀링", alias: ["CNC", "밀링"], lab: "c", training: true },
];
const LABS = [{ id: "a", name: "재료실험실" }, { id: "c", name: "가공실험실" }];
const bk = (o) => ({ eq: "utm", date: TODAY, start: 600, end: 720, who: "박서윤", status: "ok", ...o });

test("시간 도우미: 분 ↔ HH:MM, 틀린 값은 -1", () => {
  assert.equal(L.toMin("14:30"), 870);
  assert.equal(L.hhmm(870), "14:30");
  assert.equal(L.toMin("25:00"), -1);
  assert.equal(L.toMin("오후"), -1);
  assert.equal(L.withDay(TODAY), "10/20(화)");
});

test("겹침: 구간이 겹치면 충돌, 앞 예약이 끝나는 시각에 시작하는 건 괜찮다", () => {
  assert.equal(L.overlaps(bk({}), bk({ start: 660, end: 780 })), true);
  assert.equal(L.overlaps(bk({}), bk({ start: 720, end: 780 })), false);
  assert.equal(L.overlaps(bk({}), bk({ eq: "sem" })), false, "다른 장비");
  assert.equal(L.overlaps(bk({}), bk({ date: "2026-10-21" })), false, "다른 날");
  assert.equal(L.overlaps(bk({}), bk({ start: 540, end: 900 })), true, "완전히 감싸는 경우");
});

test("취소한 예약과는 겹쳐도 충돌이 아니다", () => {
  const list = [bk({ id: "x", status: "cancelled" })];
  assert.equal(L.findConflict(list, bk({ id: "y" })), null);
});

test("검사: 지난 날짜, 거꾸로 된 시간, 운영 시간 밖, 4시간 초과, 30분 단위", () => {
  assert.deepEqual(L.validate(bk({}), TODAY), []);
  assert.ok(L.validate(bk({ date: "2026-10-19" }), TODAY).some((e) => e.includes("지난 날짜")));
  assert.ok(L.validate(bk({ start: 720, end: 600 }), TODAY).some((e) => e.includes("끝 시간")));
  assert.ok(L.validate(bk({ start: 1230, end: 1290 }), TODAY).some((e) => e.includes("이용 시간")));
  assert.ok(L.validate(bk({ start: 540, end: 870 }), TODAY).some((e) => e.includes("4시간")));
  assert.ok(L.validate(bk({ start: 610, end: 700 }), TODAY).some((e) => e.includes("30분")));
  assert.ok(L.validate(bk({ who: " " }), TODAY).some((e) => e.includes("이름")));
  assert.ok(L.validate(bk({}), TODAY, 630).some((e) => e.includes("지난 시간")), "오늘 10:30에 10:00 예약");
  assert.deepEqual(L.validate(bk({ date: "2026-10-21" }), TODAY, 630), [], "내일은 상관없다");
});

test("안전교육이 필요한 장비는 자동 확정하지 않고 관리자 승인 대기", () => {
  assert.equal(L.statusFor(EQ[1]), "pending");
  assert.equal(L.statusFor(EQ[0]), "ok");
});

test("DB 제약: 저장하는 순간 겹치면 23P01로 거절한다", () => {
  const s = L.createStore([bk({ id: "b1" })]);
  const r = s.insert(bk({ start: 690, end: 750, who: "이도현" }));
  assert.equal(r.ok, false);
  assert.equal(r.code, "23P01");
  assert.equal(r.conflict.id, "b1");
  assert.equal(s.insert(bk({ start: 720, end: 780 })).ok, true, "바로 뒤 시간은 저장된다");
});

test("동시 예약 재현: 화면 확인만 있으면 둘 다 저장되어 충돌 1건", () => {
  const s = L.createStore([], { constraint: false });
  const r = L.simulateRace(s, bk({ who: "박서윤" }), bk({ who: "이도현" }));
  assert.equal(r.log.filter((x) => x.step === "check" && x.ok).length, 2, "둘 다 '비어 있음'을 봤다");
  assert.equal(r.saved, 2);
  assert.equal(r.conflicts, 1);
});

test("동시 예약 재현: DB 제약이 있으면 한 사람만 저장, 충돌 0건", () => {
  const s = L.createStore([], { constraint: true });
  const r = L.simulateRace(s, bk({ who: "박서윤" }), bk({ who: "이도현" }));
  assert.equal(r.saved, 1);
  assert.equal(r.conflicts, 0);
  const second = r.log.find((x) => x.step === "insert" && x.who === "이도현");
  assert.equal(second.ok, false);
  assert.equal(second.code, "23P01");
});

test("빠른 예약 문장(규칙): '내일 오후 2시부터 3시간 SEM'", () => {
  const r = L.parseRequest("내일 오후 2시부터 3시간 SEM 쓸게요", TODAY, EQ);
  assert.deepEqual([r.eq, r.date, r.start, r.end], ["sem", "2026-10-21", 840, 1020]);
  assert.deepEqual(r.missing, []);
});

test("빠른 예약 문장(규칙): 월/일, 시각 범위, 용도, '2시'는 오후로 본다", () => {
  const r = L.parseRequest("10/23 2시~4시 반 인장시험기 용도: 알루미늄 시편 인장", TODAY, EQ);
  assert.deepEqual([r.eq, r.date, r.start, r.end], ["utm", "2026-10-23", 840, 990]);
  assert.equal(r.purpose, "알루미늄 시편 인장");
  const w = L.parseRequest("금요일 10:00 CNC", TODAY, EQ);
  assert.deepEqual([w.eq, w.date, w.start, w.end], ["cnc", "2026-10-23", 600, -1]);
  assert.deepEqual(w.missing, ["끝 시간"]);
});

test("Claude 응답 검사: 없는 장비·틀린 날짜는 비우고, 쓸 게 없으면 null", () => {
  const ok = L.normalizeParse({ equipment: "sem", date: "2026-10-21", start: "14:00", end: "17:00", purpose: "단면 관찰", unclear: "" }, EQ);
  assert.deepEqual([ok.eq, ok.date, ok.start, ok.end, ok.purpose], ["sem", "2026-10-21", 840, 1020, "단면 관찰"]);
  const bad = L.normalizeParse({ equipment: "laser", date: "내일", start: "14:00", end: "13:00" }, EQ);
  assert.deepEqual([bad.eq, bad.date, bad.end], ["", "", -1]);
  assert.deepEqual(bad.missing, ["장비", "날짜", "끝 시간"]);
  assert.equal(L.normalizeParse({ equipment: "x", date: "?", start: "?" }, EQ), null);
  assert.equal(L.normalizeParse("문장", EQ), null);
});

test("공유 CSV: 예약자 이름을 가리고, 취소한 예약은 뺀다", () => {
  assert.equal(L.maskName("김민준"), "김*준");
  assert.equal(L.maskName("이준"), "이*");
  assert.equal(L.maskName("남궁서진"), "남**진");
  const csv = L.toCsv([bk({ id: "1", purpose: "인장, 3회" }), bk({ id: "2", who: "최하늘", status: "cancelled" })], EQ, LABS);
  assert.ok(csv.startsWith("﻿날짜,"));
  assert.ok(csv.includes("박*윤"));
  assert.ok(!csv.includes("박서윤"));
  assert.ok(!csv.includes("최"));
  assert.ok(csv.includes('"인장, 3회"'));
});

test("장비별 사용 시간 합계", () => {
  const u = L.usage([bk({}), bk({ start: 780, end: 840 }), bk({ eq: "sem", status: "cancelled" })], EQ);
  assert.equal(u.find((x) => x.id === "utm").minutes, 180);
  assert.equal(u.find((x) => x.id === "sem").minutes, 0);
});
