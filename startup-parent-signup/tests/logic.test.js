// 자리있음 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const S = [
  { id: "s1", org: "햇살어린이집", title: "아이 마음 읽는 대화법", when: "11/5(목) 10:30", place: "2층 강당", cap: 2, keys: ["햇살"] },
  { id: "s2", org: "푸른숲종합복지관", title: "영유아 놀이 코칭", when: "11/12(목) 19:00", place: "3층 프로그램실", cap: 3, keys: ["푸른숲"] },
];

test("전화번호: 여러 모양을 하나로, 휴대폰이 아니면 빈 값", () => {
  for (const s of ["010-2345-6789", "010 2345 6789", "010.2345.6789", "01023456789", "+82 10-2345-6789", "82-10-2345-6789"]) assert.equal(L.normPhone(s), "01023456789", s);
  assert.equal(L.normPhone("02-123-4567"), "");
  assert.equal(L.normPhone("010-12"), "");
});

test("가리기: 화면·내보내기는 가운데 네 자리를 숨긴다", () => {
  assert.equal(L.maskPhone("01023456789"), "010-****-6789");
  assert.equal(L.fmtPhone("01023456789"), "010-2345-6789");
});

test("Claude에 보낼 글에는 전화번호가 남지 않는다", () => {
  const m = L.maskForAi("김하은 010-2345-6789 햇살\n이도현 +82 10 5521 0934 푸른숲");
  assert.equal(/\d{4}/.test(m.text), false);
  assert.deepEqual(m.map, { "[전화1]": "01023456789", "[전화2]": "01055210934" });
});

test("메모 정리: 이름·번호·강의·아이 나이·경로를 읽는다", () => {
  const r = L.parseMemo("문자) 박서윤 어머님 010 3456 7788 햇살어린이집 강의 신청합니다. 아이 4세\n전화) 이도현 아버님 010-5521-0934 푸른숲 놀이 코칭, 30개월", S);
  assert.equal(r.entries.length, 2);
  assert.deepEqual([r.entries[0].name, r.entries[0].phone, r.entries[0].session, r.entries[0].kids, r.entries[0].source], ["박서윤", "01034567788", "s1", "4세", "문자"]);
  assert.deepEqual([r.entries[1].name, r.entries[1].session, r.entries[1].kids, r.entries[1].source], ["이도현", "s2", "30개월", "전화"]);
});

test("메모 정리: 번호·강의를 못 찾은 줄은 사람이 확인하도록 따로 모은다", () => {
  const r = L.parseMemo("전화) 한 분 더 신청한다고 하심. 번호는 못 받음. 푸른숲\n문자) 정민아님 01077810092 강의 신청해요", S);
  assert.equal(r.entries.length, 0);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0].why, /전화번호 없음/);
  assert.match(r.problems[1].why, /강의를 알 수 없음/);
});

test("메모 정리: 문의 문장은 메모로 남기고 '6살'은 '6세'로", () => {
  const r = L.parseMemo("문자) 정민아님 01077810092 햇살 강의요. 6살 둘째도 데려가도 되나요?", S);
  assert.equal(r.entries[0].kids, "6세");
  assert.equal(r.entries[0].note, "6살 둘째도 데려가도 되나요?");
});

test("중복 확인: 같은 번호·같은 강의는 한 명으로, 순서는 먼저 신청한 쪽", () => {
  const r = L.dedupe([
    { name: "김하은", phone: "01023456789", session: "s1", kids: "", at: "a" },
    { name: "이도현", phone: "01055210934", session: "s1", kids: "3세", at: "b" },
    { name: "김하은", phone: "01023456789", session: "s1", kids: "4세", at: "c" },
  ]);
  assert.equal(r.list.length, 2);
  assert.equal(r.list[0].name, "김하은");
  assert.equal(r.list[0].times, 2);
  assert.equal(r.list[0].kids, "4세"); // 비어 있던 값만 채운다
  assert.equal(r.list[0].at, "a");
  assert.equal(r.merged.length, 1);
});

test("중복 확인: 같은 번호라도 다른 강의면 따로, 이름이 다르면 확인 표시", () => {
  const r = L.dedupe([
    { name: "김하은", phone: "01023456789", session: "s1" },
    { name: "김하은", phone: "01023456789", session: "s2" },
    { name: "이준호", phone: "01023456789", session: "s1" },
  ]);
  assert.equal(r.list.length, 2);
  assert.equal(r.merged[0].nameDiff, "이준호");
});

test("기존 명단에 붙이기: 폼으로 이미 신청한 사람이 전화로 또 하면 추가되지 않는다", () => {
  const existing = [{ id: "f1", name: "김하은", phone: "01023456789", session: "s1", at: "2026-10-20", source: "폼" }];
  const r = L.merge(existing, [{ name: "김하은", phone: "01023456789", session: "s1" }, { name: "최유나", phone: "01099881122", session: "s2" }], "2026-10-28");
  assert.equal(r.list.length, 2);
  assert.equal(r.added, 1);
  assert.equal(r.dupes, 1);
  assert.equal(r.list[0].source, "폼");
});

test("정원: 먼저 신청한 순서대로 확정, 넘치면 대기 번호", () => {
  const list = ["c", "a", "b"].map((at) => ({ name: at, phone: "0101234567" + at.length, session: "s1", at }));
  const r = L.seats(list, S[0]);
  assert.deepEqual(r.map((e) => [e.name, e.status, e.wait]), [["a", "확정", 0], ["b", "확정", 0], ["c", "대기", 1]]);
});

test("안내 문자: 칸을 채우고, 모르는 칸은 알려 준다", () => {
  const msg = L.fillMessage(L.TEMPLATE["대기"], { name: "최유나", wait: 2 }, S[1]);
  assert.match(msg, /^\[푸른숲종합복지관\] 최유나님/);
  assert.match(msg, /대기 2번/);
  assert.equal(msg.includes("{"), false);
  assert.deepEqual(L.unknownFields("{이룸}님 {강의}"), ["이룸"]);
});

test("Claude 응답 검사: 번호표에 없는 번호·없는 강의는 버리고, 전부 틀리면 null", () => {
  const map = { "[전화1]": "01023456789" };
  assert.equal(L.normalizeParse(null, map, S), null);
  assert.equal(L.normalizeParse({ entries: [{ name: "김하은", phone: "010-9999-0000", session: "s1" }] }, map, S), null);
  const r = L.normalizeParse({ entries: [{ name: "김하은", phone: "[전화1]", session: "s1", kids: "4세" }, { name: "누구", phone: "[전화1]", session: "s9" }] }, map, S);
  assert.equal(r.length, 1);
  assert.equal(r[0].phone, "01023456789");
});

test("기관 제출용 CSV: 전화번호를 가리고, 쉼표가 든 칸은 따옴표로", () => {
  const rows = L.seats([{ name: "김하은", phone: "01023456789", session: "s1", kids: "4세, 2세", at: "a", source: "폼" }], S[0]);
  const csv = L.toCsv(rows, S[0]);
  assert.equal(csv.includes("01023456789"), false);
  assert.ok(csv.includes("010-****-6789"));
  assert.ok(csv.includes('"4세, 2세"'));
});
