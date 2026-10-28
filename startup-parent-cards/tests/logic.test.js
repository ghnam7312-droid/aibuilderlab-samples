// 집으로 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const SIB = L.splitSentences(L.LECTURES[0].text);
const SLEEP = L.splitSentences(L.LECTURES[2].text);

test("문장 나누기: 번호가 1부터 붙고, 따옴표 안 물음표에서는 자르지 않는다", () => {
  const s = L.splitSentences("첫 문장입니다. 마지막에는 “오늘 뭐가 좋았어?” 하고 물어봐요.\n셋째 문장이에요!");
  assert.deepEqual(s.map((x) => x.no), [1, 2, 3]);
  assert.equal(s[1].text, "마지막에는 “오늘 뭐가 좋았어?” 하고 물어봐요.");
  assert.ok(L.LECTURES.every((l) => L.splitSentences(l.text).length >= 10));
});

test("규칙 카드: 말·행동·질문이 모두 원고 문장에서 나오고 근거 검사를 통과한다", () => {
  for (const lec of L.LECTURES) {
    const s = L.splitSentences(lec.text);
    const c = L.buildCard(s, "", 0);
    assert.deepEqual(c.missing, [], lec.title);
    for (const line of Object.values(c.lines)) {
      assert.ok(line.refs.length > 0);
      assert.ok(line.check.ok, `${lec.title}: ${line.text}`);
      assert.ok(s.find((x) => x.no === line.refs[0]).text.includes(line.text));
    }
  }
});

test("규칙 카드: 전문가 상담을 안내하는 원고 문장은 '해 볼 행동'으로 고르지 않는다", () => {
  for (let seed = 0; seed < 8; seed++) {
    const c = L.buildCard(SLEEP, "", seed);
    assert.ok(!/상담/.test(c.lines.do.text) && !/상담/.test((c.lines.tip || {}).text || ""));
  }
});

test("부모 질문이 바뀌면 고르는 문장도 바뀌고, '다른 문장으로'(seed)는 다른 행동을 고른다", () => {
  const a = L.buildCard(SIB, "", 0).lines.do.refs[0];
  const b = L.buildCard(SIB, "싸움이 커지면 떨어져 앉는 쉬는 자리를 만들어도 될까요", 0).lines.do.refs[0];
  assert.notEqual(a, b);
  assert.equal(b, 4);
  assert.notEqual(L.buildCard(SIB, "", 1).lines.do.refs[0], a);
});

test("근거 검사: 원고에 없는 의학·약 조언은 버린다 (잠자리 카드에 멜라토닌)", () => {
  const r = L.ground({ text: "잠들기 전에 멜라토닌을 조금 먹이면 도움이 됩니다.", refs: [3] }, SLEEP);
  assert.equal(r.ok, false);
  assert.match(r.reason, /의학·발달 조언/);
  assert.equal(L.ground({ text: "잠이 안 오면 약을 먹여 보세요.", refs: [3] }, SLEEP).ok, false);
  // '약속'은 '약'이 아니다
  const phone = L.splitSentences(L.LECTURES[1].text);
  assert.equal(L.ground({ text: "정한 약속은 종이에 적어 가족 모두가 보는 곳에 붙여 둡니다.", refs: [3] }, phone).ok, true);
});

test("근거 검사: 원고에 없는 숫자 기준·발달 기준도 버린다", () => {
  const phone = L.splitSentences(L.LECTURES[1].text);
  assert.match(L.ground({ text: "스마트폰은 하루 1시간만 보게 하세요.", refs: [2] }, phone).reason, /숫자 기준/);
  assert.match(L.ground({ text: "이 시기 형제 다툼은 정상 발달이니 걱정하지 마세요.", refs: [1] }, SIB).reason, /의학·발달/);
});

test("근거 검사: 번호가 없거나, 없는 번호거나, 원고와 다른 말이면 버린다", () => {
  assert.match(L.ground({ text: "아이 마음을 말로 옮겨 주세요.", refs: [] }, SIB).reason, /번호가 없음/);
  assert.match(L.ground({ text: "아이 마음을 말로 옮겨 주세요.", refs: [40] }, SIB).reason, /없는 문장 번호\(40\)/);
  const far = L.ground({ text: "주말에는 가족 여행을 떠나 기분을 바꿔 주세요.", refs: [2] }, SIB);
  assert.equal(far.ok, false);
  assert.ok(far.score < L.MIN_SCORE);
  // 원고 문장을 조금 줄인 것은 통과
  assert.equal(L.ground({ text: "각자의 마음을 한 문장씩 말로 옮겨 주세요.", refs: [2] }, SIB).ok, true);
});

