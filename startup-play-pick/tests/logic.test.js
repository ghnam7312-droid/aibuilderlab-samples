// 오늘놀이 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-28";
const HOME = ["종이", "크레파스", "수건", "상자", "컵", "공", "그릇·냄비", "그림책", "페트병", "쌀·콩", "끈·리본"];
const Q = { months: 20, minutes: 20, place: "실내", materials: HOME };

test("낱말 찾기: 조사가 붙어도 찾고, 비슷한 다른 말은 걸리지 않는다", () => {
  assert.ok(L.hasWord("콩을 옮겨요", "콩"));
  assert.ok(L.hasWord("끈으로 묶어요", "끈"));
  assert.ok(!L.hasWord("콩콩 뛰어요", "콩"));
  assert.ok(!L.hasWord("실내에서 해요", "실"));
  assert.ok(!L.hasWord("물감으로 칠해요", "물"));
  assert.ok(L.hasWord("의자 위에 올라가요", "의자 위"));
});

test("작은 부품: 36개월 미만이면 걸러내고, 그 뒤에는 주의만 붙인다", () => {
  const play = { title: "숟가락으로 콩 옮기기", materials: ["쌀·콩", "컵"], steps: ["콩을 컵으로 옮겨요"] };
  const young = L.screen(play, 20);
  assert.equal(young.ok, false);
  assert.equal(young.blocked[0].id, "small");
  const old = L.screen(play, 40);
  assert.equal(old.ok, true);
  assert.equal(old.cautions[0].id, "small");
});

test("풍선은 8세(96개월) 미만이면 뺀다", () => {
  const play = { title: "풍선 치기", materials: ["풍선"], steps: ["손바닥으로 쳐요"] };
  assert.equal(L.screen(play, 60).ok, false);
  assert.equal(L.screen(play, 96).ok, true);
});

test("불·열은 월령과 상관없이 뺀다", () => {
  const r = L.screen({ title: "촛불 끄기 놀이", materials: [], steps: ["촛불을 불어 꺼요"] }, 70);
  assert.equal(r.ok, false);
  assert.equal(r.blocked[0].always, true);
  assert.match(L.blockReason(r.blocked[0]), /화상/);
});

test("물·높은 곳은 빼지 않고 주의 문장을 붙인다", () => {
  const r = L.screen({ title: "컵으로 물 옮기기", materials: ["컵"], steps: ["그릇에 물을 조금 담아요"] }, 20);
  assert.equal(r.ok, true);
  assert.equal(r.cautions[0].id, "water");
});

test("규칙 추천: 20개월 샘플 → 3개, 영역이 겹치지 않고 모두 안전 기준 통과", () => {
  const r = L.recommend(L.CATALOG, Q, 0, [], TODAY);
  assert.equal(r.picks.length, 3);
  assert.equal(new Set(r.picks.map((p) => p.area)).size, 3);
  assert.ok(r.picks.every((p) => p.check.ok && Q.months >= p.min && Q.months <= p.max));
});

test("규칙 추천: 집에 콩·리본이 있어도 20개월에는 그 놀이를 걸러 이유와 함께 보여 준다", () => {
  const r = L.recommend(L.CATALOG, Q, 0, [], TODAY);
  const titles = r.screened.map((p) => p.title);
  assert.ok(titles.includes("숟가락으로 콩 옮기기"));
  assert.ok(titles.includes("리본 따라 춤추기"));
  assert.ok(r.picks.every((p) => !titles.includes(p.title)));
});

test("규칙 추천: 시간·장소·재료 조건을 지킨다", () => {
  const r = L.recommend(L.CATALOG, { months: 40, minutes: 10, place: "실외", materials: [] }, 0, [], TODAY);
  assert.ok(r.picks.length > 0);
  assert.ok(r.picks.every((p) => p.minutes <= 10 && p.materials.length === 0 && p.place !== "실내"));
});

test("이번 주에 많이 한 영역은 뒤로 미룬다", () => {
  const log = [1, 2, 3].map((i) => ({ date: L.addDays(TODAY, -i), title: `x${i}`, area: "언어" }));
  const r = L.recommend(L.CATALOG, Q, 0, log, TODAY);
  assert.notEqual(r.picks[0].area, "언어");
  assert.equal(L.weekAreas(log, TODAY)["언어"], 3);
  assert.equal(L.weekAreas([{ date: L.addDays(TODAY, -9), area: "언어" }], TODAY)["언어"], 0);
});

