// 본보기 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const Q = "의자를 받은 지 5일 됐는데 색이 생각과 달라서 반품하고 싶어요. 배송비는 얼마인가요?";
const GOOD = "안녕하세요, 솔담리빙 고객지원팀 윤서하입니다. 받으신 의자 색상이 생각과 달라 반품을 문의하셨네요. 기대와 달라 불편하셨을 것 같아 죄송합니다. 반품은 상품을 받으신 날부터 7일 이내에 신청하실 수 있고, 단순 변심이라 왕복 배송비 6,000원이 들어요. 마이페이지 > 주문 내역에서 반품 신청을 눌러 주시면 내일까지 수거 일정을 문자로 보내 드립니다. 더 궁금하신 점은 이 채팅으로 말씀해 주세요. 감사합니다.";
const WEAK = "반품은 받으신 날부터 14일 안에 하시면 되고 배송비는 3,000원입니다. 회수 접수 무료로 처리해 드릴게요.";

test("체크리스트는 10항목", () => {
  assert.equal(L.ITEMS.length, 10);
  assert.equal(new Set(L.ITEMS.map((i) => i.id)).size, 10);
});

test("정책 검사: 반품 기한·환불 기간·배송비", () => {
  assert.deepEqual(L.checkPolicy(GOOD), []);
  const m = L.checkPolicy("반품은 받으신 날부터 14일 이내 가능해요. 환불은 7일 걸려요. 배송비는 3,000원이에요.");
  assert.deepEqual(m.map((x) => x.rule), ["반품·교환 신청은 7일 이내", "환불은 영업일 3~5일", "단순 변심 배송비는 왕복 6,000원"]);
  assert.deepEqual(L.checkPolicy("환불은 영업일 3~5일 안에 들어와요."), []);
  assert.equal(L.checkPolicy("파손 상품이라 배송비 6,000원은 고객님 부담이에요.")[0].rule, "불량·파손은 배송비 없음");
});

test("정책 검사: 수거 일정 같은 다른 날짜는 반품 기한으로 보지 않는다", () => {
  assert.deepEqual(L.checkPolicy("반품 신청해 주시면 2일 안에 수거 기사님이 방문해요."), []);
});

test("좋은 답변은 10항목 모두 통과", () => {
  const r = L.review(GOOD, Q);
  assert.equal(r.applicable, 10);
  assert.equal(r.passed, 10, JSON.stringify(r.items.filter((x) => x.status !== "pass")));
  assert.equal(r.score, 100);
});

test("약한 답변: 정책·약속·쉬운 말에서 걸리고 근거를 보여 준다", () => {
  const r = L.review(WEAK, Q);
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by.policy.status, "fail");
  assert.match(by.policy.note, /7일/);
  assert.equal(by.promise.status, "fail");
  assert.equal(by.promise.evidence, "무료로 처리");
  assert.equal(by.plain.status, "fail");
  assert.equal(by.plain.evidence, "회수");
  assert.equal(by.greet.status, "fail");
  assert.ok(r.score < 40);
});

test("해당 없는 항목은 점수에서 뺀다", () => {
  const r = L.review("안녕하세요, 솔담리빙 고객지원팀입니다. 회원 등급은 마이페이지에서 보실 수 있어요. 감사합니다.", "회원 등급 기준이 궁금해요");
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by.empathy.status, "na");
  assert.equal(by.policy.status, "na");
  assert.equal(r.applicable, 8);
});

test("예시는 실제 우수 응답만: AI 답안·낮은 점수·정책 다른 응답은 뺀다", () => {
  const rs = [
    { id: "r1", source: "real", rating: 4.8, by: "윤○○", inquiry: Q, text: GOOD },
    { id: "r2", source: "real", rating: 4.0, by: "박○○", inquiry: Q, text: GOOD },
    { id: "a1", source: "ai", rating: 5, by: "AI", inquiry: Q, text: GOOD },
    { id: "r3", source: "real", rating: 4.9, by: "정○○", inquiry: Q, text: "안녕하세요, 솔담리빙 고객지원팀입니다. 반품은 받으신 날부터 14일 이내에 하시면 돼요. 감사합니다." },
  ];
  assert.equal(L.usable(rs[2]).ok, false);
  assert.match(L.usable(rs[1]).why, /4.5점/);
  assert.match(L.usable(rs[3]).why, /정책/);
  const ex = L.exemplars("greet", rs);
  assert.deepEqual(ex.map((e) => e.resp.id), ["r1"]);
  assert.ok(ex[0].evidence.startsWith("안녕하세요"));
});

test("Claude 응답 검사: 모르는 항목·지어낸 근거·모범 답안 칸은 버린다", () => {
  assert.equal(L.normalizeReview({ items: [] }, WEAK), null);
  assert.equal(L.normalizeReview("좋아요", WEAK), null);
  const n = L.normalizeReview({
    items: [
      { id: "greet", pass: false, evidence: "", tip: "첫 문장에 인사와 소속을 넣으세요" },
      { id: "restate", pass: true, evidence: "반품은 받으신 날부터 14일 안에 하시면 되고", tip: "" },
      { id: "empathy", pass: true, evidence: "불편을 드려 정말 죄송합니다", tip: "" },
      { id: "deadline", pass: true, evidence: "14일 안에", tip: "" },
      { id: "next", pass: "yes" },
      { id: "nope", pass: true },
      { id: "close", pass: false, evidence: "", tip: "x".repeat(100), model_answer: "안녕하세요 …" },
    ],
  }, WEAK);
  assert.equal(n.items.length, 5);
  assert.equal(n.items.find((x) => x.id === "empathy").evidence, ""); // 답변에 없는 말
  assert.equal(n.items.find((x) => x.id === "close").tip.length, 60);
  assert.ok(!("model_answer" in n.items.find((x) => x.id === "close")));
});

test("Claude 결과 얹기: 정책·약속·쉬운 말은 규칙이 정한다", () => {
  const rule = L.review(WEAK, Q);
  const ai = { items: L.ITEMS.map((i) => ({ id: i.id, pass: true, evidence: "", tip: "" })) };
  const m = L.mergeReview(rule, ai);
  const by = Object.fromEntries(m.items.map((x) => [x.id, x]));
  assert.equal(m.mode, "ai");
  assert.equal(by.greet.status, "pass");
  assert.equal(by.policy.status, "fail");
  assert.equal(by.promise.status, "fail");
  assert.equal(by.plain.status, "fail");
});

test("연습 기록: 최근 3번이 모두 80점 이상이면 '안정'", () => {
  assert.equal(L.progress([]).count, 0);
  const p = L.progress([{ score: 40 }, { score: 70 }, { score: 80 }, { score: 90 }, { score: 100 }]);
  assert.deepEqual([p.first, p.last, p.best, p.recent, p.steady], [40, 100, 100, 90, true]);
  assert.equal(L.progress([{ score: 90 }, { score: 60 }, { score: 95 }]).steady, false);
});

test("교육 자료: 10항목 제목과 출처 문장, AI 답안은 들어가지 않는다", () => {
  const rs = [{ id: "r1", source: "real", rating: 4.8, by: "윤○○ (6년차)", inquiry: Q, text: GOOD }, { id: "a1", source: "ai", rating: 5, by: "AI 생성", inquiry: Q, text: "안녕하세요, 솔담리빙입니다. 무조건 해결해 드립니다." }];
  const b = L.buildBooklet(rs);
  assert.equal((b.match(/^## \d+\./gm) || []).length, 10);
  assert.ok(b.includes("윤○○ (6년차) · 팀장 평가 4.8점"));
  assert.ok(!b.includes("AI 생성"));
});
