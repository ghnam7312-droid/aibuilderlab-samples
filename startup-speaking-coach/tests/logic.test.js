// 말해봄 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TARGET = { label: "ended up -ing", re: "ended up \\w+ing" };
const MINSEO = "Last weekend I go to Busan with my family. We eat a lot of seafood and it was very delicious. Um, on Sunday it rained so we, uh, ended up staying in the hotel. I was very boring but my brother enjoy to play games. Um, I think Busan is more better than Seoul in summer.";

test("고칠 점은 최대 2개, 나머지는 '다음 숙제'로 미룬다", () => {
  const r = L.review(MINSEO, 34, TARGET);
  assert.equal(L.MAX_FIXES, 2);
  assert.equal(r.fixes.length, 2);
  assert.ok(r.later.length >= 2);
  assert.equal(r.fixes.length + r.later.length, L.findIssues(MINSEO).length);
});

test("우선순위: 뜻이 달라지는 실수 → 반복 횟수 → 먼저 나온 순서", () => {
  const r = L.review(MINSEO, 34, TARGET);
  assert.deepEqual(r.fixes.map((f) => f.rule), ["past", "feel"]);
  assert.equal(r.fixes[0].count, 2); // I go, We eat
  const d = L.review("Yesterday I meet my friend. He don't like pasta. I am agree with him.", 20, TARGET);
  assert.deepEqual(d.fixes.map((f) => f.rule), ["past", "third"]); // 같은 무게면 먼저 나온 것
});

test("과거 시제: 지난 일을 말할 때만, '나는 생각한다' 같은 현재 문장에서는 끈다", () => {
  assert.equal(L.findIssues("I go to school every day.").length, 0);
  const hits = L.findIssues("Yesterday I go to the park. I think we go there often.");
  assert.equal(hits.find((h) => h.rule === "past").count, 1);
});

test("자주 나오는 실수 규칙들", () => {
  const ids = (t) => L.findIssues(t).map((x) => x.rule).sort();
  assert.deepEqual(ids("I have lived here since 5 years."), ["since"]);
  assert.deepEqual(ids("People is kind."), ["plural"]);
  assert.deepEqual(ids("She enjoys to swim."), ["enjoy"]);
  assert.equal(L.findIssues("She enjoys to swim.")[0].better, "enjoys swimming");
  assert.deepEqual(ids("This is more better."), ["more"]);
  assert.deepEqual(ids("We discussed about it."), ["discuss"]);
  assert.deepEqual(ids("I very like it."), ["verylike"]);
  assert.deepEqual(ids("I have went there."), ["have"]);
});

test("um·uh가 3번 이상이면 고칠 점 후보, 단어 수에서는 뺀다", () => {
  assert.equal(L.countFillers("Um, I, uh, think, um, yes"), 3);
  assert.ok(L.findIssues("Um, I, uh, like it, um.").some((x) => x.rule === "filler"));
  assert.ok(!L.findIssues("Um, I like it.").some((x) => x.rule === "filler"));
  assert.equal(L.words("Um, I like it, uh."), 3);
});

test("다시 말하기 대본: 고를 2개만 바꾸고 나머지는 둔다", () => {
  const r = L.review(MINSEO, 34, TARGET);
  assert.ok(r.retry.includes("I went to Busan"));
  assert.ok(r.retry.includes("We ate a lot"));
  assert.ok(r.retry.includes("I was very bored"));
  assert.ok(r.retry.includes("more better")); // 미룬 것은 그대로
});

test("측정값: 분당 단어, 목표 표현 사용 여부", () => {
  const m = L.metrics("Last week we ended up eating pizza at home.", 6, TARGET);
  assert.equal(m.words, 9);
  assert.equal(m.wpm, 90);
  assert.equal(m.target, true);
  assert.equal(m.targetText, "ended up eating");
  assert.equal(L.metrics("hello", 0, TARGET).wpm, 0);
});

test("Claude 응답 검사: 학생이 말하지 않은 표현은 버리고 2개까지만 남긴다", () => {
  const n = L.normalizeFeedback({
    good: "끝까지 말했어요",
    fixes: [
      { title: "과거형", wrong: "I go", better: "I went", why: "지난 일" },
      { title: "지어낸 지적", wrong: "I goed", better: "I went", why: "" },
      { title: "-ed", wrong: "I was very boring", better: "I was very bored", why: "" },
      { title: "비교", wrong: "more better", better: "better", why: "" },
    ],
    later: ["enjoy -ing"], retry: "",
  }, MINSEO);
  assert.equal(n.mode, "ai");
  assert.deepEqual(n.fixes.map((f) => f.wrong), ["I go", "I was very boring"]);
  assert.deepEqual(n.later.map((x) => x.title), ["비교", "enjoy -ing"]);
  assert.ok(n.retry.includes("I went")); // retry가 비면 직접 만든다
});

test("Claude 응답 검사: 형식이 틀리거나 지적이 전부 지어낸 것이면 null", () => {
  assert.equal(L.normalizeFeedback(null, MINSEO), null);
  assert.equal(L.normalizeFeedback("좋아요", MINSEO), null);
  assert.equal(L.normalizeFeedback({ good: "", fixes: [] }, MINSEO), null);
  assert.equal(L.normalizeFeedback({ good: "좋아요", fixes: [{ wrong: "I goed", better: "I went" }] }, MINSEO), null);
  assert.equal(L.normalizeFeedback({ good: "좋아요", fixes: [] }, MINSEO).fixes.length, 0); // 고칠 게 없을 수도 있다
});

test("다시 말하기 확인: 고친 것과 아직인 것", () => {
  const r = L.review(MINSEO, 34, TARGET);
  const c = L.checkRetry(r.fixes, "Last weekend I went to Busan. We ate fish. I was very boring.");
  assert.deepEqual(c.map((x) => x.fixed), [true, false]);
  const ai = [{ rule: "ai", title: "x", wrong: "I go", better: "I went" }];
  assert.equal(L.checkRetry(ai, "I went home")[0].fixed, true);
});

test("제출률과 내보내기 전 개인정보 가리기", () => {
  assert.deepEqual(L.submitRate([{ submitted: true }, { submitted: false }, { submitted: true }, { submitted: true }]), { done: 3, n: 4, pct: 75 });
  assert.equal(L.submitRate([]).pct, 0);
  const msg = L.toMessage("민서", { good: "좋아요", fixes: [], retry: "Call me at 010-1234-5678 or minseo@example.com" }, "숙제");
  assert.ok(!msg.includes("1234-5678"));
  assert.ok(!msg.includes("minseo@example.com"));
  assert.ok(msg.includes("고칠 점이 없어요"));
});

test("화면 강조 위치: 고칠 조각을 번호와 함께", () => {
  const r = L.review(MINSEO, 34, TARGET);
  const { flat, marks } = L.marks(MINSEO, r.fixes);
  assert.equal(marks.length, 3);
  assert.equal(flat.slice(marks[0].start, marks[0].end), "I go");
  assert.equal(marks[2].n, 1);
});
