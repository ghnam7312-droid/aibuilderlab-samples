// 두문장 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const T0 = Date.UTC(2026, 9, 20, 1, 0, 0);
const MIN = 60000;
const ev = (vid, v, type, m) => ({ vid, v, type, ts: T0 + m * MIN });

test("새로고침 중복: 같은 방문자·문구·종류가 30분 안에 다시 오면 한 번만 센다", () => {
  const list = [ev("x", "A", "view", 0), ev("x", "A", "click", 1), ev("x", "A", "view", 2), ev("x", "A", "click", 2)];
  const t = L.tally(list);
  assert.deepEqual(t.A, { views: 1, clicks: 1 });
  assert.equal(t.dup, 2);
  // 고치기 전 방식: 클릭이 두 번 잡힌다
  assert.equal(L.tally(list, false).A.clicks, 2);
});

test("30분이 지나 다시 오면 새 방문으로 센다", () => {
  const t = L.tally([ev("x", "B", "view", 0), ev("x", "B", "view", 31)]);
  assert.equal(t.B.views, 2);
  assert.equal(t.dup, 0);
});

test("노출 없이 들어온 클릭은 빼고 '노출 없음'으로 센다", () => {
  const t = L.tally([ev("y", "A", "click", 0), ev("z", "B", "view", 0), ev("z", "A", "click", 1)]);
  assert.equal(t.A.clicks, 0);
  assert.equal(t.orphan, 2);
  const m = L.markEvents([ev("y", "A", "click", 0)]);
  assert.equal(m[0].reason, "orphan");
});

test("형식이 틀린 이벤트는 무시하고, 순서가 섞여 들어와도 시간순으로 센다", () => {
  const t = L.tally([ev("x", "A", "click", 2), null, { vid: "x", v: "C", type: "view", ts: T0 }, ev("x", "A", "view", 0), { vid: "q", v: "A", type: "view" }]);
  assert.deepEqual(t.A, { views: 1, clicks: 1 });
});

test("샘플 이벤트는 같은 seed면 늘 같고, 중복을 빼면 정해 둔 숫자가 된다", () => {
  const g = { seed: 5, start: T0, span: 86400000, views: [50, 40], clicks: [3, 6], dupClicks: 5, dupViews: 4 };
  const a = L.genEvents("t", g), b = L.genEvents("t", g);
  assert.deepEqual(a, b);
  const t = L.tally(a);
  assert.deepEqual([t.A.views, t.A.clicks, t.B.views, t.B.clicks], [50, 3, 40, 6]);
  assert.equal(t.dup, 9);
});

test("같은 방문자는 늘 같은 문구에 배정된다", () => {
  assert.equal(L.assignVariant("v1a2", "t6"), L.assignVariant("v1a2", "t6"));
  const s = new Set(Array.from({ length: 40 }, (_, i) => L.assignVariant(`v${i}`, "t6")));
  assert.equal(s.size, 2);
});

test("정규분포·z검정: 알려진 값과 맞는다", () => {
  assert.ok(Math.abs(L.normCdf(1.96) - 0.975) < 0.001);
  assert.ok(Math.abs(L.normCdf(0) - 0.5) < 1e-6);
  const r = L.zTest({ views: 1000, clicks: 20 }, { views: 1000, clicks: 40 });
  assert.ok(r.z > 2.5 && r.p < 0.02);
  assert.equal(L.zTest({ views: 0, clicks: 0 }, { views: 10, clicks: 1 }).p, 1);
});

test("판정: 표본 부족 → 남은 노출 수, 차이 없음 → 원래 문구(A) 유지", () => {
  const need = L.verdict({ A: { views: 140, clicks: 3 }, B: { views: 136, clicks: 5 } });
  assert.equal(need.kind, "need");
  assert.equal(need.need, 160 + 164);
  const tie = L.verdict({ A: { views: 860, clicks: 16 }, B: { views: 870, clicks: 14 } });
  assert.deepEqual([tie.kind, tie.keep], ["tie", "A"]);
  const win = L.verdict({ A: { views: 900, clicks: 15 }, B: { views: 905, clicks: 29 } });
  assert.deepEqual([win.kind, win.winner], ["win", "B"]);
  const back = L.verdict({ A: { views: 900, clicks: 30 }, B: { views: 905, clicks: 12 } });
  assert.equal(back.winner, "A");
});

