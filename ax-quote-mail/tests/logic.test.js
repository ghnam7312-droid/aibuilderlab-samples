// 견적함 로직 테스트 — node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const QM = require("../logic.js");

const MON = new Date("2026-10-19T09:00:00+09:00"); // 샘플 기준일 (월)

test("제목에 '견적'이 있으면 견적 요청으로 분류한다", () => {
  const c = QM.classify({ subj: "A4 용지 견적 요청드립니다", body: "A4 용지 50박스 견적 부탁드립니다." });
  assert.equal(c.cat, "quote");
  assert.equal(c.need, false);
});

test("제목 단어는 2점, 본문 단어는 1점이다", () => {
  const c = QM.classify({ subj: "단가 문의", body: "단가가 궁금합니다" });
  assert.equal(c.score.quote, 2); // 단가(제목)
  assert.equal(c.score.ask, 3);   // 문의(제목 2) + 궁금(본문 1)
});

test("1·2등 점수 차이가 1점 이하면 사람에게 넘긴다(확인 필요)", () => {
  const c = QM.classify({ subj: "27인치 모니터 단가 문의", body: "27인치 모니터 12대 단가가 얼마인지 궁금합니다." });
  assert.equal(c.need, true);
  assert.deepEqual([c.cat, c.alt].sort(), ["ask", "quote"]);
});

test("끝인사 '감사합니다.' 줄은 점수에 넣지 않는다 (3주차 버그 수정)", () => {
  const c = QM.classify({ subj: "발주서 송부", body: "토너 30개 발주서 첨부합니다.\n\n감사합니다." });
  assert.equal(c.score.etc, 0);
  assert.equal(c.cat, "order");
});

test("맞는 단어가 하나도 없으면 기타, 확신은 낮게", () => {
  const c = QM.classify({ subj: "안녕하세요", body: "잘 지내시죠" });
  assert.equal(c.cat, "etc");
  assert.ok(c.confidence < 0.5);
});

test("'주문 확정'은 발주·주문으로 간다 (키워드 추가 후)", () => {
  const c = QM.classify({ subj: "주문 확정 · 프린터 토너 40개", body: "견적대로 주문 확정합니다." });
  assert.equal(c.cat, "order");
});

test("수량 앞의 긴 품목 이름을 고른다: '사무용 의자 8개'", () => {
  const ex = QM.extract({ subj: "", body: "사무용 의자 8개 견적서 보내 주세요." });
  assert.equal(ex.items, "사무용 의자 8개");
});

test("품목 여러 개와 날짜 납기를 뽑는다", () => {
  const ex = QM.extract({ subj: "모니터 30대 + 키보드 30개 견적", body: "모니터 27형 30대, 무선 키보드 30개 견적 부탁드립니다.\n11월 15일까지 회신 주세요." });
  assert.equal(ex.items, "모니터 27형 30대, 무선 키보드 30개");
  assert.equal(ex.due, "11월 15일");
});

test("같은 품목이 제목·본문에 겹쳐도 한 번만 넣는다", () => {
  const ex = QM.extract({ subj: "x", body: "A4 용지 50박스요. 다시 말씀드리면 A4 용지 50박스입니다." });
  assert.equal(ex.items, "A4 용지 50박스");
});

test("납기 D-day: 날짜·이달 말·이번 주 금요일·다음 주 화요일", () => {
  assert.equal(QM.daysLeft("11월 5일", MON), 17);
  assert.equal(QM.daysLeft("이달 말", MON), 12);
  assert.equal(QM.daysLeft("이번 주 금요일", MON), 4);
  assert.equal(QM.daysLeft("다음 주 화요일", MON), 8);
  assert.equal(QM.daysLeft("2026-10-21", MON), 2);
  assert.equal(QM.daysLeft("", MON), null);
});

test("Claude 응답을 받아들인다: 확신 0.6 미만이면 확인 필요", () => {
  const a = QM.fromAi({ category: "견적 요청", confidence: 0.92, reason: "단가 요청", items: [{ name: "A4 용지", qty: 50, due: "2026-11-05" }] });
  assert.equal(a.cat, "quote");
  assert.equal(a.need, false);
  assert.equal(QM.itemsText(a.items), "A4 용지 50개");
  const b = QM.fromAi({ category: "문의", confidence: 0.55, reason: "애매", items: [] });
  assert.equal(b.need, true);
});

test("Claude 응답 모양이 틀리면 버리고 규칙을 쓴다", () => {
  assert.equal(QM.fromAi(null), null);
  assert.equal(QM.fromAi({ category: "스팸" }), null);
  assert.equal(QM.fromAi({ category: "확인 필요" }), null);
  const c = QM.fromAi({ category: "기타", confidence: "많이", items: "없음" });
  assert.equal(c.confidence, 0.5);
  assert.deepEqual(c.items, []);
});

test("회신 초안: 품목·납기를 다시 확인하고, 단가는 지어내지 않는다", () => {
  const r = QM.replyDraft({ subj: "A4 용지 견적 요청드립니다", person: "김수정 과장", body: "A4 용지 50박스 견적 부탁드립니다. 11월 5일까지 납품 가능한지요." });
  assert.equal(r.subject, "RE: A4 용지 견적 요청드립니다");
  assert.match(r.body, /김수정 과장님/);
  assert.match(r.body, /A4 용지 50박스/);
  assert.match(r.body, /11월 5일/);
  assert.doesNotMatch(r.body, /\d{1,3}(,\d{3})+원/);
});

test("CSV: BOM, 큰따옴표·쉼표·줄바꿈이 있어도 칸이 밀리지 않는다", () => {
  const csv = QM.toCsv([["거래처", "메모"], ["한빛, 상사", '말한 "급함"\n확인']]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.slice(1).split("\r\n")[1], '"한빛, 상사","말한 ""급함""\n확인"');
});
