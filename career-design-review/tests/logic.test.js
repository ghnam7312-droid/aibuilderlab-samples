// 모아닫기 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const C = (id, source, author, screen, text) => ({ id, source, author, screen, text });
const SAMPLE = [
  C("c1", "kakao", "지우", "홈", "배너 글씨가 너무 작아요"),
  C("c2", "figma", "태민", "홈", "메인 배너 텍스트 크기 키우면 좋겠어요"),
  C("c3", "mail", "윤 교수", "홈", "배너 글자가 작아서 잘 안 읽힙니다"),
  C("c4", "figma", "하린", "홈", "추천 도서 카드 간격이 좁아 답답해요"),
  C("c5", "kakao", "지우", "홈", "추천 도서 카드 사이 간격 좁아요"),
  C("c6", "figma", "태민", "검색", "검색창 안내 문구가 애매해요"),
  C("c7", "mail", "윤 교수", "검색", "최근 검색어 지우기 버튼이 없음"),
  C("c8", "kakao", "하린", "검색", "최근 검색어 삭제 버튼 필요"),
  C("c9", "mail", "하린", "검색", "최근 검색어 삭제 버튼 필요"),
];

test("붙여 넣기 읽기: [채널] 이름 · 화면: 내용", () => {
  assert.deepEqual(L.parseLine("[카톡] 지우 · 홈: 배너 글씨가 작아요"), { source: "kakao", author: "지우", screen: "홈", text: "배너 글씨가 작아요" });
  assert.equal(L.parseLine("[메일] 윤 교수 · 결제 : 단계 표시: 필요").text, "단계 표시: 필요");
  assert.equal(L.parseLine("그냥 한 줄"), null);
  const p = L.parsePaste("[피그마] 하린 · 상세: 줄 간격\n\n아무 말\n[카톡] 태민 · 홈: 색");
  assert.equal(p.ok.length, 2);
  assert.deepEqual(p.bad, [2]);
});

test("비슷한 정도: 같은 뜻 다른 말(글씨·텍스트·글자)도 가깝게", () => {
  assert.ok(L.similarity("배너 글씨가 너무 작아요", "메인 배너 텍스트 크기 키우면 좋겠어요") >= L.THRESHOLD);
  assert.ok(L.similarity("배너 글씨가 너무 작아요", "추천 도서 카드 간격이 좁아요") < 0.2);
  assert.equal(L.similarity("", "배너"), 0);
});

test("똑같은 코멘트(다른 채널로 다시 보낸 것)는 하나만 남긴다", () => {
  const d = L.dedupe(SAMPLE);
  assert.deepEqual(d.removed, ["c9"]);
  assert.equal(d.comments.length, 8);
  assert.deepEqual(d.comments.find((c) => c.id === "c8").alsoIn, ["mail"]);
});

test("같은 의견은 한 수정 항목으로 합친다", () => {
  const g = L.groupComments(L.dedupe(SAMPLE).comments);
  const ids = g.map((x) => x.ids.join(","));
  assert.ok(ids.includes("c1,c2,c3"));
  assert.ok(ids.includes("c4,c5"));
  assert.ok(ids.includes("c7,c8"));
  assert.equal(g.length, 4);
  const banner = g.find((x) => x.ids.includes("c1"));
  assert.deepEqual(banner.sources.sort(), ["figma", "kakao", "mail"]);
});

test("코멘트 하나는 정확히 한 항목에만 (여러 번 묶이지 않음)", () => {
  const g = L.groupComments(L.dedupe(SAMPLE).comments);
  const all = g.flatMap((x) => x.ids);
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, 8);
});

test("다른 화면의 코멘트는 비슷해도 합치지 않는다", () => {
  const g = L.groupComments([C("a", "kakao", "지우", "홈", "버튼 색이 약해요"), C("b", "figma", "태민", "상세", "버튼 색이 약해요")]);
  assert.equal(g.length, 2);
});

