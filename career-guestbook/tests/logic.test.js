// 한마디함 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

test("칭찬 문장은 칭찬·긍정으로 나눈다", () => {
  const c = L.classify("발표 내용이 정말 유익했어요. 감사합니다!");
  assert.equal(c.cat, "칭찬");
  assert.equal(c.mood, "긍정");
  assert.ok(c.hits.includes("유익"));
});

test("물음표가 있으면 질문이 이긴다 (동점일 때 질문 우선)", () => {
  assert.equal(L.classify("발표 자료를 받을 수 있나요?").cat, "질문");
  assert.equal(L.classify("좋았는데 다음은 언제 하나요?").cat, "질문");
});

test("불편·아쉬움은 개선 요청·부정", () => {
  const c = L.classify("자리가 좁아서 노트북 펴기가 불편했어요.");
  assert.equal(c.cat, "개선 요청");
  assert.equal(c.mood, "부정");
  assert.equal(c.topic, "장소·시설");
});

test("'~었으면 해요' 같은 바람은 개선 요청으로 본다", () => {
  assert.equal(L.classify("다음엔 초보자용 세션도 있었으면 해요.").cat, "개선 요청");
});

test("'좋았으면' 의 '좋'은 칭찬 근거로 세지 않는다", () => {
  const c = L.classify("발표가 조금 더 짧았으면 좋겠어요");
  assert.equal(c.cat, "개선 요청");
});

test("맞는 단어가 없으면 기타·중립", () => {
  const c = L.classify("그냥 들러 봤어요");
  assert.equal(c.cat, "기타");
  assert.equal(c.mood, "중립");
  assert.deepEqual(c.hits, []);
});

test("빈 글·이상한 입력에도 멈추지 않는다", () => {
  assert.equal(L.classify("").cat, "기타");
  assert.equal(L.classify(null).cat, "기타");
  assert.equal(L.topicOf(undefined), "");
});

test("주제 묶기: 마이크·소리는 음향·화면", () => {
  assert.equal(L.topicOf("마이크 소리가 뒤쪽에서 잘 안 들렸어요"), "음향·화면");
  assert.equal(L.topicOf("시작 시간이 30분 늦어져서"), "시간 배분");
});

test("Claude 분류 응답 검증: 정해진 범주가 아니면 버린다", () => {
  assert.equal(L.normalizeClassify({ category: "불만", sentiment: "부정" }), null);
  assert.equal(L.normalizeClassify(null), null);
  const ok = L.normalizeClassify({ category: "질문", sentiment: "이상함", topic: "안내·공지", reason: "환불 절차를 묻는다" });
  assert.equal(ok.cat, "질문");
  assert.equal(ok.mood, "중립"); // 모르는 감정은 중립으로
});

test("Claude 요약 응답 검증: 문장이 2개 미만이면 버리고, 할 일은 4개까지", () => {
  assert.equal(L.normalizeSummary({ lines: ["하나"] }), null);
  assert.equal(L.normalizeSummary({ lines: "문자열" }), null);
  const s = L.normalizeSummary({
    lines: ["a", "b", "c", "d"],
    actions: Array.from({ length: 6 }, (_, i) => ({ topic: `t${i}`, count: "3", suggestion: "s" })).concat([{ topic: 1 }]),
  });
  assert.equal(s.lines.length, 3);
  assert.equal(s.actions.length, 4);
  assert.equal(s.actions[0].count, 3);
});

test("규칙 요약: 숫자가 실제 개수와 맞는다", () => {
  const rows = [
    { text: "좋았어요", cat: "칭찬", mood: "긍정", reply: "" },
    { text: "언제 하나요?", cat: "질문", mood: "중립", reply: "" },
    { text: "언제 끝나나요?", cat: "질문", mood: "중립", reply: "답함" },
    { text: "마이크가 안 들렸어요", cat: "개선 요청", mood: "부정", reply: "" },
  ];
  const d = L.digest(rows);
  assert.equal(d.total, 4);
  assert.equal(d.counts["질문"], 2);
  assert.equal(d.unanswered, 1);
  assert.equal(d.pos, 25);
  assert.equal(d.actions[0].topic, "음향·화면");
  assert.equal(d.lines.length, 3);
});

test("의견이 없으면 요약 문장도 할 일도 없다", () => {
  const d = L.digest([]);
  assert.equal(d.total, 0);
  assert.deepEqual(d.lines, []);
  assert.deepEqual(d.actions, []);
});

test("요약 입력은 최근 80건, 글은 200자까지만 보낸다", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ cat: "기타", text: "가".repeat(300) + i }));
  const inp = L.summaryInput(rows);
  assert.equal(inp.posts.length, 80);
  assert.equal(inp.posts[0].text.length, 200);
});

test("방 코드: 형식에 맞고, 같은 난수면 같은 코드", () => {
  let i = 0; const r = () => ((i++ * 0.137) % 1);
  const a = L.newRoomCode(r);
  i = 0;
  assert.equal(L.newRoomCode(r), a);
  assert.ok(L.validRoom(a));
  assert.equal(a.length, 8);
  assert.ok(!L.validRoom("AB"));
  assert.ok(!L.validRoom("abc-def-ghi"));
});

test("참가자 주소 읽기: 방 코드가 올바를 때만 참가자 화면", () => {
  assert.deepEqual(L.parseJoin("?room=abcd2345&join=1"), { room: "abcd2345", join: true });
  assert.deepEqual(L.parseJoin("?room=abcd2345"), { room: "abcd2345", join: false });
  assert.deepEqual(L.parseJoin("?room=<script>&join=1"), { room: "", join: false });
  assert.equal(L.joinUrl("https://x.kr/demo/a/index.html?room=old#top", "abcd2345"), "https://x.kr/demo/a/index.html?room=abcd2345&join=1");
});

test("실시간 글 합치기: 이미 받은 글은 다시 넣지 않는다", () => {
  const items = [{ id: "r5", rid: 5, live: true, text: "a" }, { id: 1, text: "샘플" }];
  const added = L.mergeRoom(items, [
    { id: 5, body: "a", category: "칭찬", created_at: "2026-10-20T00:00:00Z" },
    { id: 6, body: "새 글", category: "질문", sentiment: "중립", mode: "ai", created_at: "2026-10-20T00:01:00Z" },
    { id: 6, body: "중복", category: "질문", created_at: "2026-10-20T00:01:00Z" },
  ]);
  assert.equal(added.length, 1);
  assert.equal(added[0].id, "r6");
  assert.equal(added[0].ai.mode, "ai");
  assert.equal(L.lastRoomId(items.concat(added)), 6);
});

test("서버 글의 모르는 분류는 기타로 받는다", () => {
  const p = L.fromRoomPost({ id: 9, body: "x", category: "??", sentiment: "??", created_at: "bad" });
  assert.equal(p.ai.cat, "기타");
  assert.equal(p.ai.mood, "중립");
  assert.equal(p.ai.mode, "rule");
  assert.ok(Number.isFinite(p.at));
});

test("몇 분 전 표시", () => {
  const now = 10_000_000;
  assert.equal(L.ago(now - 20_000, now), "방금");
  assert.equal(L.ago(now - 7 * 60000, now), "7분 전");
  assert.equal(L.ago(now - 130 * 60000, now), "2시간 전");
  assert.equal(L.ago(now - 49 * 3600000, now), "2일 전");
});
