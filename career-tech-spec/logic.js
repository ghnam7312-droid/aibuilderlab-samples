/* 뼈대 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Ppyeodae, Node(테스트)에서는 require('./logic.js').
 *
 * 원칙: 테이블은 '화면이 쓰는 데이터'에서 나온다.
 *   prune()   AI가 제안한 테이블 중 어느 화면에서도 쓰지 않는 것을 뺀다.
 *             단, 남은 테이블이 참조(FK)하는 테이블은 같이 남기고, 사람이 이유를 적어 남긴 것도 남긴다.
 *   apisFor() 뺀 테이블을 쓰는 API는 함께 뺀다.
 *   checklist() 리뷰 체크리스트를 자동으로 채운다. 개인정보 접근은 사람이 확인한다.
 * Claude 는 결정을 바꾸지 않는다. 남기고 뺀 '근거 문장'만 쓰고, 결정과 어긋나면 버린다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Ppyeodae = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";


  /* ---------- 샘플: 캡스톤 2팀 '스터디로그' (스터디 모임 출석·과제 앱) ---------- */
  const C = (name, type, o) => ({ name, type, ...(o || {}) });
  const ID = C("id", "uuid", { pk: true });
  const AT = C("created_at", "timestamptz");
  const SAMPLE = {
    title: "스터디로그",
    // AI가 처음 제안한 13개 (purpose는 제안할 때 붙인 용도)
    tables: [
      { name: "users", purpose: "회원", columns: [ID, C("email", "text", { pii: true }), C("name", "text", { pii: true }), AT] },
      { name: "studies", purpose: "스터디 모임", columns: [ID, C("title", "text"), C("description", "text"), C("owner_id", "uuid", { ref: "users.id" }), AT] },
      { name: "memberships", purpose: "스터디 참여", columns: [ID, C("study_id", "uuid", { ref: "studies.id" }), C("user_id", "uuid", { ref: "users.id" }), C("role", "text")] },
      { name: "sessions", purpose: "모임 일정", columns: [ID, C("study_id", "uuid", { ref: "studies.id" }), C("starts_at", "timestamptz"), C("place", "text")] },
      { name: "attendances", purpose: "출석", columns: [ID, C("session_id", "uuid", { ref: "sessions.id" }), C("user_id", "uuid", { ref: "users.id" }), C("status", "text"), C("checked_at", "timestamptz")] },
      { name: "assignments", purpose: "과제", columns: [ID, C("study_id", "uuid", { ref: "studies.id" }), C("title", "text"), C("due_at", "timestamptz")] },
      { name: "submissions", purpose: "과제 제출·피드백", columns: [ID, C("assignment_id", "uuid", { ref: "assignments.id" }), C("user_id", "uuid", { ref: "users.id" }), C("link", "text"), C("feedback", "text"), C("submitted_at", "timestamptz")] },
      { name: "notifications", purpose: "푸시 알림", columns: [ID, C("user_id", "uuid", { ref: "users.id" }), C("kind", "text"), C("read_at", "timestamptz")] },
      { name: "comments", purpose: "과제 댓글", columns: [ID, C("assignment_id", "uuid", { ref: "assignments.id" }), C("user_id", "uuid", { ref: "users.id" }), C("body", "text")] },
      { name: "likes", purpose: "댓글 좋아요", columns: [ID, C("comment_id", "uuid", { ref: "comments.id" }), C("user_id", "uuid", { ref: "users.id" })] },
      { name: "tags", purpose: "스터디 분야 태그", columns: [ID, C("name", "text")] },
      { name: "study_tags", purpose: "스터디-태그 연결", columns: [C("study_id", "uuid", { ref: "studies.id" }), C("tag_id", "uuid", { ref: "tags.id" })] },
      { name: "audit_logs", purpose: "변경 이력", columns: [ID, C("user_id", "uuid", { ref: "users.id" }), C("action", "text"), AT] },
    ],
    screens: [
      { id: "s1", name: "로그인", uses: ["users"] },
      { id: "s2", name: "스터디 목록", uses: ["studies", "memberships"] },
      { id: "s3", name: "스터디 만들기", uses: ["studies", "memberships"] },
      { id: "s4", name: "스터디 상세", uses: ["studies", "memberships", "sessions"] },
      { id: "s5", name: "출석 체크", uses: ["sessions", "attendances"] },
      { id: "s6", name: "과제 제출", uses: ["assignments", "submissions"] },
      { id: "s7", name: "피드백 남기기", uses: ["submissions"] },
    ],
    // AI가 제안한 API 19개. 뺀 테이블을 쓰는 5개는 같이 빠진다
    apis: [
      { method: "POST", path: "/auth/login", desc: "학교 메일로 로그인", tables: ["users"], screens: ["s1"] },
      { method: "GET", path: "/me", desc: "내 정보", tables: ["users"], screens: ["s1"] },
      { method: "GET", path: "/studies", desc: "내 스터디 목록", tables: ["studies", "memberships"], screens: ["s2"] },
      { method: "POST", path: "/studies", desc: "스터디 만들기 (만든 사람은 owner로 참여)", tables: ["studies", "memberships"], screens: ["s3"] },
      { method: "GET", path: "/studies/:id", desc: "스터디 상세·멤버", tables: ["studies", "memberships"], screens: ["s4"] },
      { method: "POST", path: "/studies/:id/join", desc: "초대 코드로 참여", tables: ["memberships"], screens: ["s2"] },
      { method: "GET", path: "/studies/:id/sessions", desc: "모임 일정", tables: ["sessions"], screens: ["s4"] },
      { method: "POST", path: "/studies/:id/sessions", desc: "일정 추가", tables: ["sessions"], screens: ["s4"] },
      { method: "POST", path: "/sessions/:id/attendance", desc: "출석 체크", tables: ["attendances"], screens: ["s5"] },
      { method: "GET", path: "/sessions/:id/attendance", desc: "출석 현황", tables: ["attendances"], screens: ["s5"] },
      { method: "GET", path: "/studies/:id/assignments", desc: "과제 목록", tables: ["assignments"], screens: ["s6"] },
      { method: "POST", path: "/studies/:id/assignments", desc: "과제 내기", tables: ["assignments"], screens: ["s6"] },
      { method: "POST", path: "/assignments/:id/submissions", desc: "과제 제출 (링크)", tables: ["submissions"], screens: ["s6"] },
      { method: "PATCH", path: "/submissions/:id", desc: "피드백 남기기", tables: ["submissions"], screens: ["s7"] },
      { method: "GET", path: "/notifications", desc: "알림 목록", tables: ["notifications"], screens: [] },
      { method: "POST", path: "/assignments/:id/comments", desc: "과제 댓글", tables: ["comments"], screens: [] },
      { method: "POST", path: "/comments/:id/likes", desc: "댓글 좋아요", tables: ["likes"], screens: [] },
      { method: "GET", path: "/tags", desc: "태그 목록", tables: ["tags", "study_tags"], screens: [] },
      { method: "GET", path: "/admin/audit-logs", desc: "변경 이력", tables: ["audit_logs"], screens: [] },
    ],
  };

  const refsOf = (t) => (t.columns || []).filter((c) => c.ref).map((c) => c.ref.split(".")[0]);

  /** 화면 → 쓰는 테이블 수 */
  function usage(tables, screens) {
    const u = {};
    tables.forEach((t) => { u[t.name] = screens.filter((s) => (s.uses || []).includes(t.name)).map((s) => s.id); });
    return u;
  }

  /**
   * 줄이기. manual: { 테이블: '남기는 이유' } (사람이 남긴 것)
   * → { kept: [{name, why:'screen'|'fk'|'manual', screens, by}], removed: [{name, reason}] }
   */
  function prune(tables, screens, manual) {
    const u = usage(tables, screens);
    const keep = new Map();
    tables.forEach((t) => {
      if (u[t.name].length) keep.set(t.name, { name: t.name, why: "screen", screens: u[t.name] });
      else if (manual && typeof manual[t.name] === "string" && manual[t.name].trim()) keep.set(t.name, { name: t.name, why: "manual", screens: [], note: manual[t.name].trim() });
    });
    // 남은 테이블이 참조하는 테이블은 같이 남긴다 (끝까지 따라간다)
    let grew = true;
    while (grew) {
      grew = false;
      for (const k of [...keep.keys()]) {
        const t = tables.find((x) => x.name === k);
        for (const r of refsOf(t)) {
          if (!keep.has(r) && tables.some((x) => x.name === r)) { keep.set(r, { name: r, why: "fk", screens: [], by: k }); grew = true; }
        }
      }
    }
    const kept = tables.filter((t) => keep.has(t.name)).map((t) => keep.get(t.name));
    const removed = tables.filter((t) => !keep.has(t.name)).map((t) => {
      const deps = refsOf(t).filter((r) => !keep.has(r));
      return { name: t.name, reason: deps.length ? `어느 화면에서도 쓰지 않고, 참조하는 ${deps.join(", ")}도 빠짐` : "어느 화면에서도 쓰지 않음" };
    });
    return { kept, removed };
  }

  /** 남은 테이블만 쓰는 API */
  function apisFor(apis, keptNames) {
    const k = new Set(keptNames);
    return { kept: apis.filter((a) => a.tables.every((t) => k.has(t))), dropped: apis.filter((a) => !a.tables.every((t) => k.has(t))) };
  }

  /** snake_case 복수형 (users, study_tags, audit_logs) */
  const isSnakePlural = (n) => /^[a-z]+(_[a-z]+)*s$/.test(n);

  /** 개인정보 컬럼 */
  function piiColumns(tables, keptNames) {
    const k = new Set(keptNames);
    return tables.filter((t) => k.has(t.name)).flatMap((t) => t.columns.filter((c) => c.pii).map((c) => `${t.name}.${c.name}`));
  }

  /** 리뷰 체크리스트. manualChecks: { id: true } (사람이 확인한 항목) */
  function checklist(tables, screens, apis, result, manualChecks) {
    const names = result.kept.map((k) => k.name);
    const a = apisFor(apis, names).kept;
    const noApi = screens.filter((s) => !a.some((x) => x.screens.includes(s.id)));
    const badName = names.filter((n) => !isSnakePlural(n));
    const missingRef = result.kept.flatMap((k) => refsOf(tables.find((t) => t.name === k.name)).filter((r) => !names.includes(r)).map((r) => `${k.name}→${r}`));
    const pii = piiColumns(tables, names);
    const mc = manualChecks || {};
    return [
      { id: "used", auto: true, label: "모든 테이블을 쓰는 화면이 있다", ok: result.kept.every((k) => k.why !== "manual" || k.note), detail: result.kept.filter((k) => k.why === "manual").map((k) => `${k.name}: 사람이 남김`).join(", ") },
      { id: "fk", auto: true, label: "참조(FK)하는 테이블이 모두 남아 있다", ok: !missingRef.length, detail: missingRef.join(", ") || result.kept.filter((k) => k.why === "fk").map((k) => `${k.name}은(는) ${k.by}가 참조해서 남김`).join(", ") },
      { id: "api", auto: true, label: "화면마다 API가 1개 이상 있다", ok: !noApi.length, detail: noApi.map((s) => `${s.name}에 API 없음`).join(", ") },
      { id: "name", auto: true, label: "테이블 이름은 snake_case 복수형", ok: !badName.length, detail: badName.join(", ") },
      { id: "pii", auto: false, label: "개인정보 컬럼은 본인·운영자만 읽는다 (사람이 확인)", ok: !!mc.pii, detail: pii.join(", ") },
      { id: "team", auto: false, label: "팀원 3명이 설계서를 읽고 확인했다", ok: !!mc.team, detail: "" },
    ];
  }

  /** 규칙으로 쓰는 근거 문장 */
  function ruleReasons(tables, screens, result) {
    const nameOf = (id) => (screens.find((s) => s.id === id) || { name: id }).name;
    const t = (n) => tables.find((x) => x.name === n) || {};
    return [
      ...result.kept.map((k) => ({ table: k.name, keep: true, why: k.why === "screen" ? `${k.screens.map(nameOf).join(", ")} 화면이 씀` : k.why === "fk" ? `${k.by}이(가) 참조함` : `사람이 남김: ${k.note}` })),
      ...result.removed.map((r) => ({ table: r.name, keep: false, why: `${r.reason}${t(r.name).purpose ? ` — 제안 용도는 ‘${t(r.name).purpose}’` : ""}` })),
    ];
  }

  /** Claude 응답 검사: 표에 없는 테이블·결정과 어긋난 항목은 버리고, 남는 게 없으면 null */
  function normalizeReview(d, result) {
    if (!d || typeof d !== "object" || !Array.isArray(d.reasons)) return null;
    const decided = new Map([...result.kept.map((k) => [k.name, true]), ...result.removed.map((r) => [r.name, false])]);
    const reasons = d.reasons
      .filter((x) => x && typeof x.table === "string" && typeof x.why === "string" && x.why.trim() && decided.has(x.table))
      .filter((x) => typeof x.keep !== "boolean" || x.keep === decided.get(x.table))
      .map((x) => ({ table: x.table, keep: decided.get(x.table), why: x.why.trim().slice(0, 160) }));
    if (!reasons.length) return null;
    const risks = (Array.isArray(d.risks) ? d.risks : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 160)).slice(0, 4);
    return { summary: typeof d.summary === "string" ? d.summary.trim().slice(0, 200) : "", reasons, risks };
  }
  /** 규칙 근거 위에 Claude 근거를 덮는다 (Claude 가 빠뜨린 테이블은 규칙 근거 유지) */
  function mergeReasons(rule, ai) {
    return rule.map((r) => { const a = ai.reasons.find((x) => x.table === r.table); return a ? { ...r, why: a.why, by: "ai" } : r; });
  }

  /** 결정이 같은지 비교할 서명 */
  const signature = (result) => result.kept.map((k) => k.name).sort().join(",");

  /** 설계서 마크다운 */
  function toMarkdown(p) {
    const { title, tables, screens, apis, result, reasons, checks } = p;
    const names = result.kept.map((k) => k.name);
    const a = apisFor(apis, names).kept;
    const o = [`# ${title} 기술 설계서`, "", `- 테이블 ${names.length}개 (AI 제안 ${tables.length}개에서 줄임) · API ${a.length}개 · 화면 ${screens.length}개`, "", "## 화면"];
    screens.forEach((s) => o.push(`- **${s.name}** — ${(s.uses || []).join(", ") || "쓰는 데이터 없음"}`));
    o.push("", "## 테이블 (ERD)");
    tables.filter((t) => names.includes(t.name)).forEach((t) => {
      o.push("", `### ${t.name}`, "", "| 컬럼 | 타입 | 비고 |", "|---|---|---|");
      t.columns.forEach((c) => o.push(`| ${c.name} | ${c.type} | ${[c.pk ? "PK" : "", c.ref ? `FK → ${c.ref}` : "", c.pii ? "개인정보" : ""].filter(Boolean).join(", ")} |`));
    });
    o.push("", "## 판단 기록", "", "| 테이블 | 결정 | 근거 |", "|---|---|---|");
    reasons.forEach((r) => o.push(`| ${r.table} | ${r.keep ? "남김" : "뺌"} | ${r.why.replace(/\|/g, "/")} |`));
    o.push("", "## API", "", "| 메서드 | 경로 | 설명 | 테이블 |", "|---|---|---|---|");
    a.forEach((x) => o.push(`| ${x.method} | \`${x.path}\` | ${x.desc} | ${x.tables.join(", ")} |`));
    o.push("", "## 리뷰 체크리스트");
    checks.forEach((c) => o.push(`- [${c.ok ? "x" : " "}] ${c.label}${c.detail ? ` (${c.detail})` : ""}`));
    return o.join("\n") + "\n";
  }

  return { SAMPLE, refsOf, usage, prune, apisFor, isSnakePlural, piiColumns, checklist, ruleReasons, normalizeReview, mergeReasons, signature, toMarkdown };
});
