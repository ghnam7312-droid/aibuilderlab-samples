// 금요보고 로직 테스트 — node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const WR = require("../logic.js");

const S = WR.sample();
const F = WR.facts(S.weeks, S.top);

test("한 주는 금요일~목요일, 날짜는 KST로 찍힌다", () => {
  assert.equal(WR.label(WR.dayOf("now", 0)), "10/9(금)");
  assert.equal(WR.label(WR.dayOf("now", 6)), "10/15(목)");
  assert.equal(WR.weekRange("last"), "10/2(금) – 10/8(목)");
});

test("KST 자정 직후도 하루 밀리지 않는다 (2주차 버그)", () => {
  // UTC로는 10/8 15:30 이지만 한국 시간으로는 10/9 00:30
  assert.equal(WR.label(new Date("2026-10-08T15:30:00Z")), "10/9(금)");
  assert.equal(WR.isoKST(new Date("2026-10-08T15:30:00Z")), "2026-10-09");
});

test("휴일 표시: 한글날·개천절", () => {
  assert.equal(WR.holiday("now", 0), "한글날");
  assert.equal(WR.holiday("last", 1), "개천절");
  assert.equal(WR.holiday("now", 3), "");
});

test("다음 자동 발송: 금요일 17시, 지났으면 다음 주", () => {
  const iso = (d) => d.toISOString();
  assert.equal(iso(WR.nextFriday(new Date("2026-10-19T10:00:00+09:00"))), "2026-10-23T08:00:00.000Z");
  assert.equal(iso(WR.nextFriday(new Date("2026-10-23T16:59:00+09:00"))), "2026-10-23T08:00:00.000Z");
  assert.equal(iso(WR.nextFriday(new Date("2026-10-23T17:01:00+09:00"))), "2026-10-30T08:00:00.000Z");
});

test("주간 합계·전환율·객단가", () => {
  const b = WR.stats(S.weeks.now);
  assert.equal(b.S, 36120000);
  assert.equal(b.O, 535);
  assert.equal(b.V, 14890);
  assert.equal(b.R.toFixed(2), "3.59");
  assert.equal(Math.round(b.A), 67514);
});

test("전주 대비 증감률", () => {
  const a = WR.stats(S.weeks.last), b = WR.stats(S.weeks.now);
  assert.equal(WR.pct(b.S, a.S).toFixed(1), "12.2");
  assert.equal(WR.pct(b.A, a.A).toFixed(1), "-1.2");
  assert.equal(WR.pct(5, 0), 0); // 0으로 나누지 않는다
});

test("차트 눈금은 1·2·2.5·5 단위로 떨어진다", () => {
  assert.equal(WR.niceStep(1530000), 2000000);
  assert.equal(WR.niceStep(230), 250);
  assert.equal(WR.niceStep(0), 1);
});

test("입력 검증: 쉼표·단위 허용, 글자·빈칸·소수·주문>방문 거름", () => {
  assert.deepEqual(WR.parseCell("6,120,000원"), { ok: true, value: 6120000 });
  assert.equal(WR.parseCell("").ok, false);
  assert.match(WR.parseCell("61O").msg, /숫자가 아닌/);
  assert.match(WR.parseCell("3.5").msg, /소수점/);
  assert.match(WR.parseCell("3000", { field: "orders", visits: 2480 }).msg, /방문 2,480명보다 많아요/);
  assert.match(WR.parseCell("50", { field: "visits", orders: 92 }).msg, /적어요/);
});

test("문장 속 숫자 뽑기: 만 원·%·%p·건·날짜", () => {
  const n = WR.numbersIn("매출은 3,612만 원으로 12.2% 늘었고 전환율은 0.19%p 올랐습니다. 10/9(금) 주문 92건.");
  assert.deepEqual(n.map((x) => [x.v, x.unit]), [[3612, "만원"], [12.2, "%"], [0.19, "%p"], [10, "월"], [9, "일"], [92, "건"]]);
});

test("검산: 규칙 요약 문장은 숫자가 모두 데이터와 맞는다", () => {
  const lines = WR.ruleSummary(S.weeks, S.top);
  assert.equal(lines.length, 4);
  lines.forEach((l) => {
    const c = WR.checkNumbers(l, F);
    assert.ok(c.ok, `${l} → ${JSON.stringify(c.items.filter((x) => !x.ok))}`);
  });
});

test("검산: 데이터에 없는 숫자를 잡아낸다 (AI가 지어낸 숫자)", () => {
  const c = WR.checkNumbers("이번 주 매출은 4,200만 원으로 지난주보다 18.5% 늘었습니다.", F);
  assert.equal(c.ok, false);
  assert.deepEqual(c.items.filter((x) => !x.ok).map((x) => x.raw), ["4,200만 원", "18.5%"]);
});

test("검산: 반올림은 적힌 자릿수만큼 봐준다", () => {
  assert.equal(WR.checkNumbers("매출 12% 증가", F).ok, true);      // 12.2 → 12
  assert.equal(WR.checkNumbers("전환율 3.6%", F).ok, true);         // 3.59 → 3.6
  assert.equal(WR.checkNumbers("전환율 9.9%", F).ok, false);
  assert.equal(WR.checkNumbers("객단가 67,514원", F).ok, true);
  assert.equal(WR.checkNumbers("객단가 67,600원", F).ok, false);
});

test("Claude 응답: 문장 배열만 받고 이상하면 null", () => {
  assert.deepEqual(WR.fromAi({ lines: ["a", " b ", ""] }), ["a", "b"]);
  assert.equal(WR.fromAi({ lines: ["하나뿐"] }), null);
  assert.equal(WR.fromAi({ text: "..." }), null);
  assert.equal(WR.fromAi(null), null);
});

test("Claude 입력에는 계산된 숫자만 넘긴다", () => {
  const i = WR.aiInput(S.weeks, S.top);
  assert.equal(i.thisWeek.sales만원, 3612);
  assert.equal(i.change.sales, 12.2);
  assert.equal(i.days[0].holiday, "한글날");
  assert.equal(i.days.length, 7);
  assert.equal(i.topProducts[0].name, "무선 키보드");
});
