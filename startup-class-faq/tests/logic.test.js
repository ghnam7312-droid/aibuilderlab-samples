// 답해둠 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-20";
const FAQ = L.SAMPLE_FAQ;
const order = (o) => ({ paidAt: L.addDays(TODAY, -3), endsAt: L.addDays(TODAY, 87), price: 99000, total: 24, watched: 1, kitShipped: false, kitReturned: false, ...o });

test("분류: 재료 · 수강 기간 · 영상 · 기타", () => {
  assert.equal(L.classify("물감은 따로 사야 하나요?").cat, "material");
  assert.equal(L.classify("수강 기간 연장 되나요").cat, "period");
  assert.equal(L.classify("영상이 재생이 안 돼요").cat, "video");
  assert.equal(L.classify("작품 전시도 하나요?").cat, "etc");
});

test("분류: 돈이 걸린 말이 하나라도 있으면 다른 말보다 먼저 환불", () => {
  assert.equal(L.classify("키트 받았는데 환불 되나요? 영상도 봤어요").cat, "refund");
  assert.equal(L.classify("수강 기간 중에 취소하면요?").cat, "refund");
});

test("분쟁·신고·규정 밖 사정은 사람에게 넘긴다", () => {
  assert.deepEqual(L.needsHuman("소비자원에 신고할게요").words, ["소비자원", "신고"]);
  assert.equal(L.needsHuman("입원하게 됐어요").yes, true);
  assert.equal(L.needsHuman("키트 언제 와요").yes, false);
});

test("환불 1항: 결제 7일 이내 · 2강 이하면 전액", () => {
  const c = L.refundCalc(order({}), TODAY);
  assert.deepEqual([c.amount, c.clauses], [99000, [1]]);
});

test("환불 2·3항: 남은 강의 비율, 1,000원 미만 버림, 키트 발송이면 재료비 빼기", () => {
  const c = L.refundCalc(order({ paidAt: L.addDays(TODAY, -20), watched: 10, kitShipped: true }), TODAY);
  // 99,000 × 14 ÷ 24 = 57,750 → 57,000 → − 25,000
  assert.equal(c.amount, 32000);
  assert.deepEqual(c.clauses, [2, 3]);
  const back = L.refundCalc(order({ paidAt: L.addDays(TODAY, -20), watched: 10, kitShipped: true, kitReturned: true }), TODAY);
  assert.equal(back.amount, 57000);
});

test("환불: 7일 안이라도 3강 넘게 봤으면 1항이 아니라 2항", () => {
  const c = L.refundCalc(order({ watched: 3 }), TODAY);
  assert.deepEqual(c.clauses, [2]);
  assert.equal(c.amount, 86000); // 99,000 × 21 ÷ 24 = 86,625
});

test("환불 4항 · 5항: 기간이 끝났으면 0원, 주문 정보가 없으면 사람에게", () => {
  assert.deepEqual(L.refundCalc(order({ endsAt: L.addDays(TODAY, -1) }), TODAY).clauses, [4]);
  const none = L.refundCalc(null, TODAY);
  assert.equal(none.human, true);
  assert.equal(L.refundReply(none), null);
});

test("환불 답변은 규정 문서의 문장을 그대로 인용한다", () => {
  const c = L.refundCalc(order({ paidAt: L.addDays(TODAY, -20), watched: 10, kitShipped: true }), TODAY);
  const txt = L.refundReply(c);
  assert.ok(txt.includes("32,000원"));
  assert.ok(txt.includes(`규정 2항: ${L.clause(2).text}`));
  assert.ok(txt.includes(`규정 3항: ${L.clause(3).text}`));
});

