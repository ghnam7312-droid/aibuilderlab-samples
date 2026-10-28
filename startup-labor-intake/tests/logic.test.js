// 사실먼저 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-28";
const CAFE = `2025년 3월 4일부터 동네 카페에서 일했어요. 주 5일, 오전 9시부터 오후 6시까지 일했고 쉬는 시간은 따로 없었어요. 월급은 매달 210만 원 받았어요. 근로계약서는 처음에 쓰자고 했는데 결국 안 썼어요. 사장님 포함해서 직원은 6명 정도예요. 2026년 9월 30일에 사장님이 다음 달부터 나오지 말라고 해서 그만뒀어요. 퇴직금을 받을 수 있나요?`;

test("문장 나누기와 날짜 찾기 (없는 날짜는 버린다)", () => {
  assert.equal(L.sentences("첫 문장입니다. 두 번째요?\n세 번째").length, 3);
  assert.deepEqual(L.findDate("2025년 3월 4일부터"), { date: "2025-03-04", approx: false, text: "2025년 3월 4일" });
  assert.equal(L.findDate("2025년 3월부터").approx, true);
  assert.equal(L.findDate("2026년 2월 30일"), null);
});

test("근무 기간 계산: 1년 6개월, 한 달 안 되면 일수", () => {
  assert.equal(L.period("2025-03-04", "2026-09-30"), "1년 6개월");
  assert.equal(L.period("2026-10-01", "2026-10-10"), "10일");
  assert.equal(L.period("2026-10-10", "2026-10-01"), "");
});

test("금액과 하루 근무 시간: '210만 원', '오전 9시부터 오후 6시까지'", () => {
  assert.equal(L.findAmount("월급은 매달 210만 원"), 2100000);
  assert.equal(L.findAmount("시급은 12,000원"), 12000);
  assert.equal(L.hoursOfDay("오전 9시부터 오후 6시까지"), 9);
  assert.equal(L.hoursOfDay("하루 6시간씩"), 6);
});

test("규칙 정리: 카페 사례에서 7개 항목을 모두 사실로 채운다", () => {
  const r = L.extract(CAFE, TODAY);
  assert.equal(r.facts.start.value, "2025-03-04");
  assert.match(r.facts.end.value, /^2026-09-30/);
  assert.match(r.facts.wage.value, /월급 2,100,000원/);
  assert.match(r.facts.hours.value, /주 45시간/);
  assert.match(r.facts.contract.value, /작성 안 함/);
  assert.match(r.facts.size.value, /6명/);
  assert.match(r.facts.issue.value, /해고·계약 종료/);
  assert.equal(r.facts.period.value, "1년 6개월");
  assert.deepEqual(L.coverage(r.facts), { done: 7, total: 7 });
});

test("'계약서를 쓰자고 했는데 안 썼어요'는 '작성 안 함', '작성했어요'는 '작성함'", () => {
  assert.match(L.extract("계약서는 쓰자고 했는데 결국 안 썼어요.", TODAY).facts.contract.value, /작성 안 함/);
  assert.match(L.extract("계약서는 처음에 작성했어요.", TODAY).facts.contract.value, /작성함/);
});

test("빠진 사실은 상담 전 확인 질문이 된다", () => {
  const r = L.extract("회사에서 연봉을 깎겠다고 해요. 3년 넘게 다녔는데 이게 맞는 건가요?", TODAY);
  const keys = L.missing(r.facts).map((m) => m.key);
  assert.ok(keys.includes("start"), "날짜 없는 '3년 넘게'는 입사일 확인이 필요하다");
  assert.ok(keys.includes("wage") && keys.includes("contract"));
  assert.equal(r.facts.issue.value, "임금 변경");
});

test("의뢰인 질문은 답하지 않고 넘길 목록으로 모은다", () => {
  const r = L.extract(CAFE, TODAY);
  assert.deepEqual(r.questions.map((q) => q.text), ["퇴직금을 받을 수 있나요?"]);
});

