/* 장비표 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Jangbipyo, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 시간은 0시부터 센 분(minute)으로 다룬다. 14:30 → 870.
 *
 * 핵심은 createStore(): 데이터베이스 한 장을 흉내 낸다.
 *   constraint:true  → 저장하는 그 순간 겹치는 예약을 다시 확인한다 (DB의 exclude 제약과 같은 자리).
 *   constraint:false → 화면에서 '비어 있나' 확인만 하고 저장한다 (예전 방식, 동시 예약에 뚫린다).
 * simulateRace()는 두 사람이 같은 시간을 동시에 누르는 상황을 그대로 재현한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Jangbipyo = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  const OPEN = 9 * 60;   // 실험실 문 여는 시간
  const CLOSE = 21 * 60; // 닫는 시간
  const MAX_MIN = 4 * 60; // 한 번에 최대 4시간
  const STEP = 30;        // 30분 단위

  /* ---------- 날짜 · 시간 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function md(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function withDay(s) { return `${md(s)}(${DAYS[d0(s).getDay()]})`; }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  /** "14:30" → 870, 틀리면 -1 */
  function toMin(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m || +m[1] > 24 || +m[2] > 59) return -1;
    return +m[1] * 60 + +m[2];
  }

  /* ---------- 겹침 ---------- */
  /** 같은 장비·같은 날, [start, end) 반열린 구간이 겹치면 true. 14:00에 끝나고 14:00에 시작하는 건 괜찮다 */
  function overlaps(a, b) {
    return a.eq === b.eq && a.date === b.date && a.start < b.end && b.start < a.end;
  }
  const live = (b) => b.status !== "cancelled";
  function findConflict(list, b) { return list.find((x) => live(x) && x.id !== b.id && overlaps(x, b)) || null; }
  /** 저장된 예약 중 서로 겹치는 쌍 (충돌 건수 집계용) */
  function conflictPairs(list) {
    const l = list.filter(live), out = [];
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (overlaps(l[i], l[j])) out.push([l[i].id, l[j].id]);
    return out;
  }

  /* ---------- 예약 검사 ---------- */
  /** 저장 전에 사람에게 보여 줄 문제들. 비어 있으면 통과. nowMin을 주면 오늘 지난 시간도 막는다 */
  function validate(b, today, nowMin) {
    const e = [];
    if (!b.eq) e.push("장비를 골라 주세요");
    if (!isIso(b.date)) e.push("날짜가 올바르지 않아요");
    else if (today && b.date < today) e.push("지난 날짜는 예약할 수 없어요");
    if (!(b.start >= 0) || !(b.end >= 0)) e.push("시작·끝 시간을 넣어 주세요");
    else {
      if (b.end <= b.start) e.push("끝 시간이 시작보다 늦어야 해요");
      if (b.start < OPEN || b.end > CLOSE) e.push(`이용 시간은 ${hhmm(OPEN)}~${hhmm(CLOSE)}이에요`);
      if (b.start % STEP || b.end % STEP) e.push("30분 단위로 예약해 주세요");
      if (b.end - b.start > MAX_MIN) e.push("한 번에 4시간까지 예약할 수 있어요");
      if (b.date === today && nowMin >= 0 && b.start < nowMin) e.push("이미 지난 시간이에요");
    }
    if (!String(b.who || "").trim()) e.push("예약자 이름을 넣어 주세요");
    return e;
  }
  /** 안전교육이 필요한 장비는 자동 확정하지 않는다 → 실험실 관리자 승인 대기 */
  const statusFor = (eq) => (eq && eq.training ? "pending" : "ok");

  /* ---------- 저장소 (DB 흉내) ---------- */
  function createStore(initial, opts) {
    const rows = (initial || []).map((b) => ({ ...b }));
    const constraint = !(opts && opts.constraint === false);
    let seq = rows.length;
    return {
      constraint,
      rows: () => rows.slice(),
      /** 화면이 하는 '비어 있나' 확인: 그 순간의 사본을 본다 */
      snapshot: () => rows.map((b) => ({ ...b })),
      /** 저장. 제약이 켜져 있으면 저장하는 순간 다시 확인한다 */
      insert(b) {
        if (constraint) {
          const c = findConflict(rows, b);
          if (c) return { ok: false, code: "23P01", error: "겹치는 예약이 이미 있어요", conflict: c };
        }
        const row = { ...b, id: b.id || `b${++seq}` };
        rows.push(row);
        return { ok: true, row };
      },
    };
  }
  /**
   * 두 사람이 같은 시간을 동시에 누른다.
   * 1) 둘 다 화면에서 '비어 있음'을 확인 (같은 사본)  2) 둘 다 저장 요청
   * 화면 확인만으로는 둘 다 통과한다. 저장하는 순간의 제약이 있어야 한 사람만 들어간다.
   */
  function simulateRace(store, a, b) {
    const log = [];
    const seen = store.snapshot();
    const freeA = !findConflict(seen, a), freeB = !findConflict(seen, b);
    log.push({ who: a.who, step: "check", ok: freeA }, { who: b.who, step: "check", ok: freeB });
    const ra = freeA ? store.insert(a) : { ok: false, error: "이미 찼어요" };
    const rb = freeB ? store.insert(b) : { ok: false, error: "이미 찼어요" };
    log.push({ who: a.who, step: "insert", ok: ra.ok, code: ra.code }, { who: b.who, step: "insert", ok: rb.ok, code: rb.code });
    const saved = [ra, rb].filter((r) => r.ok).length;
    return { log, saved, conflicts: conflictPairs(store.rows()).length };
  }

  /* ---------- 빠른 예약 문장 (규칙) ---------- */
  /** "내일 오후 2시부터 3시간 SEM" → {eq, date, start, end, purpose} 찾은 것만 */
  function parseRequest(text, today, equipment) {
    const t = String(text || "");
    const out = { eq: "", date: "", start: -1, end: -1, purpose: "", missing: [] };
    const low = t.toLowerCase();
    const hit = (equipment || []).find((e) => [e.name, ...(e.alias || [])].some((a) => low.includes(String(a).toLowerCase())));
    if (hit) out.eq = hit.id;
    if (/모레/.test(t)) out.date = addDays(today, 2);
    else if (/내일/.test(t)) out.date = addDays(today, 1);
    else if (/오늘/.test(t)) out.date = today;
    let m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(t) || /(\d{1,2})월\s*(\d{1,2})일/.exec(t);
    if (m) { const y = d0(today).getFullYear(); const s = iso(new Date(y, +m[1] - 1, +m[2])); if (+s.slice(5, 7) === +m[1]) out.date = s < today ? addDays(s, 365) : s; }
    m = /(다음\s*주\s*)?([월화수목금토일])요일/.exec(t);
    if (!out.date && m) { const cur = d0(today).getDay(), want = DAYS.indexOf(m[2]); let n = ((want - cur + 7) % 7) || 7; if (m[1]) n += n < 7 ? 7 : 0; out.date = addDays(today, n); }
    // 시각: "14시", "14:30", "오후 2시", "2시 반"
    const times = [];
    const re = /(오전|오후)?\s*(\d{1,2})(?::(\d{2})|시(?!간)\s*(반|\d{1,2}분)?)/g;
    let x;
    while ((x = re.exec(t))) {
      let h = +x[2]; const mm = x[3] ? +x[3] : x[4] === "반" ? 30 : x[4] ? parseInt(x[4], 10) : 0;
      if (x[1] === "오후" && h < 12) h += 12;
      else if (!x[1] && h >= 1 && h <= 8) h += 12; // 실험실은 9시에 열므로 '2시'는 오후
      times.push(h * 60 + mm);
    }
    if (times[0] >= 0) out.start = times[0];
    const dur = /(\d{1,2})\s*시간(\s*반)?/.exec(t);
    if (times.length >= 2) out.end = times[1];
    else if (dur && out.start >= 0) out.end = out.start + +dur[1] * 60 + (dur[2] ? 30 : 0);
    const pu = /(?:용도|목적)\s*[:：]\s*(.+)$/.exec(t);
    if (pu) out.purpose = pu[1].trim().slice(0, 40);
    if (!out.eq) out.missing.push("장비");
    if (!out.date) out.missing.push("날짜");
    if (out.start < 0) out.missing.push("시작 시간");
    if (out.end < 0) out.missing.push("끝 시간");
    return out;
  }
  /** Claude 응답 검사: 목록에 없는 장비·틀린 날짜·시간이면 그 칸을 비운다. 아무것도 못 쓰면 null */
  function normalizeParse(d, equipment) {
    if (!d || typeof d !== "object") return null;
    const ids = new Set((equipment || []).map((e) => e.id));
    const eq = typeof d.equipment === "string" && ids.has(d.equipment) ? d.equipment : "";
    const date = isIso(d.date) ? d.date : "";
    const start = toMin(d.start), end = toMin(d.end);
    if (!eq && !date && start < 0) return null;
    const out = { eq, date, start, end: end > start ? end : -1, purpose: typeof d.purpose === "string" ? d.purpose.trim().slice(0, 40) : "", missing: [] };
    if (!out.eq) out.missing.push("장비");
    if (!out.date) out.missing.push("날짜");
    if (out.start < 0) out.missing.push("시작 시간");
    if (out.end < 0) out.missing.push("끝 시간");
    out.note = typeof d.unclear === "string" ? d.unclear.trim().slice(0, 80) : "";
    return out;
  }

  /* ---------- 집계 · 내보내기 ---------- */
  /** 이름 가리기: 김민준 → 김*준, 이준 → 이* */
  function maskName(n) {
    const s = String(n || "").trim();
    if (s.length <= 1) return s ? "*" : "";
    if (s.length === 2) return s[0] + "*";
    return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
  }
  function usage(list, equipment) {
    return equipment.map((e) => ({ id: e.id, minutes: list.filter((b) => live(b) && b.eq === e.id).reduce((s, b) => s + b.end - b.start, 0) }));
  }
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  /** 공유용 CSV: 예약자 이름은 가린다 */
  function toCsv(list, equipment, labs) {
    const eqOf = (id) => equipment.find((e) => e.id === id) || { name: id, lab: "" };
    const labOf = (id) => (labs.find((l) => l.id === id) || { name: "" }).name;
    const rows = list.filter(live).slice().sort((a, b) => (a.date + hhmm(a.start)).localeCompare(b.date + hhmm(b.start)))
      .map((b) => [b.date, hhmm(b.start), hhmm(b.end), labOf(eqOf(b.eq).lab), eqOf(b.eq).name, maskName(b.who), b.status === "pending" ? "승인 대기" : "확정", b.purpose || ""]);
    return "\uFEFF" + [["날짜", "시작", "끝", "실험실", "장비", "예약자", "상태", "용도"], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  return { DAYS, OPEN, CLOSE, MAX_MIN, STEP, d0, iso, addDays, md, withDay, isIso, hhmm, toMin, overlaps, findConflict, conflictPairs, validate, statusFor, createStore, simulateRace, parseRequest, normalizeParse, maskName, usage, toCsv };
});
