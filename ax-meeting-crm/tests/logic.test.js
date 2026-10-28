// 적어줌 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-28"; // 수요일
const MEMO = `가람식품 미팅 10/28(수) 본사 3층
참석: 오세진 팀장(구매), 나
- 발주 시스템이 느려서 바꾸려고 함. 공장 2곳 동시 사용 필요
- 처음엔 예산 2,800만 정도라 했는데, 공장 추가해서 최종 견적은 3,200만 원으로 맞춤
- 오 팀장 연락처 010-2345-6789, sejin.oh@garam.example
- 다음 주 화요일까지 수정 견적서 보내기로 함`;

test("금액 표현: 만·천만·억·원 단위를 원으로 바꾼다", () => {
  const v = (s) => L.findAmounts(s).map((a) => a.value);
  assert.deepEqual(v("3,200만 원"), [32000000]);
  assert.deepEqual(v("1억 2천만"), [120000000]);
  assert.deepEqual(v("1.5억"), [150000000]);
  assert.deepEqual(v("월 450,000원"), [450000]);
  assert.deepEqual(v("5명 참석, 2곳"), []);
});

test("금액 표시와 사람이 친 금액 읽기", () => {
  assert.equal(L.fmtWon(32000000), "3,200만 원");
  assert.equal(L.fmtWon(120000000), "1억 2,000만 원");
  assert.equal(L.parseWonInput("1.2억"), 120000000);
  assert.equal(L.parseWonInput("32,000,000"), 32000000);
  assert.equal(L.parseWonInput("삼천만"), null);
});

test("날짜: '다음 주 화요일'은 다음 달력 주, 없는 날짜는 버린다", () => {
  const d = (s) => L.findDates(s, TODAY).map((x) => x.iso);
  assert.deepEqual(d("다음 주 화요일까지"), ["2026-11-03"]);
  assert.deepEqual(d("이번 주 금요일"), ["2026-10-30"]);
  assert.deepEqual(d("11/5 재미팅"), ["2026-11-05"]);
  assert.deepEqual(d("2/30"), []);
  assert.deepEqual(d("내일 전화"), ["2026-10-29"]);
});

test("규칙: 금액이 여러 개면 '최종'이 붙은 금액을 고르고 후보는 남긴다", () => {
  const r = L.extractRule(MEMO, TODAY, ["가람식품", "하늘물류"]);
  assert.equal(r.fields.company, "가람식품");
  assert.equal(r.fields.contact, "오세진 팀장");
  assert.equal(r.fields.amount, 32000000);
  assert.equal(r.cand.amount.length, 2);
  assert.equal(r.fields.meetingDate, "2026-10-28");
  assert.equal(r.fields.nextDate, "2026-11-03");
  assert.equal(r.fields.stage, "견적");
});

test("규칙: 날짜가 없으면 미팅일은 오늘, 단계는 첫 미팅", () => {
  const r = L.extractRule("고객사: 바른교육\n첫 인사, 담당 이하린 대리. 내년 예산 잡히면 연락 준다고 함", TODAY, []);
  assert.equal(r.fields.company, "바른교육");
  assert.equal(r.fields.meetingDate, TODAY);
  assert.equal(r.fields.amount, null);
  assert.equal(r.fields.stage, "첫 미팅");
});

test("개인정보: 전화·메일은 요약·다음 할 일에서 가린다", () => {
  assert.equal(L.maskPII("연락 010-2345-6789 / a.b@x.example"), "연락 [전화 가림] / [메일 가림]");
  const r = L.extractRule(MEMO, TODAY, ["가람식품"]);
  assert.ok(!/010-2345/.test(JSON.stringify(r.fields)));
});

test("Claude 응답 검사: 형식이 틀리면 버린다", () => {
  assert.equal(L.normalizeAi(null, MEMO, TODAY), null);
  assert.equal(L.normalizeAi([], MEMO, TODAY), null);
  assert.equal(L.normalizeAi({ company: "", summary: "" }, MEMO, TODAY), null);
  const n = L.normalizeAi({ company: "가람식품", stage: "거의 계약", amount: "3200만", meetingDate: "10/28", summary: "교체 검토" }, MEMO, TODAY);
  assert.equal(n.fields.stage, "");
  assert.equal(n.fields.amount, null);
  assert.equal(n.fields.meetingDate, "");
});

