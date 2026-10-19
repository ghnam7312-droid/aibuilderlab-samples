// 다음주 핵심 규칙 테스트 — node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const ACAD = {
  id: "a1", name: "하늘수학학원", teacher: "정다은 선생님", classes: ["중2 A반", "중2 B반"],
  units: [["개념원리", "유리수와 순환소수"], ["개념원리", "단항식의 계산"], ["개념원리", "다항식의 계산"], ["개념원리", "일차부등식"]],
  students: ["김서윤", "이도현", "박지우"],
};

test("정답률은 같은 입력이면 늘 같고 0.15~1 사이다", () => {
  const a = L.rate("a1", "김서윤", "일차부등식");
  assert.equal(a, L.rate("a1", "김서윤", "일차부등식"));
  for (const n of ACAD.students) for (const u of ACAD.units) {
    const r = L.rate("a1", n, u[1]);
    assert.ok(r >= 0.15 && r <= 1, `${n} ${u[1]} ${r}`);
  }
});

test("지난달 정답률은 이번 달보다 높지 않다 (다니는 동안 오른다)", () => {
  for (const n of ACAD.students) for (const u of ACAD.units) {
    assert.ok(L.rate("a1", n, u[1], 2) <= L.rate("a1", n, u[1], 0) + 1e-9);
  }
});

test("보완 단원은 정답률 낮은 순 3개, 같으면 단원표 순서", () => {
  const rs = [{ name: "A", r: 0.9 }, { name: "B", r: 0.5 }, { name: "C", r: 0.5 }, { name: "D", r: 0.3 }, { name: "E", r: 0.7 }];
  assert.deepEqual(L.weakUnits(rs).map((x) => x.name), ["D", "B", "C"]);
  assert.equal(L.weakUnits(rs, 1)[0].name, "D");
  assert.deepEqual(L.weakUnits([]), []);
});

test("규칙 계획은 3줄, 요일과 단원이 들어가고 약할수록 문항이 많다", () => {
  const p = L.rulePlan([{ name: "일차부등식", r: 0.3 }, { name: "다항식", r: 0.6 }, { name: "유리수", r: 0.7 }]);
  assert.equal(p.length, 3);
  assert.match(p[0], /^월·수 일차부등식/);
  assert.match(p[1], /^목 다항식/);
  assert.match(p[2], /^토 유리수/);
  const n = (s) => Number(s.match(/(\d+)문항/)[1]);
  const weaker = L.rulePlan([{ name: "X", r: 0.2 }])[0];
  const stronger = L.rulePlan([{ name: "X", r: 0.9 }])[0];
  assert.ok(n(weaker) > n(stronger));
  assert.equal(n(weaker) % 2, 0);
});

test("보완 단원이 없어도 계획 3줄은 채워진다", () => {
  const p = L.rulePlan([]);
  assert.equal(p.length, 3);
  assert.ok(p.every((s) => s.length > 0));
});

test("Claude 응답 검사: 3줄 미만이면 null, 없는 단원은 버린다", () => {
  const names = ["일차부등식", "다항식의 계산"];
  assert.equal(L.normalizeAiPlan({ plan: ["a", "b"] }, names), null);
  assert.equal(L.normalizeAiPlan(null, names), null);
  assert.equal(L.normalizeAiPlan("문자열", names), null);
  const ok = L.normalizeAiPlan({ weak: ["일차부등식", "지어낸 단원"], plan: ["월 1", "수 2", "토 3", "넷째"], message: "  안녕하세요  " }, names);
  assert.deepEqual(ok.weak, ["일차부등식"]);
  assert.equal(ok.plan.length, 3);
  assert.equal(ok.message, "안녕하세요");
});

test("CSV 단원표: 제목 줄·BOM·따옴표·빈 줄을 견디고 잘못된 줄 번호를 알려 준다", () => {
  const csv = '﻿교재,단원명\n개념원리,유리수와 순환소수\n"개념원리, 개정판","단항식의 ""계산"""\n\n개념원리,\n쎈,일차부등식\n';
  const r = L.parseUnitCsv(csv);
  assert.deepEqual(r.units, [["개념원리", "유리수와 순환소수"], ["개념원리, 개정판", '단항식의 "계산"'], ["쎈", "일차부등식"]]);
  assert.deepEqual(r.skipped, [5]);
});

test("CSV 제목 줄이 없어도 첫 줄부터 읽는다", () => {
  assert.equal(L.parseUnitCsv("쎈,일차함수\n쎈,연립방정식").units.length, 2);
});

test("학생 등록: 줄·쉼표로 나누고 기존·중복 이름은 따로 알려 준다", () => {
  const r = L.parseStudents("홍길동\n 김서윤 , 이몽룡\n홍길동\n\n", ["김서윤"]);
  assert.deepEqual(r.added, ["홍길동", "이몽룡"]);
  assert.deepEqual(r.dup, ["김서윤", "홍길동"]);
});

