// 끝까지 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const sample = () => L.metrics(L.parseCsv(L.CSV_SAMPLE).rows);

test("샘플 CSV는 오류 없이 24줄", () => {
  const p = L.parseCsv(L.CSV_SAMPLE);
  assert.equal(p.rows.length, 24);
  assert.deepEqual(p.errors, []);
});

test("CSV 검사: 틀린 줄은 줄 번호와 이유를 남기고 건너뛴다", () => {
  const p = L.parseCsv("호,제목,주제,클릭,끝까지읽음\n41,좋은 글,운임·비용,10,5\n99,없는 호,기타,1,1\n42,반대,기타,5,9\n43,칸 부족,기타\n44,음수,기타,-1,0");
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.errors.map((e) => e.line), [3, 4, 5, 6]);
  assert.match(p.errors[1].why, /클릭보다 많/);
});

test("지표: 클릭률·완독률·완독 점수", () => {
  const [x] = L.metrics([{ id: "a", no: 48, title: "t", topic: "x", clicks: 120, reads: 90 }]);
  assert.equal(x.ctr, L.pct(120, 626));
  assert.equal(x.readRate, 75);
  assert.equal(x.score, L.pct(90, 626));
});

test("클릭 수로만 보면 낚시성 제목이 1등 (고친 문제 재현)", () => {
  const top = L.rank(sample(), "clicks")[0];
  assert.ok(top.bait);
  assert.ok(L.baitWords(top.title).length > 0);
});

test("완독을 반영하면 상위 5개에 낚시 의심 글이 없다", () => {
  const top5 = L.rank(sample(), "score").slice(0, 5);
  assert.equal(top5.filter((x) => x.bait).length, 0);
  assert.equal(top5[0].title, "운임 협상 전에 꼭 챙길 숫자 7가지");
});

test("낚시 의심: 클릭률이 중앙값의 1.3배 이상이고 완독률 30% 미만", () => {
  const ls = sample();
  assert.equal(ls.filter((x) => x.bait).length, 3);
  const med = L.median(ls.map((x) => x.ctr));
  ls.filter((x) => x.bait).forEach((x) => { assert.ok(x.ctr >= med * 1.3); assert.ok(x.readRate < 30); });
  // 클릭률이 낮으면 완독률이 낮아도 낚시가 아니다
  assert.equal(ls.find((x) => x.title.startsWith("물류 투자 시장")).bait, false);
});

test("자리 변화: 낚시 글은 내려가고(음수) 잘 읽힌 글은 올라간다", () => {
  const ls = sample();
  const s = L.rankShift(ls);
  ls.filter((x) => x.bait).forEach((x) => assert.ok(s[x.id] < 0));
  assert.ok(s[ls.find((x) => x.title.startsWith("운임 협상")).id] > 0);
});

test("호별 추이: 41호 열람률 38%·전환 1.2%, 48호 51%·3.4% (목표치와 같음)", () => {
  const t = L.issueTrend();
  assert.deepEqual([t[0].openRate, t[0].conv], [38, 1.2]);
  assert.deepEqual([t[7].openRate, t[7].conv], [51, 3.4]);
  assert.equal(L.ISSUES.reduce((s, i) => s + i.paid, 0), 96);
});

test("최근 4호만 거르기", () => {
  const rows = L.lastIssues(L.parseCsv(L.CSV_SAMPLE).rows, 4);
  assert.equal(rows.length, 12);
  assert.ok(rows.every((r) => r.no >= 45));
});

test("규칙 추천: 완독 점수 높은 주제 3개와 낚시 주의", () => {
  const r = L.recommend(L.topicStats(sample()));
  assert.deepEqual(r.topics.map((t) => t.topic), ["운임·비용", "창고·풀필먼트", "물류 테크"]);
  assert.match(r.caution, /택배·라스트마일/);
  // 글이 1개뿐인 주제만 있어도 비지 않는다
  const one = L.recommend(L.topicStats(L.metrics([{ id: "a", no: 48, title: "t", topic: "해운·항만", clicks: 9, reads: 8 }])));
  assert.deepEqual(one.topics.map((t) => t.topic), ["해운·항만"]);
});

test("Claude 응답 검사: 없는 주제·지어낸 숫자·낚시 제목을 걸러 낸다", () => {
  const stats = L.topicStats(sample());
  const n = L.normalizeRecommend({
    topics: [
      { topic: "운임·비용", reason: `완독률 ${stats[0].readRate}%로 가장 높음`, titleIdea: "운임표 다시 짜기 2편" },
      { topic: "드론 배송", reason: "새 주제", titleIdea: "x" },
      { topic: "창고·풀필먼트", reason: "완독률 99%", titleIdea: "창고 계약의 충격적 비밀" },
      { topic: "운임·비용", reason: "중복", titleIdea: "" },
    ],
    caution: "낚시 글 77개",
  }, stats);
  assert.equal(n.topics.length, 2);
  assert.equal(n.topics[0].titleIdea, "운임표 다시 짜기 2편");
  assert.match(n.topics[1].reason, /^글 4개/); // 지어낸 99%는 버리고 규칙 문장
  assert.equal(n.topics[1].titleIdea, "");
  assert.equal(n.caution, "");
});

test("Claude 응답 검사: 형식이 틀리면 null", () => {
  const stats = L.topicStats(sample());
  assert.equal(L.normalizeRecommend(null, stats), null);
  assert.equal(L.normalizeRecommend({ topics: "운임" }, stats), null);
  assert.equal(L.normalizeRecommend({ topics: [{ topic: "없는 주제" }] }, stats), null);
});

test("CSV 내보내기: 쉼표가 든 제목은 따옴표로 감싼다", () => {
  const out = L.toCsv([{ rank: 1, no: 41, title: "A, B", topic: "x", clicks: 1, reads: 1, ctr: 1, readRate: 100, score: 1, bait: true }]);
  assert.ok(out.split("\n")[1].startsWith('1,41,"A, B",x'));
  assert.ok(out.includes(",예"));
});
