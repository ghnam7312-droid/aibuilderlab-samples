// 한장 로직 테스트 — node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const HJ = require("../logic.js");

const ids = () => { let n = 0; return (p) => `${p}${n++}`; };

test("숫자 칸: 쉼표·원·공백은 허용, 글자가 섞이면 NaN", () => {
  assert.equal(HJ.toNum("1,590,000원"), 1590000);
  assert.equal(HJ.toNum(" 12 "), 12);
  assert.ok(Number.isNaN(HJ.toNum("1,59O,000")));
  assert.ok(Number.isNaN(HJ.toNum("")));
});

test("오타 고치기 제안: 영문 O→0, l→1, 전각 숫자, 마침표 천 단위", () => {
  assert.equal(HJ.fixTypo("1,59O,000"), 1590000);
  assert.equal(HJ.fixTypo("l2"), 12);
  assert.equal(HJ.fixTypo("１２０"), 120);
  assert.equal(HJ.fixTypo("1.590.000"), 1590000);
  assert.equal(HJ.fixTypo("1,590,000"), null); // 이미 숫자면 고칠 것 없음
  assert.equal(HJ.fixTypo("약 백만"), null);    // 못 고치면 사람에게
});

test("CSV: BOM, 따옴표 속 쉼표·줄바꿈·큰따옴표, CRLF", () => {
  const t = '﻿부서,품목,수량,금액\r\n영업1팀,"프린터 토너, 검정",2,"96,000"\r\n영업1팀,"메모 ""급함""\n둘째 줄",1,500\r\n\r\n';
  const r = HJ.parseCSV(t);
  assert.equal(r.length, 3);
  assert.deepEqual(r[1], ["영업1팀", "프린터 토너, 검정", "2", "96,000"]);
  assert.equal(r[2][1], '메모 "급함"\n둘째 줄');
});

test("열 이름 맞추기: 같은 이름은 확정, 비슷한 이름은 사람 확인", () => {
  const sure = HJ.guessMapping(["부서", "일자", "담당", "거래처", "품목", "수량", "금액"]);
  assert.equal(sure.needsReview, false);
  const fuzzy = HJ.guessMapping(["매출일", "영업담당", "거래처명", "상품", "개수", "판매금액(원)"]);
  assert.deepEqual(fuzzy.cols.map((c) => c.field), ["date", "owner", "client", "item", "qty", "amount"]);
  const odd = HJ.guessMapping(["날", "누가", "상품명칭", "몇개", "얼마"]);
  assert.equal(odd.needsReview, true);
  assert.ok(odd.missing.length > 0);
});

test("표 → 부서 파일: '합계' 줄은 부서 보고 합계로 읽는다", () => {
  const r = HJ.tableToFile("B2B팀_10월3주.csv", [["부서", "품목", "수량", "금액"], ["B2B팀", "A4 용지(박스)", "10", "260,000"], ["B2B팀", "토너", "2", "96000"], ["합계", "", "", "356,000"]]);
  assert.equal(r.file.dept, "B2B팀");
  assert.equal(r.file.rows.length, 2);
  assert.equal(r.file.declared, 356000);
  assert.equal(r.file.declaredFromFile, true);
});

test("표 → 부서 파일: 머리글이 다르면 매핑을 먼저 묻는다, 매핑을 주면 읽는다", () => {
  const cells = [["매출일", "담당자", "상품 이름", "개수", "판매 금액(VAT 포함)"], ["10/12", "김도윤", "모니터", "2", "578000"]];
  const ask = HJ.tableToFile("영업1팀.csv", cells);
  assert.ok(ask.needMap);
  const ok = HJ.tableToFile("영업1팀.csv", cells, { mapping: ["date", "owner", "item", "qty", "amount"] });
  assert.equal(ok.file.dept, "영업1팀");
  assert.equal(ok.file.rows[0].item, "모니터");
});

test("표 → 부서 파일: 필요한 열이 없으면 이유를 말한다", () => {
  const r = HJ.tableToFile("x.csv", [["부서", "품목", "수량"], ["a", "b", "1"]], { mapping: ["dept", "item", "qty"] });
  assert.match(r.error, /금액/);
  assert.match(HJ.tableToFile("x.csv", []).error, /빈 파일/);
});

