// 당일결과 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const CSV = `이름,부서,내용,강사,적용,시간,자료,사전,사후,추천,의견
김도현,영업1팀,5,5,4,3,4,2,4,9,"김도현 팀장님 사례가 우리 팀 얘기 같았어요. 실습 시간이 짧았어요"
박서연,영업1팀,4,5,4,3,4,3,4,8,도현 팀장님이랑 롤플 한 게 제일 좋았어요
이준호,영업1팀,5,4,5,4,5,2,5,10,
최민지,영업1팀,4,4,4,2,4,3,4,7,시간이 빠듯해서 아쉬웠어요
정하늘,영업1팀,5,5,5,4,4,2,4,9,자료 받고 싶어요 010-1234-5678
한지우,인사팀,3,4,3,3,3,3,3,6,"현업에 바로 적용하기는 어려웠어요, 사례가 더 있으면"
오세린,재무팀,4,4,4,3,4,2,3,8,심화 과정도 있으면 좋겠어요`;

const NAMES = ["김도현", "박서연", "이준호", "최민지", "정하늘", "한지우", "오세린"];

test("CSV: 따옴표 안 쉼표를 지키고, 제목 줄을 건너뛴다", () => {
  const { rows, errors } = L.parseCsv(CSV);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 7);
  assert.equal(rows[5].comment, "현업에 바로 적용하기는 어려웠어요, 사례가 더 있으면");
  assert.deepEqual(rows[0].q, [5, 5, 4, 3, 4]);
});

test("CSV: 점수 범위·칸 수가 틀린 줄은 버리고, 오류 문구에 이름을 쓰지 않는다", () => {
  const { rows, errors } = L.parseCsv(`김도현,영업1팀,6,5,4,3,4,2,4,9,좋음\n박서연,영업1팀,4\n이준호,영업1팀,5,4,5,4,5,2,5,10,`);
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => !e.includes("김도현") && !e.includes("박서연")));
  assert.match(errors[0], /^1번째 응답/);
});

test("익명 처리: 성+이름, 이름+호칭, 연락처를 가린다", () => {
  const m = L.maskText("김도현 팀장님 사례 좋았고 도현 팀장님 덕분, 서연님도. 연락 010-1234-5678, a.b@ex.co.kr", NAMES);
  assert.ok(!m.text.includes("김도현"));
  assert.ok(!m.text.includes("도현 팀장"));
  assert.ok(!m.text.includes("서연님"));
  assert.ok(m.text.includes("(연락처)") && m.text.includes("(이메일)"));
  assert.equal(m.hits, 5);
});

test("익명 처리: 성+직함('김 팀장')도 가리고, 이름이 아닌 말은 건드리지 않는다", () => {
  assert.equal(L.maskText("김 팀장님이 설명", NAMES).text, `${L.MASK} 팀장님이 설명`);
  assert.equal(L.maskText("실습 시간이 짧았어요", NAMES).text, "실습 시간이 짧았어요");
});

test("anonymize: 의견에 이름이 남지 않고, 응답 순서와 다르게 섞인다", () => {
  const { rows } = L.parseCsv(CSV);
  const a = L.anonymize(rows);
  assert.equal(a.comments.length, 6);
  const all = a.comments.map((c) => c.text).join("\n");
  assert.deepEqual(L.leakCheck(all, NAMES), []);
  assert.ok(a.masked >= 3);
  assert.notDeepEqual(a.comments.map((c) => c.text), rows.filter((r) => r.comment).map((r) => L.maskText(r.comment, NAMES).text));
  assert.deepEqual(L.anonymize(rows).comments, a.comments, "같은 입력이면 같은 순서");
});

test("집계: 문항 평균, 사전→사후, 추천 지수", () => {
  const { rows } = L.parseCsv(CSV);
  const g = L.aggregate(rows);
  assert.equal(g.n, 7);
  assert.equal(g.byQ.find((q) => q.key === "time").avg, 3.1);
  assert.equal(g.pre, 2.4);
  assert.equal(g.post, 3.9);
  assert.equal(g.delta, 1.5);
  assert.equal(g.improved, 86); // 한 명은 그대로
  assert.equal(g.nps, 29); // 추천(9~10) 3명 − 비추천(0~6) 1명 → 2/7
});

test("부서별: 5명 미만 부서는 합치고, 합쳐도 모자라면 숨긴다", () => {
  const { rows } = L.parseCsv(CSV);
  const g = L.groupBy(rows);
  assert.deepEqual(g.list.map((x) => [x.dept, x.n]), [["영업1팀", 5]]);
  assert.equal(g.hidden, 2); // 인사팀 1 + 재무팀 1
  const more = rows.concat(rows.slice(0, 3).map((r) => ({ ...r, dept: "인사팀" })), rows.slice(0, 1).map((r) => ({ ...r, dept: "재무팀" })));
  const g2 = L.groupBy(more);
  assert.equal(g2.hidden, 0);
  assert.ok(g2.list.some((x) => x.merged && x.n === 6));
});

test("규칙 요약: 4.0 미만 문항과 반복된 아쉬움을 보완할 점으로", () => {
  const { rows } = L.parseCsv(CSV);
  const s = L.ruleSummary(L.aggregate(rows), L.anonymize(rows).comments);
  assert.match(s.headline, /7명 응답/);
  assert.ok(s.improvements.some((x) => x.includes("시간 배분")));
  assert.ok(s.nextSteps.some((x) => x.includes("실습 시간")));
  assert.ok(s.themes.length >= 2);
  assert.equal(L.ruleSummary(L.aggregate([]), []).strengths.length, 0);
});

test("AI 입력: 집계와 가린 의견만 담고 이름·부서 원자료는 없다", () => {
  const { rows } = L.parseCsv(CSV);
  const a = L.anonymize(rows);
  const input = L.buildAiInput({ course: "리더십", client: "가상고객" }, L.aggregate(rows), a.comments);
  const s = JSON.stringify(input);
  assert.deepEqual(L.leakCheck(s, NAMES), []);
  assert.ok(!s.includes("영업1팀"));
  assert.equal(input.n, 7);
});

test("Claude 응답 검사: 형식이 틀리면 버린다", () => {
  assert.equal(L.normalizeSummary(null, NAMES), null);
  assert.equal(L.normalizeSummary("텍스트", NAMES), null);
  assert.equal(L.normalizeSummary({ headline: "" , strengths: ["a"] }, NAMES), null);
  assert.equal(L.normalizeSummary({ headline: "요약", strengths: [], improvements: [] }, NAMES), null);
  const ok = L.normalizeSummary({ headline: "요약", strengths: ["좋음", 3], improvements: [], commentThemes: [{ theme: "시간", count: "2.4", example: "" }, { count: 3 }], nextSteps: [] }, NAMES);
  assert.deepEqual(ok.strengths, ["좋음"]);
  assert.deepEqual(ok.themes, [{ theme: "시간", count: 2, example: "" }]);
});

test("Claude 응답 검사: 이름이 섞여 오면 다시 가린다", () => {
  const ok = L.normalizeSummary({ headline: "김도현 팀장 사례가 호응", strengths: ["박서연님 롤플"], improvements: [], commentThemes: [{ theme: "사례", count: 2, example: "도현 팀장님 사례" }], nextSteps: ["최민지 의견 반영"] }, NAMES);
  assert.deepEqual(L.leakCheck(JSON.stringify(ok), NAMES), []);
  assert.ok(!JSON.stringify(ok).includes("도현 팀장"));
});

test("보고용 문구: 이름이 없고, 응답률과 부서 기준을 밝힌다", () => {
  const { rows } = L.parseCsv(CSV);
  const g = L.aggregate(rows);
  const txt = L.reportText({ client: "가상고객", course: "리더십", date: "2026-10-28", total: 10 }, g, L.ruleSummary(g, L.anonymize(rows).comments));
  assert.deepEqual(L.leakCheck(txt, NAMES), []);
  assert.match(txt, /응답률 70%/);
  assert.match(txt, /응답 5명 이상만 표시/);
  assert.match(txt, /영업1팀 5명/);
  assert.ok(!txt.includes("인사팀"));
});
