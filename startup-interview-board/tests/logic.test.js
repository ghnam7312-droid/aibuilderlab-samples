// 들어보니 핵심 규칙 테스트 — npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const iv = (id, role, hours, price, memo = "") => ({ id, role, hours, price, memo });

test("규칙 제안: H1은 시간 4시간 기준, 학부모는 상관없음", () => {
  const H1 = L.HYPS[0];
  assert.equal(H1.auto(iv(1, "원장", 4, 0)), "y");
  assert.equal(H1.auto(iv(1, "강사", 3, 0)), "n");
  assert.equal(H1.auto(iv(1, "학부모", 10, 0)), "x");
});

test("규칙 제안: H2는 원장만, 1~10만 원이면 지지", () => {
  const H2 = L.HYPS[1];
  assert.equal(H2.auto(iv(1, "원장", 0, 10)), "y");
  assert.equal(H2.auto(iv(1, "원장", 0, 0)), "n");
  assert.equal(H2.auto(iv(1, "원장", 0, 11)), "n");
  assert.equal(H2.auto(iv(1, "강사", 0, 5)), "x");
});

test("가설 판정: 검증됨 · 반증됨 · 검증 중 경계", () => {
  const ivs = [1, 2, 3, 4, 5].map((i) => iv(i, "원장", 0, 0));
  assert.equal(L.tally(ivs, { "1|H": "y", "2|H": "y", "3|H": "y" }, "H").st, "ok");
  assert.equal(L.tally(ivs, { "1|H": "y", "2|H": "y", "3|H": "y", "4|H": "n", "5|H": "n" }, "H").st, "wait", "3 < 2×2");
  assert.equal(L.tally(ivs, { "1|H": "y", "2|H": "n", "3|H": "n" }, "H").st, "no");
  assert.equal(L.tally(ivs, { "1|H": "y", "2|H": "y" }, "H").st, "wait");
  assert.deepEqual(L.tally(ivs, { "1|H": "x" }, "H"), { y: 0, n: 0, st: "wait" });
});

test("확정 태그 순환: 제안 → 확정, 지지 → 반증 → 상관없음 → 지지", () => {
  assert.equal(L.nextTag(undefined, "n"), "n");
  assert.equal(L.nextTag("y"), "n");
  assert.equal(L.nextTag("n"), "x");
  assert.equal(L.nextTag("x"), "y");
});

test("주제·인용: 사전 단어로 주제, 큰따옴표(곧은·굽은) 안은 인용", () => {
  const memo = '엑셀 성적표를 캡처해서 카톡으로 보냄.\n"다음에 뭘 할지 궁금해요." 그리고 “단원별로 보고 싶어요”';
  assert.deepEqual(L.topicsOf(memo), ["엑셀·캡처 수작업", "카톡으로 전달", "다음에 뭘 할지", "단원별로 보기"]);
  assert.deepEqual(L.quotesOf(memo), ["다음에 뭘 할지 궁금해요.", "단원별로 보고 싶어요"]);
  assert.equal(L.plainOf(memo).startsWith("엑셀 성적표를"), true);
  assert.equal(L.plainOf(memo).includes("궁금해요"), false);
});

test("Claude 분석 검사: 메모에 없는 인용은 버리고, 입장은 y/n/x로", () => {
  const memo = '지난달 리포트에 6시간. "10만 원 넘으면 고민해요."';
  const r = L.normalizeAnalyze({
    keywords: ["리포트 시간", "가격 상한", "이건 열여섯 글자가 넘는 아주 긴 키워드입니다"],
    quote: "학부모가 좋아해요",
    evidence: [{ id: "h1", stance: "지지", why: "6시간" }, { id: "H2", stance: "반증", why: "" }, { id: "H9", stance: "지지" }, { id: "H1x", stance: "?" }],
  }, memo, ["H1", "H2"]);
  assert.deepEqual(r.keywords, ["리포트 시간", "가격 상한"]);
  assert.equal(r.quote, "");
  assert.deepEqual(r.stances, { H1: { s: "y", why: "6시간" }, H2: { s: "n", why: "" } });
  const ok = L.normalizeAnalyze({ keywords: ["가격"], quote: "“10만 원 넘으면 고민해요.”", evidence: [] }, memo, ["H1"]);
  assert.equal(ok.quote, "10만 원 넘으면 고민해요.");
  assert.equal(L.normalizeAnalyze({ keywords: [], evidence: [] }, memo, ["H1"]), null);
  assert.equal(L.normalizeAnalyze(null, memo, ["H1"]), null);
});

