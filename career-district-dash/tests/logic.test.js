// 자리판 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const ROWS = L.sampleRows();
const FULL = { ...L.RENAMES, ...L.MISSING_IN_TABLE };

test("샘플 데이터: 3개 구 · 18개 동 · 업종 20개, 같은 씨앗이면 같은 값", () => {
  assert.equal(L.GUS.length, 3);
  assert.equal(L.DONGS.length, 18);
  assert.equal(L.BIZ_NAMES.length, 20);
  assert.equal(new Set(L.BIZ_NAMES).size, 20);
  assert.deepEqual(L.sampleRows(), ROWS);
  assert.ok(ROWS.every((r) => r.stores >= 0 && r.opened >= 0 && r.closed >= 0));
});

test("1분기 원본에는 옛 이름이 들어 있다 (2분기는 지금 이름만)", () => {
  const q1Names = new Set(ROWS.filter((r) => r.q === "2026Q1").map((r) => r.dong));
  const q2Names = new Set(ROWS.filter((r) => r.q === "2026Q2").map((r) => r.dong));
  assert.ok(q1Names.has("새솔2동") && q1Names.has("솔밭1동") && q1Names.has("가람2동"));
  assert.ok(!q2Names.has("새솔2동"));
  assert.equal(q2Names.size, 18);
});

test("이름 맞추기: 지금 이름은 그대로, 옛 이름은 대응표로, 모르면 빈 문자열", () => {
  assert.equal(L.resolveDong("햇살동", {}), "햇살동");
  assert.equal(L.resolveDong("새솔2동", L.RENAMES), "햇살동");
  assert.equal(L.resolveDong("새솔 2동", L.RENAMES), "햇살동");
  assert.equal(L.resolveDong("새솔2동", {}), "");
  assert.equal(L.resolveDong("없는동", { "없는동": "어딘가동" }), ""); // 지금 목록에 없는 이름으로는 못 보낸다
});

test("대응표가 없으면 옛 이름 행이 빠지고, 대응표를 쓰면 되살아난다", () => {
  const off = L.aggregate(ROWS, { biz: "커피전문점", gus: L.GUS, map: {} });
  const on = L.aggregate(ROWS, { biz: "커피전문점", gus: L.GUS, map: L.RENAMES });
  const full = L.aggregate(ROWS, { biz: "커피전문점", gus: L.GUS, map: FULL });
  assert.equal(off.unmatched.length, 7);
  assert.deepEqual(on.unmatched.map((u) => u.name), ["가람2동"]);
  assert.equal(on.unmatched[0].rows, 20); // 업종 20개 × 1분기
  assert.equal(full.unmatched.length, 0);
  const sol = (a) => a.dongs.find((d) => d.dong === "솔밭동");
  assert.equal(sol(off).Q1.stores, 0);
  assert.ok(sol(on).Q1.stores > 0);
  assert.equal(sol(off).Q2.stores, sol(on).Q2.stores);
});

test("두 동이 합쳐진 경우(솔밭1·2동 → 솔밭동) 1분기 합이 원본 합과 같다", () => {
  const a = L.aggregate(ROWS, { biz: "편의점", gus: ["새솔구"], map: L.RENAMES });
  const raw = ROWS.filter((r) => r.biz === "편의점" && r.q === "2026Q1" && (r.dong === "솔밭1동" || r.dong === "솔밭2동")).reduce((s, r) => s + r.stores, 0);
  assert.equal(a.dongs.find((d) => d.dong === "솔밭동").Q1.stores, raw);
  assert.equal(a.dongs.length, 6);
});

test("집계 숫자: 증감·폐업률·1만 명당 점포", () => {
  const rows = [
    { q: "2026Q2", gu: "한빛구", dong: "한빛1동", biz: "꽃집", stores: 20, opened: 3, closed: 2, sales: 1000 },
    { q: "2026Q1", gu: "한빛구", dong: "한빛1동", biz: "꽃집", stores: 16, opened: 1, closed: 1, sales: 900 },
  ];
  const d = L.aggregate(rows, { biz: "꽃집", gus: ["한빛구"], map: {} }).dongs.find((x) => x.dong === "한빛1동");
  assert.equal(d.change, 4);
  assert.equal(d.changePct, 25);
  assert.equal(d.closeRate, 10);
  assert.equal(d.density, 4.8); // 20 / (42000/10000)
});