test("Claude 응답 검사: 없는 id 버림, 중복 id는 앞 항목만, 빠진 코멘트는 따로 붙임", () => {
  const cs = L.dedupe(SAMPLE).comments;
  const n = L.normalizeGroups({ groups: [
    { ids: ["c1", "c2", "c3", "zz"], summary: "홈 배너 글자 키우기" },
    { ids: ["c3", "c4", "c5"], summary: "카드 간격" },
    { ids: ["c7", "c6"], summary: "검색 화면" },
  ] }, cs);
  const all = n.flatMap((g) => g.ids);
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, cs.length);
  assert.equal(n[0].summary, "홈 배너 글자 키우기");
  assert.deepEqual(n[1].ids, ["c4", "c5"]);
  assert.ok(n.some((g) => g.ids.join() === "c8"));
});

test("Claude 응답 검사: 화면이 섞이면 화면별로 나누고, 형식이 틀리면 null", () => {
  const cs = [C("a", "kakao", "지우", "홈", "버튼"), C("b", "figma", "태민", "상세", "버튼")];
  const n = L.normalizeGroups({ groups: [{ ids: ["a", "b"], summary: "버튼" }] }, cs);
  assert.equal(n.length, 2);
  assert.equal(L.normalizeGroups({ groups: "a,b" }, cs), null);
  assert.equal(L.normalizeGroups({ groups: [{ ids: ["x"] }] }, cs), null);
  assert.equal(L.normalizeGroups(null, cs), null);
});

test("닫기: 보류·안 함은 이유가 있어야 하고, 통계가 바뀐다", () => {
  let g = L.groupComments(L.dedupe(SAMPLE).comments);
  assert.equal(L.setStatus(g, g[0].id, "hold", " ").ok, false);
  assert.equal(L.setStatus(g, g[0].id, "zzz").ok, false);
  g = L.setStatus(g, g[0].id, "done").groups;
  g = L.setStatus(g, g[1].id, "wont", "브랜드 가이드 간격 유지").groups;
  const s = L.stats(g);
  assert.deepEqual([s.total, s.closed, s.open, s.done, s.wont, s.pct], [4, 2, 2, 1, 1, 50]);
  assert.equal(g[1].reason, "브랜드 가이드 간격 유지");
});

test("다시 묶어도 닫은 결정은 지키고, 새 코멘트가 오면 다시 열고, 합친 항목은 풀 수 있다", () => {
  const cs = L.dedupe(SAMPLE).comments;
  let g = L.groupComments(cs);
  const banner = g.find((x) => x.ids.includes("c1"));
  g = L.setStatus(g, banner.id, "done").groups;
  const again = L.carryStatus(g, L.groupComments(cs));
  assert.equal(again.find((x) => x.ids.includes("c1")).status, "done");
  // 닫은 항목에 새 코멘트가 오면 다시 연다
  const more = cs.concat(C("c10", "figma", "태민", "홈", "배너 글자 크기 더 키워 주세요"));
  const reopened = L.carryStatus(g, L.groupComments(more)).find((x) => x.ids.includes("c10"));
  assert.ok(reopened.ids.includes("c1"));
  assert.equal(reopened.status, "open");
  const split = L.splitGroup(again, banner.id, cs);
  assert.equal(split.length, again.length + 2);
  assert.ok(split.filter((x) => ["c1", "c2", "c3"].includes(x.ids[0])).every((x) => x.status === "open"));
});

test("Notion 마크다운: 화면별 체크리스트, 메일 주소·전화번호는 지운다", () => {
  const cs = [C("a", "mail", "윤 교수", "결제", "단계 표시 필요. yoon.prof@example.ac.kr 010-1234-5678")];
  let g = L.groupComments(cs);
  g = L.setStatus(g, g[0].id, "hold", "다음 스프린트").groups;
  const md = L.toNotionMd("책방 앱 2차 시안", g, cs);
  assert.ok(md.includes("### 결제"));
  assert.ok(md.includes("- [x] 단계 표시 필요."));
  assert.ok(md.includes("**보류**: 다음 스프린트"));
  assert.ok(!md.includes("@example") && !md.includes("5678"));
  assert.ok(!g[0].summary.includes("@"), "화면에 보이는 대표 문장도 가린다");
});
