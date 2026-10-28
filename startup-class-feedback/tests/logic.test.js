// 한줄더 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-20";

/** 바탕 240, 사각형 안만 v 로 칠한 밝기 배열 */
function canvas(w, h, rect, v) {
  const g = new Uint8Array(w * h).fill(240);
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) g[y * w + x] = v;
  return g;
}

test("예시는 정확히 30개, 번호가 겹치지 않고 항목마다 좋은 점 2 · 해 볼 것 3", () => {
  assert.equal(L.EXAMPLES.length, 30);
  assert.equal(new Set(L.EXAMPLES.map((e) => e.id)).size, 30);
  for (const t of L.TAGS) {
    const xs = L.EXAMPLES.filter((e) => e.tag === t.id);
    assert.equal(xs.filter((e) => e.kind === "good").length, 2, t.id);
    assert.equal(xs.filter((e) => e.kind === "next").length, 3, t.id);
  }
});

test("작가 예시 30개 자체는 말투 검사를 모두 통과한다", () => {
  for (const e of L.EXAMPLES) assert.deepEqual(L.styleIssues(e.text), [], e.id);
});

test("말투 검사: 작가가 쓰지 않는 표현을 찾는다", () => {
  assert.deepEqual(L.styleIssues("기초부터 다시 하십시오"), ["하십시오", "기초부터 다시"]);
  assert.deepEqual(L.styleIssues("그림자를 한 단계 더 눌러 보세요"), []);
});

test("그림 분석: 진한 그림은 대비가 크고, 연한 그림은 작다", () => {
  const dark = L.analyze(canvas(100, 80, { x: 30, y: 20, w: 40, h: 40 }, 40), 100, 80);
  const pale = L.analyze(canvas(100, 80, { x: 30, y: 20, w: 40, h: 40 }, 200), 100, 80);
  assert.ok(dark.contrast > 0.7, String(dark.contrast));
  assert.ok(pale.contrast < 0.2, String(pale.contrast));
  assert.ok(L.suggestTags(pale).includes("value"));
  assert.ok(!L.suggestTags(dark).includes("value"));
});

test("그림 분석: 귀퉁이로 쏠리면 offset 이 커지고 구도 항목을 고른다", () => {
  const mid = L.analyze(canvas(100, 80, { x: 30, y: 20, w: 40, h: 40 }, 40), 100, 80);
  const side = L.analyze(canvas(100, 80, { x: 62, y: 44, w: 30, h: 30 }, 40), 100, 80);
  assert.ok(mid.offset < 0.1);
  assert.ok(side.offset > 0.3);
  assert.ok(L.suggestTags(side).includes("comp"));
  assert.deepEqual(side.box, { x: 62, y: 44, w: 30, h: 30 });
});

test("그림 분석: 너무 작거나 꽉 차면 구도, 빈 종이·잘못된 입력도 멈추지 않는다", () => {
  const tiny = L.analyze(canvas(100, 80, { x: 45, y: 35, w: 10, h: 10 }, 40), 100, 80);
  assert.ok(tiny.fill < 0.2 && L.suggestTags(tiny).includes("comp"));
  const full = L.analyze(canvas(100, 80, { x: 9, y: 9, w: 82, h: 62 }, 40), 100, 80);
  assert.ok(full.fill > 0.62);
  assert.equal(L.analyze(canvas(20, 20, { x: 0, y: 0, w: 0, h: 0 }, 0), 20, 20).ink, 0);
  assert.equal(L.analyze(null, 10, 10), null);
  assert.deepEqual(L.suggestTags(null), []);
});

test("대기열: 오래 기다린 과제부터, 3일 넘은 것을 센다", () => {
  const subs = [
    { id: "S-2", submitted: "2026-10-19" },
    { id: "S-1", submitted: "2026-10-14" },
    { id: "S-3", submitted: "2026-10-17" },
  ];
  assert.deepEqual(L.sortQueue(subs, TODAY).map((s) => s.id), ["S-1", "S-3", "S-2"]);
  const s = L.queueStats(subs, [{ waited: 1 }, { waited: 2 }], TODAY);
  assert.equal(s.pending, 3);
  assert.equal(s.maxWait, 6);
  assert.equal(s.late, 2);
  assert.equal(s.avgWait, 3.3);
  assert.equal(s.avgSentWait, 1.5);
});

