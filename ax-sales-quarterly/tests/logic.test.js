// 분기판 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const K = "2026-Q3";
const row = (id, owner, stage, amount, date, extra) => ({ id, q: K, owner, customer: `고객${id}`, stage, amount, date, ...extra });
const ROWS = [
  row("a", "강민서", "수주", 50000000, "2026-07-10"),
  row("b", "강민서", "실주", 20000000, "2026-08-02"),
  row("c", "오준혁", "수주", 80000000, "2026-09-15"),
  row("d", "오준혁", "수주", 30000000, "2026-09-30"),
  row("e", "윤하늘", "진행", 40000000, "2026-11-20"),
];
const PREV = [{ id: "p", q: "2026-Q2", owner: "강민서", customer: "고객p", stage: "수주", amount: 128000000, date: "2026-05-01" }];

test("분기 계산: 어느 분기인지, 범위, 앞뒤 분기", () => {
  assert.equal(L.quarterOf("2026-08-14"), "2026-Q3");
  assert.deepEqual(L.quarterRange("2026-Q1"), { start: "2026-01-01", end: "2026-03-31" });
  assert.equal(L.shiftQuarter("2026-Q1", -1), "2025-Q4");
  assert.equal(L.shiftQuarter("2026-Q4", 1), "2027-Q1");
  assert.equal(L.qLabel(K), "2026년 3분기");
});

test("금액 읽기와 표시", () => {
  assert.equal(L.parseWon("1억 2천만"), 120000000);
  assert.equal(L.parseWon("3,200만"), 32000000);
  assert.equal(L.parseWon("1.5억 원"), 150000000);
  assert.equal(L.parseWon("45000000"), 45000000);
  assert.equal(L.parseWon("많이"), null);
  assert.equal(L.fmtWon(160000000), "1억 6,000만 원");
  assert.equal(L.fmtWon(0), "0원");
});

test("양식 점검: 빠진 칸·분기 밖 날짜·중복을 잡고 계산에서 뺀다", () => {
  const v = L.validate([
    ...ROWS,
    row("x", "강민서", "수주", null, "2026-08-01"),
    row("y", "오준혁", "수주", 10000000, "2026-10-02"),
    { ...ROWS[0], id: "z" },
    row("w", "", "", 10000000, ""),
  ], K);
  assert.equal(v.ok.length, 5);
  const by = Object.fromEntries(v.issues.map((i) => [i.id, i.msg]));
  assert.equal(by.x, "금액 없음");
  assert.equal(by.y, "2026년 3분기 밖의 날짜");
  assert.equal(by.z, "같은 거래가 두 번 들어감");
  assert.ok(by.w.includes("담당 없음") && by.w.includes("단계 없음") && by.w.includes("날짜 없음"));
});

test("진행 중 거래는 다음 분기 날짜여도 통과한다", () => {
  assert.equal(L.validate([ROWS[4]], K).issues.length, 0);
});

test("분기 숫자: 수주액·달성률·승률·전분기 대비·진행", () => {
  const r = L.compute(ROWS, PREV, 200000000);
  assert.equal(r.won, 160000000);
  assert.equal(r.wonCount, 3);
  assert.equal(r.lostCount, 1);
  assert.equal(r.winRate, 75);
  assert.equal(r.achieve, 80);
  assert.equal(r.qoq, 25);
  assert.equal(r.avgDeal, 53333333);
  assert.equal(r.pipeline, 40000000);
  assert.deepEqual(r.byOwner.map((o) => [o.owner, o.won, o.winRate]), [["오준혁", 110000000, 100], ["강민서", 50000000, 50], ["윤하늘", 0, 0]]);
  assert.equal(r.top[0].id, "c");
});

test("지난 분기 기록이 없으면 대비 0, 문장도 비교하지 않는다", () => {
  const r = L.compute(ROWS, [], 0);
  assert.equal(r.qoq, 0);
  assert.equal(r.achieve, 0);
  assert.ok(L.ruleSummary(r, "영업2팀", K)[1].includes("비교하지 않았습니다"));
});

test("규칙 요약 4문장은 숫자 검산을 통과한다 (팀 이름 속 숫자는 무시)", () => {
  const r = L.compute(ROWS, PREV, 200000000);
  const s = L.ruleSummary(r, "영업1팀", K);
  assert.equal(s.length, 4);
  assert.ok(s[0].includes("1억 6,000만 원") && s[0].includes("80%"));
  assert.ok(s[1].includes("25% 늘었습니다"));
  assert.deepEqual(L.checkNumbers(s, r, K, ["영업1팀"]), { ok: true, bad: [] });
});

test("문장 속 숫자 읽기: 억·만·%·건", () => {
  const n = L.numbersIn("수주액 1억 6,000만 원, 승률 75%, 3건");
  assert.deepEqual(n.map((x) => [x.value, x.unit]), [[160000000, "원"], [75, "%"], [3, "건"]]);
});

test("Claude 문장에 계산과 다른 숫자가 있으면 걸린다", () => {
  const r = L.compute(ROWS, PREV, 200000000);
  assert.equal(L.checkNumbers(["수주액은 1.6억 원으로 목표의 80%입니다."], r, K).ok, true);
  const bad = L.checkNumbers(["수주액은 1억 8,000만 원, 승률 80%입니다."], r, K);
  assert.equal(bad.ok, false);
  assert.ok(bad.bad.includes("1억 8,000만 원"));
});

test("Claude 응답 형식 검사", () => {
  assert.equal(L.normalizeSummary(null), null);
  assert.equal(L.normalizeSummary({ lines: "문장" }), null);
  assert.equal(L.normalizeSummary({ lines: ["하나", "둘"] }), null);
  assert.deepEqual(L.normalizeSummary({ lines: [" 가 ", "", "나", 3, "다"] }), { lines: ["가", "나", "다"] });
});

test("마크다운 공유본에 같은 양식 칸이 모두 있다", () => {
  const r = L.compute(ROWS, PREV, 200000000);
  const md = L.toMarkdown(r, "영업1팀", K, L.ruleSummary(r, "영업1팀", K));
  ["## 영업1팀 2026년 3분기 영업 리포트", "| 수주액 | 1억 6,000만 원 |", "| 목표 대비 | 80%", "### 요약", "### 담당별", "| 오준혁 |"].forEach((x) => assert.ok(md.includes(x), x));
});

test("샘플 데이터는 씨앗이 같으면 같다", () => {
  const a = L.sampleDeals(7, ["가"], ["나"], K), b = L.sampleDeals(7, ["가"], ["나"], K);
  assert.deepEqual(a, b);
  assert.ok(a.some((r) => r.q === "2026-Q2") && a.some((r) => r.stage === "진행"));
});
