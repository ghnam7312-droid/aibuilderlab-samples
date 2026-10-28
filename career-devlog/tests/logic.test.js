// 커밋일지 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-22"; // 목요일
const REPOS = [
  { name: "capstone-web", private: false, policy: "full" },
  { name: "capstone-api", private: false, policy: "full" },
  { name: "intern-dashboard", private: true, policy: "count" },
  { name: "lab-notes", private: true, policy: "off" },
];
const LOG = `# 샘플
2026-10-19 capstone-web @하늘 feat: 로그인 화면 마크업 (#12)
2026-10-20 capstone-api @지민 PR #14 병합: 출석 API
2026-10-20 capstone-api @지민 feat: 출석 API
2026-10-21 capstone-web @태오 이슈 #9 닫음: 모바일 메뉴 겹침
2026-10-21 intern-dashboard @하늘 fix: 거래처 정산 쿼리 수정
2026-10-22 lab-notes @유나 docs: 교수님 면담 메모
2026-10-22 secret-tool @유나 feat: 사내 배포 스크립트
2026-10-23 capstone-web @유나 docs: 배포 방법 정리, 문의 yuna@example.com
2026-10-12 capstone-web @하늘 feat: 지난주 작업
이건 형식이 틀린 줄`;

test("주 계산: 월요일 시작, 최근 주가 앞", () => {
  assert.equal(L.weekStart(TODAY), "2026-10-19");
  assert.equal(L.weekStart("2026-10-25"), "2026-10-19", "일요일은 그 주 마지막 날");
  const w = L.weeks(TODAY, 8);
  assert.equal(w.length, 8);
  assert.deepEqual(w[0], { start: "2026-10-19", end: "2026-10-25" });
  assert.equal(w[7].start, "2026-08-31");
});

test("활동 읽기: 커밋 종류, PR·이슈 번호, 끝의 (#12) 떼기, 틀린 줄 번호", () => {
  const { items, bad } = L.parseActivity(LOG);
  assert.equal(items.length, 9);
  assert.deepEqual(bad, [11]);
  assert.deepEqual([items[0].kind, items[0].type, items[0].text], ["commit", "feat", "로그인 화면 마크업"]);
  assert.deepEqual([items[1].kind, items[1].ref, items[1].text], ["pr", "#14", "출석 API"]);
  assert.deepEqual([items[3].kind, items[3].type, items[3].ref], ["issue", "fix", "#9"]);
});

test("저장소 정책: 비공개는 '내용 포함'이 될 수 없고, 설정에 없는 저장소는 제외", () => {
  assert.equal(L.policyOf(REPOS, "capstone-web"), "full");
  assert.equal(L.policyOf([{ name: "x", private: true, policy: "full" }], "x"), "count");
  assert.equal(L.policyOf(REPOS, "secret-tool"), "off");
  assert.equal(L.policyOf(REPOS, "lab-notes"), "off");
});

test("민감 정보 가리기: 메일, 토큰, 내부 주소, IP, 전화번호", () => {
  const r = L.redact("문의 a.b@team.dev, 키 ghp_ABCDEFGHIJKLMNOPQRST12, http://wiki.internal/x 서버 10.0.3.4 전화 010-1234-5678");
  assert.equal(r.hits, 5);
  for (const s of ["a.b@team.dev", "ghp_", "wiki.internal", "10.0.3.4", "1234-5678"]) assert.ok(!r.text.includes(s), s);
  assert.equal(L.redact("로그인 화면 마크업").hits, 0);
});

test("비공개 저장소 내용은 일지에 들어가지 않는다 (건수만 / 제외)", () => {
  const { items } = L.parseActivity(LOG);
  const log = L.buildLog(items, L.weeks(TODAY, 1)[0], REPOS);
  const md = L.toMarkdown(log);
  for (const s of ["정산", "면담", "배포 스크립트", "intern-dashboard", "lab-notes", "secret-tool"]) assert.ok(!md.includes(s), s);
  assert.ok(md.includes("비공개 저장소 작업 1건 (내용 비공개)"));
  assert.deepEqual(log.counted, { "intern-dashboard": 1 });
  assert.deepEqual(log.off, { "lab-notes": 1, "secret-tool": 1 });
});

