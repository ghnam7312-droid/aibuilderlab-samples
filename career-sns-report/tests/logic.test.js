// 곁눈 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-28"; // 수요일
const LAST_WEEK = "2026-10-19"; // 지난주 월요일

test("날짜 도우미: 주 시작(월요일)·더하기·요일", () => {
  assert.equal(L.weekStart(TODAY), "2026-10-26");
  assert.equal(L.weekStart("2026-11-01"), "2026-10-26"); // 일요일
  assert.equal(L.addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(L.withDay(LAST_WEEK), "10/19(월)");
});

test("날짜 맞추기: 섞인 형식 7종이 모두 YYYY-MM-DD 하나로", () => {
  const cases = {
    "2026-10-21": "2026-10-21",
    "2026. 10. 21.": "2026-10-21",
    "2026/10/21": "2026-10-21",
    "2026년 10월 21일 오후 3:12": "2026-10-21",
    "10/21": "2026-10-21",
    "10.21": "2026-10-21",
    "21 Oct 2026": "2026-10-21",
    "Oct 21, 2026": "2026-10-21",
    "46316": "2026-10-21",
    "어제": "2026-10-27",
    "3일 전": "2026-10-25",
    "5시간 전": TODAY,
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(L.normDate(raw, TODAY).date, want, raw);
});

test("연도 없는 날짜: 오늘보다 7일 넘게 뒤면 작년", () => {
  assert.equal(L.normDate("12/30", "2027-01-03").date, "2026-12-30");
  assert.equal(L.normDate("11/2", TODAY).date, "2026-11-02");
  assert.equal(L.normDate("10월 21일", TODAY).date, "2026-10-21");
});

test("읽을 수 없거나 없는 날짜는 버리지 않고 '확인 필요'로 남긴다", () => {
  assert.equal(L.normDate("날짜?", TODAY).date, "");
  assert.equal(L.normDate("2026-02-30", TODAY).date, "");
  assert.equal(L.normDate("", TODAY).kind, "빈 칸");
  const ps = L.parseSheet("브랜드\t날짜\n귀리하루\t날짜?\t피드\t행사\t3\t1\thttps://feed.example/a", TODAY);
  assert.equal(ps.length, 1);
  assert.equal(L.buildReport(ps, LAST_WEEK).unknown.length, 1);
});

test("날짜를 맞춰야 정렬이 맞는다 (원문 글자 순 정렬은 틀린다)", () => {
  const ps = L.parseSheet(["브루잇\t10/25\t피드\ta", "브루잇\t2026-10-19\t피드\tb", "브루잇\t46318\t피드\tc", "브루잇\t21 Oct 2026\t피드\td"].join("\n"), TODAY);
  const r = L.buildReport(ps, LAST_WEEK);
  assert.deepEqual(r.posts.map((p) => p.date), ["2026-10-25", "2026-10-23", "2026-10-21", "2026-10-19"]);
  assert.notDeepEqual(L.naiveSort(ps).map((p) => p.text), r.posts.map((p) => p.text));
});

test("숫자 읽기: 만·k·쉼표", () => {
  assert.equal(L.parseCount("1.2만"), 12000);
  assert.equal(L.parseCount("3.4k"), 3400);
  assert.equal(L.parseCount("1,234"), 1234);
  assert.equal(L.parseCount("-"), 0);
});

test("표 읽기: 머리글 건너뛰기, http 링크만 인정", () => {
  const ps = L.parseSheet("브랜드\t날짜\t채널\t내용\t좋아요\t댓글\t링크\n잔잔티\t10/20\t블로그\t글\t10\t2\tjavascript:alert(1)\n\n물결워터\t10/21\t피드\t글\t5\t1\thttps://feed.example/x", TODAY);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].link, "");
  assert.equal(ps[1].link, "https://feed.example/x");
  assert.equal(ps[1].id, "p2");
});

