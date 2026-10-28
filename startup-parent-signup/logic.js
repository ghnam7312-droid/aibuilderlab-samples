/* 자리있음 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Jariisseum, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름: 전화·문자로 받은 메모 → 신청 항목으로 정리(규칙 또는 Claude) → 전화번호 기준 중복 확인
 *       → 정원 안이면 확정, 넘으면 대기 → 안내 문자 · 기관 제출용 명단(CSV).
 * 개인정보: Claude에는 전화번호를 [전화1]처럼 가려서 보내고, 화면·내보내기에는 가운데 네 자리를 가린다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Jariisseum = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 전화번호 ---------- */
  const PHONE_RE = /(?:\+?82[\s.-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/g;
  /** 여러 모양의 번호 → "01012345678". 휴대폰 번호가 아니면 "" */
  function normPhone(s) {
    let d = String(s || "").replace(/\D/g, "");
    if (d.startsWith("82")) d = "0" + d.slice(2);
    if (d.startsWith("1") && d.length === 10) d = "0" + d;
    return /^01[016789]\d{7,8}$/.test(d) ? d : "";
  }
  function fmtPhone(d) { return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; }
  /** 화면·내보내기용: 가운데를 가린다 */
  function maskPhone(d) { return d ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : "번호 없음"; }

  /** Claude에 보내기 전에 번호를 [전화1]로 바꾼다 → {text, map} */
  function maskForAi(text) {
    const map = {};
    let n = 0;
    const out = String(text || "").replace(PHONE_RE, (m) => { const k = `[전화${++n}]`; map[k] = normPhone(m); return k; });
    return { text: out, map };
  }

  /* ---------- 규칙 정리 ---------- */
  const HONOR = "(?:어머님|아버님|어머니|아버지|보호자|님|씨)";
  const STOP = ["문자", "전화", "신청", "강의", "놀이", "코칭", "미디어", "다시", "어린이집", "복지관", "유치원", "한분", "아이", "둘째", "첫째"];
  function findName(line) {
    const a = line.match(new RegExp(`([가-힣]{2,4}?)\\s*${HONOR}`));
    if (a && !STOP.includes(a[1])) return a[1];
    const words = line.replace(PHONE_RE, " ").replace(/^[^)\]]*[)\]]\s*/, "").split(/[\s,·]+/).filter((w) => /^[가-힣]{2,4}$/.test(w));
    return words.find((w) => !STOP.includes(w) && !/[요다]$/.test(w)) || "";
  }
  function findSession(line, sessions) {
    const s = sessions.find((x) => x.keys.some((k) => line.includes(k)));
    return s ? s.id : "";
  }
  function findKids(line) { const m = line.match(/(\d{1,2})\s*(개월|세|살)/); return m ? `${m[1]}${m[2] === "살" ? "세" : m[2]}` : ""; }
  function findSource(line) { return /^\s*\(?전화/.test(line) ? "전화" : /^\s*\(?문자/.test(line) ? "문자" : "메모"; }

  /** 한 줄에 한 사람. 번호·강의를 못 찾은 줄은 problems로 */
  function parseMemo(text, sessions) {
    const entries = [], problems = [];
    String(text || "").split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const phones = line.match(PHONE_RE) || [];
      const phone = phones.length ? normPhone(phones[0]) : "";
      const session = findSession(line, sessions);
      const name = findName(line);
      const why = [!phone && "전화번호 없음", !session && "강의를 알 수 없음", !name && "이름 없음"].filter(Boolean);
      if (why.length) { problems.push({ line: i + 1, text: line, why: why.join(", ") }); return; }
      // 문의가 담긴 문장만 메모로 남긴다 ("둘째도 데려가도 되나요?")
      const note = (line.split(/(?<=[.!?])\s+/).find((x) => /\?|되나요|가능/.test(x)) || "").replace(PHONE_RE, "").trim().slice(0, 60);
      entries.push({ name, phone, session, kids: findKids(line), source: findSource(line), note, line: i + 1 });
    });
    return { entries, problems };
  }

  /* ---------- Claude 응답 검사 ---------- */
  /** map: maskForAi의 번호표. 번호가 표에 없거나 강의가 없으면 그 항목은 버린다. 전부 틀리면 null */
  function normalizeParse(data, map, sessions) {
    if (!data || !Array.isArray(data.entries)) return null;
    const ids = sessions.map((s) => s.id);
    const entries = [];
    for (const e of data.entries) {
      if (!e || typeof e !== "object") continue;
      const phone = map[String(e.phone || "").trim()] || "";
      const name = typeof e.name === "string" ? e.name.trim().slice(0, 10) : "";
      if (!phone || !name || !ids.includes(e.session)) continue;
      entries.push({ name, phone, session: e.session, kids: typeof e.kids === "string" ? e.kids.slice(0, 10) : "", source: "메모", note: typeof e.note === "string" ? e.note.slice(0, 60) : "", line: Number(e.line) || 0 });
    }
    return entries.length ? entries : null;
  }

  /* ---------- 중복 확인 (전화번호 + 강의) ---------- */
  /**
   * 같은 강의에 같은 번호로 두 번 들어오면 한 명으로 합친다. 먼저 신청한 순서(선착순)는 지키고,
   * 아이 나이·문의처럼 비어 있던 값만 나중 신청에서 채운다. 이름이 다르면 확인 표시.
   * @returns {list, merged:[{name, phone, session, times, nameDiff}]}
   */
  function dedupe(list) {
    const byKey = new Map();
    const out = [];
    for (const e of list) {
      const key = `${e.phone}|${e.session}`;
      const first = byKey.get(key);
      if (!first) { const c = { ...e, times: e.times || 1 }; byKey.set(key, c); out.push(c); continue; }
      first.times += e.times || 1;
      if (!first.kids && e.kids) first.kids = e.kids;
      if (!first.note && e.note) first.note = e.note;
      if (e.name !== first.name) first.nameDiff = e.name;
    }
    return { list: out, merged: out.filter((e) => e.times > 1).map((e) => ({ name: e.name, phone: e.phone, session: e.session, times: e.times, nameDiff: e.nameDiff || "" })) };
  }

  /** 새로 들어온 것을 기존 명단에 붙이며 중복 확인 → {list, added, dupes} */
  function merge(existing, incoming, stamp) {
    const before = new Set(existing.map((e) => `${e.phone}|${e.session}`));
    const tagged = incoming.map((e, i) => ({ ...e, id: e.id || `${stamp}-${i}`, at: e.at || `${stamp}-${String(i).padStart(3, "0")}` }));
    const r = dedupe([...existing.map((e) => ({ ...e })), ...tagged]);
    const added = r.list.filter((e) => !before.has(`${e.phone}|${e.session}`)).length;
    return { list: r.list, added, dupes: incoming.length - added, merged: r.merged };
  }

  /* ---------- 정원 · 대기 ---------- */
  function seats(list, session) {
    const mine = list.filter((e) => e.session === session.id).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return mine.map((e, i) => ({ ...e, status: i < session.cap ? "확정" : "대기", wait: i < session.cap ? 0 : i - session.cap + 1 }));
  }

  /* ---------- 안내 문자 ---------- */
  const TEMPLATE = {
    "확정": "[{기관}] {이름}님, ‘{강의}’ 신청이 확정되었습니다.\n일시: {일시}\n장소: {장소}\n아이와 함께 오셔도 됩니다. 못 오시게 되면 이 번호로 답장 주세요.",
    "대기": "[{기관}] {이름}님, ‘{강의}’ 정원이 차서 대기 {대기}번으로 접수되었습니다.\n자리가 나면 강의 이틀 전까지 다시 연락드리겠습니다. ({일시})",
  };
  function fillMessage(tpl, e, s) {
    const vars = { "이름": e.name, "강의": s.title, "기관": s.org, "일시": s.when, "장소": s.place, "대기": String(e.wait || ""), "상태": e.status };
    return String(tpl).replace(/\{(이름|강의|기관|일시|장소|대기|상태)\}/g, (_, k) => vars[k]);
  }
  /** 템플릿에 모르는 칸이 있으면 알려 준다 ({이룸} 같은 오타) */
  function unknownFields(tpl) { return [...String(tpl).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).filter((k) => !["이름", "강의", "기관", "일시", "장소", "대기", "상태"].includes(k)); }

  /* ---------- 내보내기 ---------- */
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  /** 기관 제출용 명단. 전화번호는 가린다 */
  function toCsv(rows, session) {
    const head = ["순번", "이름", "연락처", "아이", "상태", "신청 경로"];
    const body = rows.map((r, i) => [i + 1, r.name, maskPhone(r.phone), r.kids, r.status === "대기" ? `대기 ${r.wait}` : "확정", r.source]);
    return "﻿" + [[`${session.org} · ${session.title} · ${session.when}`], head, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  return { PHONE_RE, normPhone, fmtPhone, maskPhone, maskForAi, findName, findSession, findKids, parseMemo, normalizeParse, dedupe, merge, seats, TEMPLATE, fillMessage, unknownFields, csvCell, toCsv };
});
