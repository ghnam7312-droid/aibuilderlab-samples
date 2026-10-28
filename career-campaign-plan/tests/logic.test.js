// 응답대로 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const R = L.sampleResponses();

test("샘플 설문: 실제 응답 52건, 번호가 겹치지 않고 늘 같다", () => {
  assert.equal(R.length, 52);
  assert.equal(new Set(R.map((r) => r.id)).size, 52);
  assert.deepEqual(L.sampleResponses(), R);
  assert.ok(R.every((r) => L.validateResponse(r).length === 0));
});

test("숫자 도우미: 비율 반올림·중간값·개수 세기", () => {
  assert.equal(L.pctOf(22, 52), 42);
  assert.equal(L.pctOf(1, 0), 0);
  assert.equal(L.median([3000, 1500, 2000]), 2000);
  assert.equal(L.median([1500, 2000]), 1800);
  assert.deepEqual(L.countBy([{ c: ["a", "b"] }, { c: ["a"] }], (x) => x.c), [["a", 2], ["b", 1]]);
});

test("규칙 기획: 페르소나 3개, 메시지 4안, 통계는 응답에서 계산", () => {
  const p = L.rulePlan(R);
  assert.equal(p.personas.length, 3);
  assert.equal(p.messages.length, 4);
  assert.deepEqual(p.personas.map((x) => x.refs.length), [22, 16, 14]);
  const s = L.statsOf(p.personas[0].refs, R);
  assert.equal(s.share, 42);
  assert.equal(s.criteria[0][0], "카페인 부담 적음");
  for (const x of p.personas) assert.ok(L.checkClaim(x.summary, x.refs, R).ok, x.summary);
  assert.ok(p.personas[0].summary.includes("당 적음을 먼저"));
});

test("근거 검사: 근거 없음·없는 응답 번호·근거와 다른 %·명을 잡는다", () => {
  const ids = R.slice(0, 22).map((r) => r.id);
  assert.ok(L.checkClaim("응답 22명(42%)", ids, R).ok);
  assert.ok(L.checkClaim("전체 52명 중 22명", ids, R).ok);
  const bad = L.checkClaim("응답자의 78%가 원한다", [], R);
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.includes("근거 응답 없음"));
  const fake = L.checkClaim("설문 300명 중 64%", ["R03", "R88"], R);
  assert.deepEqual(fake.refs, ["R03"]);
  assert.equal(fake.issues.length, 3);
});

test("AI 첫 초안(지어낸 설문 결과)을 검사하면 실제 근거가 있는 2줄만 통과", () => {
  const rows = L.auditDraft(L.firstDraft(), R);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.filter((r) => r.ok).map((r) => r.kind), ["페르소나", "메시지"]);
  assert.ok(rows[3].issues.some((x) => x.includes("효능 표현")));
  assert.ok(rows[4].issues.some((x) => x.includes("과장 표현")));
});

test("효능·건강 표현은 사람 확인으로 넘긴다, 과장 표현은 감점", () => {
  assert.equal(L.healthClaim("마시면 살 빠지는 탄산"), "살 빠");
  assert.equal(L.healthClaim("피로 회복에 좋은"), "피로 회복");
  assert.equal(L.healthClaim("달지 않은 탄산"), "");
  const p = L.rulePlan(R);
  const sc = L.score({ copy: "무조건 다이어트 톡차", persona: "전체", angle: "당 적음", refs: [] }, p.personas);
  assert.equal(sc.honest, 1);
  assert.equal(sc.evidence, 1);
  assert.equal(sc.health, "다이어트");
});

test("평가표: 근거 많고 타깃 장면이 들어간 짧은 문구가 높다", () => {
  const p = L.rulePlan(R);
  const good = L.score(p.messages[0], p.personas);
  assert.equal(good.target, 5);
  assert.ok(good.total >= 18);
  const off = L.score({ copy: "새로운 맛의 시작, 지금 바로 만나 보는 톡차", persona: p.personas[0].name, angle: "맛", refs: ["R01"] }, p.personas);
  assert.ok(off.total < good.total);
});

test("Claude 응답 검사: 근거 3건 미만·숫자 틀린 페르소나, 근거 없는 메시지는 버린다", () => {
  const ids = (a, b) => R.slice(a, b).map((r) => r.id);
  const n = L.normalizePlan({
    personas: [
      { name: "수업 사이", when: "수업·업무 사이", summary: "응답 22명(42%)이 수업 사이에 마신다", needs: ["카페인 부담 적음", "없는기준"], refs: ids(0, 22) },
      { name: "운동 끝", summary: "응답 16명이 운동 후에", refs: ids(22, 38) },
      { name: "지어낸 사람", summary: "응답자의 90%", refs: ids(38, 40) },
      { name: "틀린 숫자", summary: "응답 30명", refs: ids(38, 52) },
    ],
    messages: [
      { copy: "수업 사이, 커피 대신 톡차", persona: "수업 사이", angle: "카페인 부담 적음", refs: ids(0, 18) },
      { copy: "운동 끝, 달지 않은 한 모금", persona: "운동 끝", refs: ids(22, 36) },
      { copy: "모두가 고른 최고의 음료", refs: ids(0, 5) },
      { copy: "근거 없는 문구", refs: ["R99"] },
    ],
  }, R);
  assert.deepEqual(n.personas.map((p) => p.name), ["수업 사이", "운동 끝"]);
  assert.deepEqual(n.personas[0].needs, ["카페인 부담 적음"]);
  assert.equal(n.messages.length, 2);
  assert.equal(n.dropped.length, 4);
  assert.equal(L.normalizePlan({ personas: [], messages: [] }, R), null);
  assert.equal(L.normalizePlan("텍스트", R), null);
});

test("응답 추가: 입력 검사와 다음 번호", () => {
  assert.equal(L.nextId(R), "R53");
  assert.equal(L.validateResponse({ when: "운동 후", criteria: [], price: 2000, channel: "편의점" }).length, 1);
  assert.equal(L.validateResponse({ when: "새벽", criteria: ["맛"], price: 99999, channel: "편의점" }).length, 2);
  const more = R.concat({ id: L.nextId(R), when: "운동 후", criteria: ["용량"], price: 2500, channel: "편의점" });
  assert.equal(L.rulePlan(more).personas[1].refs.length, 17);
});

test("마크다운 기획서: 응답 수·근거 번호·채택 표시", () => {
  const p = L.rulePlan(R);
  const md = L.toMarkdown(p, R, 0);
  assert.ok(md.includes("실제 설문 응답 52건"));
  assert.ok(md.includes("### 공강 사이 리프레셔"));
  assert.ok(md.includes("응답 22명 (42%)"));
  assert.ok(md.includes("(채택)"));
  assert.ok(md.includes("R01, R02"));
});
