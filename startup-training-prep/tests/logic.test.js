// 맞춤사례 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const COMPANY = { name: "가상물류", industry: "logistics", size: "직원 약 900명", topic: "신임 팀장 피드백 리더십" };
const MATS = [
  { id: "m1", source: "public", title: "회사 소개 (홈페이지)", text: "전국 6개 물류센터에서 하루 약 8만 건을 출고하는 3자 물류 회사" },
  { id: "m2", source: "survey", title: "사전 설문 요약", text: "응답 20명 중 60%가 연차 많은 팀원 관리를 고민" },
  { id: "m3", source: "internal", title: "센터별 실적", text: "센터별 매출 1,240억, 이직률 18%" },
  { id: "m4", source: "public", title: "면담 메모", text: "박정우 팀장 — 팀원과 출고 일정 갈등" },
  { id: "m5", source: "public", title: "채용 공고", text: "연 매출 3,100억 원 규모의 물류 기업" },
  { id: "m6", source: "public", title: "조직도 (대외비)", text: "‘프로젝트 하늘길’ 신설 예정" },
];

test("사전 진단: 고른 항목을 세고, 자유 응답은 고르지 않은 항목만 더한다", () => {
  const d = L.diagnose([
    { pains: ["senior"], text: "연차 많은 선배에게 말하기 어려워요" },
    { pains: ["senior", "time"], text: "" },
    { pains: [], text: "교대 근무라 마주칠 시간이 없어요" },
    { pains: ["goal"], text: "" },
  ]);
  assert.equal(d.n, 4);
  assert.deepEqual(d.top.map((t) => [t.key, t.count]), [["senior", 2], ["time", 2], ["goal", 1]]);
  assert.equal(d.top[0].percent, 50);
  assert.equal(L.diagnose([]).top.length, 0);
});

test("자료 기준: 공개 정보는 사용, 설문 요약의 비율은 확인 없이 사용", () => {
  assert.equal(L.checkMaterial(MATS[0]).verdict, "ok");
  assert.equal(L.checkMaterial(MATS[1]).verdict, "ok");
});

test("자료 기준: 내부 표시·대외비·실명은 제외", () => {
  assert.equal(L.checkMaterial(MATS[2]).verdict, "block");
  const m4 = L.checkMaterial(MATS[3]);
  assert.equal(m4.verdict, "block");
  assert.ok(m4.reasons.includes("직원 실명"));
  assert.equal(L.checkMaterial(MATS[5]).verdict, "block");
  assert.equal(L.checkMaterial({ source: "public", text: "문의 kim@example.com" }).verdict, "block");
  assert.equal(L.checkMaterial({ source: "public", text: "2025 인사평가 등급 분포" }).verdict, "block");
});

test("자료 기준: 금액 수치는 '확인 필요', 사람이 확인해야 들어간다", () => {
  assert.equal(L.checkMaterial(MATS[4]).verdict, "check");
  assert.deepEqual(L.usable(MATS, {}).map((m) => m.id), ["m1", "m2"]);
  assert.deepEqual(L.usable(MATS, { m5: true }).map((m) => m.id), ["m1", "m2", "m5"]);
  assert.deepEqual(L.usable(MATS, { m3: true, m4: true }).map((m) => m.id), ["m1", "m2"], "제외 자료는 확인해도 못 넣는다");
});

test("이름 찾기: '신임 팀장', '현장 반장'은 이름이 아니다", () => {
  assert.deepEqual(L.findNames("박정우 팀장과 신임 팀장 12명, 현장 반장, 김서연과장"), ["박정우", "김서연"]);
  assert.equal(L.cleanQuote("박정우 팀장님이 신임 팀장들에게 010-1111-2222"), "○○ 팀장님이 신임 팀장들에게");
});

