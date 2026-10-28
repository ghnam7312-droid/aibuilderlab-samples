// 첫주노트 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const DOCS = `부서,문서명,종류,개정일
영업팀,취업규칙,규정,2023-03-01
재무팀,취업규칙(개정),규정,2026-01-01
개발팀,취업규칙,규정,2024-07-01
재무팀,경비 처리 규정_최종,규정,2025-09-15
마케팅팀,경비 처리 규정,규정,2025.9.15
재무팀,보안 서약서 양식,양식,
영업팀,연차 신청 절차,안내,2025-02-01
개발팀,연차 신청 절차,안내,`;
const docs = () => L.parseDocs(DOCS).docs;

const QS = `부서,질문
영업팀,연차 신청은 어디서 하나요?
재무팀,연차 신청 어디서 하나요
개발팀,연차 신청은 어디서 하나요?
영업팀,수습 기간에도 급여가 100% 나오나요?
개발팀,수습 기간 급여는 어떻게 되나요?
재무팀,보안 서약서는 언제 내나요?
개발팀,보안 서약서 제출 시기가 언제인가요?
마케팅팀,명함 신청은 어디서 하나요?`;
const qs = () => L.parseQuestions(QS);

test("개정일 읽기: 점·하이픈·두 자리 연도, 없는 날짜는 버린다", () => {
  assert.equal(L.normDate("2025.9.15"), "2025-09-15");
  assert.equal(L.normDate("25-9-1"), "2025-09-01");
  assert.equal(L.normDate("2025-02-30"), "");
  assert.equal(L.normDate(""), "");
});

test("같은 문서로 보기: (개정), _최종, v2, 공백은 지운다", () => {
  assert.equal(L.docKey("취업규칙(개정)"), L.docKey("취업규칙"));
  assert.equal(L.docKey("경비 처리 규정_최종"), L.docKey("경비처리규정"));
  assert.equal(L.docKey("법인카드 사용 안내 v2"), L.docKey("법인카드 사용 안내"));
  assert.notEqual(L.docKey("연차 신청 절차"), L.docKey("출장 신청 절차"));
});

test("최신본만 남긴다: 개정일이 가장 늦은 것, 예전 개정본은 제외", () => {
  const r = L.latestOnly(docs());
  const rule = r.kept.find((d) => d.key === L.docKey("취업규칙"));
  assert.equal(rule.date, "2026-01-01");
  assert.equal(rule.dept, "재무팀");
  assert.equal(rule.replaced, 2);
  assert.equal(r.old.filter((d) => d.replacedBy === rule.id).length, 2);
});

test("같은 날짜 개정본이 두 부서에 있으면 하나만 남기고 사본으로 표시", () => {
  const r = L.latestOnly(docs());
  const exp = r.kept.find((d) => d.key === L.docKey("경비 처리 규정"));
  assert.deepEqual(exp.copies, ["마케팅팀"]);
  assert.ok(r.old.some((d) => d.why === "같은 개정본 사본"));
});

test("개정일 없는 문서: 개정본이 있으면 제외, 없으면 '확인 필요'로 남기지 않는다", () => {
  const r = L.latestOnly(docs());
  assert.ok(r.old.some((d) => d.title === "연차 신청 절차" && d.why.startsWith("개정일 없음")));
  assert.deepEqual(r.undated.map((d) => d.title), ["보안 서약서 양식"]);
  assert.ok(!r.kept.some((d) => d.title === "보안 서약서 양식"));
});

test("담당자가 인정하면 개정일 없는 문서도 최신본으로", () => {
  const id = docs().find((d) => d.title === "보안 서약서 양식").id;
  const r = L.latestOnly(docs(), { [id]: true });
  const k = r.kept.find((d) => d.id === id);
  assert.ok(k && k.confirmed);
  assert.equal(r.undated.length, 0);
});

test("질문 묶기: 표현이 조금 달라도 같은 질문, '신청'만 같은 질문은 따로", () => {
  const g = L.cluster(qs());
  const leave = g.find((x) => x.ids.includes(1));
  assert.deepEqual(leave.ids, [1, 2, 3]);
  assert.ok(!leave.ids.includes(8)); // 명함 신청은 연차와 다른 질문
  assert.ok(L.sim("연차 신청은 어디서 하나요?", "연차 신청 어디서 하나요") > 0.9);
});

test("공통 질문: 2개 부서 이상, 최신본 자료에만 연결", () => {
  const r = L.latestOnly(docs());
  const f = L.finish(L.cluster(qs()), qs(), r.kept, 2);
  const leave = f.find((x) => x.ids.includes(1));
  assert.ok(leave.common);
  assert.equal(r.kept.find((d) => d.id === leave.docId).date, "2025-02-01");
  const card = f.find((x) => x.ids.includes(8));
  assert.equal(card.common, false);
  // 보안 서약서는 최신본이 '확인 필요'라 아직 연결하지 않는다
  assert.equal(f.find((x) => x.ids.includes(6)).docId, "");
});

test("급여·계약 질문은 자료를 연결하지 않고 인사 담당자에게", () => {
  assert.ok(L.isSensitive("수습 기간 급여는 어떻게 되나요?"));
  assert.ok(L.isSensitive("근로계약서 사본은 어디서 받나요?"));
  assert.ok(!L.isSensitive("연차 신청은 어디서 하나요?"));
  const f = L.finish([{ question: "수습 급여", ids: [4, 5], docId: "D2" }], qs(), L.latestOnly(docs()).kept, 2);
  assert.equal(f[0].sensitive, true);
  assert.equal(f[0].docId, "");
});

test("Claude 응답 검사: 질문 번호는 한 번씩, 구버전 자료 연결은 지우고, 빠진 질문은 붙인다", () => {
  const r = L.latestOnly(docs());
  const oldId = r.old[0].id;
  const g = L.normalizeFaq({ groups: [
    { question: "연차는 어디서 신청하나요?", ids: [1, 2, 3, 99], docId: oldId, category: "근태" },
    { question: "연차 중복", ids: [3] },
    { question: "급여", ids: [4, 5] },
  ] }, qs(), r.kept);
  assert.deepEqual(g[0].ids, [1, 2, 3]);
  assert.equal(g[0].docId, "");
  assert.equal(g.length, 2 + 3); // 6, 7, 8번은 따로 붙음
  assert.ok(g.filter((x) => x.missed).every((x) => x.ids.length === 1));
  assert.equal(L.normalizeFaq({ groups: [] }, qs(), r.kept), null);
  assert.equal(L.normalizeFaq("묶음", qs(), r.kept), null);
});

test("확산 계획: 칸 넘기기는 원본을 바꾸지 않고, 네 단계 완료면 적용", () => {
  const p = L.emptyPlan(["영업팀", "재무팀"]);
  let q = p;
  for (let i = 0; i < 4; i++) q = L.cycle(L.cycle(q, "영업팀", i), "영업팀", i);
  assert.deepEqual(p.영업팀, [0, 0, 0, 0]);
  assert.deepEqual(L.progress(q), { applied: 1, total: 2, pct: 50 });
  assert.equal(L.cycle(q, "영업팀", 0).영업팀[0], 0); // 완료 → 예정
});

test("키트 마크다운: 최신본 · 공통 질문 · 계획 표", () => {
  const r = L.latestOnly(docs());
  const res = { kept: r.kept, groups: L.finish(L.cluster(qs()), qs(), r.kept, 2) };
  const md = L.toKitMd(res, qs(), L.emptyPlan(["영업팀"]));
  assert.ok(md.includes("## 최신본 자료 (3개)"));
  assert.ok(md.includes("인사 담당자에게 직접 확인"));
  assert.ok(md.includes("| 영업팀 | 예정 | 예정 | 예정 | 예정 |"));
  assert.ok(!md.includes("2023-03-01"));
});