test("샘플: 48행, 중복 1행(영업2팀), 형식 오류 1칸(호남지사), 차이 −1,142,000", () => {
  const a = HJ.analyze(HJ.sampleWeek("now", ids()), []);
  assert.equal(a.all.length, 48);
  assert.equal(a.dupLeft.length, 1);
  assert.equal(a.bad.size, 1);
  assert.equal(a.diff, -1142000);
  assert.equal(a.pass, false);
});

test("중복을 빼고 오타를 고치면 보고 합계 = 행 합계, 검산 통과", () => {
  const files = HJ.sampleWeek("now", ids());
  const a = HJ.analyze(files, []);
  const badRow = a.all.find((x) => a.bad.has(x.r.id)).r;
  badRow.amount = String(HJ.fixTypo(badRow.amount));
  const b = HJ.analyze(files, a.dupLeft);
  assert.equal(b.diff, 0);
  assert.equal(b.pass, true);
});

test("부서별 대조: 중복이 있는 부서만 차이가 난다", () => {
  const files = HJ.sampleWeek("now", ids());
  const a = HJ.analyze(files, []);
  const off = files.filter((f) => a.perFile[f.id].diff !== 0).map((f) => f.dept);
  assert.deepEqual(off, ["영업2팀", "호남지사"]);
  assert.equal(a.perFile[files[1].id].diff, 448000); // 노트북 거치대 14개 한 줄 더
});

test("날짜가 다르면 같은 내용이라도 중복이 아니다", () => {
  const f = [{ id: "f", dept: "A", declared: 0, rows: [
    { id: "1", date: "10/12", owner: "a", client: "c", item: "i", qty: "1", amount: "100" },
    { id: "2", date: "10/13", owner: "a", client: "c", item: "i", qty: "1", amount: "100" },
  ] }];
  assert.equal(HJ.analyze(f, []).dupLeft.length, 0);
});

test("지난주 비교: ±15% 넘게 움직인 부서를 표시한다", () => {
  const n = HJ.sampleWeek("now", ids()), l = HJ.sampleWeek("last", ids());
  const a = HJ.analyze(n, []);
  const flagged = HJ.compareWeeks(n, l, a.dupLeft).filter((x) => x.flag).map((x) => x.dept);
  assert.ok(flagged.includes("B2B팀"));
  assert.ok(flagged.includes("해외사업팀"));
});

test("이상치 설명(규칙): 가장 큰 원인 품목·거래처, 새 품목/사라진 품목", () => {
  const n = HJ.sampleWeek("now", ids()), l = HJ.sampleWeek("last", ids());
  const b2b = HJ.explainChange(n[4], l[4], []);
  assert.match(b2b.lines[0], /^B2B팀 \+16% \(\+1,680,000원\)/);
  assert.match(b2b.lines[1], /회의 테이블\(\+4개, \+1,680,000원\) · 거래처 정우건설 — 지난주엔 없던 품목/);
  const ov = HJ.explainChange(n[9], l[9], []);
  assert.match(ov.lines[1], /모니터 27형\(−12개, −3,468,000원\).*이번 주엔 없는 품목/);
});

test("이상치 설명: 형식 오류 칸 때문에 줄어 보이면 먼저 알린다", () => {
  const n = HJ.sampleWeek("now", ids()), l = HJ.sampleWeek("last", ids());
  const hn = HJ.explainChange(n[7], l[7], []);
  assert.equal(hn.badCount, 1);
  assert.match(hn.lines[1], /형식 오류 1칸/);
});

test("통합 시트를 다시 올리면 부서별 파일로 나눈다 (엑셀 왕복)", () => {
  const cells = [["부서", "일자", "담당", "거래처", "품목", "수량", "금액"],
    ["영업1팀", "10/12", "김도윤", "한빛상사", "프린터 토너", "2", "96000"],
    ["영업2팀", "10/13", "박지훈", "미래물산", "무선 키보드", "3", "117000"],
    ["영업1팀", "10/14", "이서연", "대성테크", "A4 용지(박스)", "10", "260000"]];
  const r = HJ.tableToFiles("통합.xlsx", cells);
  assert.equal(r.split, true);
  assert.deepEqual(r.files.map((f) => [f.dept, f.rows.length, f.declared]), [["영업1팀", 2, 356000], ["영업2팀", 1, 117000]]);
});
