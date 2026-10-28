// 열두칸 로직 테스트 — 실행: node --test (또는 npm test)
// 인터뷰 수치·가격은 가상의 목표 모델 샘플 값이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const ALL = L.ITEMS.map((it) => it.id);

test("후보 항목은 8개 영역 × 5개 = 40개, id가 겹치지 않는다", () => {
  assert.equal(L.ITEMS.length, 40);
  assert.equal(new Set(ALL).size, 40);
  L.CATS.forEach((c) => assert.equal(L.ITEMS.filter((it) => it.cat === c).length, 5));
});

test("점수: 인터뷰 언급·상담 빈도가 높고 바로 답할 수 있으면 높다", () => {
  const contract = L.ITEMS.find((it) => it.pro === "근로계약서 서면 작성·교부");
  const roster = L.ITEMS.find((it) => it.pro === "근로자 명부 작성·보관");
  assert.equal(L.score(contract), 8 * 2 + 3 * 3 + 2 - 2);
  assert.ok(L.score(contract) > L.score(roster));
});

test("핵심 추천: 정확히 12개, 한 영역에서 2개 이하", () => {
  const r = L.recommend(L.ITEMS);
  assert.equal(r.length, 12);
  const per = {};
  r.forEach((id) => { const c = L.ITEMS.find((it) => it.id === id).cat; per[c] = (per[c] || 0) + 1; });
  assert.ok(Object.values(per).every((n) => n <= 2));
  assert.ok(r.includes("i01"), "근로계약서는 꼭 들어간다");
});

test("영역 제한 때문에 모자라면 남은 점수 순으로 채운다", () => {
  const two = L.ITEMS.filter((it) => it.cat === "임금" || it.cat === "안전");
  assert.equal(L.recommend(two, 6, 2).length, 6);
});

test("끝까지 답한 사장님(추정): 12개 8명, 20개 4명, 40개 0명, 사이는 직선", () => {
  assert.equal(L.completion(12), 8);
  assert.equal(L.completion(20), 4);
  assert.equal(L.completion(40), 0);
  assert.equal(L.completion(16), 6);
  assert.equal(L.completion(30), 2);
});

test("40개 전부(처음 버전)는 막히고, 추천 12개는 통과", () => {
  const all = L.checkSet(ALL, L.ITEMS);
  assert.equal(all.ok, false);
  assert.ok(all.issues.some((x) => x.level === "error" && /40개예요/.test(x.msg)));
  assert.equal(all.done, 0);
  const core = L.checkSet(L.recommend(L.ITEMS), L.ITEMS);
  assert.equal(core.ok, true);
  assert.ok(core.minutes <= 15);
  assert.ok(core.hard <= 3);
});

test("13개면 12개를 넘었다고 막는다, 빈 묶음도 막는다", () => {
  const r = L.recommend(L.ITEMS);
  const extra = ALL.find((id) => !r.includes(id));
  assert.equal(L.checkSet(r.concat(extra), L.ITEMS).ok, false);
  assert.equal(L.checkSet([], L.ITEMS).ok, false);
});

test("서류를 찾아봐야 하는 항목이 많으면 주의", () => {
  const hard = L.ITEMS.filter((it) => !it.easy).slice(0, 5).map((it) => it.id);
  assert.ok(L.checkSet(hard, L.ITEMS).issues.some((x) => x.level === "warn" && /서류/.test(x.msg)));
});

test("사장님 답: '아니오'와 '모름'만 상담에서 확인할 항목이 된다 (위반 판정 없음)", () => {
  const ids = ["i01", "i02", "i08"];
  const r = L.toConsult(ids, { i01: "yes", i02: "no", i08: "unk" }, L.ITEMS);
  assert.deepEqual(r.list.map((x) => x.id), ["i02", "i08"]);
  assert.equal(r.answered, 3);
  assert.ok(r.list.every((x) => !/위반/.test(x.plain)));
});

test("가격 실험: 계약이 있으면 계약 수, 없으면 '쓰겠다'의 1/3로 가정", () => {
  const [t1, t2, t3] = L.TIERS;
  assert.deepEqual(L.revenue(t2), { n: 3, sum: 270000, assumed: false });
  assert.deepEqual(L.revenue(t1), { n: 2, sum: 80000, assumed: true });
  assert.equal(L.revenue(t3).sum, 0);
});

test("AI 응답 검사: 모르는 id·너무 긴 말·질문이 아닌 말·판단 표현은 버린다", () => {
  const n = L.normalizePlain({ items: [
    { id: "i01", plain: "직원마다 계약서를 써서 한 장씩 줬나요?" },
    { id: "i02", plain: "계약서를 다시 안 쓰면 위반이에요?" },
    { id: "i08", plain: "주휴수당을 줍니다." },
    { id: "i99", plain: "모르는 항목인가요?" },
    { id: "i09", plain: "가".repeat(70) + "나요?" },
  ] }, ["i01", "i02", "i08", "i09"]);
  assert.deepEqual(n.plain, { i01: "직원마다 계약서를 써서 한 장씩 줬나요?" });
  assert.equal(n.rejected, 3);
});

test("AI 응답 형식이 틀리거나 쓸 것이 없으면 null", () => {
  assert.equal(L.normalizePlain(null, ["i01"]), null);
  assert.equal(L.normalizePlain({ items: "문자열" }, ["i01"]), null);
  assert.equal(L.normalizePlain({ items: [{ id: "i01", plain: "과태료 대상입니다" }] }, ["i01"]), null);
});

test("상품 기획안: 항목 수·소요·근거·가격, 다듬은 질문 우선", () => {
  const ids = L.recommend(L.ITEMS);
  const md = L.planMd(ids, L.ITEMS, L.TIERS[1], { i01: "계약서 한 장씩 줬나요?" });
  assert.match(md, /핵심 12개/);
  assert.match(md, /사장님 9명 인터뷰/);
  assert.match(md, /월 90,000원/);
  assert.match(md, /1\. \[계약·서류\] 계약서 한 장씩 줬나요\?/);
  assert.match(md, /위반 판정이 아니라/);
});
