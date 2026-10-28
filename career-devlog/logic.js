/* 커밋일지 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Commitilji, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다.
 *
 * 무엇을 밖에 내보내지 않을지가 먼저다.
 *   1) 저장소마다 정책: full(내용 포함) · count(건수만) · off(제외). 비공개 저장소는 full이 될 수 없다.
 *      설정에 없는 저장소는 off로 본다 (모르면 내보내지 않는다).
 *   2) 내용이 들어가는 줄도 메일 주소·토큰·내부 주소·전화번호를 가린다.
 *   3) AI 요약에는 1)·2)를 거친 줄만 보내고, 돌아온 요약에 비공개 저장소 이름이 섞여 있으면 통째로 버린다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Commitilji = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  const TYPES = { feat: "기능", fix: "버그 수정", docs: "문서", refactor: "정리", test: "테스트", chore: "기타", style: "기타" };

  /* ---------- 날짜 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function md(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function withDay(s) { return `${md(s)}(${DAYS[d0(s).getDay()]})`; }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;
  /** 그 주의 월요일 */
  function weekStart(s) { const k = d0(s).getDay(); return addDays(s, -((k + 6) % 7)); }
  /** 오늘이 든 주부터 n주 전까지, 최근 주가 앞 */
  function weeks(today, n) {
    const w0 = weekStart(today);
    return Array.from({ length: n }, (_, i) => { const start = addDays(w0, -7 * i); return { start, end: addDays(start, 6) }; });
  }

  /* ---------- 활동 기록 읽기 ---------- */
  /**
   * 한 줄: "2026-10-20 capstone-web @하늘 feat: 로그인 화면 (#12)"
   *        "2026-10-21 capstone-api @지민 PR #14 병합: 출석 API"
   *        "2026-10-22 capstone-web @태오 이슈 #9 닫음: 모바일 메뉴 겹침"
   */
  function parseActivity(text) {
    const items = [], bad = [];
    String(text || "").split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const m = /^(\d{4}-\d{2}-\d{2})\s+([\w.-]+)\s+@([^\s]+)\s+(.+)$/.exec(line);
      if (!m || !isIso(m[1])) { bad.push(i + 1); return; }
      let msg = m[4].trim(), kind = "commit", type = "chore", ref = "";
      let k = /^PR\s*#(\d+)\s*(?:병합|merged)\s*[:：]\s*(.+)$/i.exec(msg);
      if (k) { kind = "pr"; ref = `#${k[1]}`; msg = k[2]; }
      k = !k && /^이슈\s*#(\d+)\s*(?:닫음|closed)\s*[:：]\s*(.+)$/i.exec(msg);
      if (k) { kind = "issue"; ref = `#${k[1]}`; msg = k[2]; }
      k = /^(feat|fix|docs|refactor|test|chore|style)(\([^)]*\))?!?\s*:\s*(.+)$/i.exec(msg);
      if (k) { type = k[1].toLowerCase(); msg = k[3]; }
      else if (kind === "issue") type = "fix";
      else if (kind === "pr") type = "feat";
      msg = msg.replace(/\s*\(#\d+\)\s*$/, "").trim();
      items.push({ date: m[1], repo: m[2], author: m[3], kind, type, ref, text: msg, line: i + 1 });
    });
    return { items, bad };
  }

  /* ---------- 내보내지 않을 것 ---------- */
  /** 저장소 정책. 비공개는 full이 될 수 없고, 설정에 없으면 off */
  function policyOf(repos, name) {
    const r = (repos || []).find((x) => x.name === name);
    if (!r) return "off";
    const p = r.policy === "full" || r.policy === "count" ? r.policy : "off";
    return r.private && p === "full" ? "count" : p;
  }
  const RX = [
    [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[메일 가림]"],
    [/\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g, "[토큰 가림]"],
    [/https?:\/\/[^\s)]*(internal|intra|corp|localhost|192\.168|10\.\d)[^\s)]*/gi, "[내부 주소 가림]"],
    [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP 가림]"],
    [/\b01[016789]-?\d{3,4}-?\d{4}\b/g, "[전화 가림]"],
  ];
  function redact(text) {
    let s = String(text || ""), hits = 0;
    for (const [re, rep] of RX) s = s.replace(re, () => { hits++; return rep; });
    return { text: s, hits };
  }
  /** 정책을 적용한다 → 내용을 보여 줄 줄, 건수만 셀 저장소, 뺀 건수, 가린 곳 */
  function applyPolicy(items, repos) {
    const shown = [], counted = {}, off = {};
    let redacted = 0;
    for (const it of items) {
      const p = policyOf(repos, it.repo);
      if (p === "full") { const r = redact(it.text); redacted += r.hits; shown.push({ ...it, text: r.text }); }
      else if (p === "count") counted[it.repo] = (counted[it.repo] || 0) + 1;
      else off[it.repo] = (off[it.repo] || 0) + 1;
    }
    return { shown, counted, off, redacted };
  }
  /** 밖에 나가면 안 되는 이름: full이 아닌 저장소 이름 */
  function blockedTerms(items, repos) {
    const names = new Set(items.map((x) => x.repo).concat((repos || []).map((r) => r.name)));
    return [...names].filter((n) => policyOf(repos, n) !== "full");
  }
  function leaks(text, blocked) {
    const s = String(text || "").toLowerCase();
    return blocked.some((b) => b && s.includes(b.toLowerCase()));
  }

  /* ---------- 일지 만들기 (규칙) ---------- */
  function buildLog(items, week, repos) {
    const inWeek = items.filter((x) => x.date >= week.start && x.date <= week.end);
    const pol = applyPolicy(inWeek, repos);
    const people = {};
    for (const it of pol.shown) {
      const p = (people[it.author] = people[it.author] || { name: it.author, commit: 0, pr: 0, issue: 0, did: [] });
      p[it.kind]++;
      // 같은 일을 커밋·PR로 두 번 적지 않는다
      const label = `${it.kind === "pr" ? "PR " + it.ref + " " : it.kind === "issue" ? "이슈 " + it.ref + " " : ""}${it.text}`;
      if (!p.did.some((d) => d.endsWith(it.text))) p.did.push(label);
    }
    const members = Object.values(people).sort((a, b) => (b.commit + b.pr + b.issue) - (a.commit + a.pr + a.issue));
    const byType = {};
    pol.shown.forEach((x) => { byType[x.type] = (byType[x.type] || 0) + 1; });
    const top = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    const prs = pol.shown.filter((x) => x.kind === "pr").length;
    const headline = pol.shown.length
      ? `${members.length}명이 ${pol.shown.length}건 작업${prs ? ` · PR ${prs}건 병합` : ""}${top ? ` · ${TYPES[top[0]] || top[0]} 위주` : ""}`
      : "공개하기로 고른 저장소에 이번 주 활동이 없어요";
    const next = pol.shown.filter((x) => /todo|다음|남음|이어서|wip/i.test(x.text)).map((x) => `${x.author}: ${x.text}`).slice(0, 4);
    const repoRows = Object.entries(inWeek.reduce((a, x) => ((a[x.repo] = (a[x.repo] || 0) + 1), a), {}))
      .map(([name, n]) => ({ name, n, policy: policyOf(repos, name) }));
    return { week, headline, members, next, repos: repoRows, total: inWeek.length, shownCount: pol.shown.length, counted: pol.counted, off: pol.off, redacted: pol.redacted, shown: pol.shown, mode: "rule" };
  }

  /* ---------- Claude 응답 검사 ---------- */
  /** 형식이 틀리거나, 입력에 없는 사람이 있거나, 막힌 이름이 섞이면 null */
  function normalizeSummary(d, allowedNames, blocked) {
    if (!d || typeof d !== "object" || typeof d.headline !== "string" || !d.headline.trim()) return null;
    const str = (x, n) => (typeof x === "string" ? x.trim().slice(0, n) : "");
    const members = (Array.isArray(d.members) ? d.members : []).filter((m) => m && typeof m.name === "string")
      .map((m) => ({ name: m.name.replace(/^@/, "").trim(), did: (Array.isArray(m.did) ? m.did : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 6) }));
    if (!members.length || members.some((m) => !allowedNames.includes(m.name))) return null;
    const next = (Array.isArray(d.next) ? d.next : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 5);
    const out = { headline: str(d.headline, 140), members, next };
    const all = [out.headline, ...next, ...members.flatMap((m) => m.did)].join("\n");
    if (leaks(all, blocked)) return null;
    if (redact(all).hits) return null; // 가렸던 것이 되살아났다
    return out;
  }
  function mergeSummary(log, ai) {
    const members = log.members.map((m) => { const a = ai.members.find((x) => x.name === m.name); return a && a.did.length ? { ...m, did: a.did } : m; });
    return { ...log, headline: ai.headline, members, next: ai.next.length ? ai.next : log.next, mode: "ai" };
  }

  /* ---------- 마크다운 ---------- */
  function toMarkdown(log, member) {
    const ms = member && member !== "all" ? log.members.filter((m) => m.name === member) : log.members;
    const out = [`## 주간 개발 일지 · ${withDay(log.week.start)} ~ ${withDay(log.week.end)}`, "", `> ${log.headline}`, ""];
    out.push("### 사람별");
    if (!ms.length) out.push("- 공개 저장소 활동 없음");
    ms.forEach((m) => {
      out.push(`- **${m.name}** — 커밋 ${m.commit} · PR ${m.pr} · 이슈 ${m.issue}`);
      m.did.forEach((d) => out.push(`  - ${d}`));
    });
    if (log.next.length) { out.push("", "### 다음 주"); log.next.forEach((n) => out.push(`- ${n}`)); }
    const pub = log.repos.filter((r) => r.policy === "full").map((r) => `${r.name} ${r.n}건`);
    const cnt = Object.values(log.counted).reduce((a, b) => a + b, 0);
    out.push("", "### 저장소", `- ${pub.join(" · ") || "없음"}`);
    if (cnt) out.push(`- 비공개 저장소 작업 ${cnt}건 (내용 비공개)`);
    return out.join("\n") + "\n";
  }

  return { DAYS, TYPES, d0, iso, addDays, md, withDay, isIso, weekStart, weeks, parseActivity, policyOf, redact, applyPolicy, blockedTerms, leaks, buildLog, normalizeSummary, mergeSummary, toMarkdown };
});