test("FAQ 찾기: 말이 달라도 두 글자 조각으로 찾고, 환불 FAQ로는 답하지 않는다", () => {
  assert.equal(L.findFaq("키트 언제 와요? 주문한 지 이틀 됐어요", FAQ, "material").faq.id, "F02");
  assert.equal(L.findFaq("영상 다운로드해서 비행기에서 보고 싶어요", FAQ, "video").faq.id, "F06");
  assert.equal(L.findFaq("작품 전시 같은 것도 하나요?", FAQ, "etc"), null);
  assert.equal(L.findFaq("환불", [{ id: "X", cat: "refund", q: "환불", keys: "환불", a: "" }], "refund"), null);
});

test("갈래 정하기: FAQ · 환불 규정 · 사람", () => {
  assert.equal(L.route({ text: "수강 기간이 몇 달인가요?" }, FAQ, TODAY).kind, "faq");
  const r = L.route({ text: "환불하고 싶어요", order: order({}) }, FAQ, TODAY);
  assert.deepEqual([r.kind, r.calc.amount], ["policy", 99000]);
  const h = L.route({ text: "환불 안 해 주면 소비자원에 신고할게요", order: order({}) }, FAQ, TODAY);
  assert.deepEqual([h.kind, h.escalated, h.reply], ["human", true, ""]);
});

test("AI에게는 환불·규정·사람 갈래를 절대 보내지 않는다", () => {
  assert.equal(L.aiAllowed(L.route({ text: "물감 몇 색 필요해요?" }, FAQ, TODAY)), true);
  assert.equal(L.aiAllowed(L.route({ text: "환불하고 싶어요", order: order({}) }, FAQ, TODAY)), false);
  assert.equal(L.aiAllowed(L.route({ text: "환불하고 싶어요" }, FAQ, TODAY)), false);
  assert.equal(L.aiAllowed(L.route({ text: "입원해서 못 들어요" }, FAQ, TODAY)), false);
});

test("Claude 응답 검사: 환불·돈 얘기가 들어가면 버린다 (규정과 다른 답 방지)", () => {
  const ids = FAQ.map((f) => f.id);
  assert.deepEqual(L.normalizeReply({ category: "재료", reply: "기본 키트면 모든 과제를 할 수 있어요.", faqId: "f01" }, ids), { reply: "기본 키트면 모든 과제를 할 수 있어요.", faqId: "F01" });
  assert.equal(L.normalizeReply({ category: "수강 기간", reply: "연장이 어려우면 일부 환불해 드릴게요.", faqId: "F04" }, ids), null);
  assert.equal(L.normalizeReply({ category: "환불", reply: "규정을 확인해 드릴게요, 잠시만요.", faqId: "" }, ids), null);
  assert.equal(L.normalizeReply({ category: "기타", reply: "전시는 따로 없어요. 감사합니다.", faqId: "F99" }, ids), null);
  assert.equal(L.normalizeReply({ reply: "짧음" }, ids), null);
  assert.equal(L.normalizeReply(null, ids), null);
});

test("개인정보 가리기: 이름 · 전화번호 · 이메일", () => {
  assert.equal(L.maskName("윤채원"), "윤○○");
  assert.equal(L.maskName("남궁민수"), "남○○");
  assert.equal(L.maskText("연락은 010-2345-6789나 me@ex.com으로"), "연락은 (전화번호 가림)나 (이메일 가림)으로");
});

test("정리: FAQ별로 세어 많은 순, 시간은 한 건 3분 → 45초", () => {
  const inqs = ["키트 언제 와요", "키트 배송 언제 도착해요", "수강 기간 몇 달이에요"].map((text) => ({ text, route: L.route({ text }, FAQ, TODAY) }));
  const s = L.faqStats(inqs, FAQ);
  assert.deepEqual([s.top[0].id, s.top[0].n], ["F02", 2]);
  assert.equal(s.byCat.material, 2);
  assert.deepEqual(L.timeSaved(20), { before: 60, after: 15 });
  const md = L.faqMarkdown(s);
  assert.ok(md.indexOf("재료 키트는 언제") < md.indexOf("재료는 무엇이"));
  assert.ok(md.includes("## 환불"));
});
