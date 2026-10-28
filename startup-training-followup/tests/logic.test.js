// 이어감 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const IVS = [
  { needs: ["report", "apply"], budget: 30000 },
  { needs: ["remind", "refresh"], budget: 20000 },
  { needs: ["coach", "apply"], budget: 40000 },
  { needs: ["report"], budget: 50000 },
];
const DRAFT = "3개월 후속 관리로 교육 효과를 보장합니다. 수료 후 팀 성과가 반드시 오릅니다. 매주 퀴즈를 반드시 드립니다.";

test("인터뷰 요약: 요구별 인원, 1인 예산 중앙값", () => {
  const s = L.needSummary(IVS);
  assert.equal(s.n, 4);
  assert.deepEqual(s.counts.slice(0, 2).map((c) => [c.key, c.count]), [["report", 2], ["apply", 2]]);
  assert.equal(s.budgetMedian, 35000);
  assert.equal(L.needSummary([]).budgetMedian, 0);
});

test("요구 충족: 요구를 모두 채운 담당자 수와 빠진 요구", () => {
  const c = L.coverage(IVS, ["report", "task"]);
  assert.equal(c.full, 2);
  assert.deepEqual(c.missing.map((m) => m.key).sort(), ["coach", "refresh", "remind"]);
  assert.equal(L.coverage(IVS, ["report", "task", "remind", "refresh", "coach"]).full, 4);
});

test("가격: 인원 비례 + 고정비, 50명·100명 할인, 천 원 단위", () => {
  const p = L.price(["remind", "report"], 30);
  assert.equal(p.total, 9000 * 30 + 800000);
  assert.equal(p.rate, 0);
  assert.equal(p.monthly, 357000);
  const p50 = L.price(["remind", "report"], 50);
  assert.equal(p50.rate, 0.1);
  assert.equal(p50.total, Math.round(((9000 * 50 + 800000) * 0.9) / 1000) * 1000);
  assert.equal(L.price(["task"], 120).rate, 0.15);
  assert.equal(L.price([], 0).perHead, 0);
  assert.equal(L.price(["없는것"], 10).total, 0);
});

test("문구 검사: 보장·단정·확정 수치·재지 않는 성과 약속을 찾는다", () => {
  const f = L.checkCopy(DRAFT + " 만족도 100% 과정.");
  const kinds = f.map((x) => x.kind);
  assert.ok(kinds.includes("측정"));
  assert.ok(kinds.includes("성과"));
  assert.ok(kinds.includes("단정"));
  assert.ok(kinds.includes("수치"));
  assert.ok(f.every((x, i) => i === 0 || f[i - 1].at <= x.at), "앞에서부터 순서대로");
});

test("문구 검사: 부정문과 측정 약속은 걸지 않는다", () => {
  assert.deepEqual(L.checkCopy("교육 효과를 보장하지 않습니다."), []);
  assert.deepEqual(L.checkCopy("교육 후 90일에 역량 자가진단 점수 변화를 같은 설문으로 재서 보고합니다."), []);
});

test("규칙 고치기: 보장 문장은 측정 약속으로, 단정 표현은 지운다", () => {
  const out = L.fixCopy(DRAFT, ["remind", "report"]);
  assert.deepEqual(L.checkCopy(out), []);
  assert.match(out, /^교육 후 90일에 역량 자가진단 점수 변화를 교육 전·90일 뒤 같은 설문 비교로 재서 보고합니다\./);
  assert.match(out, /12주 동안 매주 퀴즈 정답률을/);
  assert.match(out, /매주 퀴즈를 드립니다\.$/);
});

test("조사: 받침에 맞춘 을/를, 으로/로", () => {
  assert.equal(L.josa("변화", "을"), "를");
  assert.equal(L.josa("참석률", "을"), "을");
  assert.equal(L.josa("출석 기록", "으로"), "으로");
  assert.equal(L.josa("자동 채점", "으로"), "으로");
  assert.equal(L.josa("비교", "으로"), "로");
  assert.equal(L.josa("체크리스트 5문항", "으로"), "으로");
});

test("측정 약속 확인: 고른 구성의 지표가 문구에 들어갔나", () => {
  const c = L.promiseCheck("퀴즈 정답률을 매주 보고", ["remind", "report"]);
  assert.deepEqual([c.named, c.total], [1, 2]);
  assert.deepEqual(c.missing, ["역량 자가진단 점수 변화"]);
});

test("규칙 문구: 고른 구성마다 지표·방법·시점이 하나씩", () => {
  const r = L.ruleCopy(["task", "report"], L.needSummary(IVS), L.price(["task", "report"], 30));
  assert.equal(r.promises.length, 2);
  assert.ok(r.promises.every((p) => p.metric && p.method && p.timing));
  assert.match(r.pitch, /담당자 4명 중 2명/);
  assert.deepEqual(L.checkCopy(`${r.headline} ${r.pitch}`), []);
});

test("Claude 응답 검사: 형식이 틀리면 버리고, 빈 약속은 뺀다", () => {
  assert.equal(L.normalizeCopy(null), null);
  assert.equal(L.normalizeCopy({ headline: "a", pitch: "" }), null);
  assert.equal(L.normalizeCopy({ headline: "a", pitch: "b", promises: [{ metric: "x" }] }), null);
  const n = L.normalizeCopy({ headline: "a", pitch: "b", promises: [{ metric: "참석률", method: "출석", timing: "45일" }, { metric: "", method: "m", timing: "t" }], flags: [{ phrase: "보장", reason: "r", rewrite: "효과를 보장해 드립니다" }] });
  assert.equal(n.promises.length, 1);
  assert.equal(n.flags[0].rewrite, "", "고친 문장에도 보장 표현이 있으면 비운다");
});

test("Claude 응답 검사: AI 문구에 보장·단정 표현이 있으면 통째로 버린다", () => {
  assert.equal(L.normalizeCopy({ headline: "효과를 보장합니다", pitch: "b", promises: [{ metric: "x", method: "y", timing: "z" }] }), null);
  assert.equal(L.normalizeCopy({ headline: "a", pitch: "성과가 반드시 오릅니다", promises: [{ metric: "x", method: "y", timing: "z" }] }), null);
});

test("제안서: 구성·측정 약속·예시 가격, 본문에 보장 표현 없음", () => {
  const sel = ["remind", "report"]; const p = L.price(sel, 60);
  const txt = L.proposalText("가상전자", L.ruleCopy(sel, L.needSummary(IVS), p), sel, p);
  assert.match(txt, /■ 측정 약속/);
  assert.match(txt, /퀴즈 정답률 · 주 1회 5문항 퀴즈 자동 채점/);
  assert.match(txt, /10% 할인 반영/);
  assert.deepEqual(L.checkCopy(txt), []);
});
