// 효과먼저 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const OLD = `안녕하세요. 저는 유아교육을 전공하고 10년 동안 부모 교육 강의를 해 온 강사입니다.
그동안 50여 곳에 출강했고 관련 자격을 갖고 있습니다. 제 강의는 최고의 강의로 반드시 만족을 보장합니다.
강의 주제는 놀이, 대화법, 미디어 사용입니다. 회당 강의료는 30만 원입니다.`;
const ORG = { name: "해오름종합사회복지관", type: "복지관", contact: "부모교육 담당 사회복지사", quotes: ["신청은 20명인데 당일엔 8명 와요.", "실적 보고에 만족도 숫자가 필요해요."], attendNow: 40, satisfactionNow: "조사 없음", prepHours: 3, budget: 2400000 };
const PKG = { sessions: 8, perSession: 300000, discount: 10, attendTarget: 70, satTarget: 4.5, startMonth: 3 };

test("문장 나누기: 마침표·줄바꿈 기준", () => {
  assert.equal(L.sentences("하나입니다. 둘입니다!\n셋째").length, 3);
});

test("문장 분류: 강사 중심 · 기관 효과 · 기타", () => {
  assert.equal(L.kindOf("저는 10년 동안 출강했습니다."), "me");
  assert.equal(L.kindOf("부모님 참여율과 만족도를 회차마다 보고합니다."), "org");
  assert.equal(L.kindOf("강의 주제는 놀이입니다."), "etc");
});

test("처음 쓴 제안서는 강사 중심으로 판정되고 과장 문구를 찾는다", () => {
  const r = L.lint(OLD);
  assert.equal(r.ok, false);
  assert.ok(r.ratio.me > r.ratio.org);
  assert.ok(r.hype >= 3); // 최고의, 반드시, 보장
  assert.ok(r.problems.some((p) => p.includes("과장")));
});

test("가격: 회당 × 회차, 할인 뒤 천 원 아래 버림", () => {
  const p = L.price(PKG);
  assert.equal(p.list, 2400000);
  assert.equal(p.total, 2160000);
  assert.equal(p.perAfter, 270000);
  assert.equal(L.price({ sessions: 3, perSession: 333333, discount: 7 }).total % 1000, 0);
  assert.equal(L.price({ sessions: 99, perSession: 1, discount: 90 }).disc, 40); // 범위 고정
});

test("예산: 안 · 초과 · 모름", () => {
  assert.deepEqual(L.budgetFit(2160000, 2400000), { kind: "fit", gap: 240000 });
  assert.equal(L.budgetFit(3000000, 2400000).kind, "over");
  assert.equal(L.budgetFit(1, 0).kind, "unknown");
});

test("연간 구성: 회차 수만큼, 시작 달부터 12개월 안에 고르게", () => {
  const p = L.plan("복지관", 4, 3);
  assert.deepEqual(p.map((x) => x.month), [3, 6, 9, 12]);
  assert.equal(new Set(p.map((x) => x.topic)).size, 4);
  assert.deepEqual(L.plan("유치원", 3, 11).map((x) => x.month), [11, 3, 7]);
});

test("규칙 제안서: 기관의 고민이 처음, 강사는 맨 끝", () => {
  const prop = L.buildProposal(ORG, PKG, "유아교육 전공 · 부모 교육 강사");
  assert.equal(prop.sections[0].key, "pain");
  assert.equal(prop.sections.at(-1).key, "me");
  assert.match(prop.sections[0].body, /당일엔 8명/);
  assert.match(prop.headline, /참여율 70%/);
  assert.match(prop.sections.find((s) => s.key === "cost").body, /216만 원/);
});

test("규칙 제안서는 점검을 통과한다 (기관 효과 60% 이상, 과장 없음)", () => {
  const prop = L.buildProposal(ORG, PKG, "유아교육 전공 · 부모 교육 강사");
  const r = L.lint(L.toText(prop, ORG.name));
  assert.ok(r.ratio.org >= 60, `org ${r.ratio.org}`);
  assert.equal(r.ok, true);
  assert.equal(r.hype, 0);
});

test("Claude 응답 검사: 형식이 틀리면 null", () => {
  const fixed = L.buildProposal(ORG, PKG, "강사");
  assert.equal(L.normalizeRewrite(null, fixed), null);
  assert.equal(L.normalizeRewrite({ headline: "", sections: [] }, fixed), null);
  assert.equal(L.normalizeRewrite({ headline: "제목", sections: [{ title: "a", body: "b" }] }, fixed), null);
});

test("Claude 응답 검사: 과장 문장은 지우고, 강사 소개는 맨 뒤, 비용은 계산값으로", () => {
  const fixed = L.buildProposal(ORG, PKG, "강사");
  const r = L.normalizeRewrite({
    headline: "참여율을 올리는 연간 부모 교육",
    sections: [
      { title: "강사 소개", body: "유아교육 전공 강사입니다." },
      { title: "복지관의 고민", body: "신청 대비 출석이 낮습니다. 참여율을 반드시 두 배로 보장합니다." },
      { title: "비용", body: "연 100만 원입니다." },
      { title: "측정", body: "회차마다 만족도 설문을 보고합니다." },
    ],
  }, fixed);
  assert.equal(r.removed, 1);
  assert.equal(r.sections.at(-1).title, "강사 소개");
  assert.equal(r.sections[0].body, "신청 대비 출석이 낮습니다.");
  assert.match(r.sections.find((s) => s.title === "비용").body, /216만 원/);
  assert.deepEqual(r.metrics, fixed.metrics);
});

test("영업 현황: 제안 7곳 중 연간 계약 2곳", () => {
  const s = ["제안함", "협의 중", "연간 계약", "연간 계약", "보류", "제안함", "제안함", "제안 전"].map((status) => ({ status }));
  assert.deepEqual(L.pipeline(s), { proposed: 7, contracts: 2, rate: 29 });
});

test("복사 글: 목표는 약속이 아니라는 문장을 붙인다", () => {
  const t = L.toText(L.buildProposal(ORG, PKG, "강사"), ORG.name);
  assert.match(t, /^\[제안서\] 해오름종합사회복지관/);
  assert.match(t, /약속하는 숫자가 아닙니다/);
});
