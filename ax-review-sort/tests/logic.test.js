// 고객말 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const S = L.sample();
const byId = Object.fromEntries(S.map((r) => [r.id, r]));
const rv = (rating, text, product = "스텐 텀블러 500ml") => ({ id: "x", rating, product, text });

test("분명한 칭찬은 긍정, 분명한 불만은 부정 + 개선 요청", () => {
  const a = L.classifyRule(byId.r1);
  assert.equal(a.sentiment, "긍정"); assert.equal(a.needsHuman, false);
  const b = L.classifyRule(byId.r2);
  assert.equal(b.sentiment, "부정"); assert.equal(b.category, "품질·불량");
  assert.equal(b.request, true); assert.ok(b.requestText.includes("바꿔 주세요"));
});

test("반어적 칭찬은 긍정으로 세지 않고 '사람 확인'으로 보낸다", () => {
  const c = L.classifyRule(byId.r20); // "배송 진짜 빠르네요^^ 열흘 만에 왔어요" (별점 5)
  assert.notEqual(c.sentiment, "긍정");
  assert.equal(c.needsHuman, true);
  assert.ok(c.flags.includes("반어 의심"));
  const d = L.classifyRule(byId.r10); // "포장 하나는 기가 막히네요. 도마는 갈라져 왔지만요" (별점 4)
  assert.equal(d.needsHuman, true);
  assert.ok(d.flags.includes("별점·글 어긋남"));
});

test("안전 관련 말이 있으면 확신도와 상관없이 사람에게 넘긴다", () => {
  const c = L.classifyRule(byId.r21);
  assert.equal(c.safety, true); assert.equal(c.needsHuman, true);
  assert.equal(L.classifyRule(rv(1, "아이 손가락이 베였어요")).safety, true);
});

test("너무 짧은 리뷰는 확신도가 낮아 사람 확인", () => {
  const c = L.classifyRule(byId.r24);
  assert.ok(c.confidence < L.HUMAN_CONF); assert.equal(c.needsHuman, true);
});

test("주제 분류: 배송·설명·사이즈", () => {
  assert.equal(L.categoryOf("배송이 일주일 만에 왔어요"), "배송");
  assert.equal(L.categoryOf("조립 설명서가 없어요"), "설명·조립");
  assert.equal(L.categoryOf("생각보다 크기가 작아요"), "사이즈·규격");
});

test("개인정보 가리기: 전화번호·이메일·주문번호, 이름은 가운데를 가린다", () => {
  assert.equal(L.maskPII("010-2345-6789로 연락 주세요"), "[전화번호]로 연락 주세요");
  assert.equal(L.maskPII("a.b@mail.co.kr 로"), "[이메일] 로");
  assert.equal(L.maskPII("주문번호 20261027123"), "주문번호 [가림]");
  assert.equal(L.maskName("김서연"), "김*연");
  assert.equal(L.maskName("박준"), "박*");
});

test("AI 입력에는 작성자 이름이 없고 본문의 연락처는 가려진다", () => {
  const i = L.aiInput(S);
  const r4 = i.reviews.find((x) => x.id === "r4");
  assert.equal("author" in r4, false);
  assert.ok(!/010-/.test(JSON.stringify(i)));
});

test("AI 응답 검사: 없는 id·틀린 값은 버리고, 절반 넘게 틀리면 전부 버린다", () => {
  const two = [byId.r1, byId.r2];
  const ok = L.normalizeAi({ items: [{ id: "r1", sentiment: "긍정", category: "기타", request: "", confidence: 0.9, reason: "" }, { id: "r2", sentiment: "부정", category: "품질·불량", request: "패킹 두껍게", confidence: 0.95, reason: "" }] }, two);
  assert.equal(Object.keys(ok).length, 2);
  assert.equal(ok.r2.request, true);
  assert.equal(L.normalizeAi({ items: [{ id: "r9", sentiment: "좋음", category: "?", confidence: 3 }] }, two), null);
  assert.equal(L.normalizeAi({ items: "없음" }, two), null);
});

test("AI가 확신해도 규칙이 잡은 반어 신호는 지워지지 않는다", () => {
  const rule = L.classifyRule(byId.r20);
  const m = L.mergeAi(rule, { sentiment: "긍정", category: "배송", request: false, requestText: "", confidence: 0.95, reason: "빠르다고 함" });
  assert.equal(m.needsHuman, true);
  const low = L.mergeAi(L.classifyRule(byId.r1), { sentiment: "긍정", category: "기타", request: false, requestText: "", confidence: 0.4, reason: "" });
  assert.equal(low.needsHuman, true); assert.ok(low.flags.includes("AI 확신 낮음"));
});

test("사람이 정하면 확인 칸에서 빠지고 집계에 들어간다", () => {
  const before = L.stats(L.finalize(S, {}, {}));
  const after = L.stats(L.finalize(S, {}, { r20: { sentiment: "부정" } }));
  assert.equal(after.human, before.human - 1);
  assert.equal(after.requests, before.requests + 1);
});

test("개선 요청 상위 5개: 상품·주제로 묶고, 사람 확인 대기는 빼고, 많은 순", () => {
  const top = L.topRequests(L.finalize(S, {}, {}));
  assert.equal(top.length, 5);
  assert.deepEqual([top[0].product, top[0].category, top[0].count], ["스텐 텀블러 500ml", "품질·불량", 3]);
  assert.ok(top.every((t, i) => i === 0 || top[i - 1].count >= t.count));
  assert.ok(!top.some((t) => t.ids.includes("r21"))); // 안전 관련(사람 확인)은 자동 집계에 없음
});

test("상품팀 전달 글에는 작성자 이름과 연락처가 없다", () => {
  const items = L.finalize(S, {}, {});
  const txt = L.toHandoff(L.topRequests(items), L.stats(items), "10월");
  assert.ok(txt.includes("상위 5개"));
  S.forEach((r) => assert.ok(!txt.includes(r.author), r.author));
  assert.ok(!/010-/.test(txt));
  assert.ok(txt.includes("안전 관련 리뷰 2건"));
});

test("리뷰 붙여넣기: '별점 | 상품 | 내용', 틀린 줄은 이유와 함께", () => {
  const r = L.parsePasted("2 | 텀블러 | 뚜껑이 새요\n7 | 도마 | 별점 틀림\n아무 말", L.PRODUCTS, 100);
  assert.equal(r.reviews.length, 1);
  assert.equal(r.reviews[0].product, "스텐 텀블러 500ml");
  assert.equal(r.reviews[0].id, "n100");
  assert.equal(r.errors.length, 2);
});
