/* 적어줌 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Jeogeojum, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 * 미팅 메모 → CRM 칸(고객사·담당자·단계·금액·날짜·다음 할 일·요약)
 *   규칙: 금액('3,200만 원', '1억 2천만'), 날짜('11/5', '다음 주 화요일'), 단계 낱말을 읽는다.
 *   Claude: 같은 칸을 문맥으로 채운다. 단, 숫자 칸(금액·날짜)은 원문에 그 숫자가 있는지 다시 찾고,
 *           어느 쪽이든 사람이 '원문과 맞음'을 눌러야 저장된다 (canSave).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Jeogeojum = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  const DAY_MS = 86400000;
  const STAGES = ["첫 미팅", "요구 파악", "제안", "견적", "협상", "계약", "보류"];
  /** 숫자 칸: 사람이 원문과 대조해야 저장된다 */
  const NUMERIC = ["amount", "meetingDate", "nextDate"];
  const LABEL = { company: "고객사", contact: "고객 담당자", stage: "단계", amount: "예상 금액", meetingDate: "미팅일", nextDate: "다음 연락일", nextAction: "다음 할 일", summary: "요약" };

  /* ---------- 날짜 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function md(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function withDay(s) { return `${md(s)}(${DAYS[d0(s).getDay()]})`; }
  function daysBetween(a, b) { return Math.round((d0(b) - d0(a)) / DAY_MS); }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;
  function nextWeekday(today, ch) {
    const t = DAYS.indexOf(ch), cur = d0(today).getDay();
    return addDays(today, ((t - cur + 7) % 7) || 7);
  }
  /** "11/5" → 날짜. 두 달 넘게 지난 날짜는 내년, 없는 날짜(2/30)는 "" */
  function parseMD(today, m, d) {
    const t = d0(today), x = new Date(t.getFullYear(), m - 1, d);
    if (x.getMonth() !== m - 1) return "";
    if (t - x > 60 * DAY_MS) x.setFullYear(x.getFullYear() + 1);
    return iso(x);
  }
  /** 글에 나온 날짜 표현 모두 → [{iso, text, index}] */
  function findDates(text, today) {
    const out = [];
    const s = String(text || "");
    let m;
    const r1 = /(\d{1,2})\s*[\/월]\s*(\d{1,2})\s*일?(\([월화수목금토일]\))?/g;
    while ((m = r1.exec(s))) { const v = parseMD(today, +m[1], +m[2]); if (v) out.push({ iso: v, text: m[0], index: m.index }); }
    const r2 = /(다음\s*주|이번\s*주)?\s*([월화수목금토일])요일/g;
    while ((m = r2.exec(s))) {
      // '다음 주 화요일' = 다음 달력 주(월요일 시작)의 화요일, '이번 주 화요일' = 이번 주의 화요일
      let v = nextWeekday(today, m[2]);
      if (m[1]) {
        const mon = addDays(today, -((d0(today).getDay() + 6) % 7));
        v = addDays(mon, (DAYS.indexOf(m[2]) + 6) % 7 + (/다음/.test(m[1]) ? 7 : 0));
      }
      out.push({ iso: v, text: m[0].trim(), index: m.index + (m[0].length - m[0].trimStart().length) });
    }
    const r3 = /(오늘|내일|모레)/g;
    while ((m = r3.exec(s))) out.push({ iso: addDays(today, { 오늘: 0, 내일: 1, 모레: 2 }[m[1]]), text: m[1], index: m.index });
    return out.sort((a, b) => a.index - b.index);
  }

  /* ---------- 금액 ---------- */
  const num = (x) => Number(String(x).replace(/,/g, ""));
  /** 글에 나온 금액 표현 모두 → [{value(원), text, index}] */
  function findAmounts(text) {
    const s = String(text || "");
    const out = [];
    const re = /(\d+(?:\.\d+)?)\s*억(?:\s*(\d{1,4}(?:,\d{3})*)\s*(천)?\s*만)?\s*원?|(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(천)?\s*만\s*원?|(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g;
    let m;
    while ((m = re.exec(s))) {
      let v;
      if (m[1] !== undefined) v = num(m[1]) * 1e8 + (m[2] ? num(m[2]) * (m[3] ? 1e7 : 1e4) : 0);
      else if (m[4] !== undefined) v = num(m[4]) * (m[5] ? 1e7 : 1e4);
      else v = num(m[6]);
      v = Math.round(v);
      if (v > 0) out.push({ value: v, text: m[0].trim(), index: m.index });
    }
    return out;
  }
  /** 3,200만 원 · 1억 2,000만 원 · 450,000원 */
  function fmtWon(v) {
    if (v === null || v === undefined || v === "" || !Number.isFinite(+v)) return "";
    v = Math.round(+v);
    if (v < 10000) return `${v.toLocaleString("ko-KR")}원`;
    const eok = Math.floor(v / 1e8), man = Math.floor((v % 1e8) / 1e4), won = v % 1e4;
    if (won) return `${v.toLocaleString("ko-KR")}원`;
    return [eok ? `${eok}억` : "", man ? `${man.toLocaleString("ko-KR")}만` : ""].filter(Boolean).join(" ") + " 원";
  }
  /** 사람이 친 금액("3200만", "1.2억", "32,000,000") → 원. 못 읽으면 null */
  function parseWonInput(s) {
    const t = String(s || "").trim();
    if (!t) return null;
    if (/^\d{1,3}(,\d{3})+$|^\d+$/.test(t)) return num(t);
    const a = findAmounts(/[원억만]$/.test(t) ? t : t + "원");
    return a.length === 1 && a[0].text.replace(/\s/g, "").length >= t.replace(/\s/g, "").length - 1 ? a[0].value : null;
  }

  /* ---------- 개인정보 가리기 ---------- */
  function maskPII(text) {
    return String(text || "")
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[메일 가림]")
      .replace(/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[전화 가림]");
  }

  /* ---------- 규칙으로 칸 채우기 ---------- */
  const STAGE_WORDS = [
    ["계약", /계약서|계약\s*(체결|확정|진행)|발주\s*확정|도장/],
    ["협상", /협상|네고|할인\s*요청|조건\s*조율|단가\s*조정/],
    ["견적", /견적/],
    ["제안", /제안서|제안\s*발표|데모|시연/],
    ["요구 파악", /요구\s*사항|니즈|현황\s*파악|문제\s*점/],
    ["보류", /보류|내년으로|미루|중단/],
  ];
  const lineOf = (s, idx) => { const a = s.lastIndexOf("\n", idx - 1) + 1, b = s.indexOf("\n", idx); return s.slice(a, b < 0 ? s.length : b).trim(); };
  const clean = (l) => l.replace(/^[\s\-•*·]+/, "").trim();

  function extractRule(memo, today, customers) {
    const s = String(memo || "");
    const lines = s.split(/\n/).map(clean).filter(Boolean);
    const f = { company: "", contact: "", stage: "", amount: null, meetingDate: "", nextDate: "", nextAction: "", summary: "" };
    const src = {};
    const cand = {};
    // 고객사: '고객사:' 줄 → 고객 목록 이름 → '(주)OO'
    const lab = s.match(/(?:고객사|회사|거래처)\s*[:：]\s*([^\n,·/]+)/);
    const known = (customers || []).filter(Boolean).sort((a, b) => b.length - a.length).find((c) => s.includes(c));
    const corp = s.match(/(?:\(주\)|㈜)\s*([가-힣A-Za-z]{2,12})|([가-힣]{2,10})\s*(?:\(주\)|㈜)/);
    f.company = (lab && lab[1].trim()) || known || (corp && (corp[1] || corp[2])) || "";
    if (f.company) src.company = f.company;
    // 고객 담당자: '이름 + 직함'
    const ct = s.match(/([가-힣]{2,4})\s?(팀장|과장|부장|차장|대리|이사|상무|대표|실장|매니저|주임)/);
    if (ct) { f.contact = `${ct[1]} ${ct[2]}`; src.contact = ct[0]; }
    // 단계: 뒤에 나온(더 진행된) 단계가 이긴다
    let stageAt = -1;
    STAGE_WORDS.forEach(([name, re]) => { const g = new RegExp(re.source, "g"); let m; while ((m = g.exec(s))) if (m.index > stageAt) { stageAt = m.index; f.stage = name; src.stage = m[0]; } });
    if (!f.stage) f.stage = "첫 미팅";
    // 금액: 여러 개면 '최종·확정·견적·예산'이 붙은 줄, 그래도 여러 개면 마지막 것. 후보는 모두 남긴다
    const am = findAmounts(s);
    cand.amount = am.map((a) => ({ value: a.value, text: a.text, line: lineOf(s, a.index) }));
    if (am.length) {
      const strong = am.filter((a) => /최종|확정|으로\s*(정리|맞춤|합의)/.test(lineOf(s, a.index)));
      const mid = am.filter((a) => /견적|예산|금액|규모|계약/.test(lineOf(s, a.index)));
      const pick = (strong.length ? strong : mid.length ? mid : am).slice(-1)[0];
      f.amount = pick.value; src.amount = pick.text;
    }
    // 날짜: 첫 줄(머리)의 날짜는 미팅일, '다음·재미팅·회신·까지·연락' 줄의 날짜는 다음 연락일
    const ds = findDates(s, today);
    cand.dates = ds.map((d) => ({ iso: d.iso, text: d.text, line: lineOf(s, d.index) }));
    const headEnd = s.indexOf("\n") < 0 ? s.length : s.indexOf("\n");
    const meet = ds.find((d) => d.index < headEnd || /미팅\s*일|방문\s*일|만남/.test(lineOf(s, d.index)));
    if (meet) { f.meetingDate = meet.iso; src.meetingDate = meet.text; } else { f.meetingDate = today; src.meetingDate = ""; }
    const nexts = ds.filter((d) => d !== meet && /다음|재\s*미팅|회신|까지|연락|후속|다시|보내/.test(lineOf(s, d.index)));
    const nx = nexts[0] || ds.filter((d) => d !== meet && d.iso >= today).slice(-1)[0];
    if (nx) { f.nextDate = nx.iso; src.nextDate = nx.text; }
    // 다음 할 일: '보내기로·드리기로·하기로·전달' 줄
    const act = lines.find((l) => /(보내|드리|전달|하|준비|공유)기로|다음\s*할\s*일|후속\s*[:：]|요청\s*받음/.test(l));
    if (act) { f.nextAction = maskPII(act.replace(/^(다음\s*할\s*일|후속)\s*[:：]\s*/, "")).slice(0, 120); src.nextAction = act; }
    // 요약: 머리 줄을 뺀 앞의 두 줄
    const body = lines.filter((l, i) => !(i === 0 && (meet && meet.index < headEnd)) && !/^(고객사|회사|거래처|참석)\s*[:：]/.test(l));
    f.summary = maskPII(body.slice(0, 2).join(" ")).slice(0, 160);
    return { fields: f, src, cand, mode: "rule" };
  }

  /* ---------- Claude 응답 검사 ---------- */
  /** 숫자 칸 값이 원문에 실제로 있나 */
  function inSource(key, value, memo, today) {
    if (value === null || value === undefined || value === "") return { found: true, text: "" };
    if (key === "amount") { const a = findAmounts(memo).find((x) => x.value === value); return { found: !!a, text: a ? a.text : "" }; }
    const d = findDates(memo, today).find((x) => x.iso === value);
    if (d) return { found: true, text: d.text };
    if (key === "meetingDate" && value === today) return { found: true, text: "오늘(메모에 날짜 없음)" };
    return { found: false, text: "" };
  }
  const str = (v, n) => (typeof v === "string" ? maskPII(v.trim()).slice(0, n) : "");
  function normalizeAi(d, memo, today) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const f = {
      company: str(d.company, 40), contact: str(d.contact, 30),
      stage: STAGES.includes(d.stage) ? d.stage : "",
      amount: typeof d.amount === "number" && Number.isFinite(d.amount) && d.amount > 0 ? Math.round(d.amount) : null,
      meetingDate: isIso(d.meetingDate) ? d.meetingDate : "",
      nextDate: isIso(d.nextDate) ? d.nextDate : "",
      nextAction: str(d.nextAction, 120), summary: str(d.summary, 160),
    };
    if (!f.company && !f.summary) return null;
    const src = {};
    const missing = [];
    NUMERIC.forEach((k) => { const r = inSource(k, f[k], memo, today); src[k] = r.text; if (!r.found) missing.push(k); });
    return { fields: f, src, notInSource: missing, mode: "ai" };
  }

  /** 규칙 결과 위에 Claude 결과를 얹는다: 빈 칸은 규칙 값을 남긴다 */
  function mergeAi(rule, ai) {
    const fields = { ...rule.fields }, src = { ...rule.src };
    Object.keys(ai.fields).forEach((k) => {
      const v = ai.fields[k];
      if (v !== "" && v !== null) { fields[k] = v; src[k] = ai.src[k] !== undefined ? ai.src[k] : rule.src[k]; }
    });
    return { fields, src, cand: rule.cand, notInSource: ai.notInSource.filter((k) => ai.fields[k] !== null && ai.fields[k] !== ""), mode: "ai" };
  }

  /* ---------- 저장 검사 ---------- */
  /** 숫자 칸(값이 있는 것)은 모두 사람이 확인해야, 고객사는 반드시 있어야 저장된다 */
  function canSave(fields, confirmed) {
    const need = NUMERIC.filter((k) => fields[k] !== null && fields[k] !== "" && !(confirmed && confirmed[k]));
    const problems = [];
    if (!String(fields.company || "").trim()) problems.push("고객사");
    if (!STAGES.includes(fields.stage)) problems.push("단계");
    return { ok: !need.length && !problems.length, need, problems };
  }

  /** 같은 고객사·같은 미팅일이면 새로 쌓지 않고 고친다 → {list, replaced} */
  function upsert(list, rec) {
    const key = (r) => `${String(r.company).replace(/\s|\(주\)|㈜/g, "")}|${r.meetingDate}`;
    const i = list.findIndex((r) => key(r) === key(rec));
    if (i < 0) return { list: [rec, ...list], replaced: false };
    const next = list.slice();
    next[i] = { ...rec, id: list[i].id };
    return { list: next, replaced: true };
  }

  function filterRecords(list, { stage = "all", owner = "all", q = "" } = {}) {
    const k = q.trim();
    return list.filter((r) => (stage === "all" || r.stage === stage) && (owner === "all" || r.owner === owner) && (!k || `${r.company} ${r.contact} ${r.summary} ${r.nextAction}`.includes(k)));
  }

  /* ---------- CSV ---------- */
  /** 쉼표·따옴표·줄바꿈은 따옴표로, '=+-@'로 시작하는 글은 엑셀 수식으로 읽히지 않게 ' 를 붙인다 */
  function csvCell(v) {
    let s = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const CSV_COLS = [["savedAt", "저장일"], ["owner", "영업 담당"], ["company", "고객사"], ["contact", "고객 담당자"], ["stage", "단계"], ["amount", "예상 금액(원)"], ["meetingDate", "미팅일"], ["nextDate", "다음 연락일"], ["nextAction", "다음 할 일"], ["summary", "요약"]];
  /** 엑셀에서 한글이 깨지지 않게 BOM, 줄은 CRLF. 연락처는 내보내지 않는다(요약도 다시 가림) */
  function toCsv(list) {
    const rows = [CSV_COLS.map((c) => c[1])].concat(list.map((r) => CSV_COLS.map(([k]) => (k === "summary" || k === "nextAction" ? maskPII(r[k]) : r[k]))));
    return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  return { DAYS, STAGES, NUMERIC, LABEL, d0, iso, addDays, md, withDay, daysBetween, isIso, nextWeekday, parseMD, findDates, findAmounts, fmtWon, parseWonInput, maskPII, extractRule, inSource, normalizeAi, mergeAi, canSave, upsert, filterRecords, csvCell, toCsv };
});
