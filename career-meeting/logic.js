/* 회의끝 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Hoeuikkeut, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 * 정리는 두 가지 길이 있다.
 *   규칙: "@이름 ... 10/24까지", "결정: ..." 처럼 형식을 맞춘 회의록을 줄 단위로 읽는다.
 *   Claude: 받아 적은 그대로의 회의록에서 결정·할 일·논의를 뽑는다. 뽑은 항목은
 *           matchLine()으로 회의록의 어느 줄에서 나왔는지 다시 찾아 '출처 줄'을 붙인다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Hoeuikkeut = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  const DAY_MS = 86400000;

  /* ---------- 날짜 ---------- */
  /** "YYYY-MM-DD" → 그날 0시 (로컬) */
  function d0(isoStr) { const [y, m, d] = isoStr.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(isoStr, n) { const d = d0(isoStr); d.setDate(d.getDate() + n); return iso(d); }
  function md(isoStr) { const d = d0(isoStr); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function withDay(isoStr) { const d = d0(isoStr); return `${md(isoStr)}(${DAYS[d.getDay()]})`; }
  function daysBetween(a, b) { return Math.round((d0(b) - d0(a)) / DAY_MS); }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d0(s).getTime()) && iso(d0(s)) === s;

  /** 다음 X요일 (오늘이 X요일이면 다음 주) */
  function nextWeekday(today, ch) {
    const t = DAYS.indexOf(ch);
    const cur = d0(today).getDay();
    return addDays(today, ((t - cur + 7) % 7) || 7);
  }
  /** "10/24" → 날짜. 두 달 넘게 지난 날짜면 내년으로 본다 */
  function parseMD(today, m, d) {
    const t = d0(today);
    const x = new Date(t.getFullYear(), m - 1, d);
    if (x.getMonth() !== m - 1) return "";
    if (t - x > 60 * DAY_MS) x.setFullYear(x.getFullYear() + 1);
    return iso(x);
  }

  /** 한 줄에서 마감 표현 찾기 → {due, text} */
  function findDue(text, today) {
    const m1 = text.match(/(\d{1,2})\/(\d{1,2})(\([^)]*\))?\s*(까지)?/);
    if (m1) return { due: parseMD(today, +m1[1], +m1[2]), text: m1[0] };
    const m2 = text.match(/(다음\s*주\s*)?([월화수목금토일])요일\s*까지/);
    if (m2) {
      let due = nextWeekday(today, m2[2]);
      if (m2[1] && daysBetween(today, due) < 7) due = addDays(due, 7);
      return { due, text: m2[0] };
    }
    const m3 = text.match(/(오늘|내일|모레)(\s*까지)?/);
    if (m3) return { due: addDays(today, { 오늘: 0, 내일: 1, 모레: 2 }[m3[1]]), text: m3[0] };
    return { due: "", text: "" };
  }

  /* ---------- 규칙으로 읽기 ---------- */
  /** 참석자가 주어로 나오면('서연이가', '준호가') 결정이 아니라 누군가의 할 일이다 */
  function hasActor(text, names) {
    return (names || []).some((n) => n && new RegExp(`${n}(이가|가|이는|는)\\s`).test(text));
  }
  function parse(src, today) {
    const lines = [];
    let title = "", attendees = [];
    const raw = String(src || "").split(/\n/).map((r) => r.replace(/^[\s\-•*·]+/, "").trim()).filter(Boolean);
    // '참석:' 줄 바로 앞의 첫 줄은 제목으로 본다 ([대괄호]가 없어도)
    const attAt = raw.findIndex((t) => /^참석(자)?\s*[:：]/.test(t));
    raw.forEach((text, i) => {
      if (!title && /^\[.+\]/.test(text)) { title = text.replace(/^\[|\].*$/g, ""); lines.push({ text, type: "head", label: "제목" }); return; }
      if (!title && i === 0 && attAt === 1) { title = text.replace(/\s*\(.*?\)\s*$/, "").replace(/\s+\d{1,2}\/\d{1,2}.*$/, "").trim() || text; lines.push({ text, type: "head", label: "제목" }); return; }
      const att = text.match(/^참석(자)?\s*[:：]\s*(.+)$/);
      if (att) { attendees = att[2].split(/[,，、\s]+/).filter(Boolean); lines.push({ text, type: "head", label: "참석" }); return; }
      const who = text.match(/@([가-힣A-Za-z0-9_]+)/);
      if (who) {
        const due = findDue(text, today);
        const what = text.replace(who[0], "").replace(due.text, "").replace(/\s+/g, " ").trim();
        lines.push({ text, type: "task", who: who[1], what, due: due.due, whoText: who[0], dueText: due.text });
      } else if (/^결정\s*[:：]/.test(text) || (/기로\s*(함|했|결정)|로\s*결정|결정함/.test(text) && !hasActor(text, attendees))) {
        lines.push({ text, type: "dec", clean: text.replace(/^결정\s*[:：]\s*/, "") });
      } else lines.push({ text, type: "note" });
    });
    lines.forEach((l, i) => { l.idx = i; });
    return {
      title, attendees, lines, mode: "rule",
      decisions: lines.filter((l) => l.type === "dec").map((l) => ({ text: l.clean, line: l.idx })),
      tasks: lines.filter((l) => l.type === "task").map((l) => ({ who: l.who, what: l.what, due: l.due, line: l.idx })),
      notes: lines.filter((l) => l.type === "note").map((l) => ({ text: l.text, line: l.idx })),
    };
  }

  /* ---------- Claude 결과를 회의록 줄에 다시 붙이기 ---------- */
  /** 두 글자씩 자른 조각 (띄어쓰기·기호 무시) */
  function grams(s) {
    const t = String(s || "").replace(/[\s\p{P}\p{S}]/gu, "");
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  }
  /** 항목 글이 가장 많이 겹치는 줄 번호. 겹침이 너무 적으면 -1.
   *  hint(담당자 이름)가 그 줄에 있으면 점수를 더 준다: '도윤 무선 마이크 대여' ↔ '도윤이가 … 물어보기로' */
  function matchLine(text, lines, taken, hint) {
    const g = grams(text);
    if (!g.size) return -1;
    let best = -1, score = 0;
    lines.forEach((l, i) => {
      if (l.type === "head") return;
      const lg = grams(l.text);
      let hit = 0;
      g.forEach((x) => { if (lg.has(x)) hit++; });
      let s = hit / g.size;
      if (hint && hint !== "미정" && l.text.includes(hint)) s += 0.2;
      if (taken && taken.has(i)) s *= 0.8; // 한 줄에서 여러 항목이 나올 수도 있지만, 빈 줄을 먼저 고른다
      if (s > score) { score = s; best = i; }
    });
    return score >= 0.3 ? best : -1;
  }

  /** Claude 응답 검사 → 쓸 수 없으면 null */
  function normalizeExtract(d) {
    if (!d || typeof d !== "object") return null;
    const strs = (a, n) => (Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, n);
    const tasks = (Array.isArray(d.tasks) ? d.tasks : [])
      .filter((t) => t && typeof t.task === "string" && t.task.trim())
      .slice(0, 30)
      .map((t) => ({ who: typeof t.owner === "string" && t.owner.trim() ? t.owner.trim().replace(/^@/, "").slice(0, 20) : "미정", what: t.task.trim().slice(0, 160), due: isIso(t.due) ? t.due : "" }));
    const decisions = strs(d.decisions, 20);
    if (!tasks.length && !decisions.length) return null;
    return {
      title: typeof d.title === "string" ? d.title.trim().slice(0, 80) : "",
      attendees: strs(d.attendees, 30).map((x) => x.replace(/^@/, "")),
      decisions, tasks, discussion: strs(d.discussion, 20),
    };
  }

  /** 규칙 결과(줄 목록) 위에 Claude 결과를 얹는다: 줄 종류는 Claude 기준으로 다시 칠한다 */
  function mergeAi(ruleResult, ai) {
    const lines = ruleResult.lines.map((l) => ({ ...l, type: l.type === "head" ? "head" : "note", refs: [] }));
    const taken = new Set();
    const link = (text, kind, n, hint) => {
      const i = matchLine(text, lines, taken, hint);
      if (i >= 0) {
        taken.add(i);
        // 할 일이 결정보다 우선해 보이도록
        if (kind === "task" || lines[i].type !== "task") lines[i].type = kind === "task" ? "task" : kind === "dec" ? "dec" : lines[i].type;
        lines[i].refs.push(`${kind}:${n}`);
      }
      return i;
    };
    const decisions = ai.decisions.map((t, n) => ({ text: t, line: link(t, "dec", n) }));
    const tasks = ai.tasks.map((t, n) => ({ ...t, line: link(t.what, "task", n, t.who) }));
    const notes = ai.discussion.map((t, n) => ({ text: t, line: link(t, "note", n) }));
    // 줄에 담당·마감 표시가 있으면 그대로 강조한다
    lines.forEach((l) => {
      if (l.type !== "task") return;
      const w = l.text.match(/@([가-힣A-Za-z0-9_]+)/);
      l.whoText = w ? w[0] : "";
      l.dueText = findDue(l.text, "2000-01-01").text;
    });
    return {
      title: ai.title || ruleResult.title,
      attendees: ai.attendees.length ? ai.attendees : ruleResult.attendees,
      lines, decisions, tasks, notes, mode: "ai",
    };
  }

  /** 규칙과 Claude가 찾은 개수 비교 (화면의 '규칙 vs Claude' 줄) */
  function compare(ruleResult, aiResult) {
    return {
      rule: { dec: ruleResult.decisions.length, task: ruleResult.tasks.length },
      ai: { dec: aiResult.decisions.length, task: aiResult.tasks.length },
      extraTasks: Math.max(0, aiResult.tasks.length - ruleResult.tasks.length),
    };
  }

  /* ---------- 마감 ---------- */
  function dueStatus(due, today) {
    if (!due) return { kind: "none", n: null };
    const n = daysBetween(today, due);
    if (n < 0) return { kind: "late", n };
    if (n === 0) return { kind: "today", n };
    if (n <= 2) return { kind: "soon", n };
    return { kind: "ok", n };
  }
  /** 업무판 알림: 끝나지 않은 일 중 지났거나 2일 안에 마감 */
  function reminders(tasks, today) {
    return tasks
      .filter((t) => t.status !== "done")
      .map((t) => ({ ...t, ds: dueStatus(t.due, today) }))
      .filter((t) => t.ds.kind === "late" || t.ds.kind === "today" || t.ds.kind === "soon")
      .sort((a, b) => a.ds.n - b.ds.n);
  }

  /* ---------- 내보내기 ---------- */
  /** iCalendar 글자 이스케이프 */
  function icsEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  /** 한 줄 75바이트 넘으면 접기 (UTF-8 기준, 글자 중간에서 자르지 않는다) */
  function fold(line) {
    const enc = (c) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(c).length : Buffer.byteLength(c));
    let out = "", cur = "", bytes = 0;
    for (const ch of line) {
      const b = enc(ch);
      if (bytes + b > (out ? 74 : 75)) { out += (out ? "\r\n " : "") + cur; cur = ""; bytes = 0; }
      cur += ch; bytes += b;
    }
    return out ? `${out}\r\n ${cur}` : cur;
  }
  /** 마감 있는 할 일 → .ics (종일 일정) */
  function buildIcs(tasks, title, stamp) {
    const dt = (stamp || "20260101T000000Z");
    const ev = tasks.filter((t) => t.due && t.status !== "done").map((t, i) => [
      "BEGIN:VEVENT",
      `UID:hoeuikkeut-${String(t.id || i)}-${t.due}@aibuilderlab.kr`,
      `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${t.due.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${addDays(t.due, 1).replace(/-/g, "")}`,
      `SUMMARY:${icsEsc(`[${t.who}] ${t.what}`)}`,
      `DESCRIPTION:${icsEsc(`${title || "회의"}에서 나온 할 일 · 회의끝`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`내일 마감: ${t.what}`)}`, "TRIGGER:-P1D", "END:VALARM",
      "END:VEVENT",
    ]);
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Builder Lab//Hoeuikkeut//KO", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEsc(title || "회의 할 일")}`]
      .concat(...ev, ["END:VCALENDAR"]);
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  /** Notion에 붙이면 체크리스트가 되는 마크다운 */
  function toNotionMd(title, decisions, tasks, cols) {
    const head = `## ${title || "회의 할 일"}\n\n`;
    const dec = decisions.length ? `### 결정사항\n${decisions.map((d) => `- ${d.text}`).join("\n")}\n\n` : "";
    const body = cols.map(([k, label]) => {
      const l = tasks.filter((t) => t.status === k);
      return l.length ? `### ${label}\n` + l.map((t) => `- [${k === "done" ? "x" : " "}] ${t.what} @${t.who}${t.due ? ` (마감 ${md(t.due)})` : ""}`).join("\n") : "";
    }).filter(Boolean).join("\n\n");
    return head + dec + body;
  }

  return { DAYS, hasActor, iso, d0, addDays, md, withDay, daysBetween, isIso, nextWeekday, parseMD, findDue, parse, grams, matchLine, normalizeExtract, mergeAi, compare, dueStatus, reminders, icsEsc, fold, buildIcs, toNotionMd };
});