test("Claude가 원문에 없는 숫자를 옮기면 표시한다 (2,800만 ≠ 3,800만)", () => {
  const n = L.normalizeAi({ company: "가람식품", summary: "교체 검토", amount: 38000000, meetingDate: "2026-10-28", nextDate: "2026-11-03" }, MEMO, TODAY);
  assert.deepEqual(n.notInSource, ["amount"]);
  const ok = L.normalizeAi({ company: "가람식품", summary: "교체 검토", amount: 28000000, meetingDate: "2026-10-28" }, MEMO, TODAY);
  assert.deepEqual(ok.notInSource, []);
  assert.equal(ok.src.amount, "2,800만");
});

test("mergeAi: Claude가 비운 칸은 규칙 값을 남긴다", () => {
  const rule = L.extractRule(MEMO, TODAY, ["가람식품"]);
  const ai = L.normalizeAi({ company: "가람식품", contact: "", summary: "공장 2곳 발주 시스템 교체", amount: 32000000, stage: "견적" }, MEMO, TODAY);
  const m = L.mergeAi(rule, ai);
  assert.equal(m.fields.contact, "오세진 팀장");
  assert.equal(m.fields.summary, "공장 2곳 발주 시스템 교체");
  assert.equal(m.fields.nextDate, "2026-11-03");
  assert.equal(m.mode, "ai");
});

test("저장: 숫자 칸은 사람이 모두 확인해야 저장된다", () => {
  const f = { company: "가람식품", stage: "견적", amount: 32000000, meetingDate: TODAY, nextDate: "2026-11-03" };
  assert.deepEqual(L.canSave(f, {}).need, ["amount", "meetingDate", "nextDate"]);
  assert.equal(L.canSave(f, { amount: true, meetingDate: true }).ok, false);
  assert.equal(L.canSave(f, { amount: true, meetingDate: true, nextDate: true }).ok, true);
  // 비어 있는 숫자 칸은 확인할 것이 없다
  assert.equal(L.canSave({ ...f, amount: null, nextDate: "" }, { meetingDate: true }).ok, true);
  assert.deepEqual(L.canSave({ ...f, company: " " }, { amount: true, meetingDate: true, nextDate: true }).problems, ["고객사"]);
});

test("같은 고객사·같은 미팅일은 새로 쌓지 않고 고친다", () => {
  const list = [{ id: "a", company: "(주)가람식품", meetingDate: TODAY, amount: 1 }];
  const r = L.upsert(list, { id: "b", company: "가람식품", meetingDate: TODAY, amount: 2 });
  assert.equal(r.replaced, true);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].id, "a");
  assert.equal(r.list[0].amount, 2);
  assert.equal(L.upsert(list, { id: "c", company: "가람식품", meetingDate: "2026-10-01" }).list.length, 2);
});

test("목록 거르기: 단계·담당·검색어", () => {
  const list = [{ company: "가람식품", stage: "견적", owner: "이서윤" }, { company: "하늘물류", stage: "계약", owner: "김도현" }];
  assert.equal(L.filterRecords(list, { stage: "견적" }).length, 1);
  assert.equal(L.filterRecords(list, { owner: "김도현" })[0].company, "하늘물류");
  assert.equal(L.filterRecords(list, { q: "하늘" }).length, 1);
});

test("CSV: BOM, 따옴표, 수식 방지, 연락처 가림", () => {
  const csv = L.toCsv([{ savedAt: TODAY, owner: "이서윤", company: "=가람", contact: "오세진 팀장", stage: "견적", amount: 32000000, meetingDate: TODAY, nextDate: "", nextAction: "견적서 \"수정본\" 보내기", summary: "연락 010-2345-6789" }]);
  assert.ok(csv.startsWith("﻿저장일,"));
  assert.ok(csv.includes("'=가람"));
  assert.ok(csv.includes('"견적서 ""수정본"" 보내기"'));
  assert.ok(!csv.includes("010-2345"));
  assert.ok(csv.endsWith("\r\n"));
});
