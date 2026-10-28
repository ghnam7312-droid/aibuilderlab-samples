// 빈자리 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const EXAM = L.sampleLog("exam");
const NORMAL = L.sampleLog("normal");

test("샘플 기록: 기간 10일 × 구역 5개 × 16시간, 같은 씨앗이면 같은 값", () => {
  assert.equal(EXAM.length, 10 * 5 * 16);
  assert.deepEqual(L.sampleLog("exam"), EXAM);
  L.ZONES.forEach((z) => EXAM.filter((x) => x.zone === z.id && x.used != null).forEach((x) => assert.ok(x.used >= 0 && x.used <= z.seats)));
});

test("시스템이 멈춘 시간은 0이 아니라 빈칸(null)으로 들어 있다", () => {
  const miss = EXAM.filter((x) => x.used == null);
  assert.equal(miss.length, 4 + 2 + 2);
  assert.ok(miss.every((x) => x.used === null));
});

test("평균: 결측은 빼고 계산, 이전 방식은 0으로 넣는다", () => {
  assert.equal(L.meanOf([0.9, null, 0.7]), 0.8);
  assert.ok(Math.abs(L.meanOf([0.9, null, 0.6], true) - 0.5) < 1e-9);
  assert.equal(L.meanOf([null, null]), null);
  assert.equal(L.meanOf([]), null);
});

test("결측이 있는 칸: 결측 제외 평균이 0 처리 평균보다 높고, 빠진 날 수를 기억한다", () => {
  const good = L.matrix(EXAM), zero = L.matrix(EXAM, { zeroForMissing: true });
  const g = good.cells.B[10], z = zero.cells.B[10];
  assert.equal(g.missing, 1);
  assert.equal(g.n, 9);
  assert.ok(g.rate > z.rate + 0.05);
  assert.equal(good.missingHours, 8);
  // 결측이 없는 칸은 두 방식이 같다
  assert.equal(good.cells.W[9].rate, zero.cells.W[9].rate);
});

test("시험 기간 혼잡 시간대(90% 이상 연속) 3개", () => {
  const p = L.findPeaks(L.matrix(EXAM));
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((x) => `${x.zone}${x.from}-${x.to}`).sort(), ["A13-18", "B10-13", "N19-23"]);
  p.forEach((x) => assert.ok(x.avgPct >= 90));
});

test("결측을 0으로 계산하면 2층 열람실 B의 오전 혼잡이 사라진다 (이전 버그)", () => {
  const p = L.findPeaks(L.matrix(EXAM, { zeroForMissing: true }), 10);
  assert.ok(!p.some((x) => x.zone === "B"));
});

test("평소 기간에는 90%를 넘는 시간대가 없다", () => {
  assert.equal(L.findPeaks(L.matrix(NORMAL)).length, 0);
});

test("혼잡 찾기: 끝 시각까지 이어지는 구간, 기록 없는 칸은 끊는다", () => {
  const cells = {};
  L.ZONES.forEach((z) => { cells[z.id] = {}; L.HOURS.forEach((h) => { cells[z.id][h] = { rate: 0.5 }; }); });
  cells.A[21] = { rate: 0.95 }; cells.A[22] = { rate: 0.91 }; cells.A[23] = { rate: 0.93 };
  cells.B[10] = { rate: 0.95 }; cells.B[11] = { rate: null }; cells.B[12] = { rate: 0.92 };
  const p = L.findPeaks({ cells }, 10);
  const a = p.find((x) => x.zone === "A");
  assert.deepEqual([a.from, a.to, a.hours, a.avgPct], [21, 24, 3, 93]);
  assert.equal(p.filter((x) => x.zone === "B").length, 2);
});

test("요약: 가장 붐빈 칸, 구역 평균, 좌석 합계", () => {
  const s = L.summary(L.matrix(EXAM));
  assert.equal(s.seatTotal, 588);
  assert.ok(s.top.pct >= 95);
  assert.equal(s.zones.length, 5);
  assert.ok(s.zones.find((z) => z.zone === "W").avgPct < s.zones.find((z) => z.zone === "A").avgPct);
});

test("규칙 보고서: '모르는 것'이 먼저, 결측 시간이 들어가고, 숫자 검산을 통과한다", () => {
  for (const [period, log] of [["exam", EXAM], ["normal", NORMAL]]) {
    for (const zero of [false, true]) {
      const input = L.aiInput(period, L.matrix(log, { zeroForMissing: zero }), { zeroForMissing: zero });
      const r = L.ruleReport(input);
      assert.ok(r.unknowns.length >= 3);
      assert.match(r.unknowns[0], new RegExp(`${input.missingHours}시간`));
      assert.equal(L.normalizeReport(r, input).ok, true, `${period} ${zero}`);
    }
  }
});

test("Claude 응답 검사: 빈 칸 · 형식 오류 · 입력에 없는 숫자는 버린다", () => {
  const input = L.aiInput("exam", L.matrix(EXAM));
  assert.equal(L.normalizeReport(null, input).ok, false);
  assert.equal(L.normalizeReport({ headline: "제목", findings: ["a"], proposal: "b" }, input).ok, false); // unknowns 없음
  const r = L.normalizeReport({ headline: "혼잡 3개", unknowns: ["가방만 둔 자리는 구분 못 함"], findings: ["열람실 A 오후 평균 99%"], proposal: "좌석 40석 추가" }, input);
  assert.equal(r.ok, false);
  assert.match(r.reason, /숫자 검산 실패/);
  const ok = L.normalizeReport({ headline: "혼잡 3개", unknowns: ["가방만 둔 자리는 구분 못 함"], findings: [`${input.peaks[0].zone} 평균 ${input.peaks[0].avgPct}%`], proposal: "창가석 일부를 개인석으로" }, input);
  assert.equal(ok.ok, true);
});

test("CSV: BOM, 머리글 16시간, 구역 5행", () => {
  const csv = L.toCsv("exam", L.matrix(EXAM));
  const rows = csv.split("\r\n");
  assert.ok(rows[0].startsWith("﻿기간,구역,좌석,8시"));
  assert.equal(rows[0].split(",").length, 3 + 16);
  assert.equal(rows.length, 6);
});
