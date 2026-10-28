// 값매김 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const C = L.COSTS;
const plan = (o) => ({ id: "X", name: "x", price: 100000, kit: true, minutes: 60, ...o });

test("1인당 계산: 가격에서 수수료 2개 · 재료 · 배송 · 작가 시간을 모두 뺀다", () => {
  const u = L.unit(L.PLANS[1], C); // B 99,000
  assert.deepEqual([u.platform, u.pay, u.kit, u.ship, u.time], [14850, 3465, 18000, 3500, 20000]);
  assert.equal(u.net, 39185);
  assert.equal(Math.round(u.margin * 1000) / 10, 39.6);
});

test("1기 그때 계산(수수료 빠짐)과 다시 계산의 차이", () => {
  const was = L.cohort(L.COHORT1, C, 60, { legacy: true });
  const now = L.cohort(L.COHORT1, C, 60);
  assert.equal(was.net, 27500);
  assert.equal(now.net, 14735);
  assert.equal(was.net - now.net, now.platform + now.pay); // 차이는 정확히 수수료 두 줄
  assert.equal(was.profit, 750000);
  assert.equal(now.profit, -15900); // 남는 줄 알았는데 손해
  assert.equal(now.breakEven, 62);
});

test("키트가 없으면 재료·배송이 빠지고, 작가 시간은 분 단위로 계산", () => {
  const u = L.unit(plan({ kit: false, minutes: 30 }), C);
  assert.equal(u.kit + u.ship, 0);
  assert.equal(u.time, 10000);
});

test("손익분기: 고정비 ÷ 1인당 남는 돈 올림, 남는 돈이 없으면 무한대", () => {
  assert.equal(L.breakEven(39185, 900000), 23);
  assert.equal(L.breakEven(0, 900000), Infinity);
  assert.equal(L.breakEven(-500, 900000), Infinity);
});

test("빠뜨린 비용 경고: 수수료 0% · 키트 재료비 0원 · 팔수록 손해", () => {
  assert.deepEqual(L.missingCosts(C, L.PLANS), []);
  const w = L.missingCosts({ ...C, platformRate: 0, kitCost: 0 }, L.PLANS);
  assert.ok(w.some((s) => s.includes("플랫폼 수수료")));
  assert.ok(w.some((s) => s.includes("재료비")));
  assert.ok(L.missingCosts(C, [plan({ price: 30000 })]).some((s) => s.includes("손해")));
});

test("사전 신청 테스트: 신청 64명, 신청률·방문자당 남는 돈·예상 수강생", () => {
  assert.equal(L.totalSignups(L.PRESIGN), 64);
  const rs = L.presignRows(L.PLANS, C, L.PRESIGN);
  const b = rs.find((r) => r.id === "B");
  assert.equal(b.conv, 0.125);
  assert.equal(b.perVisitor, 4898);
  assert.equal(b.students, 60);
  assert.equal(b.profit, 1451100);
  assert.equal(L.presignRows([plan({ id: "Z" })], C, {})[0].conv, 0); // 방문 0이면 0
});

test("규칙 추천: 1인당이 아니라 방문자당 남는 돈이 큰 구성 (B, 객단가 9.9만)", () => {
  const rv = L.reviewRule(L.presignRows(L.PLANS, C, L.PRESIGN), C);
  assert.equal(rv.pick, "B");
  assert.ok(rv.reasons.some((s) => s.startsWith("C는")));      // 1인당은 C가 더 큼을 밝힌다
  assert.ok(rv.risks.some((s) => s.includes("9명")));          // 표본이 적은 구성 경고
  const none = L.reviewRule(L.presignRows([plan({ price: 1000 })], C, { X: { visits: 10, signups: 1 } }), C);
  assert.equal(none.pick, "");
});

test("숫자 검사: 입력에서 나온 숫자(원·%·만 단위)만 허용", () => {
  const rs = L.presignRows(L.PLANS, C, L.PRESIGN);
  const ok = L.allowedNumbers(rs, C);
  assert.equal(L.numbersGrounded("B는 9.9만 원, 신청률 12.5%, 1인당 39,185원", ok), true);
  assert.equal(L.numbersGrounded("1:1 라이브 3가지 구성", ok), true);
  assert.equal(L.numbersGrounded("B를 고르면 매출이 2배인 1,980,000원", ok), false);
});

test("Claude 응답 검사: 없는 구성 · 지어낸 숫자 · 빈 이유는 버린다", () => {
  const rs = L.presignRows(L.PLANS, C, L.PRESIGN);
  const good = { pick: "b", reasons: ["방문자당 4,898원으로 가장 커요."], risks: ["C는 신청이 9명뿐이에요."] };
  assert.deepEqual(L.normalizeReview(good, rs, C), { pick: "B", reasons: good.reasons, risks: good.risks });
  assert.equal(L.normalizeReview({ ...good, pick: "D" }, rs, C), null);
  assert.equal(L.normalizeReview({ ...good, reasons: ["경쟁 클래스 평균이 120,000원이에요."] }, rs, C), null);
  assert.equal(L.normalizeReview({ ...good, reasons: [] }, rs, C), null);
  assert.equal(L.normalizeReview("B", rs, C), null);
});

test("규칙 추천 문장은 숫자 검사를 스스로 통과한다", () => {
  const rs = L.presignRows(L.PLANS, C, L.PRESIGN);
  const rv = L.reviewRule(rs, C);
  assert.deepEqual(L.normalizeReview(rv, rs, C), rv);
});

test("계산표 내보내기: 구성 3줄 + 머리줄, 손익분기 불가 표시", () => {
  const csv = L.exportCsv([...L.PLANS.slice(0, 2), plan({ id: "Z", name: "손해", price: 10000 })], C, L.PRESIGN);
  const lines = csv.replace("﻿", "").split("\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[2].startsWith("B 영상 + 재료 키트,99000,14850,3465,21500,20000,39185,39.6%,23,272,34,12.5%,4898,60,1451100"));
  assert.ok(lines[3].includes(",불가,"));
});

test("표시 도우미: 원 · 만 · %", () => {
  assert.equal(L.won(1451100), "1,451,100원");
  assert.equal(L.man(69000), "6.9만");
  assert.equal(L.man(99000), "9.9만");
  assert.equal(L.pct(0.125), "12.5%");
});
