// 프롬서랍 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

test("공용 프롬프트는 12개, 모두 분류와 본문이 있고 id가 겹치지 않는다", () => {
  assert.equal(L.PROMPTS.length, 12);
  assert.equal(new Set(L.PROMPTS.map((p) => p.id)).size, 12);
  L.PROMPTS.forEach((p) => { assert.ok(L.CATS.includes(p.cat), p.id); assert.ok(p.body.length > 40, p.id); });
});

test("넣으면 안 되는 정보 목록이 맨 앞: 막는 항목이 먼저, 조심할 항목이 뒤", () => {
  const kinds = L.FORBIDDEN.map((f) => f.kind);
  assert.equal(kinds[0], "block");
  assert.ok(kinds.lastIndexOf("block") < kinds.indexOf("warn"));
});

test("검사: 고객 이름·전화번호를 찾아 막는다", () => {
  const r = L.scan(L.SAMPLE_MATERIAL);
  assert.deepEqual(r.block.map((x) => x.id).sort(), ["name", "phone"]);
  assert.equal(L.scan("뚜껑이 새요. 교환 원해요").block.length, 0);
});

test("검사: 이메일·주소·주문번호·주민번호·카드번호", () => {
  const t = "a.b@mail.com / 서울시 강서구 하늘로 12 / 주문번호 20261027001 / 900101-1234567 / 1234-5678-9012-3456";
  assert.deepEqual(L.scan(t).block.map((x) => x.id).sort(), ["address", "card", "email", "order", "rrn"]);
});

test("가리기: 막는 정보는 자리표시로 바뀌고, 다시 검사하면 깨끗하다", () => {
  const m = L.mask(L.SAMPLE_MATERIAL);
  assert.ok(m.includes("[고객]") && m.includes("[전화번호]"));
  assert.ok(!m.includes("김서연") && !m.includes("010-"));
  assert.equal(L.scan(m).block.length, 0);
});

test("조심할 정보는 경고만, 법률·안전 판단 요청은 사람 확인", () => {
  const r = L.scan("이번 분기 원가와 마진율을 보고 이 문구가 표시광고 위반인지 알려 줘");
  assert.equal(r.block.length, 0);
  assert.ok(r.warn.length >= 2);
  assert.ok(r.human);
});

test("빈칸 채우기: 값이 없으면 [이름]으로 남기고 알려 준다, 자료는 뒤에 붙는다", () => {
  const body = "{{상품명}}을 {{대상}}에게. {{상품명}} 3안";
  assert.deepEqual(L.varsOf(body), ["상품명", "대상"]);
  const a = L.fill(body, { 상품명: "도마" }, "자료 한 줄");
  assert.deepEqual(a.empty, ["대상"]);
  assert.ok(a.text.startsWith("도마을 [대상]에게. 도마 3안"));
  assert.ok(a.text.endsWith("[자료]\n자료 한 줄"));
});

test("프롬프트 점검: 공용 프롬프트는 대부분 갖췄고, 한 줄 요청은 점수가 낮다", () => {
  const good = L.checkPrompt(L.fill(L.PROMPTS[0].body, L.SAMPLE_VALUES).text);
  assert.ok(good.score >= 80, String(good.score));
  const bad = L.checkPrompt("상세페이지 문구 써 줘");
  assert.ok(bad.score <= 20);
  assert.ok(bad.missing.includes("역할") && bad.missing.includes("출력 형식"));
});

test("AI 점검 응답 검사: 형식·점수 범위·금지 정보", () => {
  assert.equal(L.normalizeReview({ score: 80, missing: ["분량"], improved: "당신은 카피라이터다. 3안을 60자 이내로." }).score, 80);
  assert.equal(L.normalizeReview({ score: 180, missing: [], improved: "x" }), null);
  assert.equal(L.normalizeReview({ score: 70, missing: [] }), null);
  assert.equal(L.normalizeReview({ score: 70, missing: [], improved: "고객 김서연님께 010-1111-2222로 연락" }), null);
});

test("결과물 검수: 과장 표현·숫자·개인정보를 자동으로 본다", () => {
  const r = L.inspectOutput(L.SAMPLE_OUTPUT);
  assert.equal(r.hype.state, "bad");
  assert.ok(r.hype.note.includes("최고") && r.hype.note.includes("100%"));
  assert.equal(r.pii.state, "ok");
  assert.equal(r.numbers.note, "숫자 1개 대조 필요");
  assert.equal(L.inspectOutput("효능이 있는지 치료에 좋다").legal.state, "bad");
});

test("남은 검수 항목: 자동 통과 + 사람이 체크한 것은 빠진다", () => {
  const auto = L.inspectOutput("불편을 드려 죄송합니다.");
  const all = L.CHECKLIST.length;
  const autoOk = L.CHECKLIST.filter((c) => c.auto).length; // pii · hype · legal 모두 통과
  assert.equal(L.remaining(auto, {}), all - autoOk);
  assert.equal(L.remaining(auto, { numbers: true, facts: true }), all - autoOk - 2);
  assert.equal(L.remaining(L.inspectOutput(L.SAMPLE_OUTPUT), { hype: true }), all - 2); // 과장은 체크해도 남는다
});

test("찾기: 제목·본문·분류로", () => {
  assert.equal(L.search(L.PROMPTS, "", "리뷰").length, 2);
  assert.ok(L.search(L.PROMPTS, "답글").some((p) => p.id === "p07"));
  assert.equal(L.search(L.PROMPTS, "없는말").length, 0);
});
