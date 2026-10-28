// 갈래 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

test("분류 기준은 5개로 고정, 각자 정의와 예시 2개", () => {
  assert.equal(L.CRITERIA.length, 5);
  assert.equal(L.CRITERIA_VERSION, "v3");
  L.CRITERIA.forEach((c) => { assert.ok(c.def); assert.equal(c.ex.length, 2); });
  assert.equal(L.CATS.length, 6);
});

test("같은 글은 언제나 같은 갈래 (여러 번 · 순서를 섞어도)", () => {
  const t = "실습실 컴퓨터가 오래돼서 R이 자주 멈춰요.";
  const a = L.classifyRule(t), b = L.classifyRule(t), c = L.classifyRule(`  ${t}  `);
  assert.deepEqual(a, b);
  assert.equal(c.cat, a.cat);
  const r = L.consistency(L.sampleItems(), 5, 11);
  assert.equal(r.same, 5);
});

test("동점이면 기준 순서가 앞선 쪽 (무작위로 갈리지 않는다)", () => {
  // '대학원'(진로·취업 2점) vs '상담'(학과 운영 2점) → 앞선 진로·취업
  assert.equal(L.classifyRule("대학원 진학 상담을 받을 곳이 없어요.").cat, "c4");
});

test("기준 예시 문장은 모두 자기 갈래로 분류된다", () => {
  L.CRITERIA.forEach((c) => c.ex.forEach((e) => assert.equal(L.classifyRule(e).cat, c.id, e)));
});

test("너무 짧거나 핵심어가 없으면 '검토 필요'", () => {
  assert.equal(L.classifyRule("좋았어요.").cat, "review");
  assert.equal(L.classifyRule("특별히 바라는 것은 없습니다").cat, "review");
  assert.equal(L.classifyRule("").cat, "review");
});

test("개인정보 가리기: 학번 · 전화번호 · 이메일", () => {
  const m = L.maskPII("학번 20231187, 010-2345-6789, 01023456789, me.kim@example.com 으로");
  assert.equal(m.text, "학번 [학번], [전화번호], [전화번호], [이메일] 으로");
  assert.deepEqual(m.found.sort(), ["이메일", "전화번호", "학번"].sort());
  assert.equal(L.maskPII("2026년 1학기 과목").text, "2026년 1학기 과목"); // 연도는 그대로
});

test("민감한 응답은 자동 분류하지 않고 사람에게 (AI 입력에서도 빠진다)", () => {
  const it = L.makeItem("X1", "팀플에서 선배가 폭언을 해서 힘들어요");
  assert.equal(it.sensitive, true);
  assert.equal(L.autoCat(it), "review");
  it.ai = { cat: "c2", reason: "" }; // AI 결과가 붙어도
  assert.equal(L.autoCat(it), "review");
  const inp = L.aiInput([it, L.makeItem("X2", "강의 녹화본을 올려 주세요")]);
  assert.deepEqual(inp.items.map((x) => x.id), ["X2"]);
  assert.equal(inp.criteria.length, 5);
});

test("AI 입력에는 가린 글만 들어간다", () => {
  const inp = L.aiInput([L.makeItem("X3", "연락은 010-1111-2222 로 주세요. 실습실 자리가 부족해요")]);
  assert.ok(!JSON.stringify(inp).includes("010-1111-2222"));
});

test("샘플 42건: 사람이 검수한 22건 중 20건 일치 → 91%", () => {
  const items = L.sampleItems();
  assert.equal(items.length, 42);
  assert.deepEqual(L.agreement(items), { reviewed: 22, agree: 20, rate: 91 });
  const c = L.counts(items);
  assert.equal(Object.values(c).reduce((s, n) => s + n, 0), 42);
  assert.equal(L.agreement([]).rate, null);
});

test("Claude 응답 검사: 기준 밖 이름 · 없는 번호 · 중복은 버린다", () => {
  const items = [L.makeItem("A", "강의 녹화 부탁해요"), L.makeItem("B", "취업 특강 열어 주세요"), L.makeItem("C", "공지가 늦어요")];
  const n = L.normalizeAi({ items: [
    { id: "A", category: "수업 방식", reason: "강의 진행" },
    { id: "B", category: "진로 · 취업", reason: "" },
    { id: "C", category: "기타", reason: "" },
    { id: "Z", category: "교과과정" },
    { id: "A", category: "교과과정" },
  ] }, items);
  assert.equal(n.valid, 2);
  assert.equal(n.byId.A.cat, "c2");
  assert.equal(n.byId.B.cat, "c4");
  assert.equal(n.byId.C, undefined);
  assert.equal(n.dropped, 3);
});

test("Claude 응답 검사: 쓸 만한 답이 절반 미만이거나 형식이 틀리면 통째로 버린다", () => {
  const items = [L.makeItem("A", "강의 녹화 부탁해요"), L.makeItem("B", "취업 특강"), L.makeItem("C", "공지가 늦어요")];
  assert.equal(L.normalizeAi({ items: [{ id: "A", category: "수업 방식" }] }, items), null);
  assert.equal(L.normalizeAi("텍스트", items), null);
  assert.equal(L.normalizeAi({ result: [] }, items), null);
  assert.equal(L.catId("검토 필요"), "review");
  assert.equal(L.catId("실습/환경"), "");
});

test("CSV: 가린 글 · 자동 분류 · 검수 · 일치 표시", () => {
  const items = [L.makeItem("A", "강의 녹화 부탁해요 010-1234-5678", "c2"), L.makeItem("B", "취업 특강", "c5")];
  const csv = L.toCsv(items);
  assert.ok(csv.startsWith("﻿번호,"));
  assert.ok(!csv.includes("010-1234-5678"));
  const rows = csv.split("\r\n");
  assert.ok(rows[1].endsWith(",수업 방식,O"));
  assert.ok(rows[2].endsWith(",학과 운영,X"));
});
