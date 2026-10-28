// 뼈대 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const S = L.SAMPLE;
const clone = (x) => JSON.parse(JSON.stringify(x));

test("샘플: AI 제안 13개 → 화면 기준 7개, API 19개 → 14개", () => {
  const r = L.prune(S.tables, S.screens, {});
  assert.equal(S.tables.length, 13);
  assert.deepEqual(r.kept.map((k) => k.name), ["users", "studies", "memberships", "sessions", "attendances", "assignments", "submissions"]);
  assert.deepEqual(r.removed.map((k) => k.name), ["notifications", "comments", "likes", "tags", "study_tags", "audit_logs"]);
  const a = L.apisFor(S.apis, r.kept.map((k) => k.name));
  assert.equal(S.apis.length, 19);
  assert.equal(a.kept.length, 14);
  assert.equal(a.dropped.length, 5);
});

test("뺀 이유: 화면에서 안 씀 / 참조하는 테이블도 빠짐", () => {
  const r = L.prune(S.tables, S.screens, {});
  assert.equal(r.removed.find((x) => x.name === "notifications").reason, "어느 화면에서도 쓰지 않음");
  assert.ok(r.removed.find((x) => x.name === "likes").reason.includes("comments도 빠짐"));
});

test("참조(FK)되는 테이블은 화면에 없어도 남긴다", () => {
  const screens = [{ id: "a", name: "출석 체크", uses: ["attendances"] }];
  const r = L.prune(S.tables, screens, {});
  const why = Object.fromEntries(r.kept.map((k) => [k.name, k.why]));
  assert.deepEqual(why, { users: "fk", studies: "fk", sessions: "fk", attendances: "screen" });
  assert.equal(r.kept.find((k) => k.name === "studies").by, "sessions", "sessions → studies 를 따라감");
});

test("화면에 데이터를 추가하면 그 테이블이 살아난다 (입력이 바뀌면 결과도)", () => {
  const screens = clone(S.screens);
  screens.find((s) => s.id === "s4").uses.push("notifications");
  const r = L.prune(S.tables, screens, {});
  assert.equal(r.kept.length, 8);
  assert.equal(L.apisFor(S.apis, r.kept.map((k) => k.name)).kept.length, 15);
});

test("사람이 이유를 적으면 남기고, 빈 이유는 무시", () => {
  assert.equal(L.prune(S.tables, S.screens, { tags: "  " }).kept.length, 7);
  const r = L.prune(S.tables, S.screens, { study_tags: "2학기 검색 화면에 쓸 예정" });
  const k = r.kept.find((x) => x.name === "study_tags");
  assert.equal(k.why, "manual");
  assert.equal(r.kept.find((x) => x.name === "tags").why, "fk", "study_tags 가 참조하는 tags 도 따라 남음");
});

test("이름 규칙: snake_case 복수형", () => {
  assert.equal(L.isSnakePlural("study_tags"), true);
  assert.equal(L.isSnakePlural("users"), true);
  assert.equal(L.isSnakePlural("User"), false);
  assert.equal(L.isSnakePlural("studyTag"), false);
  assert.equal(L.isSnakePlural("attendance"), false);
});

test("체크리스트: 샘플은 자동 항목 통과, 개인정보·팀 확인은 사람이 체크해야 통과", () => {
  const r = L.prune(S.tables, S.screens, {});
  const c = L.checklist(S.tables, S.screens, S.apis, r, {});
  assert.ok(c.filter((x) => x.auto).every((x) => x.ok));
  const pii = c.find((x) => x.id === "pii");
  assert.equal(pii.ok, false);
  assert.equal(pii.detail, "users.email, users.name");
  assert.equal(L.checklist(S.tables, S.screens, S.apis, r, { pii: true }).find((x) => x.id === "pii").ok, true);
});

test("체크리스트: API 없는 화면을 잡아낸다", () => {
  const screens = clone(S.screens).concat([{ id: "s8", name: "알림 목록", uses: ["notifications"] }]);
  const r = L.prune(S.tables, screens, {});
  const api = L.checklist(S.tables, screens, S.apis, r, {}).find((x) => x.id === "api");
  assert.equal(api.ok, false);
  assert.equal(api.detail, "알림 목록에 API 없음");
});

test("Claude 응답 검사: 결정과 어긋나거나 표에 없는 테이블은 버린다", () => {
  const r = L.prune(S.tables, S.screens, {});
  const n = L.normalizeReview({
    summary: "화면 7개 기준으로 7개면 충분",
    reasons: [
      { table: "notifications", keep: false, why: "알림 화면이 없고 마감 안내는 단톡으로 충분" },
      { table: "comments", keep: true, why: "댓글은 꼭 필요" },
      { table: "payments", keep: false, why: "없는 테이블" },
      { table: "users", why: "로그인 화면이 씀" },
    ],
    risks: ["출석 상태 값(출석·지각·결석)을 정해 둘 것"],
  }, r);
  assert.deepEqual(n.reasons.map((x) => x.table), ["notifications", "users"]);
  assert.equal(n.reasons[1].keep, true, "keep 이 없으면 규칙 결정을 따른다");
  assert.equal(n.risks.length, 1);
  assert.equal(L.normalizeReview({ reasons: [{ table: "comments", keep: true, why: "x" }] }, r), null);
  assert.equal(L.normalizeReview("좋아요", r), null);
});

test("근거 합치기: Claude 가 빠뜨린 테이블은 규칙 근거 유지", () => {
  const r = L.prune(S.tables, S.screens, {});
  const rule = L.ruleReasons(S.tables, S.screens, r);
  assert.equal(rule.length, 13);
  assert.equal(rule.find((x) => x.table === "attendances").why, "출석 체크 화면이 씀");
  const merged = L.mergeReasons(rule, { reasons: [{ table: "tags", keep: false, why: "검색 화면이 없어 뺌" }] });
  assert.equal(merged.find((x) => x.table === "tags").why, "검색 화면이 없어 뺌");
  assert.equal(merged.find((x) => x.table === "tags").by, "ai");
  assert.equal(merged.find((x) => x.table === "users").why, rule.find((x) => x.table === "users").why);
});

test("설계서 마크다운: 남긴 테이블·판단 기록·API·체크리스트가 들어간다", () => {
  const r = L.prune(S.tables, S.screens, {});
  const md = L.toMarkdown({ title: S.title, tables: S.tables, screens: S.screens, apis: S.apis, result: r, reasons: L.ruleReasons(S.tables, S.screens, r), checks: L.checklist(S.tables, S.screens, S.apis, r, {}) });
  assert.ok(md.includes("테이블 7개 (AI 제안 13개에서 줄임) · API 14개 · 화면 7개"));
  assert.ok(md.includes("### submissions"));
  assert.ok(!md.includes("### notifications"));
  assert.ok(md.includes("| notifications | 뺌 |"));
  assert.ok(md.includes("FK → users.id"));
  assert.ok(md.includes("- [ ] 개인정보 컬럼"));
});
