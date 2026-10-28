// 미리봄 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-28";
const RESUME = `한지우 / 010-2841-5530 / jiwoo.han@example.com
경력
2018.03 - 현재  가람대학교 학사지원팀 · 행정 주임
 - 교직원 채용 공고·서류 접수 운영 (연 4회)
 - 학사 규정 개정안 정리, 설명회 12회 진행
2016.01 - 2018.02  누리교육재단 · 사무 계약직
 - 강사 교육 일정 운영
자격·교육
 - 사회조사분석사 2급`;
const CLIENT = { id: "c1", name: "한지우", target: "hr", worry: "행정 경력이 인정될까요? 연봉이 줄어도 괜찮아요.", resume: RESUME };

test("개인정보 가리기: 전화·이메일·주민번호", () => {
  const m = L.maskPii("010-2841-5530 / a.b@example.com / 900101-1234567 / 01098765432");
  assert.ok(!/2841|5530|a\.b@|1234567|98765432/.test(m), m);
  assert.ok(m.includes("(이메일 가림)"));
});

test("경력 읽기: 기간·기관·직무·업무 줄", () => {
  const c = L.parseCareer(RESUME, TODAY);
  assert.equal(c.jobs.length, 2);
  assert.deepEqual([c.jobs[0].org, c.jobs[0].role], ["가람대학교 학사지원팀", "행정 주임"]);
  assert.equal(c.jobs[0].bullets.length, 2);
  assert.equal(c.jobs[1].bullets.length, 1, "자격·교육 아래 줄은 경력 업무가 아니다");
  // 2016.01~2018.02 = 26개월, 2018.03~2026.10 = 104개월
  assert.equal(c.months, 130);
  assert.equal(L.yearsLabel(c.months), "10년 10개월");
});

test("겹치는 경력 기간은 한 번만 센다", () => {
  const c = L.parseCareer(`2020.01 - 2020.12 가 · 직원\n2020.07 - 2021.06 나 · 직원`, TODAY);
  assert.equal(c.months, 18);
});

test("잘못된 기간(끝이 시작보다 앞, 13월)은 버린다", () => {
  const c = L.parseCareer(`2022.05 - 2021.01 가 · 직원\n2020.13 - 현재 나 · 직원`, TODAY);
  assert.equal(c.jobs.length, 0);
});

test("규칙 진단: 강점은 핵심어가 겹치는 업무 줄, 채울 부분은 빠진 핵심어", () => {
  const d = L.ruleDiagnose(CLIENT, TODAY);
  assert.equal(d.mode, "rule");
  assert.ok(d.hit.includes("채용") && d.hit.includes("규정"));
  assert.ok(d.strengths.some((s) => s.includes("채용")));
  assert.ok(d.strengths[0].includes("규정"), "핵심어가 많이 겹치는 줄이 먼저");
  assert.ok(d.gaps.includes("면접"));
  assert.ok(d.questions.some((q) => q.includes("연봉")), "고민에 연봉이 있으면 하한선 질문");
});

test("주의 신호: 마음 건강·노무 표현은 사람에게 넘긴다", () => {
  const f = L.safetyFlags("요즘 잠을 잘 못 자요. 권고사직 위로금이 맞는지도 모르겠고요.");
  assert.deepEqual(f.map((x) => x.kind), ["wellbeing", "labor"]);
  assert.ok(f.every((x) => /하지 않습니다/.test(x.action)));
  assert.equal(L.safetyFlags("연봉이 걱정돼요").length, 0);
});

test("Claude 응답 검사: 요약·질문이 없으면 버린다", () => {
  assert.equal(L.normalizeDiagnose(null), null);
  assert.equal(L.normalizeDiagnose({ summary: "", questions: ["a"] }), null);
  assert.equal(L.normalizeDiagnose({ summary: "요약", questions: [] }), null);
  assert.equal(L.normalizeDiagnose({ summary: "요약", questions: "질문" }), null);
  const n = L.normalizeDiagnose({ summary: " 요약 ", strengths: ["강점", 3], gaps: [], questions: ["q1", "q2", "q3", "q4", "q5", "q6"] });
  assert.equal(n.summary, "요약");
  assert.deepEqual(n.strengths, ["강점"]);
  assert.equal(n.questions.length, 5);
});

test("Claude 결과를 합쳐도 주의 신호와 경력 계산은 규칙 것을 유지", () => {
  const rule = L.ruleDiagnose({ ...CLIENT, worry: "권고사직을 받았어요" }, TODAY);
  const m = L.mergeDiagnose(rule, { summary: "AI 요약", strengths: [], gaps: ["면접 경험"], questions: ["질문"] });
  assert.equal(m.mode, "ai");
  assert.equal(m.flags.length, 1);
  assert.equal(m.career.months, rule.career.months);
  assert.deepEqual(m.strengths, rule.strengths, "AI 강점이 비면 규칙 강점");
});

test("AI 입력에는 이름·연락처가 없다", () => {
  const inp = JSON.stringify(L.aiInput(CLIENT));
  assert.ok(!inp.includes("한지우") && !inp.includes("5530") && !inp.includes("example.com"));
  assert.ok(inp.includes("채용"));
});

test("파일 권한: 본인과 담당 코치만 열 수 있다", () => {
  const file = { id: "f8k2", owner: "c1", coach: "coachA" };
  assert.equal(L.canOpen(file, { role: "client", id: "c1" }), true);
  assert.equal(L.canOpen(file, { role: "coach", id: "coachA" }), true);
  assert.equal(L.canOpen(file, { role: "coach", id: "coachB" }), false);
  assert.equal(L.canOpen(file, { role: "client", id: "c2" }), false);
  assert.equal(L.canOpen(file, { role: "guest", id: "anon" }), false);
  assert.equal(L.canOpen(file, null), false);
});

test("열람 주소: 10분 뒤 만료, 다른 사람이 쓰면 거절, 이름이 들어가지 않음", () => {
  const file = { id: "f8k2", owner: "c1", coach: "coachA" };
  const now = Date.UTC(2026, 9, 28, 1, 0);
  const coach = { role: "coach", id: "coachA" };
  const link = L.issueLink(file, coach, now);
  assert.ok(link && !link.url.includes("한지우"));
  assert.equal(L.issueLink(file, { role: "guest", id: "anon" }, now), null);
  assert.equal(L.verifyLink(link, file, coach, now + 60000).ok, true);
  assert.equal(L.verifyLink(link, file, coach, now + L.LINK_MS + 1).reason, "만료됨");
  assert.equal(L.verifyLink(link, file, { role: "client", id: "c1" }, now).reason, "다른 사람에게 발급된 주소");
  assert.equal(L.verifyLink(link, file, { role: "coach", id: "coachB" }, now).reason, "권한 없음");
});

test("요약 리포트: '→'는 할 일, '#' 줄과 연락처는 빠진다", () => {
  const d = L.ruleDiagnose(CLIENT, TODAY);
  const r = L.buildReport(CLIENT, d, "- 채용 운영 경험을 HR 언어로 바꿔 보기로\n# 표정이 많이 지쳐 보임\n→ 이력서 첫 줄 다시 쓰기\n할 일: 010-1111-2222 로 연락", "10/28");
  assert.ok(r.startsWith("한○○님 상담 요약"));
  assert.ok(r.includes("1. 이력서 첫 줄 다시 쓰기"));
  assert.ok(!r.includes("지쳐"), "코치 전용 줄은 고객 리포트에 없다");
  assert.ok(!r.includes("1111-2222"));
  assert.ok(!r.includes("한지우"));
});