test("Claude 응답: 형식이 틀리면 null, 근거 없는 문장은 버리고 이유를 남긴다", () => {
  assert.equal(L.normalizeCard(null, SLEEP), null);
  assert.equal(L.normalizeCard({ lines: "카드" }, SLEEP), null);
  assert.equal(L.normalizeCard({ lines: [{ slot: "기타", text: "x", refs: [1] }] }, SLEEP), null);
  const r = L.normalizeCard({ lines: [
    { slot: "say", text: "오늘 제일 좋았던 일은 뭐였어?", refs: [4] },
    { slot: "do", text: "잠들기 전 멜라토닌 젤리를 하나 주세요.", refs: [3] },
    { slot: "do", text: "잠들기 전에는 집 안 불빛을 조금씩 낮춰 보세요.", refs: [3] },
    { slot: "ask", text: "나는 잠자리에서 아이 이야기를 서두르지 않고 들었나?", refs: [10] },
  ] }, SLEEP);
  assert.equal(r.usable, true);
  assert.equal(r.lines.do.text, "잠들기 전에는 집 안 불빛을 조금씩 낮춰 보세요.");
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].check.reason, /멜라토닌/);
});

test("Claude 응답: 말·행동·질문 중 근거 있는 것이 하나라도 모자라면 쓰지 않는다", () => {
  const r = L.normalizeCard({ lines: [
    { slot: "say", text: "오늘 제일 좋았던 일은 뭐였어?", refs: [4] },
    { slot: "do", text: "아이 발달에 맞춰 수면 시간을 늘려 주세요.", refs: [6] },
    { slot: "ask", text: "나는 잠자리에서 아이 이야기를 서두르지 않고 들었나?", refs: [10] },
  ] }, SLEEP);
  assert.equal(r.usable, false);
  assert.deepEqual(r.missing, ["do"]);
});

test("부모 질문 분류: 응급 낱말은 119, 건강·발달 낱말은 상담 안내, 나머지는 카드", () => {
  assert.equal(L.triage("동생이 단추를 삼켰어요").level, "urgent");
  assert.equal(L.triage("놀다가 머리를 부딪혔어요").level, "urgent");
  assert.equal(L.triage("또래보다 말이 늦은 것 같아요").level, "consult");
  assert.equal(L.triage("잠을 못 자는데 약을 먹여도 될까요").level, "consult");
  assert.equal(L.triage("ADHD 검사를 받아야 할까요").level, "consult");
  assert.equal(L.triage("스마트폰 약속을 자꾸 안 지켜요").level, "none");
  assert.equal(L.triage("형제가 매일 싸워요").level, "none");
});

test("개인정보: 이름·전화·메일·나이를 가리고, AI 입력에는 가린 질문만 들어간다", () => {
  const q = "김하린 어머님입니다. 010-2345-6789 / harin@example.com 우리 도윤이는 6살인데 동생과 매일 싸워요";
  const t = L.scrub(q);
  assert.ok(!/김하린|2345|example|도윤|6살/.test(t));
  assert.match(t, /\[보호자\].*\[전화\].*\[메일\].*우리 아이.*\[나이\]/);
  const input = L.aiInput(L.LECTURES[0], SIB, q);
  assert.equal(input.question, t);
  assert.equal(input.sentences.length, SIB.length);
  assert.deepEqual(Object.keys(input).sort(), ["lecture", "question", "sentences"]);
});

test("주간 메일: 무료판은 말·행동만, 유료판은 질문·강사 한 줄·근거 원문까지", () => {
  const c = L.buildCard(SIB, "", 0);
  const week = L.weekKey("2026-10-28");
  assert.equal(week, "2026-W44");
  const free = L.buildMail(c, L.LECTURES[0], SIB, "free", week);
  const paid = L.buildMail(c, L.LECTURES[0], SIB, "paid", week);
  assert.match(free.subject, /44주차.*형제 다툼 대화법/);
  assert.ok(free.body.includes(c.lines.say.text) && free.body.includes(c.lines.do.text));
  assert.ok(!free.body.includes(c.lines.ask.text));
  assert.ok(paid.body.includes(c.lines.ask.text) && paid.body.includes("이 카드의 근거"));
  assert.ok(paid.body.includes(`${c.lines.say.refs[0]}. ${SIB[c.lines.say.refs[0] - 1].text}`));
  assert.match(paid.body, /소아청소년과나 전문가와 상담/);
});

test("발송함: 같은 주 같은 강의 카드는 한 장만, 구독 숫자 계산", () => {
  let q = L.addToQueue([], { week: "2026-W44", lectureId: "sibling", n: 1 }).queue;
  const r = L.addToQueue(q, { week: "2026-W44", lectureId: "sibling", n: 2 });
  assert.equal(r.replaced, true);
  assert.equal(r.queue.length, 1);
  assert.equal(r.queue[0].n, 2);
  q = L.addToQueue(r.queue, { week: "2026-W44", lectureId: "sleep", n: 3 }).queue;
  assert.equal(q.length, 2);
  const st = L.subStats(530, 74);
  assert.deepEqual([st.free, st.rate, st.monthly], [456, 14, 362600]);
  assert.equal(L.won(st.monthly), "362,600원");
});
