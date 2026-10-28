// 아침한장 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const A = { id: "x1", source: "가상 물류일보", title: "새벽배송 물량 18% 늘어", body: "9월 새벽배송 물량은 하루 평균 42만 건으로 6월보다 18% 늘었다. 늘어난 물량의 절반은 신선식품이었다. 구독자는 1,240명이다." };

test("숫자 뽑기: 쉼표를 빼고 값과 단위를 나눈다", () => {
  const n = L.extractNumbers("구독자 1,240명, 전환 3.4%, 3개월, 평당 월 5만 2천 원");
  assert.deepEqual(n.map((x) => [x.value, x.unit]), [["1240", "명"], ["3.4", "%"], ["3", "개월"], ["5", "만"], ["2", "천원"]]);
  assert.equal(L.extractNumbers("퍼센트 표기 7퍼센트")[0].unit, "%");
});

test("숫자 대조: 원문 표기 그대로면 통과", () => {
  const c = L.checkNumbers("하루 42만 건, 18% 증가", A.body);
  assert.equal(c.ok, true);
  assert.deepEqual(c.good, ["42만 건", "18%"]);
});

test("숫자 대조: 원문과 다른 숫자(반올림·계산·자리 실수)는 잡는다", () => {
  assert.deepEqual(L.checkNumbers("20% 가까이 늘었다", A.body).bad, ["20%"]);
  assert.deepEqual(L.checkNumbers("하루 42만 건, 1.8% 증가", A.body).bad, ["1.8%"]);
  assert.equal(L.checkNumbers("구독자 1240명", A.body).ok, true); // 쉼표 유무는 같은 숫자
});

test("숫자 대조: 같은 값이라도 단위가 바뀌면 다른 숫자", () => {
  assert.deepEqual(L.checkNumbers("하루 42만 명", A.body).bad, ["42만 명"]); // 원문은 '42만 건'
  assert.deepEqual(L.checkNumbers("18명 늘었다", A.body).bad, ["18명"]);
  assert.deepEqual(L.checkNumbers("하루 42만, 1,240명", A.body).bad, []); // 세는 말만 빠진 것은 같은 숫자
});

test("규칙 요약: 원문 문장을 그대로 고르므로 숫자 검사를 늘 통과", () => {
  L.SAMPLE.forEach((a) => {
    const r = L.ruleSummary(a);
    assert.ok(r.points.length >= 1 && r.points.length <= 2, a.id);
    r.points.forEach((p) => assert.ok(a.body.includes(p), `${a.id}: 원문에 있는 문장`));
    assert.equal(L.checkNumbers(r.points.join(" "), a.body).ok, true);
  });
});

test("규칙 요약: 숫자가 든 문장을 먼저 고른다", () => {
  const r = L.ruleSummary(A);
  assert.ok(r.points[0].includes("42만 건"));
});

test("Claude 응답 검사: 원문에 없는 숫자가 든 문장은 버리고 기록한다", () => {
  const n = L.normalizeDigest({ intro: "오늘 1건", items: [{ id: "x1", headline: "새벽배송 18% 증가", points: ["하루 42만 건으로 18% 늘었다", "하루 43만 건 수준"], why: "야간 인력이 관건" }] }, [A]);
  assert.equal(n.items[0].by, "ai");
  assert.deepEqual(n.items[0].points, ["하루 42만 건으로 18% 늘었다"]);
  assert.equal(n.rejected.length, 1);
  assert.deepEqual(n.rejected[0].bad, ["43만 건"]);
  assert.equal(n.intro, ""); // '1건'은 원문에 없다
});

test("Claude 응답 검사: 문장이 다 버려진 기사는 규칙 요약으로 채운다", () => {
  const n = L.normalizeDigest({ items: [{ id: "x1", headline: "물량 20% 증가", points: ["20% 늘었다"] }] }, [A]);
  assert.equal(n.items[0].by, "rule");
  assert.equal(n.items[0].fellBack, true);
  assert.equal(n.items[0].headline, A.title);
});

test("Claude 응답 검사: 형식이 틀리거나 없는 id 뿐이면 버린다", () => {
  assert.equal(L.normalizeDigest(null, [A]), null);
  assert.equal(L.normalizeDigest({ items: "요약" }, [A]), null);
  assert.equal(L.normalizeDigest({ items: [{ id: "zz", points: ["x"] }] }, [A]), null);
});

test("Claude 응답 검사: 빠뜨린 기사는 규칙 요약으로, 순서는 고른 순서대로", () => {
  const B = L.SAMPLE[1];
  const n = L.normalizeDigest({ items: [{ id: B.id, headline: B.title, points: ["312만 TEU로 6.2% 늘었다"] }] }, [A, B]);
  assert.deepEqual(n.items.map((x) => [x.id, x.by]), [["x1", "rule"], [B.id, "ai"]]);
});

test("같은 소식 묶기: 샘플의 택배 단가 기사 두 건", () => {
  const dup = L.findDuplicates(L.SAMPLE);
  assert.deepEqual(dup, { a4: "a3" });
});

test("발송 검사: 사람이 고친 문장도 원문 숫자와 다르면 보낼 수 없다", () => {
  const items = [L.ruleSummary(A)];
  assert.equal(L.sendCheck(items, [A]).ready, true);
  items[0] = { ...items[0], points: ["하루 45만 건으로 늘었다"] };
  const c = L.sendCheck(items, [A]);
  assert.equal(c.ready, false);
  assert.deepEqual(c.problems[0].bad, ["45만 건"]);
  assert.equal(L.sendCheck([], [A]).ready, false);
});

test("무료판은 앞 3건·해설 없음, 유료판은 전부", () => {
  const items = L.SAMPLE.slice(0, 5).map((a) => ({ ...L.ruleSummary(a), why: "의미" }));
  assert.equal(L.issueFor(items, "free").length, 3);
  assert.equal(L.issueFor(items, "free")[0].why, "");
  assert.equal(L.issueFor(items, "paid").length, 5);
});

test("내보내기: HTML은 이스케이프하고, 텍스트에는 출처가 붙는다", () => {
  const evil = { id: "e", source: "<b>매체</b>", title: "t", body: "b" };
  const html = L.toEmailHtml("제목", "", [{ id: "e", headline: "<script>", points: ["a&b"], why: "" }], [evil]);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("a&amp;b"));
  const txt = L.toText("아침한장", "", [L.ruleSummary(A)], [A]);
  assert.ok(txt.includes("(출처: 가상 물류일보)"));
  assert.ok(L.readMinutes([L.ruleSummary(A)]) >= 1);
});
