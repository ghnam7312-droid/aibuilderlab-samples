// 첫답 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const T = (subject, body, extra) => ({ id: "t1", at: "09:00", channel: "채팅", subject, body, ...extra });

test("분류: 제목·본문 낱말로 나누고 담당을 정한다", () => {
  const r = L.triage(T("배송이 아직 안 와요", "주문한 지 5일 됐는데 택배 조회가 안 됩니다"));
  assert.equal(r.cat, "ship");
  assert.equal(r.agent, "haneul");
  assert.ok(r.words.includes("택배"));
  assert.equal(L.triage(T("비밀번호를 잊었어요", "로그인이 안 됩니다")).cat, "account");
  assert.equal(L.triage(T("교환 문의", "사이즈가 안 맞아서 한 치수 큰 걸로 바꾸고 싶어요")).cat, "return");
});

test("맞는 낱말이 없으면 '기타'로 매니저에게, 신뢰도는 낮게", () => {
  const r = L.triage(T("안녕하세요", "그냥 궁금한 게 있어서요"));
  assert.equal(r.cat, "etc");
  assert.equal(r.agent, "serin");
  assert.ok(r.confidence < 0.5);
});

test("환불·보상: 낱말이 한 번만 나와도 환불·보상으로, 초안 없이 사람에게", () => {
  const r = L.triage(T("반품 문의", "반품 수거는 왔는데 환불은 언제 되나요?"));
  assert.equal(r.cat, "refund");
  assert.equal(r.ho.handoff, true);
  assert.equal(r.ho.kind, "refund");
  assert.equal(r.draft, "");
  assert.equal(r.agent, "doyun");
});

test("안전·법률: 분류와 상관없이 매니저가 직접, 급함 표시", () => {
  const r = L.triage(T("조립하다가", "의자 조립 중에 나사가 튀어서 손을 다쳤어요"));
  assert.equal(r.cat, "product");
  assert.equal(r.ho.kind, "safety");
  assert.equal(r.agent, "serin");
  assert.equal(r.urgent, true);
  assert.equal(r.draft, "");
});

test("규칙 초안: 주문번호를 넣고, 약속 표현은 없다", () => {
  const r = L.triage(T("배송 지연", "주문번호 SD2610241 아직 출고 전인가요"));
  assert.ok(r.draft.includes("SD2610241"));
  for (const c of ["ship", "return", "pay", "product", "account", "etc"]) {
    assert.deepEqual(L.findPromises(L.draftFor(T("", ""), c)), [], c);
  }
});

test("약속 표현 찾기", () => {
  assert.deepEqual(L.findPromises("확인 후 안내드리겠습니다"), []);
  assert.ok(L.findPromises("바로 환불해 드리겠습니다").length);
  assert.ok(L.findPromises("이번 건은 무료로 교환해 드릴게요").length);
  assert.ok(L.findPromises("배송비는 저희가 부담하겠습니다").length);
  assert.ok(L.findPromises("사과의 뜻으로 쿠폰을 지급하겠습니다").length);
});

test("Claude 응답 검사: 분류가 목록에 없으면 버린다", () => {
  const rule = L.triage(T("배송", "택배가 안 와요"));
  assert.equal(L.normalizeTriage({ category: "불만" }, rule), null);
  assert.equal(L.normalizeTriage("텍스트", rule), null);
  const n = L.normalizeTriage({ category: "배송", confidence: 3, reason: "택배 언급", urgent: "yes", draft: "확인 중입니다" }, rule);
  assert.deepEqual([n.cat, n.confidence, n.urgent], ["ship", 1, false]);
});

test("Claude 응답 검사: 약속이 든 초안은 버리고 담당자에게 넘긴다", () => {
  const t = T("파손", "식탁 상판이 깨져서 왔어요");
  const rule = L.triage(t);
  const ai = L.normalizeTriage({ category: "교환·반품", confidence: 0.9, reason: "파손", urgent: false, draft: "불편을 드려 죄송합니다. 무료로 교환해 드리겠습니다." }, rule);
  assert.equal(ai.draft, "");
  assert.ok(ai.promises.length);
  const m = L.applyAi(rule, ai, t);
  assert.equal(m.ho.handoff, true);
  assert.equal(m.ho.kind, "promise");
  assert.equal(m.draft, "");
  assert.equal(m.mode, "ai");
});

test("Claude가 환불 문의를 다른 분류로 봐도, 규칙이 넘긴 건 되돌리지 않는다", () => {
  const t = T("환불", "환불 요청합니다");
  const rule = L.triage(t);
  const ai = L.normalizeTriage({ category: "결제·영수증", confidence: 0.8, reason: "", urgent: false, draft: "결제 내역을 확인하겠습니다" }, rule);
  assert.equal(ai.draft, "");
  const m = L.applyAi(rule, ai, t);
  assert.equal(m.ho.handoff, true);
  assert.equal(m.draft, "");
});

test("수동 배정이 우선한다", () => {
  const r = L.triage(T("배송", "택배가 안 와요"), "minjae");
  assert.equal(r.agent, "minjae");
  assert.equal(L.assign("ship", null, "없는사람"), "haneul");
});

test("개인정보 가리기: 이름·휴대폰·이메일·카드번호", () => {
  const s = L.maskPii("김민서입니다. 010-2345-6789 / minseo.k@example.com 카드 1234-5678-9012-3456", ["김민서"]);
  assert.equal(s, "[이름]입니다. [연락처] / [이메일] 카드 [카드번호]");
  assert.equal(L.maskName("김민서"), "김○○");
});

test("첫 응답 시간: 목표 40분 기준 상태", () => {
  assert.deepEqual(L.sla("10:00", L.toMin("10:20")), { kind: "ok", min: 20 });
  assert.equal(L.sla("10:00", L.toMin("10:35")).kind, "soon");
  assert.equal(L.sla("09:00", L.toMin("10:30")).kind, "late");
  assert.deepEqual(L.sla("09:00", 0, "09:25"), { kind: "done", min: 25 });
  assert.equal(L.fmtMin(L.toMin("08:05")), "08:05");
});

test("통계: 평균 첫 응답 · 사람 확인 · 배정 수정률", () => {
  const tickets = [T("배송", "택배", { id: "a", respondedAt: "09:30" }), T("환불", "환불", { id: "b", at: "09:10" }), T("로그인", "비밀번호", { id: "c", respondedAt: "09:10" })];
  const list = tickets.map((t) => L.triage(t));
  const s = L.stats(list, tickets, { a: "minjae" });
  assert.equal(s.avgFirst, 20);
  assert.equal(s.handoff, 1);
  assert.equal(s.open, 1);
  assert.equal(s.fixRate, 33.3);
});

test("CSV: 고객 이름·연락처·본문은 나가지 않는다", () => {
  const t = T("배송, 문의", "김민서 010-2345-6789 택배가 안 와요", { id: "a", customer: "김민서", contact: "010-2345-6789" });
  const csv = L.toCsv([L.triage(t)], [t]);
  assert.ok(csv.startsWith("﻿번호,접수"));
  assert.ok(!csv.includes("김민서"));
  assert.ok(!csv.includes("010-2345"));
  assert.ok(csv.includes("김하늘"));
  assert.equal(L.csvCell('a,"b"'), '"a,""b"""');
});