test("유도 질문 점검: 미래 의향은 bad, 지난 행동은 good, 나머지는 mid", () => {
  assert.equal(L.checkQuestion("리포트 기능이 있으면 쓰시겠어요?"), "bad");
  assert.equal(L.checkQuestion("월 5만 원이면 괜찮을까요?"), "bad");
  assert.equal(L.checkQuestion("AI가 분석해 주면 좋겠죠?"), "bad");
  assert.equal(L.checkQuestion("지난달 리포트는 누가 몇 시간 들여 만들었나요?"), "good");
  assert.equal(L.checkQuestion("리포트에 대해 이야기해 주세요"), "mid");
  assert.equal(L.checkQuestion("   "), "");
});

test("규칙 고쳐 쓰기: 주제에 맞는 과거 행동 질문", () => {
  assert.match(L.ruleRewrite("월 5만 원이면 괜찮을까요?"), /얼마를 쓰고/);
  assert.match(L.ruleRewrite("AI가 분석해 주면 좋겠죠?"), /지난주/);
  assert.match(L.ruleRewrite("이 기능 쓰시겠어요?"), /지난달/);
  assert.match(L.ruleRewrite("리포트를 자동으로 만들어 주면 쓰시겠어요?"), /지난달 이 일을/);
  assert.equal(L.checkQuestion(L.ruleRewrite("이런 거 원하세요?")), "good", "고쳐 쓴 질문은 점검을 통과한다");
});

test("Claude 질문 응답 검사", () => {
  assert.deepEqual(L.normalizeQuestion({ leading: true, reason: "의향을 물어요", rewrite: "지난달엔 어떻게 하셨어요?" }), { leading: true, reason: "의향을 물어요", rewrite: "지난달엔 어떻게 하셨어요?" });
  assert.equal(L.normalizeQuestion({ leading: "true", reason: "x" }), null);
  assert.equal(L.normalizeQuestion({ leading: false, reason: "" }), null);
});

test("가격 응답: 원장만, 구간·중간값·10만 원 이하 비율", () => {
  const ivs = [iv(1, "원장", 0, 8), iv(2, "원장", 0, 5), iv(3, "원장", 0, 0), iv(4, "원장", 0, 20), iv(5, "강사", 0, 3), iv(6, "원장", 0, 6)];
  const p = L.priceStats(ivs);
  assert.equal(p.own, 5);
  assert.equal(p.pay, 4);
  assert.equal(p.median, 7, "5·6·8·20 의 중간값");
  assert.equal(p.underShare, 0.75);
  assert.deepEqual(p.buckets.map((b) => b.n), [1, 1, 2, 1]);
  assert.equal(L.priceStats([]).median, 0);
});

test("주제 집계: 역할별로 세고 많은 순", () => {
  const ivs = [iv(1, "원장", 0, 0, "엑셀로 만듦"), iv(2, "강사", 0, 0, "엑셀 캡처, 카톡"), iv(3, "학부모", 0, 0, "카톡 안 봄")];
  const t = L.topicCounts(ivs);
  assert.equal(t[0].n, 2);
  const kakao = t.find((x) => x.k === "카톡으로 전달");
  assert.deepEqual(kakao.by, [0, 1, 1]);
  const custom = L.topicCounts(ivs, () => ["단원별로 보기"]);
  assert.equal(custom[0].k, "단원별로 보기");
  assert.equal(custom[0].n, 3);
});

test("가설 문구와 기준은 화면·리포트가 같은 것을 쓴다", () => {
  assert.equal(L.HYPS.length, 2);
  assert.ok(L.HYPS.every((h) => h.id && h.text && h.crit));
  assert.deepEqual(Object.values(L.STAMP), ["검증됨", "반증됨", "검증 중"]);
});
