// 첫그림 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const SCOPE = ["demo", "wall", "floor", "light", "bath", "kitchen"];

test("평 → ㎡ 변환과 함께 표시", () => {
  assert.equal(L.toM2(34, "평"), 112.4);
  assert.equal(L.toM2(112.4, "㎡"), 112.4);
  assert.equal(L.toPy(112.4), 34);
  assert.equal(L.areaLabel(L.toM2(34, "평")), "112.4㎡ (34.0평)");
  assert.equal(L.toM2("", "평"), 0);
  assert.equal(L.toM2(-3, "㎡"), 0);
});

test("같은 집을 평으로 넣든 ㎡로 넣든 견적은 같다 (두 배 계산 회귀 방지)", () => {
  const a = L.buildQuote({ m2: L.toM2(34, "평"), space: "apt", scope: SCOPE, grade: "mid" });
  const b = L.buildQuote({ m2: L.toM2(112.4, "㎡"), space: "apt", scope: SCOPE, grade: "mid" });
  assert.equal(a.total, b.total);
  // 평 숫자를 ㎡로 착각해 한 번 더 곱하면 바닥 금액이 3.3배가 된다 — 그런 값이 아니어야 한다
  const floor = a.lines.find((l) => l.id === "floor");
  assert.equal(floor.qty, 112.4);
  assert.equal(floor.unit, "㎡");
});

test("글 속 면적 읽기: 평 · ㎡ · m2 · 제곱미터", () => {
  const r = L.parseAreas("거실 포함 34평, 방은 9.9㎡, 베란다 6 m2, 창고 3 제곱미터");
  assert.deepEqual(r.map((x) => [x.value, x.unit]), [[34, "평"], [9.9, "㎡"], [6, "㎡"], [3, "㎡"]]);
  assert.equal(r[0].m2, 112.4);
});

test("단위를 잘못 고른 것 같으면 다른 단위를 제안한다", () => {
  const w = L.checkArea(34, "㎡", "apt", "");
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].suggest, { value: 34, unit: "평" });
  assert.deepEqual(L.checkArea(34, "평", "apt", ""), []);
  const big = L.checkArea(112, "평", "apt", "");
  assert.deepEqual(big[0].suggest, { value: 112, unit: "㎡" });
});

test("메모의 면적과 입력이 15% 넘게 다르면 알린다", () => {
  const w = L.checkArea(25, "평", "apt", "고객 말로는 34평 아파트");
  assert.equal(w.length, 1);
  assert.match(w[0].msg, /34평/);
  assert.deepEqual(L.checkArea(34, "평", "apt", "34평 아파트"), []);
  assert.equal(L.checkArea("", "평", "apt", "")[0].level, "err");
});

test("견적: 도배는 바닥 × 2.6 추정, 욕실은 85㎡ 이상 아파트면 2식", () => {
  const q = L.buildQuote({ m2: 112.4, space: "apt", scope: ["wall", "bath"], grade: "basic" });
  const wall = q.lines.find((l) => l.id === "wall");
  assert.equal(wall.qty, 292.2);
  assert.equal(wall.est, true);
  assert.equal(q.lines.find((l) => l.id === "bath").qty, 2);
  assert.equal(L.buildQuote({ m2: 59, space: "apt", scope: ["bath"], grade: "basic" }).lines[0].qty, 1);
});

test("견적 합계: 관리비 8% + 부가세 10%, 만 원 단위, ±10% 범위", () => {
  const q = L.buildQuote({ m2: 100, space: "villa", scope: ["floor"], grade: "mid" });
  assert.equal(q.subtotal, 6200000);
  assert.equal(q.overhead, 496000);
  assert.equal(q.vat, 670000);
  assert.equal(q.total, 7370000);
  assert.ok(q.low < q.total && q.high > q.total);
  assert.equal(L.buildQuote({ m2: 100, space: "villa", scope: ["floor"], grade: "없는등급" }).grade, "mid");
});

