// 또렷 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const OBS = [
  { id: "O1", cat: "contrast", text: "메뉴 버튼 흰 글자가 주황 바탕에 묻힘", sev: 3, freq: 3 },
  { id: "O2", cat: "contrast", text: "가격이 옅은 회색", sev: 2, freq: 3 },
  { id: "O3", cat: "time", text: "30초 뒤 처음 화면으로", sev: 3, freq: 2 },
  { id: "O4", cat: "reach", text: "카드 투입구가 높음", sev: 3, freq: 1 },
];

test("명도 대비: WCAG 공식 계산값과 같다 (흑백 21, #767676 4.54)", () => {
  assert.equal(L.contrast("#000", "#fff"), 21);
  assert.equal(L.contrast("#767676", "#FFFFFF"), 4.54);
  assert.equal(L.contrast("#FFFFFF", "#767676"), 4.54); // 순서 상관없음
  assert.equal(L.contrast("#777777", "#fff"), 4.47);
  assert.equal(L.contrast("없는색", "#fff"), null);
});

test("큰 글자 판단: 24px 이상, 또는 굵게 18.66px 이상", () => {
  assert.equal(L.isLarge(24, false), true);
  assert.equal(L.isLarge(19, true), true);
  assert.equal(L.isLarge(18, true), false);
  assert.equal(L.isLarge(20, false), false);
});

test("요소 점검: 대비는 글자 크기에 맞는 기준(4.5 / 3)으로, 4.47은 통과 못 함", () => {
  assert.equal(L.auditEl({ id: "a", fg: "#777777", bg: "#fff", px: 16 }).contrast, "fail");
  const big = L.auditEl({ id: "b", fg: "#777777", bg: "#fff", px: 24 });
  assert.equal(big.need, 3);
  assert.equal(big.contrast, "pass");
  assert.equal(L.auditEl({ id: "c", fg: "#fff", bg: "#F2A541", px: 16, bold: true }).contrast, "fail");
});

test("누르는 영역: 24px 미만 미달, 24~43px 권장 미달, 44px 이상 통과", () => {
  const t = (w, h) => L.auditEl({ id: "x", fg: "#000", bg: "#fff", px: 20, w, h }).target;
  assert.equal(t(20, 40), "fail");
  assert.equal(t(32, 32), "warn");
  assert.equal(t(64, 44), "pass");
});

test("시간 제한: 연장 없으면 미달, 알림·연장 있으면 통과", () => {
  assert.equal(L.auditTimer({ limit: 30, extend: false }).status, "fail");
  assert.equal(L.auditTimer({ limit: 120, extend: true }).status, "pass");
  assert.equal(L.auditTimer(null).status, "pass");
  const a = L.auditScreen({ els: [{ id: "a", fg: "#fff", bg: "#F2A541", px: 16, w: 30, h: 30 }], timer: { limit: 30 } });
  assert.equal(a.fails, 2);
  assert.equal(a.warns, 2);
});

test("AI 기준 대조: 오래된 기준을 잡아낸다", () => {
  // AI가 처음 준 답: 'WCAG 2.0 기준, 누르는 영역 최소 44px'
  const a = L.verifyClaim({ id: "target", value: 44, version: "2.0" });
  assert.equal(a.status, "differ");
  assert.match(a.why, /2\.0/);
  assert.match(a.why, /24/);
  // '큰 글자도 4.5:1'
  assert.equal(L.verifyClaim({ id: "contrast", value: 4.5, large: 4.5 }).status, "differ");
  // '시간 제한은 10초 전에 경고'
  assert.equal(L.verifyClaim({ id: "timing", value: 10 }).status, "differ");
});

test("AI 기준 대조: 맞는 기준은 일치, 공식표에 없으면 사람이 확인", () => {
  assert.equal(L.verifyClaim({ id: "contrast", value: 4.5, large: 3, version: "2.2", level: "AA" }).status, "match");
  assert.equal(L.verifyClaim({ id: "target-enh", value: 44, level: "AAA" }).status, "match");
  assert.equal(L.verifyClaim({ id: "kiosk-height", value: 120 }).status, "unknown");
});

