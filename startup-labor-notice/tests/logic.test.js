// 안내한장 로직 테스트 — 실행: node --test (또는 npm test)
// 개정 내용·금액·시행일은 모두 샘플 값이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const WAGE = { id: "a1", title: "최저임금 고시 (샘플)", area: "임금", effective: "2027-01-01", unit: "시급", before: 11000, after: 11500, summary: "", target: "hourly", link: "https://gazette.example/notice/wage-sample" };
const FORM = { id: "a2", title: "연장근로 기록 서식 변경 (샘플)", effective: "2027-03-01", summary: "서식 변경 (샘플)", target: "overtime", link: "https://www.example-labor.go.kr/notice/1" };
const BAKERY = { id: "c1", name: "달빛베이커리", industry: "제과점", staff: 7, hourly: 4, shift: false, overtime: true, contactName: "김도원", contactRole: "실장" };
const OFFICE = { id: "c5", name: "그린라인 디자인", industry: "사무", staff: 6, hourly: 0, shift: false, overtime: false, contactName: "정민호", contactRole: "대표" };

test("날짜 표기: 한국어 날짜와 남은 날", () => {
  assert.equal(L.korDate("2027-01-01"), "2027년 1월 1일(금)");
  assert.equal(L.daysUntil("2027-01-01", "2026-12-25"), 7);
});

test("글 안의 날짜를 여러 표기로 찾는다", () => {
  const d = L.findDates("2027년 1월 1일부터, 2027-03-01, 2027. 2. 1. 시행");
  assert.deepEqual(d.map((x) => x.iso), ["2027-01-01", "2027-03-01", "2027-02-01"]);
  assert.equal(L.findDates("2027년 2월 30일")[0].iso, "");
});

test("금액 찾기: 쉼표 있는 원 금액만 (작은 숫자는 무시)", () => {
  assert.deepEqual(L.findAmounts("시급 11,000원 → 11,500원, 5원"), [11000, 11500]);
});

test("고시 링크 검사: 정부 도메인 / 샘플 / 기타 / 잘못된 주소", () => {
  assert.equal(L.linkInfo("https://www.example-labor.go.kr/a").kind, "gov");
  assert.equal(L.linkInfo(WAGE.link).kind, "sample");
  assert.equal(L.linkInfo("https://blog.example.com/a").kind, "other");
  assert.equal(L.linkInfo("http://x.go.kr").kind, "bad");
  assert.equal(L.linkInfo("고시 링크").ok, false);
});

test("안내 대상: 시급제 직원이 있는 곳만, 서식 개정은 교대·연장 근무가 있는 곳", () => {
  assert.equal(L.affected(WAGE, BAKERY).yes, true);
  assert.equal(L.affected(WAGE, OFFICE).yes, false);
  assert.equal(L.affected(FORM, OFFICE).yes, false);
  assert.equal(L.affected({ target: "all" }, OFFICE).yes, true);
});

test("틀 초안은 그대로 대조를 통과한다 (대조 확인을 누르면 보낼 수 있음)", () => {
  const d = L.ruleDraft(WAGE, BAKERY);
  assert.match(d.body, /2027년 1월 1일/);
  assert.match(d.body, /11,000원 → 11,500원/);
  assert.ok(d.body.includes(WAGE.link));
  assert.match(d.body, /상담에서 함께 확인/);
  const before = L.checkDraft(d, WAGE, false);
  assert.equal(before.canSend, false);
  assert.ok(before.issues.some((x) => x.code === "confirm"));
  assert.equal(L.checkDraft(d, WAGE, true).canSend, true);
});

test("시행일이 틀린 초안은 대조 확인을 눌러도 막힌다", () => {
  const d = L.ruleDraft(WAGE, BAKERY);
  d.body = d.body.replace("2027년 1월 1일", "2026년 1월 1일");
  const r = L.checkDraft(d, WAGE, true);
  assert.equal(r.canSend, false);
  assert.ok(r.issues.some((x) => x.code === "date" && x.text === "2026년 1월 1일"));
});

test("시행일이 아예 없거나, 고시에 없는 금액이 있으면 막는다", () => {
  const r1 = L.checkDraft({ subject: "안내", body: `최저임금이 바뀝니다. 근거 ${WAGE.link}` }, WAGE, true);
  assert.ok(r1.issues.some((x) => x.code === "nodate"));
  const d = L.ruleDraft(WAGE, BAKERY);
  d.body = d.body.replace("11,500원", "11,600원");
  assert.ok(L.checkDraft(d, WAGE, true).issues.some((x) => x.code === "amount" && /11,600원/.test(x.msg)));
});

test("근거 링크가 빠지면 막고, ensureLink 는 사람이 넣은 링크를 붙인다", () => {
  const d = { subject: "[노무 안내] 시행 2027-03-01", body: "연장근로 기록 서식이 2027년 3월 1일부터 바뀝니다." };
  assert.ok(L.checkDraft(d, FORM, true).issues.some((x) => x.code === "nolink"));
  d.body = L.ensureLink(d.body, FORM.link);
  assert.equal(L.checkDraft(d, FORM, true).canSend, true);
  assert.equal(L.ensureLink(d.body, FORM.link), d.body, "이미 있으면 또 붙이지 않는다");
});

test("단정적인 법적 판단 표현은 '확인'으로 표시한다", () => {
  const d = L.ruleDraft(FORM, BAKERY);
  d.body += "\n기존 서식을 쓰면 과태료가 부과됩니다.";
  const r = L.checkDraft(d, FORM, true);
  assert.ok(r.issues.some((x) => x.code === "judge" && x.level === "warn"));
});

test("AI 응답 검사: 제목·본문이 없거나 너무 짧으면 null", () => {
  assert.equal(L.normalizeDraft(null), null);
  assert.equal(L.normalizeDraft({ subject: "안내", body: "짧음" }), null);
  assert.equal(L.normalizeDraft({ body: "x".repeat(60) }), null);
  const n = L.normalizeDraft({ subject: " 안내 ", body: "가".repeat(60), checks: ["시행일 확인", 3] });
  assert.equal(n.subject, "안내");
  assert.deepEqual(n.checks, ["시행일 확인"]);
});

test("발송 대기 내보내기: 담당자 이름을 가리고 시행일 대조·근거를 적는다", () => {
  const d = L.ruleDraft(WAGE, BAKERY);
  const txt = L.exportQueue([{ amend: "a1", clientId: "c1", client: BAKERY.name, contactName: "김도원", contactRole: "실장", subject: d.subject, body: d.body, effective: WAGE.effective, link: WAGE.link }]);
  assert.doesNotMatch(txt, /김도원/);
  assert.match(txt, /김\*원 실장/);
  assert.match(txt, /시행일 대조: 2027-01-01 확인함/);
  assert.match(txt, /샘플 값/);
});

test("진행 현황: 대상·검토 중·대기 수", () => {
  const p = L.progress(WAGE, [BAKERY, OFFICE], { "a1:c1": {} }, [{ amend: "a1", clientId: "c1" }]);
  assert.deepEqual(p, { targets: 1, drafted: 1, queued: 1 });
});