test("참고 점수: 0~100, 모두 같으면 50, 경쟁 적고 매출 높은 동이 위", () => {
  const list = L.score([
    { density: 2, closeRate: 1, Q2: { sales: 3000 } },
    { density: 9, closeRate: 9, Q2: { sales: 1000 } },
  ]);
  assert.equal(list[0].score, 100);
  assert.equal(list[1].score, 0);
  const same = L.score([{ density: 3, closeRate: 3, Q2: { sales: 3 } }, { density: 3, closeRate: 3, Q2: { sales: 3 } }]);
  assert.equal(same[0].score, 50);
  const a = L.aggregate(ROWS, { biz: "약국", gus: L.GUS, map: FULL });
  assert.ok(a.dongs.every((d) => d.score >= 0 && d.score <= 100));
});

test("정렬: 점수는 높은 순, 폐업률·경쟁은 낮은 순", () => {
  const a = L.aggregate(ROWS, { biz: "치킨", gus: L.GUS, map: FULL });
  const s = L.sortDongs(a.dongs, "score");
  assert.ok(s[0].score >= s[s.length - 1].score);
  const c = L.sortDongs(a.dongs, "closeRate");
  assert.ok(c[0].closeRate <= c[c.length - 1].closeRate);
});

test("표본 검산: 대응표가 온전하면 10건 모두 일치, 빠진 이름이 있으면 그 동이 불일치", () => {
  const good = L.aggregate(ROWS, { biz: "커피전문점", gus: L.GUS, map: FULL });
  const ok = L.verifySample(ROWS, good, FULL, 10, 3);
  assert.equal(ok.length, 10);
  assert.equal(new Set(ok.map((c) => c.dong)).size, 10);
  assert.ok(ok.every((c) => c.ok));
  const bad = L.aggregate(ROWS, { biz: "커피전문점", gus: L.GUS, map: {} });
  const all = L.verifySample(ROWS, bad, FULL, 18, 3);
  const wrong = all.filter((c) => !c.ok).map((c) => c.dong).sort();
  assert.deepEqual(wrong, ["가람동", "누리동", "별마루동", "솔밭동", "푸른들동", "햇살동"].sort());
});

test("규칙 요약은 숫자 검산을 통과한다", () => {
  for (const biz of ["커피전문점", "세탁소", "헬스장"]) {
    const a = L.aggregate(ROWS, { biz, gus: L.GUS, map: FULL });
    const r = L.normalizeBrief(L.ruleBrief(a), L.aiInput(a));
    assert.equal(r.ok, true, biz);
    assert.equal(r.brief.lines.length, 3);
  }
});

test("Claude 응답 검사: 형식이 틀리거나 입력에 없는 숫자가 있으면 버린다", () => {
  const a = L.aggregate(ROWS, { biz: "커피전문점", gus: L.GUS, map: FULL });
  const inp = L.aiInput(a);
  assert.equal(L.normalizeBrief("문장", inp).ok, false);
  assert.equal(L.normalizeBrief({ headline: "제목", lines: ["하나"] }, inp).ok, false);
  const made = L.normalizeBrief({ headline: "커피전문점 비교", lines: [`점포 ${inp.totalStores}곳`, "월매출 98,765만 원으로 가장 높아요"], caution: "" }, inp);
  assert.equal(made.ok, false);
  assert.match(made.reason, /숫자 검산 실패/);
  const fine = L.normalizeBrief({ headline: "커피전문점 비교", lines: [`점포 ${L.fmt(inp.totalStores)}곳`, `상위 3곳은 ${inp.dongs[0].dong} 등`] }, inp);
  assert.equal(fine.ok, true);
});

test("숫자 뽑기: 쉼표·소수·퍼센트", () => {
  assert.deepEqual(L.numbersIn("1,234곳, 폐업률 5.6%, 2분기"), [1234, 5.6, 2]);
  assert.deepEqual(L.numbersIn(""), []);
});

test("CSV: BOM, 머리글, 쉼표가 든 칸은 따옴표", () => {
  const a = L.aggregate(ROWS, { biz: "과일·채소", gus: ["누리구"], map: FULL });
  const csv = L.toCsv(a, "score");
  assert.ok(csv.startsWith("﻿구,행정동,업종"));
  assert.equal(csv.split("\r\n").length, 7);
  assert.equal(L.csvCell('a,"b"'), '"a,""b"""');
});