test("등급이 오르면 금액도 오른다, 범위가 비면 0원", () => {
  const t = (g) => L.buildQuote({ m2: 80, space: "apt", scope: SCOPE, grade: g }).total;
  assert.ok(t("basic") < t("mid") && t("mid") < t("high"));
  assert.equal(L.buildQuote({ m2: 80, space: "apt", scope: [], grade: "mid" }).total, 0);
});

test("메모로 스타일 고르기 (규칙)", () => {
  assert.equal(L.pickStyle("원목 느낌 좋아하고 아늑하게").style.id, "warm");
  assert.equal(L.pickStyle("모던하고 차분하게, 그레이 톤").style.id, "gray");
  assert.equal(L.pickStyle("식물 많이 두는 카페").style.id, "green");
  assert.equal(L.pickStyle("").style.id, "warm");
  // 부정 구절: "하얀 건 차가워 보여서 싫다고" → 화이트가 아니다
  const p = L.pickStyle("거실이 넓어 보였으면 좋겠고 원목 느낌 좋아하심. 너무 하얀 건 차가워 보여서 싫다고.");
  assert.equal(p.style.id, "warm");
  assert.deepEqual(p.hits, ["원목"]);
});

test("개인정보: AI로 보내기 전 연락처·메일 지우기, 이름 가리기", () => {
  assert.equal(L.scrub("연락 010-1234-5678, a.b@test.kr 로"), "연락 [연락처], [메일] 로");
  assert.equal(L.maskName("한서윤"), "한*윤");
  assert.equal(L.maskName("오민"), "오*");
  assert.equal(L.maskName("남궁민수"), "남**수");
  assert.equal(L.maskName(""), "고객");
});

test("AI 응답 검사: 정상 응답은 통과, 색 코드는 대문자로", () => {
  const n = L.normalizeBrief({ style: "따뜻한 우드", keywords: ["원목", "간접 조명"], palette: [{ role: "벽", name: "오트밀", hex: "#efe6d8", material: "paint" }, { role: "바닥", name: "오크", hex: "#B98A5E", material: "wood" }, { role: "포인트", name: "테라코타", hex: "#C0603F", material: "모름" }], message: "말씀하신 원목 느낌을 살렸어요." });
  assert.equal(n.styleId, "warm");
  assert.equal(n.palette[0].hex, "#EFE6D8");
  assert.equal(n.palette[2].material, "paint");
});

test("AI 응답 검사: 없는 스타일·색 부족·금액 문장은 버린다", () => {
  const pal = [{ role: "벽", name: "a", hex: "#FFFFFF" }, { role: "바닥", name: "b", hex: "#000000" }, { role: "c", name: "c", hex: "#123456" }];
  assert.equal(L.normalizeBrief({ style: "북유럽", palette: pal, message: "좋아요" }), null);
  assert.equal(L.normalizeBrief({ style: "warm", palette: pal.slice(0, 2), message: "좋아요" }), null);
  assert.equal(L.normalizeBrief({ style: "warm", palette: [...pal.slice(0, 2), { hex: "red" }], message: "좋아요" }), null);
  assert.equal(L.normalizeBrief({ style: "warm", palette: pal, message: "약 3,500만 원이면 됩니다" }), null);
  assert.equal(L.normalizeBrief(null), null);
});

test("고객 회신: 가린 이름, ㎡·평 함께, 금액은 견적표 값", () => {
  const scope = ["wall", "floor"];
  const q = L.buildQuote({ m2: L.toM2(34, "평"), space: "apt", scope, grade: "mid" });
  const txt = L.replyText({ name: "한서윤", brief: L.ruleBrief("원목"), quote: q, scope, space: "apt" });
  assert.match(txt, /^한\*윤 고객님/);
  assert.ok(!txt.includes("한서윤"));
  assert.match(txt, /112\.4㎡ \(34\.0평\)/);
  assert.ok(txt.includes(L.manwon(q.total)));
});