test("샘플 6쌍: 끝난 5개에서 처음 문구 1.8% → 남긴 문구 3.1% (목표치)", () => {
  const rows = L.sampleTests().map((t) => { const ta = L.tally(L.genEvents(t.id, t.gen)); return { test: t, tally: ta, verdict: L.verdict(ta) }; });
  assert.equal(rows.length, 6);
  const s = L.summary(rows);
  assert.equal(s.done, 5);
  assert.equal(s.running, 1);
  assert.equal(L.pct(s.before), "1.8%");
  assert.equal(L.pct(s.after), "3.1%");
  // 중복을 안 막으면 클릭률이 부풀어 보인다
  const raw = L.tally(L.genEvents("t1", L.sampleTests()[0].gen), false);
  assert.ok(raw.B.clicks > 60);
});

test("규칙 후보는 문구에 있는 사실만 다시 배치한다 (새 숫자 없음)", () => {
  const t = L.sampleTests()[0];
  const c = L.ruleSuggest(t, "B");
  assert.equal(c.length, 3);
  for (const x of c) assert.deepEqual(L.inventedNumbers(x.text, [t.a, t.b, ...Object.values(t.facts)].join(" ")), [], x.text);
  assert.ok(c[0].text.startsWith("30명만"));
});

test("Claude 응답 검사: 과장 표현·지어낸 숫자·기존 문구와 중복·너무 짧은 것은 버린다", () => {
  const t = L.sampleTests()[0];
  const r = L.normalizeSuggest({ candidates: [
    { text: "무조건 후회 없는 학회, 클릭랩", angle: "감성" },
    { text: "지난 학기 신입 95%가 남은 학회", angle: "숫자" },
    { text: "광고 하나로 클릭률 바꿔 볼 사람, 클릭랩으로 와요!", angle: "같음" },
    { text: "짧음", angle: "x" },
    { text: "“9/12(금) 저녁, 피자 먹으며 광고 얘기해요”", angle: "장면", why: "혜택을 장면으로" },
  ] }, t);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].text, "9/12(금) 저녁, 피자 먹으며 광고 얘기해요");
  assert.deepEqual(r.dropped, { overclaim: 1, invented: 1, dup: 1, bad: 1 });
  assert.equal(L.normalizeSuggest({ candidates: [] }, t), null);
  assert.equal(L.normalizeSuggest("문자열", t), null);
});

test("다음 대결: 남긴 문구가 A, 새 후보가 B, 기록은 비어 있다", () => {
  const t = L.sampleTests()[2];
  const n = L.nextTest(t, "A", { text: "옷장 정리하고 커피값 버는 날" }, "t9");
  assert.equal(n.a, t.a);
  assert.equal(n.b, "옷장 정리하고 커피값 버는 날");
  assert.deepEqual(n.live, []);
  assert.equal(L.verdict(L.tally(n.live)).kind, "need");
});

test("CSV: 방문자 정보 없이 집계만, 쉼표·따옴표 이스케이프", () => {
  const t = L.sampleTests()[0];
  const ta = L.tally(L.genEvents(t.id, t.gen));
  const csv = L.toCsv([{ test: t, tally: ta, verdict: L.verdict(ta) }]);
  assert.ok(csv.startsWith("﻿대결,"));
  assert.ok(csv.includes('"광고 하나로 클릭률 바꿔 볼 사람, 클릭랩으로 와요"'));
  assert.ok(csv.includes("B 승리"));
  assert.ok(!/t1[AB][0-9a-z]+/.test(csv), "방문자 id가 들어가면 안 된다");
  assert.equal(L.csvCell('a"b'), '"a""b"');
});

test("날짜별 집계: 한국 시간 기준으로 나누고 중복은 뺀다", () => {
  const late = Date.UTC(2026, 9, 20, 14, 59); // 한국 23:59
  const d = L.daily([{ vid: "a", v: "A", type: "view", ts: late }, { vid: "a", v: "A", type: "view", ts: late + 60000 }, { vid: "b", v: "B", type: "view", ts: late + 2 * 60000 }]);
  assert.deepEqual(d.map((x) => x.day), ["10/20", "10/21"]);
  assert.equal(d[0].A.views, 1);
  assert.equal(d[1].B.views, 1);
});
