// 광고한장 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const S = L.sample();
const CH = Object.fromEntries(L.CHANNELS.map((c) => [c.id, c]));
const rep = (std = L.DEFAULT_STD, cur = S.cur) => L.buildReport(cur, S.prev, std, S);

test("채널이 보고한 전환은 그 채널이 세는 사건을 모두 더한 값", () => {
  assert.equal(L.reportedConv(S.cur.search, CH.search), 148 + 312);
  assert.equal(L.reportedConv(S.cur.social, CH.social), 61 + 174);
  assert.equal(L.reportedConv(S.cur.shop, CH.shop), 133);
});

test("기준 맞춘 합산: 구매만 세면 그대로 더한 합계보다 작다", () => {
  const r = rep();
  assert.equal(r.total.reported, 460 + 235 + 118 + 133);
  assert.equal(r.total.conv, 148 + 61 + 22 + 133);
  assert.equal(r.total.gap, 946 - 364);
});

test("기준에 장바구니를 넣으면 자료가 없는 채널은 경고가 붙는다", () => {
  const r = rep(["purchase", "cart"]);
  assert.equal(r.rows.find((x) => x.id === "search").conv, 460);
  assert.equal(r.rows.find((x) => x.id === "shop").conv, 133);
  assert.deepEqual(r.rows.find((x) => x.id === "shop").missing, ["cart"]);
  assert.equal(r.warnings.length, 3); // SNS · 동영상 · 쇼핑은 장바구니 자료가 없다
});

test("기준표: 채널만 세는 사건은 extra, 기준에만 있는 사건은 missing", () => {
  const t = L.standardTable(["purchase", "signup"]);
  const search = t.find((x) => x.id === "search").cells;
  assert.equal(search.find((c) => c.event === "cart").state, "extra");
  assert.equal(search.find((c) => c.event === "signup").state, "missing");
  assert.equal(search.find((c) => c.event === "purchase").state, "both");
});

test("CPA·ROAS·증감률 계산", () => {
  const r = rep();
  const shop = r.rows.find((x) => x.id === "shop");
  assert.equal(Math.round(shop.cpa), Math.round(1640000 / 133));
  assert.equal(L.pct1(shop.roas), "519.0");
  assert.equal(L.pct1(L.change(110, 100)), "10.0");
  assert.ok(Number.isNaN(L.change(5, 0)));
});

test("가장 싼 CPA 채널과 가장 비싼 CPA 채널을 찾는다", () => {
  const r = rep();
  assert.equal(r.bestCpa.id, "shop");
  assert.equal(r.worstCpa.id, "video");
});

test("원본 검사: 빈 칸·음수·클릭>노출을 잡는다", () => {
  assert.deepEqual(L.validateRow(S.cur.search, CH.search), []);
  assert.ok(L.validateRow({ ...S.cur.search, cart: NaN }, CH.search)[0].includes("장바구니"));
  assert.ok(L.validateRow({ ...S.cur.search, cost: -1 }, CH.search)[0].includes("0보다"));
  assert.ok(L.validateRow({ ...S.cur.search, click: 999999 }, CH.search).some((m) => m.includes("노출보다")));
  const r = rep(L.DEFAULT_STD, { ...S.cur, video: { ...S.cur.video, purchase: 5000 } });
  assert.equal(r.errors[0].channel, "보다 동영상광고");
});

test("규칙 요약: 3문장 + 할 일, 숫자는 모두 리포트 안의 숫자", () => {
  const r = rep();
  const s = L.ruleSummary(r);
  assert.equal(s.lines.length, 3);
  assert.ok(s.lines[2].includes("946") && s.lines[2].includes("364"));
  [...s.lines, s.action].forEach((l) => assert.deepEqual(L.unknownNumbers(l, r), [], l));
});

test("숫자 뽑기: 쉼표·소수·단위", () => {
  assert.deepEqual(L.numbersIn("광고비 738만 원, 전환 1,284건, 12.5% 늘었다"), [738, 1284, 12.5]);
});

test("AI 응답 검사: 형식이 틀리거나 없는 숫자를 지어내면 버린다", () => {
  const r = rep();
  const ok = { lines: ["기준 전환은 364건입니다.", "쇼핑픽 쇼핑광고의 ROAS가 519.0%로 가장 높습니다."], action: "보다 동영상광고 소재를 점검합니다." };
  assert.deepEqual(L.normalizeSummary(ok, r).lines.length, 2);
  assert.equal(L.normalizeSummary({ lines: "요약" }, r), null);
  assert.equal(L.normalizeSummary({ lines: ["전환 364건", "좋음"] }, r), null); // action 없음
  assert.equal(L.normalizeSummary({ ...ok, lines: ["기준 전환은 1,500건으로 크게 늘었습니다.", "좋습니다."] }, r), null);
});

test("메일 본문과 CSV에 기준과 합계가 들어간다", () => {
  const r = rep();
  const mail = L.toMailText(r, L.ruleSummary(r));
  assert.ok(mail.includes("기준: 구매"));
  assert.ok(mail.includes("쇼핑픽 쇼핑광고 |"));
  const csv = L.toCsv(r);
  assert.ok(csv.startsWith("﻿채널,"));
  assert.ok(csv.includes("합계,") && csv.includes(",946,364,"));
});

test("발행 기록: 같은 주는 두 번 발행하지 않고, 연속 주 수를 센다", () => {
  assert.equal(L.streak(S.log), 7);
  const a = L.publish(S.log, { date: "2026-10-26", week: "W44" });
  assert.equal(a.added, true);
  assert.equal(L.streak(a.log), 8);
  const b = L.publish(a.log, { date: "2026-10-26", week: "W44" });
  assert.equal(b.added, false);
  assert.equal(b.log.length, 8);
  assert.equal(L.streak([{ date: "2026-10-26" }, { date: "2026-10-12" }]), 1);
});

test("AI 입력에는 리포트 숫자만 들어간다", () => {
  const i = L.aiInput(rep());
  assert.equal(i.channels.length, 4);
  assert.equal(i.total.conv, 364);
  assert.deepEqual(i.standard, ["구매"]);
});
