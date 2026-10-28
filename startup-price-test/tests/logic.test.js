// 값찾기 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const OPTIONS = [{ id: "A", price: 15000 }, { id: "B", price: 30000 }, { id: "C", price: 49000 }];
const P = (code, seg, spent, option, reaction) => ({ code, seg, spent, option, reaction });
const PEOPLE = [
  P("P01", "직장인", 0, "A", "관심"), P("P02", "직장인", 120000, "B", "선결제"), P("P03", "직장인", 150000, "C", "선결제"),
  P("P04", "대학생", 0, "A", "선결제"), P("P05", "직장인", 90000, "B", "선결제"), P("P06", "학부모", 300000, "C", "관심"),
  P("P07", "직장인", 60000, "A", "관심"), P("P08", "학부모", 200000, "B", "관심"), P("P09", "직장인", 0, "C", "거절"),
  P("P10", "대학생", 0, "A", "관심"), P("P11", "대학생", 0, "B", "거절"), P("P12", "직장인", 80000, "C", "거절"),
];

test("유도형 질문을 찾는다: 미래 가정 · 동의 유도 · 가격 직접 묻기", () => {
  assert.equal(L.classify("AI가 숙제를 첨삭해 주면 쓰실 건가요?"), "미래 가정");
  assert.equal(L.classify("말하기 숙제를 받으면 하실 것 같나요?"), "미래 가정");
  assert.equal(L.classify("이런 앱이 나오면 추천하시겠어요?"), "미래 가정");
  assert.equal(L.classify("연습할 수 있으면 좋을 것 같지 않으세요?"), "동의 유도");
  assert.equal(L.classify("녹음 숙제가 있으면 도움이 되겠죠?"), "동의 유도");
  assert.equal(L.classify("한 달에 얼마면 내시겠어요?"), "가격 직접 묻기");
});

test("지난 행동 질문은 좋은 질문으로 둔다", () => {
  assert.equal(L.classify("지난달에 영어 회화에 얼마를 쓰셨어요?"), "지난 행동");
  assert.equal(L.classify("마지막으로 회화 수업을 그만둔 이유가 뭐였어요?"), "지난 행동");
  assert.equal(L.classify("지금 영어 공부는 어떻게 하고 계세요?"), "보통");
  assert.equal(L.classify(""), "보통");
});

test("바꿀 안은 주제에 맞는 지난 행동 질문이고, 그 자체는 유도형이 아니다", () => {
  const qs = ["한 달에 얼마면 내시겠어요?", "숙제가 있으면 하실 건가요?", "이런 앱 쓰실 건가요?", "튜터 수업이 좋을 것 같지 않으세요?", "도움이 되겠죠?"];
  L.checkQuestions(qs).forEach((it) => {
    assert.ok(it.leading, it.q);
    assert.ok(it.rewrite, it.q);
    assert.equal(L.classify(it.rewrite), "지난 행동", it.rewrite);
  });
  assert.ok(L.rewrite("한 달에 얼마면 내시겠어요?").includes("돈을 쓴 적"));
});

test("검사 결과: 지난 행동 질문에는 바꿀 안이 없고, 유도형 개수를 센다", () => {
  const r = L.checkQuestions(["지난달에 얼마를 쓰셨어요?", "쓰실 건가요?"]);
  assert.equal(r[0].rewrite, "");
  assert.equal(L.countLeading(r), 1);
});

test("Claude 응답 검사: 개수가 다르거나 leading이 불리언이 아니면 버린다", () => {
  const qs = ["쓰실 건가요?", "지난달에 얼마를 쓰셨어요?"];
  assert.equal(L.normalizeCheck(null, qs), null);
  assert.equal(L.normalizeCheck({ items: [{ leading: true }] }, qs), null);
  assert.equal(L.normalizeCheck({ items: [{ leading: "네" }, { leading: false }] }, qs), null);
});

test("Claude 응답 검사: 바꾼 질문이 또 유도형이면 규칙의 안으로 바꾼다", () => {
  const qs = ["숙제 첨삭 서비스 쓰실 건가요?", "지난달에 얼마를 쓰셨어요?"];
  const n = L.normalizeCheck({ items: [
    { leading: true, kind: "미래 가정", reason: "미래를 물음", rewrite: "숙제 첨삭이 있으면 매일 하시겠어요?" },
    { leading: false, kind: "지난 행동", reason: "좋음", rewrite: "" },
  ] }, qs);
  assert.equal(n[0].byRule, true);
  assert.equal(L.classify(n[0].rewrite), "지난 행동");
  assert.equal(n[1].leading, false);
  assert.equal(n[1].rewrite, "");
  // 모르는 kind는 질문을 다시 분류해서 채운다
  const m = L.normalizeCheck({ items: [{ leading: true, kind: "이상함", rewrite: "지난주에 영어로 말해 본 적이 있나요?" }, { leading: false }] }, qs);
  assert.equal(m[0].kind, "미래 가정");
  assert.equal(m[0].byRule, false);
});

test("가격 집계: 선결제만 결제로 세고, 기대 매출이 가장 큰 안을 고른다", () => {
  const rows = L.tally(PEOPLE, OPTIONS, "paid");
  assert.deepEqual(rows.map((r) => [r.id, r.shown, r.paid, r.per100]), [["A", 4, 1, 375000], ["B", 4, 2, 1500000], ["C", 4, 1, 1225000]]);
  assert.equal(L.best(rows).id, "B");
});

test("관심까지 세면 결론이 바뀐다 (말로 한 '쓸게요'의 함정)", () => {
  const rows = L.tally(PEOPLE, OPTIONS, "interest");
  assert.equal(rows[0].rate, 1); // A안은 4명 모두 관심
  assert.equal(L.best(rows).id, "C");
});

test("결제가 없으면 결정 보류, 반응은 거절 → 관심 → 선결제 순서로 돈다", () => {
  assert.equal(L.best(L.tally(PEOPLE.filter((p) => p.seg === "학부모"), OPTIONS, "paid")), null);
  assert.equal(L.nextReaction("거절"), "관심");
  assert.equal(L.nextReaction("관심"), "선결제");
  assert.equal(L.nextReaction("선결제"), "거절");
});

test("지난 행동과 선결제, 표본 크기 알림", () => {
  assert.deepEqual(L.pastVsPaid(PEOPLE), { spent: { n: 7, paid: 3 }, none: { n: 5, paid: 1 } });
  assert.ok(L.sampleNote(L.tally(PEOPLE, OPTIONS, "paid")).startsWith("안마다 4명"));
  assert.ok(L.sampleNote([{ shown: 2 }, { shown: 5 }]).includes("3명 미만"));
  assert.equal(L.sampleNote([{ shown: 12 }, { shown: 10 }]), "");
});

test("내보내기: 요약 마크다운과 CSV(이름 없이 번호만, 쉼표 이스케이프)", () => {
  const rows = L.tally(PEOPLE, OPTIONS, "paid");
  const md = L.summaryMd(rows, L.best(rows), L.pastVsPaid(PEOPLE), { leading: 4, total: 7 });
  assert.ok(md.includes("**결정: 월 30,000원**"));
  assert.ok(md.includes("| B | 30,000원 | 4명 | 2명 | 50% | 1,500,000원 |"));
  assert.ok(md.includes("유도형 4개"));
  const c = L.csv([P("P01", "직장인, 30대", 0, "A", "관심")]);
  assert.ok(c.startsWith("﻿번호,"));
  assert.ok(c.includes('"직장인, 30대"'));
  assert.equal(c.trim().split("\r\n").length, 2);
});