test("규칙 초안: 고른 항목의 예시 문장을 그대로 쓰고, 그 항목은 칭찬하지 않는다", () => {
  const d = L.draftRule({ id: "S-031" }, ["value"]);
  const good = L.exById(d.basis[0]), next = L.exById(d.basis[1]);
  assert.equal(good.kind, "good");
  assert.notEqual(good.tag, "value");
  assert.equal(next.tag, "value");
  assert.equal(d.good, good.text);
  assert.ok(d.next.includes(next.text));
  // 같은 과제는 늘 같은 초안
  assert.deepEqual(L.draftRule({ id: "S-031" }, ["value"]), d);
});

test("규칙 초안: 항목이 없으면 '꾸준함'으로, 셋 이상이면 두 개까지만", () => {
  const none = L.draftRule({ id: "A" }, []);
  assert.equal(L.exById(none.basis[1]).tag, "habit");
  const many = L.draftRule({ id: "B" }, ["form", "value", "line"]);
  assert.equal(many.basis.length, 3);
});

test("Claude 응답 검사: 예시 밖 번호를 근거로 대면 버린다 (작가 스타일과 다른 조언 방지)", () => {
  const allowed = L.allowedExamples(["value"]).map((e) => e.id);
  const ok = { good: "밝은 면을 비워 둔 게 좋아요.", next: "가장 어두운 곳을 먼저 정해 보세요.", basis: ["e07", "E08"] };
  assert.deepEqual(L.normalizeDraft(ok, allowed).basis, ["E07", "E08"]);
  assert.equal(L.normalizeDraft({ ...ok, basis: ["E08", "E99"] }, allowed), null);
  assert.equal(L.normalizeDraft({ ...ok, basis: ["E13"] }, allowed), null); // 구도 '해 볼 것'은 명암 과제에 없음
  assert.equal(L.normalizeDraft({ ...ok, basis: [] }, allowed), null);
});

test("Claude 응답 검사: 작가가 쓰지 않는 말투·빈 문장·형식 오류는 버린다", () => {
  const allowed = ["E07", "E08"];
  assert.equal(L.normalizeDraft({ good: "구도가 좋아요 정말로요.", next: "포토샵으로 보정해 보세요.", basis: ["E08"] }, allowed), null);
  assert.equal(L.normalizeDraft({ good: "", next: "가장 어두운 곳을 정해요.", basis: ["E08"] }, allowed), null);
  assert.equal(L.normalizeDraft("좋아요", allowed), null);
  assert.equal(L.normalizeDraft(null, allowed), null);
});

test("마지막 한 줄이 없거나 짧으면 보낼 수 없다", () => {
  assert.equal(L.canSend("").ok, false);
  assert.equal(L.canSend("좋아요").ok, false);
  assert.equal(L.canSend("반드시 다시 그려 오세요 알겠죠").ok, false);
  assert.equal(L.canSend("다음 컵은 유리컵으로 해 봐요.").ok, true);
});

test("보낼 글: 닉네임 → 좋은 점 → 해 볼 것 → 작가의 한 줄 순서", () => {
  const txt = L.compose("솜사탕", { good: "가", next: "나" }, " 마지막 ");
  assert.deepEqual(txt.split("\n"), ["솜사탕님, 과제 잘 받았어요.", "", "좋은 점 · 가", "다음에 해 볼 것 · 나", "", "마지막"]);
});

test("기록 내보내기: 닉네임과 본문은 빠지고 쉼표는 따옴표로 감싼다", () => {
  const csv = L.exportCsv([{ id: "S-1", nick: "솜사탕", title: "3주차, 컵", date: TODAY, waited: 2, tags: ["value", "comp"], basis: ["E07"], mode: "ai", text: "솜사탕님 비밀 본문" }]);
  assert.ok(csv.startsWith("﻿과제번호"));
  assert.ok(csv.includes('"3주차, 컵"'));
  assert.ok(csv.includes("명암 / 구도·여백"));
  assert.ok(!csv.includes("솜사탕"));
  assert.ok(!csv.includes("비밀 본문"));
});