test("일지: 그 주 활동만, 사람별 개수, 커밋과 PR이 같은 일이면 한 번만, 메일은 가림", () => {
  const { items } = L.parseActivity(LOG);
  const log = L.buildLog(items, L.weeks(TODAY, 1)[0], REPOS);
  assert.equal(log.total, 8, "10/12 작업은 빠진다");
  const jimin = log.members.find((m) => m.name === "지민");
  assert.deepEqual([jimin.commit, jimin.pr], [1, 1]);
  assert.equal(jimin.did.length, 1);
  assert.equal(log.redacted, 1);
  assert.ok(!L.toMarkdown(log).includes("yuna@example.com"));
  assert.ok(log.headline.includes("PR 1건"));
});

test("사람 거르기: 고른 사람만 마크다운에", () => {
  const { items } = L.parseActivity(LOG);
  const md = L.toMarkdown(L.buildLog(items, L.weeks(TODAY, 1)[0], REPOS), "태오");
  assert.ok(md.includes("**태오**"));
  assert.ok(!md.includes("**하늘**"));
});

test("막힌 이름: 내용 포함이 아닌 저장소 이름 전부", () => {
  const { items } = L.parseActivity(LOG);
  assert.deepEqual(L.blockedTerms(items, REPOS).sort(), ["intern-dashboard", "lab-notes", "secret-tool"]);
  assert.equal(L.leaks("Intern-Dashboard 정산 고침", ["intern-dashboard"]), true);
});

test("Claude 응답 검사: 통과하면 사람별 한 일을 덮어쓴다", () => {
  const { items } = L.parseActivity(LOG);
  const log = L.buildLog(items, L.weeks(TODAY, 1)[0], REPOS);
  const ai = L.normalizeSummary({ headline: "로그인·출석 API가 붙었어요", members: [{ name: "@지민", did: ["출석 API를 만들고 PR로 병합"] }], next: ["출석 화면 연결"] }, log.members.map((m) => m.name), ["intern-dashboard"]);
  assert.ok(ai);
  const merged = L.mergeSummary(log, ai);
  assert.equal(merged.mode, "ai");
  assert.deepEqual(merged.members.find((m) => m.name === "지민").did, ["출석 API를 만들고 PR로 병합"]);
  assert.deepEqual(merged.members.find((m) => m.name === "하늘").did, log.members.find((m) => m.name === "하늘").did, "응답에 없는 사람은 규칙 결과 유지");
});

test("Claude 응답 검사: 비공개 저장소 이름·없는 사람·되살아난 메일·형식 오류면 버린다", () => {
  const names = ["하늘", "지민"];
  const ok = { headline: "요약", members: [{ name: "하늘", did: ["로그인 화면"] }], next: [] };
  assert.ok(L.normalizeSummary(ok, names, ["intern-dashboard"]));
  assert.equal(L.normalizeSummary({ ...ok, next: ["intern-dashboard 정산 마무리"] }, names, ["intern-dashboard"]), null);
  assert.equal(L.normalizeSummary({ ...ok, members: [{ name: "김부장", did: ["x"] }] }, names, []), null);
  assert.equal(L.normalizeSummary({ ...ok, headline: "문의는 yuna@example.com" }, names, []), null);
  assert.equal(L.normalizeSummary({ headline: "", members: [] }, names, []), null);
  assert.equal(L.normalizeSummary("요약", names, []), null);
});

test("설정이 비어 있으면 아무 내용도 내보내지 않는다 (기본은 막기)", () => {
  const { items } = L.parseActivity(LOG);
  const log = L.buildLog(items, L.weeks(TODAY, 1)[0], []);
  assert.equal(log.shownCount, 0);
  assert.equal(log.members.length, 0);
  const md = L.toMarkdown(log);
  assert.ok(md.includes("공개 저장소 활동 없음"));
  assert.ok(!md.includes("로그인"));
});