test("학부모 링크: 한글 리포트가 주소로 갔다가 그대로 돌아온다", () => {
  const rep = {
    academy: "하늘수학학원", teacher: "정다은 선생님", className: "중2 A반", student: "김서윤", month: "10월",
    units: [{ name: "일차부등식", r: 0.6 }, { name: "다항식의 계산", r: 0.79 }],
    weak: ["일차부등식"], plan: ["월·수 일차부등식 개념 복습", "목 오답", "토 테스트"],
    message: "서윤이가 질문이 많아졌어요 😊", note: "부등식만 잡으면 90점대!", trend: [{ m: "9월", v: 0.71 }, { m: "10월", v: 0.83 }], ai: true, date: "2026-10-20",
  };
  const s = L.encodeReport(rep);
  assert.match(s, /^j[A-Za-z0-9_-]+$/, "주소에 그대로 쓸 수 있는 글자만");
  const back = L.decodeReport("#" + s);
  assert.equal(back.student, "김서윤");
  assert.equal(back.message, rep.message);
  assert.deepEqual(back.plan, rep.plan);
  assert.equal(back.units[0].r, 0.6);
  assert.equal(back.trend[1].m, "10월");
  assert.equal(back.ai, true);
});

test("깨진 링크는 null (화면은 안내문을 띄운다)", () => {
  assert.equal(L.decodeReport("이건링크가아님"), null);
  assert.equal(L.decodeReport(""), null);
  assert.equal(L.decodeReport("j" + L.b64urlEncode(JSON.stringify({ v: 2, n: "x" }))), null);
  assert.equal(L.decodeReport("j" + L.b64urlEncode("{깨진 json")), null);
});

test("압축 링크(z)는 더 짧고, 학부모 화면에서 그대로 풀린다", async () => {
  const rep = {
    academy: "하늘수학학원", teacher: "정다은 선생님", className: "중2 A반", student: "김서윤", month: "10월",
    units: ["유리수와 순환소수", "단항식의 계산", "다항식의 계산", "일차부등식", "연립일차방정식", "일차함수와 그래프"].map((name, i) => ({ name, r: 0.5 + i * 0.08 })),
    weak: ["유리수와 순환소수", "단항식의 계산", "다항식의 계산"],
    plan: ["월·수 유리수와 순환소수 개념 복습, 기본 문제 12문항", "목 단항식의 계산 틀린 유형만 8문항", "토 다항식의 계산 포함 누적 테스트 15분"],
    message: "서윤이는 이번 달 일차함수에서 특히 좋았어요.", note: "질문이 많아져서 반가워요.", trend: [{ m: "8월", v: 0.7 }, { m: "9월", v: 0.75 }, { m: "10월", v: 0.8 }], ai: false, date: "2026-10-20",
  };
  const z = await L.encodeReportZ(rep);
  assert.equal(z[0], "z");
  assert.ok(z.length < L.encodeReport(rep).length * 0.8, `압축률 ${z.length} / ${L.encodeReport(rep).length}`);
  const back = await L.decodeReportAny("#" + z);
  assert.deepEqual(back.weak, rep.weak);
  assert.equal(back.units.length, 6);
  assert.equal((await L.decodeReportAny(L.encodeReport(rep))).student, "김서윤");
  assert.equal(await L.decodeReportAny("z이상한값"), null);
});

test("카톡 문구에 링크·계획·한마디가 들어가고 빈 줄이 겹치지 않는다", () => {
  const t = L.shareText({ academy: "A학원", student: "홍길동", month: "10월", units: [{ name: "x", r: 0.5 }], weak: ["x"], plan: ["1", "2", "3"], note: "", teacher: "T", message: "" }, "https://e.x/r#abc");
  assert.match(t, /^\[A학원\] 홍길동 학생 10월 학습 리포트/);
  assert.match(t, /3\. 3/);
  assert.match(t, /리포트 자세히 보기: https:\/\/e\.x\/r#abc$/);
  assert.doesNotMatch(t, /\n\n\n/);
  assert.doesNotMatch(t, /선생님 한마디/);
});

test("요금제 추천과 연 결제·학생당 가격 (예시 가격)", () => {
  assert.equal(L.recommendPlan(15).id, "small");
  assert.equal(L.recommendPlan(31).id, "basic");
  assert.equal(L.recommendPlan(500).id, "pro");
  const basic = L.PLANS[1];
  assert.equal(L.priceOf(basic, false), 99000);
  assert.equal(L.priceOf(basic, true), 82500);
  assert.equal(L.perStudent(basic, 50, false), 1980);
  assert.equal(L.perStudent(basic, 0, false), 0);
});

test("월별 추이: 6개월, 지난달 대비 %p", () => {
  const tr = L.academyTrend(ACAD, (n) => ACAD.classes[ACAD.students.indexOf(n) % 2]);
  assert.equal(tr.length, 1 + ACAD.classes.length);
  assert.equal(tr[0].points.length, 6);
  assert.equal(tr[0].points[5].m, "10월");
  assert.equal(L.deltaPoint([{ v: 0.7 }, { v: 0.734 }]), 3.4);
  assert.equal(L.deltaPoint([{ v: 0.7 }]), 0);
  assert.equal(L.trend(ACAD, "김서윤", 3).length, 3);
});

test("시작하기 체크리스트는 실제 상태로 채워진다", () => {
  const empty = { id: "n1", units: [], students: [] };
  assert.equal(L.onboarding(empty, {}, {}).done, 0);
  const o = L.onboarding(ACAD, { "a1|김서윤": true }, {});
  assert.deepEqual(o.steps.map((s) => s.done), [true, true, true, false]);
  assert.equal(o.done, 3);
});

test("학부모 첫 문장은 학생 이름과 가장 좋은 단원을 담는다", () => {
  const m = L.ruleMessage("김서윤", [{ name: "일차함수", r: 0.95 }, { name: "부등식", r: 0.6 }]);
  assert.match(m, /^김서윤 학생/);
  assert.match(m, /일차함수은\(는\) 95%/);
});
