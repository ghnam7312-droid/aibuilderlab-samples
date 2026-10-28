// 다음걸음 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const SINGLE = 80000;
const PACK = { sessions: 4, price: 280000, includes: ["회차마다 과제 피드백", "이력서·포트폴리오 첨삭 2회", "모의 면접 1회"] };
const REVIEWS = [
  { id: "r1", who: "김○○ · 교직원 → HR", text: "매주 과제가 있어서 미루지 않았어요.", consent: true },
  { id: "r2", who: "박○○ · 매장 매니저 → 서비스 기획", text: "제 경험을 기획 언어로 바꾸는 법을 배웠어요.", consent: true },
  { id: "r3", who: "이○○ · QA → 데이터 분석", text: "포트폴리오 주제를 같이 좁혀 줬어요.", consent: false },
];
const DRAFT = {
  headline: "4주 만에 합격 보장! 직무 전환 코칭",
  sub: "100% 맞춤 코칭으로 누구나 원하는 직무로",
  bullets: ["업계 최고의 HR 출신 코치", "연봉 2배 상승 사례 다수", "회차마다 과제 피드백"],
  cta: "지금 바로 합격하기",
};

test("패키지 계산: 회당 가격과 1회 상담 대비", () => {
  const m = L.packageMath(SINGLE, PACK);
  assert.deepEqual([m.per, m.save, m.rate, m.cheaper], [70000, 40000, 12.5, true]);
  assert.equal(L.packageMath(SINGLE, { sessions: 0, price: 50000 }).sessions, 1, "0회는 1회로");
  assert.equal(L.won(280000), "280,000원");
});

test("과장 표현 검사: 보장·100%·누구나·최상급·연봉 배수·버튼", () => {
  const lint = L.lintClaims(DRAFT);
  const fields = lint.map((x) => x.field);
  assert.ok(fields.includes("headline") && fields.includes("sub") && fields.includes("cta"));
  assert.ok(fields.includes("bullets.0") && fields.includes("bullets.1"));
  assert.ok(!fields.includes("bullets.2"), "사실 문장은 걸리지 않는다");
  assert.ok(lint.some((x) => x.match.includes("합격 보장")));
});

test("과장 없는 문구는 통과", () => {
  assert.equal(L.lintClaims(L.ruleCopy(PACK, SINGLE, REVIEWS)).length, 0);
  assert.equal(L.hasClaim("4주 동안 이력서를 함께 고칩니다"), false);
  assert.equal(L.hasClaim("6주 만에 이직 성공"), true);
});

test("과장 고치기: 걸린 줄은 게시 동의한 실제 후기로, 남은 사실 줄은 그대로", () => {
  const { copy, replaced } = L.cleanCopy(DRAFT, PACK, SINGLE, REVIEWS);
  assert.equal(L.lintClaims(copy).length, 0);
  assert.equal(replaced.length, 5);
  assert.ok(copy.bullets[0].includes("매주 과제") && copy.bullets[1].includes("기획 언어"));
  assert.ok(copy.bullets.includes("회차마다 과제 피드백"));
  assert.ok(!copy.bullets.join("").includes("포트폴리오 주제"), "동의 없는 후기는 쓰지 않는다");
  assert.equal(copy.cta, "4주 패키지 신청하기");
});

test("바꿀 후기가 모자라면 그 줄은 뺀다", () => {
  const { copy, replaced } = L.cleanCopy({ ...DRAFT, bullets: ["업계 1위", "100% 만족", "무조건 이직"] }, PACK, SINGLE, REVIEWS.slice(0, 1));
  assert.equal(copy.bullets.length, 1);
  assert.equal(replaced.filter((r) => r.to === "(빼기)").length, 2);
});

test("규칙 문구: 가격·회차가 들어가고 동의한 후기만", () => {
  const c = L.ruleCopy(PACK, SINGLE, REVIEWS);
  assert.ok(c.sub.includes("280,000원") && c.sub.includes("회당 70,000원"));
  assert.ok(c.bullets.some((b) => b.includes("매주 과제")));
  assert.ok(!c.bullets.some((b) => b.includes("포트폴리오 주제")));
});

test("Claude 응답 검사: 제목·버튼·항목 2개 이상", () => {
  assert.equal(L.normalizeCopy(null), null);
  assert.equal(L.normalizeCopy({ headline: "제목", cta: "신청", bullets: ["하나"] }), null);
  assert.equal(L.normalizeCopy({ headline: "", cta: "신청", bullets: ["a", "b"] }), null);
  assert.equal(L.normalizeCopy({ headline: "제목", cta: "신청", bullets: "a, b" }), null);
  const n = L.normalizeCopy({ headline: " 제목 ", sub: 3, cta: "신청", bullets: ["a", 1, "b", "c", "d", "e"] });
  assert.deepEqual([n.headline, n.sub, n.bullets.length], ["제목", "", 4]);
});

test("게시 전 확인: 과장 · 동의 없는 후기 · 가격 표기", () => {
  const good = L.ruleCopy(PACK, SINGLE, REVIEWS);
  assert.equal(L.publishCheck(good, PACK, SINGLE, REVIEWS).ok, true);
  const withR3 = { ...good, bullets: [...good.bullets, L.quote(REVIEWS[2])] };
  const c = L.publishCheck(withR3, PACK, SINGLE, REVIEWS);
  assert.equal(c.ok, false);
  assert.match(c.checks[1].label, /동의 없는 후기 1건/);
  assert.equal(L.publishCheck(DRAFT, PACK, SINGLE, REVIEWS).checks[0].ok, false);
});

test("A/B: 2.1% → 4.4%는 우연으로 보기 어렵다", () => {
  const r = L.abTest({ visitors: 1240, apps: 26 }, { visitors: 1180, apps: 52 });
  assert.equal(r.rateA, 2.1);
  assert.equal(r.rateB, 4.4);
  assert.equal(r.winner, "B");
  assert.ok(r.p < 0.01 && r.z > 3);
  assert.equal(r.lift, 110);
});

test("A/B: 표본이 적거나 차이가 작으면 판단을 미룬다", () => {
  assert.match(L.abTest({ visitors: 120, apps: 2 }, { visitors: 110, apps: 6 }).verdict, /표본 부족/);
  const r = L.abTest({ visitors: 1000, apps: 21 }, { visitors: 1000, apps: 25 });
  assert.equal(r.winner, "");
  assert.ok(r.p > 0.05);
  assert.equal(L.abTest({ visitors: 500, apps: 900 }, { visitors: 500, apps: 10 }).rateA, 100, "신청이 방문보다 많을 수 없다");
});

test("정규분포 근사와 텍스트 내보내기", () => {
  assert.ok(Math.abs(L.phi(1.96) - 0.975) < 0.001);
  assert.ok(Math.abs(L.phi(0) - 0.5) < 0.001);
  const t = L.toText({ headline: "제목", sub: "부제", bullets: ["a"], cta: "신청" });
  assert.equal(t, "# 제목\n부제\n\n- a\n\n[신청]");
});