test("규칙 제안: 분류별로 묶고 심각도×빈도 순, 공식 수치 없는 분류는 사람 확인", () => {
  const p = L.ruleProposal(OBS);
  assert.equal(p.length, 3);
  assert.equal(p[0].cat, "contrast");
  assert.deepEqual(p[0].issues, ["O1", "O2"]);
  assert.equal(p[0].score, 15);
  assert.equal(p[0].priority, "높음");
  assert.equal(p[0].criterion, "contrast");
  const reach = p.find((x) => x.cat === "reach");
  assert.equal(reach.check, "human");
  assert.equal(reach.priority, "낮음");
});

test("Claude 응답 검사: 없는 문제 번호·기준은 버리고, 다른 수치는 'differ', 빠진 문제는 규칙으로", () => {
  const n = L.normalizeProposal({ summary: "대비부터", items: [
    { title: "대비 높이기", issues: ["O1", "O2", "O99"], action: "진한 바탕", criterion: "contrast", claimValue: 4.5, priority: "높음" },
    { title: "버튼 크게", issues: ["O1"], action: "44px", criterion: "target", claimValue: 44 },
    { title: "시간 연장", issues: ["O3"], action: "연장 버튼", criterion: "target", claimValue: 44, priority: "급함" },
    { title: "없는 기준", issues: ["O99"], criterion: "kwcag-9.9" },
  ] }, OBS);
  assert.equal(n.items.length, 3); // 2개 + 빠진 O4를 규칙으로
  assert.deepEqual(n.items[0].issues, ["O1", "O2"]);
  assert.equal(n.items[0].check, "match");
  assert.equal(n.items[1].check, "differ");
  assert.equal(n.items[1].priority, "보통");
  assert.deepEqual(n.items[2].issues, ["O4"]);
  assert.equal(n.summary, "대비부터");
});

test("Claude 응답 검사: 법적 판단 문장은 지우고 표시, 형식이 틀리면 null", () => {
  const n = L.normalizeProposal({ items: [{ title: "높이 조정", issues: ["O4"], action: "버튼을 아래로 옮긴다. 지금 높이는 법적 의무 위반이다." }] }, OBS);
  assert.equal(n.items[0].action, "버튼을 아래로 옮긴다.");
  assert.equal(n.items[0].legal, true);
  assert.equal(L.normalizeProposal({ items: "많음" }, OBS), null);
  assert.equal(L.normalizeProposal({ items: [{ title: "x", issues: ["O99"] }] }, OBS), null);
  assert.equal(L.normalizeProposal(null, OBS), null);
});

test("관찰 기록 추가: 분류·내용 검사, 번호는 이어서", () => {
  assert.equal(L.addObs(OBS, { cat: "zzz", text: "무엇" }).ok, false);
  assert.equal(L.addObs(OBS, { cat: "text", text: "작" }).ok, false);
  const r = L.addObs(OBS, { cat: "text", text: "메뉴 글자가 작다", sev: 9, freq: 0 });
  assert.equal(r.obs.id, "O5");
  assert.equal(r.obs.sev, 3);
  assert.equal(r.obs.freq, 1);
});

test("제안서 마크다운: 근거 기준과 사람 확인 안내가 들어간다", () => {
  const p = L.ruleProposal(OBS);
  const md = L.proposalMd("학생식당 키오스크 접근성 개선 제안", p, OBS, { fails: 5, warns: 2 });
  assert.ok(md.startsWith("# 학생식당 키오스크 접근성 개선 제안"));
  assert.ok(md.includes("관찰한 문제 4개 · 개선안 3개"));
  assert.ok(md.includes("1.4.3 명도 대비(최소)"));
  assert.ok(md.includes("공식 수치 없음 — 담당 부서 확인"));
  assert.ok(md.includes("법적 의무 여부를 판단하지 않습니다"));
});