test("샘플 시트: 지난주 13건, 이번 주·그 전 4건은 빼고, 1건 확인 필요", () => {
  const ps = L.parseSheet(L.sampleSheet(TODAY), TODAY);
  assert.equal(ps.length, 18);
  assert.ok(new Set(ps.map((p) => p.kind)).size >= 6, "형식이 섞여 있어야 한다");
  const r = L.buildReport(ps, LAST_WEEK);
  assert.equal(r.posts.length, 13);
  assert.equal(r.outside, 4);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.brands.length, 5);
  assert.equal(r.brands[0].name, "탄산공방");
});

test("규칙 요약: 문장마다 근거 게시물 id가 붙고, 조사가 받침에 맞는다", () => {
  const r = L.buildReport(L.parseSheet(L.sampleSheet(TODAY), TODAY), LAST_WEEK);
  const s = L.ruleSummary(r);
  assert.ok(s.lines.length >= 3);
  for (const l of s.lines) assert.ok(l.refs.length > 0 && l.refs.every((id) => r.posts.some((p) => p.id === id)), l.text);
  assert.ok(s.lines[0].text.startsWith("탄산공방이"));
  assert.equal(L.jo("물결워터", "은", "는"), "물결워터는");
  assert.deepEqual(L.ruleSummary(L.buildReport([], LAST_WEEK)).lines, []);
});

test("Claude 응답 검사: 원문 링크(게시물 id)가 없는 문장은 버린다", () => {
  const r = L.buildReport(L.parseSheet(L.sampleSheet(TODAY), TODAY), LAST_WEEK);
  const n = L.normalizeSummary({ lines: [
    { text: "탄산공방이 챌린지로 반응을 모았다", refs: ["p5", "p6"] },
    { text: "업계 전체가 제로 음료로 옮겨 가는 중", refs: [] },
    { text: "근거 id가 지어낸 것", refs: ["p99"] },
    { text: "브루잇은 신메뉴 알림이 중심", refs: ["p2", "p2", "p14"] },
  ], watch: "물결워터 게시 빈도 확인" }, r);
  assert.equal(n.lines.length, 2);
  assert.equal(n.dropped, 2);
  assert.deepEqual(n.lines[1].refs, ["p2"]); // 중복 제거, 이번 주 밖(p14) 제외
  assert.equal(L.normalizeSummary({ lines: [{ text: "하나뿐", refs: ["p5"] }] }, r), null);
  assert.equal(L.normalizeSummary("텍스트", r), null);
});

test("발행: 같은 주는 한 번만, 연속 주 수 세기", () => {
  let issues = [];
  for (let i = 8; i >= 1; i--) issues = L.publish(issues, L.addDays(LAST_WEEK, -7 * i), "x");
  assert.equal(issues.length, 8);
  assert.equal(L.streak(issues), 8);
  issues = L.publish(issues, LAST_WEEK, "y");
  assert.equal(issues[8].no, 9);
  assert.equal(L.publish(issues, LAST_WEEK, "z").length, 9);
  assert.equal(L.streak(issues), 9);
  assert.equal(L.streak(issues.filter((x) => x.no !== 5)), 4);
});

test("마크다운: 요약 문장마다 원문 링크", () => {
  const ps = L.parseSheet(L.sampleSheet(TODAY), TODAY);
  const r = L.buildReport(ps, LAST_WEEK);
  const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
  const out = L.toMarkdown(r, L.ruleSummary(r), 9, byId);
  assert.ok(out.startsWith("## 경쟁 브랜드 SNS 주간 리포트 #9 · 10/19–10/25"));
  const sumLines = out.split("\n").filter((l) => l.startsWith("- ") && !l.startsWith("- 확인"));
  for (const l of sumLines) assert.match(l, /\[원문1\]\(https:\/\/feed\.example\//);
  assert.ok(out.includes("| 탄산공방 | 4 |"));
});
