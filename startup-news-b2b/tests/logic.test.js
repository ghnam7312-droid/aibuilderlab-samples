// 팀한장 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const T = L.TIERS;
const byName = (n) => L.COMPANIES.find((c) => c.name === n);

test("누적 요금: 1~5명 기본료, 6명부터 구간별 인당 요금을 더한다", () => {
  assert.equal(L.graduated(0, T), 0);
  assert.equal(L.graduated(1, T), 25000);
  assert.equal(L.graduated(5, T), 25000);
  assert.equal(L.graduated(6, T), 29500);
  assert.equal(L.graduated(20, T), 25000 + 15 * 4500);
  assert.equal(L.graduated(21, T), 25000 + 15 * 4500 + 3800);
  assert.equal(L.graduated(85, T), 318500);
});

test("누적 요금은 사람이 늘면 언제나 늘어난다 (절벽 없음)", () => {
  assert.deepEqual(L.findCliffs(T, "graduated"), []);
  for (let n = 1; n < 100; n++) assert.ok(L.graduated(n + 1, T) > L.graduated(n, T) || n < 5);
});

test("전체 적용 방식은 구간 경계에서 절벽이 생긴다", () => {
  assert.ok(L.volume(21, T) < L.volume(20, T));
  assert.deepEqual(L.findCliffs(T, "volume"), [21, 51]);
});

test("구간 점검: 샘플 구간은 누적이면 통과, 전체 적용이면 절벽을 알린다", () => {
  assert.deepEqual(L.checkTiers(T, "graduated"), []);
  const p = L.checkTiers(T, "volume");
  assert.equal(p.length, 1);
  assert.match(p[0], /21명, 51명/);
});

test("구간 점검: 뒤 구간이 더 비싸거나 개인 구독보다 비싸면 알린다", () => {
  const bad = { base: 25000, baseSeats: 5, steps: [{ upTo: 20, per: 6000 }, { upTo: 50, per: 6500 }, { upTo: 100, per: 3200 }] };
  const p = L.checkTiers(bad, "graduated");
  assert.ok(p.some((x) => /앞 구간보다 비싸/.test(x)));
  assert.ok(p.some((x) => /개인 구독/.test(x)));
  assert.ok(L.checkTiers({ ...T, base: 0 }, "graduated").some((x) => /기본료/.test(x)));
});

test("'팀 전체 무제한'으로 팔았다면: 85명 회사는 인당 576원 (고친 문제 재현)", () => {
  assert.equal(Math.round(L.UNLIMITED / 85), 576);
  const q = L.quote(byName("다온운송"), T, "graduated", false);
  assert.equal(q.monthly, 318500);
  assert.equal(q.perSeat, 3747);
  assert.equal(q.unlimitedGap, 318500 - 49000);
});

test("견적: 모든 회사가 개인 구독 합계보다 싸다", () => {
  L.COMPANIES.forEach((c) => {
    const q = L.quote(c, T, "graduated", false);
    assert.ok(q.monthly < q.personalTotal, c.name);
    assert.ok(q.perSeat < L.PERSONAL, c.name);
  });
});

test("연 결제는 2개월분 할인, 100명 넘으면 따로 견적", () => {
  const c = byName("한결로지스");
  assert.equal(L.quote(c, T, "graduated", true).yearly, L.graduated(12, T) * 10);
  assert.equal(L.quote(c, T, "graduated", false).yearly, L.graduated(12, T) * 12);
  assert.equal(L.quote({ ...c, seats: 120 }, T, "graduated").overQuote, true);
});

test("계약한 2곳(목표치)의 월 매출 합계", () => {
  assert.equal(L.COMPANIES.filter((c) => c.status === "계약").length, 2);
  assert.equal(L.contractMrr(L.COMPANIES, T, "graduated"), L.graduated(12, T) + L.graduated(38, T));
});

test("규칙 제안 메일: 계산한 금액이 그대로 들어간다", () => {
  const c = byName("새솔창고"), q = L.quote(c, T, "graduated", false);
  const p = L.ruleProposal(c, q, false);
  assert.ok(p.subject.includes(L.won(q.monthly)));
  const allowed = new Set([q.monthly, q.perSeat, L.PERSONAL, q.yearly, c.seats]);
  assert.ok(L.moneyIn(p.subject + p.body).every((n) => allowed.has(n)));
});

test("Claude 응답 검사: 계산과 다른 금액이 있으면 통째로 버린다", () => {
  const c = byName("새솔창고"), q = L.quote(c, T, "graduated", false), inp = L.aiInput(c, q, false);
  assert.equal(L.normalizeProposal({ subject: "제안", body: `7명 기준 월 30,000원으로 드립니다. 확인 부탁드립니다.` }, inp), null);
  assert.ok(L.normalizeProposal({ subject: "제안", body: `7명 기준 월 ${q.monthly.toLocaleString("ko-KR")}원입니다. 확인 부탁드립니다.` }, inp));
  assert.equal(L.normalizeProposal({ subject: 1, body: "x" }, inp), null);
  assert.equal(L.normalizeProposal(null, inp), null);
});

test("Claude 응답 검사: 계약 조건 문장은 빼고 사람 확인으로 넘긴다", () => {
  const c = byName("한결로지스"), q = L.quote(c, T, "graduated", false), inp = L.aiInput(c, q, false);
  const n = L.normalizeProposal({
    subject: "팀 구독 제안",
    body: `12명 기준 월 ${q.monthly}원입니다. 중도 해지 시 위약금은 없습니다. 첫 발송일을 알려 주세요.`,
    questions: ["환불 규정이 궁금하신가요?", "첫 발송일은 언제가 좋을까요?"],
  }, inp);
  assert.deepEqual(n.removed, ["중도 해지 시 위약금은 없습니다."]);
  assert.ok(!n.body.includes("위약금"));
  assert.deepEqual(n.questions, ["첫 발송일은 언제가 좋을까요?"]);
});

test("CSV 내보내기: 회사 5곳 + 머리줄", () => {
  const csv = L.toCsv(L.COMPANIES, T, "graduated", false).trim().split("\n");
  assert.equal(csv.length, 6);
  assert.ok(csv[4].startsWith("다온운송,화물 운송,85,검토,318500,3747"));
});