test("Claude 응답 검사: 형식이 틀리면 null, 맞으면 다듬어 돌려준다", () => {
  assert.equal(L.normalizePlays(null), null);
  assert.equal(L.normalizePlays({ plays: "공놀이" }), null);
  assert.equal(L.normalizePlays({ plays: [{ title: "", steps: ["a"] }] }), null);
  const p = L.normalizePlays({ plays: [{ title: "이불 산 넘기", minutes: 999, area: "모름", materials: ["이불"], steps: ["이불을 쌓아요", ""] }] });
  assert.equal(p.length, 1);
  assert.equal(p[0].minutes, 15);
  assert.equal(p[0].area, "감각");
  assert.deepEqual(p[0].steps, ["이불을 쌓아요"]);
});

test("Claude가 위험한 놀이를 섞어 줘도 안전 기준으로 걸러진다 (실제로 있었던 일)", () => {
  const plays = L.normalizePlays({ plays: [
    { title: "구슬 꿰기", area: "소근육", materials: ["구슬", "끈"], steps: ["구슬을 끈에 꿰어요"] },
    { title: "이불 산 넘기", area: "대근육", materials: ["이불"], steps: ["이불을 쌓아 넘어요"] },
  ] });
  const r = L.screenAi(plays, 18);
  assert.equal(r.usable, true);
  assert.deepEqual(r.picks.map((p) => p.title), ["이불 산 넘기"]);
  assert.equal(r.screened[0].check.blocked.length, 2);
  // 모두 위험하면 쓸 수 없다 → 화면은 규칙 결과 유지
  assert.equal(L.screenAi(plays.slice(0, 1), 18).usable, false);
});

test("걱정 메모는 사람에게 넘긴다: 응급 · 상담 · 없음", () => {
  assert.equal(L.triage("아까 단추를 삼킨 것 같아요").level, "urgent");
  assert.equal(L.triage("또래보다 말이 늦은 것 같아요").level, "consult");
  assert.equal(L.triage("요즘 밖에 나가고 싶어 해요").level, "none");
});

test("Claude 입력에는 걱정 메모·이름이 없고, 피할 기준이 들어간다", () => {
  const inp = L.aiInput({ ...Q, note: "말이 늦어요", nick: "다온" }, [], TODAY);
  assert.equal(JSON.stringify(inp).includes("말이 늦"), false);
  assert.equal(JSON.stringify(inp).includes("다온"), false);
  assert.ok(inp.avoid.includes("작은 부품") && inp.avoid.includes("풍선"));
});

test("기록: 같은 날 같은 놀이는 한 번만", () => {
  const e = { date: TODAY, title: "수건 까꿍", area: "정서·사회" };
  assert.equal(L.addLog(L.addLog([], e), e).length, 1);
});

test("공유 글: 월령만 쓰고 주의 문장을 붙인다", () => {
  const r = L.recommend(L.CATALOG, { months: 24, minutes: 15, place: "상관없음", materials: ["컵", "그릇·냄비"] }, 3, [], TODAY);
  const t = L.shareText({ months: 24, minutes: 15, place: "상관없음" }, r.picks);
  assert.match(t, /^\[오늘놀이\] 24개월/);
  assert.match(t, /어른이 곁에/);
});

test("'다른 놀이 보기': 방금 본 놀이는 빼고, 모자라면 다시 쓴다", () => {
  const first = L.recommend(L.CATALOG, Q, 0, [], TODAY);
  const next = L.recommend(L.CATALOG, Q, 1, [], TODAY, first.picks.map((p) => p.title));
  assert.equal(next.picks.length, 3);
  assert.ok(next.picks.every((p) => !first.picks.some((x) => x.title === p.title)));
  const few = L.recommend(L.CATALOG, { months: 70, minutes: 20, place: "실외", materials: [] }, 0, [], TODAY, ["그림자 밟기"]);
  assert.deepEqual(few.picks.map((p) => p.title), ["산책하며 색깔 찾기", "그림자 밟기"]);
});
