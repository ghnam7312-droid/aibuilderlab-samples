/* 챙김 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Chaenggim, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다.
 *
 * 미팅 메모 → (고객 공유 줄 / 내부 전용 줄) → 약속(보내기로 한 자료 + 기한) → 메일 초안 · 후속 알림
 *   핵심 규칙: 메일 초안과 AI 입력에는 '고객 공유' 줄만 들어간다.
 *   그래도 초안에 내부 메모가 섞였는지 leakCheck 로 한 번 더 검사하고, 걸리면 복사를 막는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Chaenggim = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  const DAY_MS = 86400000;

  /* ---------- 날짜 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function md(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function withDay(s) { return `${md(s)}(${DAYS[d0(s).getDay()]})`; }
  function daysBetween(a, b) { return Math.round((d0(b) - d0(a)) / DAY_MS); }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;
  function parseMD(base, m, d) {
    const t = d0(base), x = new Date(t.getFullYear(), m - 1, d);
    if (x.getMonth() !== m - 1) return "";
    if (t - x > 60 * DAY_MS) x.setFullYear(x.getFullYear() + 1);
    return iso(x);
  }
  /** 영업일 n일 뒤 (토·일 건너뜀) */
  function addBizDays(s, n) {
    let d = s;
    while (n > 0) { d = addDays(d, 1); const w = d0(d).getDay(); if (w !== 0 && w !== 6) n--; }
    return d;
  }
  /** 글 속 기한 하나 → {due, text}. base(미팅일) 기준 */
  function findDue(text, base) {
    let m = text.match(/(\d{1,2})\s*[\/월]\s*(\d{1,2})\s*일?(\([월화수목금토일]\))?(\s*까지)?/);
    if (m) return { due: parseMD(base, +m[1], +m[2]), text: m[0] };
    m = text.match(/(다음\s*주|이번\s*주)?\s*([월화수목금토일])요일(\s*까지)?/);
    if (m) {
      let v;
      if (m[1]) { const mon = addDays(base, -((d0(base).getDay() + 6) % 7)); v = addDays(mon, (DAYS.indexOf(m[2]) + 6) % 7 + (/다음/.test(m[1]) ? 7 : 0)); }
      else { const t = DAYS.indexOf(m[2]), cur = d0(base).getDay(); v = addDays(base, ((t - cur + 7) % 7) || 7); }
      return { due: v, text: m[0].trim() };
    }
    m = text.match(/(오늘|내일|모레)(\s*까지)?/);
    if (m) return { due: addDays(base, { 오늘: 0, 내일: 1, 모레: 2 }[m[1]]), text: m[0] };
    return { due: "", text: "" };
  }

  /* ---------- 고객 공유 / 내부 전용 나누기 ---------- */
  const INTERNAL_MARK = /^[\[(（]?\s*(내부|사내|우리끼리)\s*[\])）:：]|^※\s*내부/;
  /** 고객에게 나가면 안 되는 낱말 (메모에도, 초안에도 검사한다) */
  const SENSITIVE = /마진|원가|마지노선|최저가|할인\s*(한도|폭|은?\s*최대)|내부\s*(검토|보고|사정)|팀장님(께|한테)|본부장님?(께|한테)|경쟁사\s*(단가|가격)|결재\s*(올리|받)|말하지\s*말|비밀/;
  function classify(note) {
    return String(note || "").split(/\n/).map((r) => r.replace(/^[\s\-•*·]+/, "").trim()).filter(Boolean).map((text, i) => {
      if (INTERNAL_MARK.test(text)) return { i, text, kind: "int", why: "내부 표시" };
      const s = text.match(SENSITIVE);
      if (s) return { i, text, kind: "int", why: `‘${s[0]}’` };
      return { i, text, kind: "ext", why: "" };
    });
  }
  /** 사람이 바꾼 분류(overrides: {줄번호: 'ext'|'int'})를 얹는다 */
  function applyOverrides(lines, overrides) {
    return lines.map((l) => (overrides && overrides[l.i] && overrides[l.i] !== l.kind ? { ...l, kind: overrides[l.i], why: "직접 바꿈" } : l));
  }

  /* ---------- 약속 찾기 ---------- */
  const PROMISE = /(보내|전달|공유|회신|드리|안내|발송|제출)\s*(드리기로|하기로|기로|드릴|예정)/;
  /** 고객 공유 줄에서 '보내기로 한 것' → [{item, due, auto, line}] (기한 없으면 영업일 2일 뒤로 잡고 auto 표시) */
  function findPromises(lines, base) {
    return lines.filter((l) => l.kind === "ext" && PROMISE.test(l.text)).map((l) => {
      const d = findDue(l.text, base);
      const item = l.text
        .replace(d.text, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s*(을|를)?\s*(함께|같이|먼저)?\s*(보내|전달|공유|회신|드리|안내|발송|제출)\s*(드리기로|하기로|기로|드릴|예정).*$/, "")
        .replace(/\s+/g, " ").trim();
      return { item: item || l.text, due: d.due || addBizDays(base, 2), auto: !d.due, line: l.i };
    });
  }

  /* ---------- 메일 초안 (규칙) ---------- */
  function buildDraft(m, lines, promises) {
    const ext = lines.filter((l) => l.kind === "ext" && !PROMISE.test(l.text));
    const subject = `[${m.sender.company}] ${md(m.date)} 미팅 감사드립니다${promises.length ? ` · 자료 ${promises.length}건 안내` : ""}`;
    const body = [
      `${m.contact}님, 안녕하세요.`,
      `${m.sender.company} ${m.sender.name}입니다. ${withDay(m.date)} 시간 내어 주셔서 감사합니다.`,
      "",
      ext.length ? "말씀 나눈 내용을 정리했습니다." : "",
      ...ext.slice(0, 4).map((l) => `- ${l.text}`),
      ext.length ? "" : "",
      promises.length ? "약속드린 자료는 아래 일정으로 보내드리겠습니다." : "",
      ...promises.map((p) => `- ${p.item}: ${withDay(p.due)}까지`),
      promises.length ? "" : "",
      "궁금하신 점은 언제든 회신 주세요.",
      `${m.sender.name} 드림`,
    ].filter((x, i, a) => !(x === "" && (i === 0 || a[i - 1] === ""))).join("\n");
    return { subject, body };
  }

  /* ---------- 내부 메모 섞임 검사 ---------- */
  function grams(s) {
    const t = String(s || "").replace(/[\s\p{P}\p{S}]/gu, "");
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  }
  /** 초안(text)에 내부 줄이 섞였나 → [{line, why}] (없으면 빈 배열)
   *  1) 민감 낱말 그대로  2) 내부 줄의 숫자(금액·%)  3) 내부 줄과 60% 이상 겹치는 문장 */
  function leakCheck(text, intLines) {
    const hits = [];
    const t = String(text || "");
    const s = t.match(new RegExp(SENSITIVE.source, "g"));
    if (s) s.forEach((w) => hits.push({ line: -1, why: `민감 낱말 ‘${w}’` }));
    const sentences = t.split(/\n|(?<=[.!?。])\s+/).filter((x) => x.trim().length > 4);
    (intLines || []).forEach((l) => {
      const nums = (l.text.match(/\d[\d,.]*\s*(만\s*원?|억|%|퍼센트)/g) || []).map((x) => x.replace(/\s/g, ""));
      const numHit = nums.find((n) => t.replace(/\s/g, "").includes(n));
      if (numHit) { hits.push({ line: l.i, why: `내부 숫자 ‘${numHit}’` }); return; }
      const g = grams(l.text);
      if (g.size < 4) return;
      const over = sentences.some((x) => { const sg = grams(x); let h = 0; g.forEach((k) => { if (sg.has(k)) h++; }); return h / g.size >= 0.6; });
      if (over) hits.push({ line: l.i, why: "내부 메모 문장과 겹침" });
    });
    return hits;
  }

  /* ---------- Claude 응답 검사 ---------- */
  function normalizeDraft(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const subject = typeof d.subject === "string" ? d.subject.replace(/\s+/g, " ").trim().slice(0, 100) : "";
    const body = typeof d.body === "string" ? d.body.replace(/\r\n/g, "\n").trim().slice(0, 2500) : "";
    if (!subject || body.length < 20) return null;
    return { subject, body };
  }

  /* ---------- 후속 알림 ---------- */
  function dueStatus(due, today, sent) {
    if (sent) return { kind: "sent", n: 0 };
    const n = daysBetween(today, due);
    if (n < 0) return { kind: "late", n };
    if (n === 0) return { kind: "today", n };
    if (n <= 2) return { kind: "soon", n };
    return { kind: "later", n };
  }
  /** 이번 달 약속 중 기한이 지났는데 안 보낸 것 = 놓친 후속 */
  function monthStats(list, today) {
    const ym = today.slice(0, 7);
    const mine = list.filter((p) => p.due.slice(0, 7) === ym);
    return { total: mine.length, sent: mine.filter((p) => p.sent).length, missed: mine.filter((p) => !p.sent && p.due < today).length };
  }
  /** 같은 미팅·같은 자료는 한 번만 알림에 올린다 */
  function addPromises(list, meetingId, promises) {
    const key = (p) => `${p.meetingId}|${p.item.replace(/\s/g, "")}`;
    const have = new Set(list.map(key));
    const added = promises.map((p) => ({ id: `${meetingId}-${p.line}`, meetingId, item: p.item, due: p.due, sent: false })).filter((p) => !have.has(key(p)));
    return { list: list.concat(added), added: added.length };
  }

  /* ---------- 캘린더 (.ics) ---------- */
  const icsEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  /** 한 줄 75바이트 넘으면 UTF-8 기준으로 접는다 */
  function fold(line) {
    const enc = (c) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(c).length : Buffer.byteLength(c));
    let out = "", cur = "", n = 0;
    for (const ch of line) {
      const b = enc(ch);
      if (n + b > 75) { out += cur + "\r\n "; cur = ""; n = 1; }
      cur += ch; n += b;
    }
    return out + cur;
  }
  function buildIcs(list, labelOf, stamp) {
    const ds = (s) => s.replace(/-/g, "");
    const ev = list.filter((p) => !p.sent).flatMap((p) => [
      "BEGIN:VEVENT", `UID:${p.id}@chaenggim.demo`, `DTSTAMP:${stamp || "20260101T000000Z"}`,
      `DTSTART;VALUE=DATE:${ds(p.due)}`, `DTEND;VALUE=DATE:${ds(addDays(p.due, 1))}`,
      `SUMMARY:${icsEsc(`[후속] ${labelOf ? labelOf(p) + " · " : ""}${p.item}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:후속 자료 보내기", "TRIGGER:-PT15H", "END:VALARM",
      "END:VEVENT",
    ]);
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Builder Lab//Chaenggim//KO", "CALSCALE:GREGORIAN", "X-WR-CALNAME:후속 약속"].concat(ev, ["END:VCALENDAR"]).map(fold).join("\r\n") + "\r\n";
  }

  return { DAYS, d0, iso, addDays, md, withDay, daysBetween, isIso, parseMD, addBizDays, findDue, SENSITIVE, classify, applyOverrides, findPromises, buildDraft, grams, leakCheck, normalizeDraft, dueStatus, monthStats, addPromises, icsEsc, fold, buildIcs };
});