test("판단 문장 막기: 단정형 판단은 걸리고, 사실·질문은 통과", () => {
  assert.equal(L.isJudgement("이 경우 퇴직금을 받을 수 있습니다."), true);
  assert.equal(L.isJudgement("계약서를 쓰지 않은 것은 위반입니다."), true);
  assert.equal(L.isJudgement("부당해고에 해당합니다."), true);
  assert.equal(L.isJudgement("입사일은 2025-03-04입니다."), false);
  assert.equal(L.isJudgement("퇴직금을 받을 수 있나요?"), false);
  const g = L.guard(["월급 210만 원", "주휴수당을 줘야 합니다"]);
  assert.deepEqual([g.kept.length, g.blocked.length], [1, 1]);
});

test("AI 응답 검사: 판단 값은 차단, 원문에 없는 근거와 모르는 항목은 버린다", () => {
  const sents = L.sentences(CAFE);
  const n = L.normalizeAi({
    facts: [
      { key: "wage", value: "월급 210만 원", quote: "월급은 매달 210만 원 받았어요" },
      { key: "issue", value: "부당해고에 해당합니다", quote: "나오지 말라고 해서 그만뒀어요" },
      { key: "size", value: "직원 12명", quote: "본사에 직원이 열두 명 있다" },
      { key: "salary_level", value: "높음", quote: "월급은 매달" },
    ],
    note: "퇴직금 청구 가능합니다.",
  }, sents);
  assert.equal(n.facts.wage.value, "월급 210만 원");
  assert.equal(n.facts.wage.quote, 2);
  assert.equal(n.facts.issue, undefined);
  assert.equal(n.facts.size, undefined);
  assert.deepEqual(n.blocked, ["부당해고에 해당합니다", "퇴직금 청구 가능합니다."]);
  assert.equal(n.dropped, 2);
  assert.equal(n.note, "");
});

test("AI 응답 형식이 틀리면 null → 규칙 결과 유지", () => {
  const sents = L.sentences(CAFE);
  assert.equal(L.normalizeAi(null, sents), null);
  assert.equal(L.normalizeAi({ facts: "월급 210만 원" }, sents), null);
  assert.equal(L.normalizeAi({ facts: [{ key: "wage", value: "받을 수 있습니다", quote: "월급은 매달 210만 원" }] }, sents), null);
});

test("merge: Claude 값이 규칙 값을 덮고, 못 찾은 항목은 규칙 값 유지", () => {
  const rule = L.extract(CAFE, TODAY);
  const ai = L.normalizeAi({ facts: [{ key: "wage", value: "월급 210만 원 (세전·세후 미상)", quote: "월급은 매달 210만 원 받았어요" }] }, rule.sentences);
  const m = L.merge(rule, ai);
  assert.equal(m.mode, "ai");
  assert.equal(m.facts.wage.by, "ai");
  assert.equal(m.facts.start.by, "rule");
});

test("개인정보 가리기: 이름·전화번호·이메일", () => {
  assert.equal(L.maskName("정하윤"), "정*윤");
  assert.equal(L.maskName("남궁민수"), "남**수");
  assert.equal(L.maskName("오훈"), "오*");
  assert.equal(L.maskText("연락은 010-1234-5678 또는 a.b@test.kr"), "연락은 010-****-5678 또는 (이메일 가림)");
});

test("상담 준비 메모: 이름을 가리고, 질문은 '노무사 상담에서 확인'으로, 판단 없음 문구", () => {
  const r = L.extract(CAFE + " 제 번호는 010-2222-3333이에요.", TODAY);
  const m = L.memo({ name: "정하윤", side: "근로자" }, r, {});
  assert.match(m, /정\*윤 · 근로자/);
  assert.doesNotMatch(m, /정하윤|2222-3333/);
  assert.match(m, /노무사 상담에서 확인[\s\S]*퇴직금을 받을 수 있나요\?/);
  assert.match(m, /법적 판단을 담고 있지 않습니다/);
});
