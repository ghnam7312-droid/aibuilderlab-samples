// 오늘공정 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const D = "2026-10-28";
const P = (o) => ({ id: Math.random().toString(36).slice(2), site: "A", date: D, time: "09:00", file: "IMG.jpg", process: "타일", note: "", include: true, ...o });
const SITE = { id: "A", label: "A현장", client: "한서윤" };

test("메모·파일 이름으로 공정 짐작", () => {
  assert.equal(L.guessProcess("욕실 벽 타일 붙이기, 줄눈은 내일"), "타일");
  assert.equal(L.guessProcess("거실 매입등 배선 위치 표시"), "전기");
  assert.equal(L.guessProcess("A현장_도배_1420.jpg"), "도배");
  assert.equal(L.guessProcess("그냥 사진"), "");
});

test("파일 이름의 현장 코드 읽기", () => {
  assert.equal(L.siteCodeOf("B현장_도배_1420.jpg"), "B");
  assert.equal(L.siteCodeOf("c-전기.jpg"), "C");
  assert.equal(L.siteCodeOf("IMG_2031.jpg"), "");
  assert.equal(L.siteCodeOf("BATH.jpg"), "");
});

test("다른 현장 사진이 섞이면 공유에서 뺀다 (섞여 공유되던 버그 회귀 방지)", () => {
  const photos = [P({ file: "A현장_타일.jpg" }), P({ file: "B현장_도배_1420.jpg" }), P({ site: "B" }), P({ date: "2026-10-27" })];
  const s = L.shareable(photos, "A", D);
  assert.equal(s.length, 1);
  assert.equal(s[0].file, "A현장_타일.jpg");
  assert.deepEqual(L.photoIssues(photos[1], "A").map((i) => i.kind), ["mixed"]);
});

test("업로드는 지금 연 폴더로만, 다른 현장 이름이면 보류", () => {
  const up = L.assignUploads([{ name: "IMG_1.jpg" }, { name: "B현장_바닥.jpg" }, { name: "A_타일.jpg" }], "A", D, "16:00");
  assert.ok(up.every((p) => p.site === "A" && p.date === D));
  assert.deepEqual(up.map((p) => p.held), [false, true, false]);
  assert.equal(up[2].process, "타일");
  assert.equal(L.shareable(up, "A", D).length, 2);
  const moved = L.moveTo(up[1], "B");
  assert.equal(moved.site, "B");
  assert.equal(L.shareable([moved], "B", D).length, 1);
});

test("안전 메모는 사람에게 넘긴다", () => {
  assert.equal(L.safetyFlag("안방 욕실 배관 연결부 누수 의심 자국"), "누수");
  assert.equal(L.safetyFlag("거실 벽 미세 균열 발견"), "균열");
  assert.equal(L.safetyFlag("분전반에서 탄 냄새"), "전기 안전");
  assert.equal(L.safetyFlag("타일 붙이기 시작"), "");
  assert.deepEqual(L.photoIssues(P({ note: "누수 의심" }), "A").map((i) => i.kind), ["safety"]);
});

test("규칙 일지: 공정별로 묶고 시간순, 안전 메모는 내용 대신 표시만", () => {
  const photos = [P({ time: "11:00", process: "타일", note: "주방 벽 타일 절반" }), P({ time: "08:40", process: "설비", note: "욕실 방수 1차" }), P({ time: "15:00", process: "설비", note: "배관 연결부 누수 의심" })];
  const log = L.ruleLog(SITE, D, photos, null);
  assert.deepEqual(log.items.map((x) => x.process), ["설비", "타일"]);
  assert.equal(log.items[0].done, "욕실 방수 1차");
  assert.equal(log.items[0].flag, "누수");
  assert.equal(log.count, 3);
});

test("다음 공정: 계획 순서에서 아직 안 한 첫 공정", () => {
  const photos = [P({ date: "2026-10-26", process: "철거" }), P({ date: "2026-10-27", process: "설비" }), P({ process: "타일" })];
  const pr = L.progress(photos, "A", D, ["철거", "설비", "전기", "타일", "도배", "바닥"]);
  assert.deepEqual(pr.done, ["철거", "설비"]);
  assert.deepEqual(pr.today, ["타일"]);
  assert.equal(pr.next, "도배");
  // 다른 현장 이름의 사진은 진행에 넣지 않는다
  const mixed = photos.concat(P({ process: "바닥", file: "B현장_바닥.jpg" }));
  assert.equal(L.progress(mixed, "A", D, ["철거", "설비", "전기", "타일", "도배", "바닥"]).next, "도배");
  assert.equal(L.ruleLog(SITE, "2026-10-01", photos, null).count, 0);
});

test("AI 응답 검사: 그날 없는 공정은 빼고, 다 빠지면 null", () => {
  const n = L.normalizeLog({ summary: "타일 작업", items: [{ process: "타일", done: "벽 타일", next: "줄눈" }, { process: "도배", done: "지어낸 도배" }], ask: "" }, ["타일"], false);
  assert.equal(n.items.length, 1);
  assert.equal(n.items[0].process, "타일");
  assert.equal(L.normalizeLog({ summary: "x", items: [{ process: "도배", done: "y" }] }, ["타일"], false), null);
  assert.equal(L.normalizeLog({ items: [] }, ["타일"], false), null);
  assert.equal(L.normalizeLog(null, ["타일"], false), null);
});

test("AI 응답 검사: 안전 확인 건이 있는데 '문제없다'고 쓰면 버린다", () => {
  const d = { summary: "설비 작업, 누수는 문제없습니다", items: [{ process: "설비", done: "방수" }], ask: "" };
  assert.equal(L.normalizeLog(d, ["설비"], true), null);
  assert.ok(L.normalizeLog(d, ["설비"], false));
  assert.ok(L.normalizeLog({ summary: "설비 작업을 했어요", items: [{ process: "설비", done: "방수" }] }, ["설비"], true));
});

test("Claude 일지와 합칠 때 안전 표시·다음 공정은 규칙을 따른다", () => {
  const rule = L.ruleLog(SITE, D, [P({ process: "설비", note: "누수 의심" })], null);
  const m = L.mergeAi(rule, { summary: "설비 작업", items: [{ process: "설비", done: "배관 점검", next: "" }], ask: "" });
  assert.equal(m.items[0].flag, "누수");
  assert.equal(m.next, rule.next);
});

test("고객 공유 문구: 가린 이름, 안전 건은 담당자 연락 문장, 주소 없음", () => {
  const photos = [P({ process: "설비", note: "배관 연결부 누수 의심 자국" }), P({ process: "타일", note: "욕실 벽 타일" })];
  const log = L.ruleLog(SITE, D, photos, null);
  const txt = L.shareText(SITE, D, log, ["누수"]);
  assert.match(txt, /한\*윤 고객님/);
  assert.ok(!txt.includes("한서윤"));
  assert.ok(!txt.includes("누수 의심 자국"));
  assert.match(txt, /담당자가 현장에서 직접 확인/);
  assert.match(txt, /설비 — .*담당자가 확인 중/);
});

test("공유 링크 토큰은 8자리, 같은 입력이면 같고 다르면 다르다", () => {
  const a = L.shareToken("A", D, "s1");
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, L.shareToken("A", D, "s1"));
  assert.notEqual(a, L.shareToken("B", D, "s1"));
});