test("AI 입력: 공개 정보와 설문 요약만, 제외 자료의 글자는 없다", () => {
  const d = L.diagnose([{ pains: ["senior"], text: "박정우 팀장님처럼 연차 많은 분께 말하기 어려워요" }]);
  const input = L.buildAiInput(COMPANY, d, MATS, {}, [{ text: "박정우 팀장님처럼 연차 많은 분께 말하기 어려워요" }]);
  const s = JSON.stringify(input);
  for (const bad of ["1,240억", "박정우", "하늘길", "3,100억"]) assert.ok(!s.includes(bad), bad);
  assert.equal(input.publicFacts.length, 1);
  assert.equal(input.industry, "물류");
  assert.equal(input.survey.top[0].key, "senior");
});

test("새어 나감 낱말: 제외한 자료의 수치·실명·따옴표 이름", () => {
  const t = L.leakTokens(MATS, {});
  for (const x of ["1,240억", "18%", "박정우", "프로젝트 하늘길", "3,100억"]) assert.ok(t.includes(x), x);
  assert.ok(!t.includes("8만건"), "사용하는 공개 자료의 숫자는 아니다");
  assert.ok(!L.leakTokens(MATS, { m5: true }).includes("3,100억"));
});

test("규칙 사례: 고민 순서대로 업종 말로 채우고 조사를 받침에 맞춘다", () => {
  const d = { n: 10, top: [{ key: "fear", label: "x", percent: 60 }, { key: "time", label: "y", percent: 40 }, { key: "goal", label: "z", percent: 30 }] };
  const p = L.ruleCases(COMPANY, d);
  assert.deepEqual(p.cases.map((c) => c.pain), ["fear", "time", "goal"]);
  assert.match(p.cases[0].situation, /출고 마감을/);
  assert.match(p.cases[1].situation, /^물류센터는/);
  assert.match(L.ruleCases({ industry: "it" }, d).cases[1].situation, /^개발 조직은/);
  assert.equal(L.josa("라인", "가"), "이");
  assert.equal(L.josa("스쿼드", "이"), "가");
  assert.match(L.ruleCases(COMPANY, { n: 0, top: [] }).diagnosis, /기본 사례/);
});

test("Claude 응답 검사: 형식이 틀리면 버린다", () => {
  assert.equal(L.normalizeCases(null), null);
  assert.equal(L.normalizeCases({ cases: "x" }), null);
  assert.equal(L.normalizeCases({ cases: [{ title: "a", situation: "", question: "q" }] }), null);
  const n = L.normalizeCases({ diagnosis: "d", cases: [{ pain: "없는키", title: "a", situation: "b", question: "c" }, 3], opener: "o" }, []);
  assert.equal(n.cases.length, 1);
  assert.equal(n.cases[0].pain, "");
});

test("Claude 응답 검사: 제외 자료의 수치·실명이 섞인 사례는 버린다", () => {
  const toks = L.leakTokens(MATS, {});
  const n = L.normalizeCases({
    diagnosis: "매출 1,240 억 센터의 고민",
    cases: [
      { pain: "senior", title: "박정우 팀장의 고민", situation: "갈등", question: "어떻게?" },
      { pain: "fear", title: "말 못 한 3주", situation: "물류센터 출고 지연", question: "첫 문장은?" },
    ],
    opener: "지난주 하려다 못 한 말은?",
  }, toks);
  assert.equal(n.cases.length, 1);
  assert.equal(n.dropped, 1);
  assert.equal(n.diagnosis, "", "띄어쓰기가 달라도 수치를 잡는다");
  assert.equal(n.opener, "지난주 하려다 못 한 말은?");
});

test("강의 노트: 설문 순위와 사례, 근거 기준을 적는다", () => {
  const d = { n: 20, top: [{ key: "senior", label: "연차 많은 팀원에게 말 꺼내기", percent: 60 }] };
  const md = L.notesMd(COMPANY, d, L.ruleCases(COMPANY, d));
  assert.match(md, /^# 가상물류/);
  assert.match(md, /1\. 연차 많은 팀원에게 말 꺼내기 \(60%\)/);
  assert.match(md, /### 1\. 열 살 많은 현장 반장/);
  assert.match(md, /내부 자료는 넣지 않음/);
});
