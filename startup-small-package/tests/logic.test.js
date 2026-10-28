// 작은집 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const P = L.SAMPLE_PRICES;
const NOW = "2026-10-28";
const LAST = "2025-12-31"; // 작년 기준으로 계산하던 시점
const pkg = (id) => L.PACKAGES.find((p) => p.id === id);

test("단가 고르기: 기준일 이전 가장 최신", () => {
  assert.equal(L.pickPrice(P, "wall", NOW).price, 8500);
  assert.equal(L.pickPrice(P, "wall", LAST).price, 7600);
  assert.equal(L.pickPrice(P, "wall", "2025-01-01"), null);
  assert.equal(L.latestDate(P, "labor"), "2026-09-01");
});

test("오래된 단가 찾기 (작년 단가로 계산하던 버그 회귀 방지)", () => {
  const items = L.itemsOf(pkg("one"));
  assert.equal(L.staleItems(P, items, LAST, NOW, 365).length, items.length);
  assert.deepEqual(L.staleItems(P, items, NOW, NOW, 365), []);
  const s = L.staleItems(P, ["wall"], NOW, "2028-01-01", 365);
  assert.match(s[0].reason, /365일/);
  assert.equal(L.staleItems([], ["wall"], NOW, NOW)[0].reason, "단가 없음");
});

test("수량: 도배는 바닥 × 2.6, 장판은 바닥, 나머지는 개수", () => {
  assert.equal(L.qtyOf("wall", 20), 52);
  assert.equal(L.qtyOf("floor", 20), 20);
  assert.equal(L.qtyOf(4, 20), 4);
});

test("원룸 기본 계산: 자재 + 인건비 + 관리비 10%", () => {
  const c = L.calcPackage(pkg("one"), P, NOW, 0.1);
  assert.equal(c.material, 1694000);
  assert.equal(c.labor, 1400000);
  assert.equal(c.overhead, 309400);
  assert.equal(c.cost, 3403400);
  assert.equal(c.profit, 896600);
  assert.equal(L.pct(c.margin), "20.9%");
});

test("작년 단가면 마진이 실제보다 높게 보인다", () => {
  const old = L.calcPackage(pkg("one"), P, LAST, 0.1);
  const now = L.calcPackage(pkg("one"), P, NOW, 0.1);
  assert.equal(L.pct(old.margin), "30.1%");
  assert.ok(now.margin < old.margin);
  assert.ok(old.lines.every((l) => l.asOf === "2025-09-01"));
  assert.ok(now.lines.every((l) => l.asOf === "2026-09-01"));
});

test("목표 마진 판정과 최소 판매가 (10만 원 올림)", () => {
  const two = L.calcPackage(pkg("two"), P, NOW, 0.1);
  assert.equal(two.cost, 5676000);
  assert.equal(L.status(two, 0.2), "low");
  assert.equal(L.minPrice(two.cost, 0.2), 7100000);
  const fixed = L.calcPackage({ ...pkg("two"), price: 7100000 }, P, NOW, 0.1);
  assert.equal(L.status(fixed, 0.2), "ok");
  assert.equal(L.status(L.calcPackage({ ...pkg("two"), price: 5000000 }, P, NOW, 0.1), 0.2), "loss");
});

test("단가를 고치면 결과가 바뀐다", () => {
  const edited = P.concat({ item: "floor", price: 30000, asOf: "2026-10-01" });
  const a = L.calcPackage(pkg("one"), P, NOW, 0.1);
  const b = L.calcPackage(pkg("one"), edited, NOW, 0.1);
  assert.equal(b.material - a.material, 120000);
  assert.equal(L.staleItems(edited, ["floor"], "2026-09-30", NOW).length, 1);
});

test("CSV: 머리글, 쉼표 감싸기, 샘플 단가 표시", () => {
  const calcs = L.PACKAGES.map((p) => L.calcPackage(p, P, NOW, 0.1));
  const csv = L.toCsv(L.PACKAGES, calcs, NOW);
  const lines = csv.replace("﻿", "").split("\r\n");
  assert.match(lines[0], /^패키지,기준 면적/);
  assert.equal(lines.length, 6);
  assert.match(csv, /가상의 샘플 단가/);
  assert.equal(L.toCsv([{ ...L.PACKAGES[0], name: "원룸, 기본" }], [calcs[0]], NOW).split("\r\n")[1].slice(0, 8), '"원룸, 기본"');
});

test("규칙 소개 문구: 구성 이름과 ㎡·평", () => {
  const r = L.rulePitch(pkg("plus"));
  assert.ok(r.includes.includes("욕실 부분 교체"));
  assert.match(r.tagline, /20㎡\(6\.1평\)/);
  assert.equal(r.faq.length, 2);
});

test("AI 소개 문구 검사: 구성에 없는 항목은 빼고, 다 빠지면 null", () => {
  const n = L.normalizePitch({ name: "원룸 기본", tagline: "도배·장판을 한 번에", includes: ["도배", "샷시 교체"], excludes: ["가구"], faq: [{ q: "기간은?", a: "실측 후 안내해요." }] }, pkg("one"));
  assert.deepEqual(n.includes, ["도배"]);
  assert.equal(n.faq.length, 1);
  assert.equal(L.normalizePitch({ tagline: "x", includes: ["샷시"] }, pkg("one")), null);
  assert.equal(L.normalizePitch(null, pkg("one")), null);
});

test("AI 소개 문구 검사: 금액·과장 문구는 버린다", () => {
  const base = { tagline: "도배·장판을 한 번에", includes: ["도배"], excludes: [], faq: [] };
  assert.ok(L.normalizePitch(base, pkg("one")));
  assert.equal(L.normalizePitch({ ...base, tagline: "단돈 430만 원에 끝" }, pkg("one")), null);
  assert.equal(L.normalizePitch({ ...base, tagline: "업계 최저가 원룸 패키지" }, pkg("one")), null);
  assert.equal(L.normalizePitch({ ...base, faq: [{ q: "보증?", a: "100% 만족 보장" }] }, pkg("one")), null);
});

test("소개 문구 텍스트: 가격은 계산값, 부가세 별도", () => {
  const c = L.calcPackage(pkg("one"), P, NOW, 0.1);
  const t = L.pitchText(L.rulePitch(pkg("one")), pkg("one"), c);
  assert.match(t, /가격: 430만 원 \(부가세 별도, 20㎡ 기준\)/);
});
