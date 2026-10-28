/* 이수함 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Isuham, Node(테스트)에서는 require('./logic.js').
 *
 * 하는 일
 *   신청 목록(신청 폼)과 출석 기록(QR 출석 시트)을 **사번 기준**으로 합쳐 회차별 출결과 이수 여부를 만든다.
 *   - 이름이 같아도 사번이 다르면 다른 사람이다 (동명이인).
 *   - 출석 기록에 사번이 빠졌으면 이름으로 찾되, 같은 이름이 둘 이상이면 합치지 않고 '확인 필요'로 남긴다.
 *   - 같은 사람이 같은 회차에 두 번 찍혀도 한 번으로 센다.
 *   보고 문장은 규칙으로 바로 만들고, Claude 문장은 숫자 검산을 통과할 때만 쓴다.
 *   AI에는 이름·사번을 보내지 않고 집계 숫자만 보낸다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Isuham = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 읽기 ---------- */
  /** 사번 표기 통일: 공백·하이픈 제거, 대문자 */
  function normId(s) { return String(s || "").replace(/[\s\-_.]/g, "").toUpperCase(); }
  const isId = (s) => /^[A-Z]{0,2}\d{4,8}$/.test(s);
  const normName = (s) => String(s || "").replace(/\s+/g, "");

  /** 붙여 넣은 표(탭·쉼표 구분) → 줄 배열. 머리줄(사번·이름이 들어간 줄)은 건너뛴다 */
  function rows(text) {
    return String(text || "").split(/\r?\n/).map((l, i) => ({ cells: l.split(/\t|,/).map((c) => c.trim()), n: i + 1 }))
      .filter((r) => r.cells.some(Boolean))
      .filter((r, i) => !(i === 0 && r.cells.some((c) => /^(사번|이름|성명|회차)$/.test(c))));
  }

  /** 신청 목록: 사번, 이름, 부서 */
  function parseApplicants(text) {
    const list = [], errors = [];
    let dupes = 0;
    const seen = new Map();
    rows(text).forEach((r) => {
      const [rawId, name, dept] = r.cells;
      const id = normId(rawId);
      if (!isId(id) || !normName(name)) { errors.push({ line: r.n, why: !isId(id) ? "사번 형식이 아님" : "이름 없음" }); return; }
      if (seen.has(id)) { dupes++; return; } // 같은 사번이 두 번 신청 → 한 명
      const a = { id, name: normName(name), dept: (dept || "").trim() || "부서 미기재", line: r.n };
      seen.set(id, a); list.push(a);
    });
    return { list, errors, dupes };
  }

  /** 출석 기록: 회차, 사번(비어 있을 수 있음), 이름, 입실 시각 */
  function parseAttendance(text, sessions) {
    const list = [], errors = [];
    rows(text).forEach((r) => {
      const [s, rawId, name, time] = r.cells;
      const session = Number(String(s || "").replace(/[^\d]/g, ""));
      if (!session || session > sessions) { errors.push({ line: r.n, why: "회차가 범위 밖" }); return; }
      const id = normId(rawId);
      if (id && !isId(id)) { errors.push({ line: r.n, why: "사번 형식이 아님" }); return; }
      if (!id && !normName(name)) { errors.push({ line: r.n, why: "사번·이름 모두 없음" }); return; }
      list.push({ session, id, name: normName(name), time: (time || "").trim(), line: r.n, key: `L${r.n}` });
    });
    return { list, errors };
  }

  /* ---------- 사번 기준 합치기 ---------- */
  function toMin(t) { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; }

  /** 같은 이름, 다른 사번 */
  function homonyms(people) {
    const by = new Map();
    people.forEach((p) => { if (!by.has(p.name)) by.set(p.name, new Set()); by.get(p.name).add(p.id); });
    return [...by].filter(([, ids]) => ids.size > 1).map(([name, ids]) => ({ name, ids: [...ids] }));
  }

  /**
   * opts: { sessions, passRate(0~100), start:"14:00", lateMin:10, links:{ [출석 key]: 사번 } }
   * links 는 사람이 '확인 필요'를 직접 연결한 결과다.
   */
  function merge(apps, att, opts) {
    const o = Object.assign({ sessions: 4, passRate: 75, start: "14:00", lateMin: 10, links: {} }, opts);
    const people = new Map();
    apps.forEach((a) => people.set(a.id, { ...a, applied: true, marks: Array(o.sessions).fill(""), flags: [] }));
    const byName = (name) => [...people.values()].filter((p) => p.name === name);
    const unresolved = [];
    let dupCheckins = 0;
    const startMin = toMin(o.start);

    att.forEach((r) => {
      let id = r.id || o.links[r.key] || "";
      let viaName = false;
      if (!id) {
        const c = byName(r.name);
        if (c.length === 1) { id = c[0].id; viaName = true; }
        else { unresolved.push({ ...r, candidates: c.map((p) => ({ id: p.id, dept: p.dept })) }); return; }
      }
      let p = people.get(id);
      if (!p) { // 신청 없이 온 사람
        p = { id, name: r.name || "이름 없음", dept: "신청 없음", applied: false, marks: Array(o.sessions).fill(""), flags: ["신청 없이 참석"] };
        people.set(id, p);
      }
      const how = viaName ? "사번 없이 이름으로 연결" : !r.id ? "담당자가 직접 연결" : "";
      if (how && !p.flags.includes(how)) p.flags.push(how);
      if (r.id && r.name && r.name !== p.name && !p.flags.some((f) => f.startsWith("이름 다름"))) p.flags.push(`이름 다름: ${r.name}`);
      const i = r.session - 1;
      if (p.marks[i]) { dupCheckins++; return; } // 같은 회차 두 번 찍힘
      const t = toMin(r.time);
      p.marks[i] = startMin !== null && t !== null && t > startMin + o.lateMin ? "L" : "O";
    });

    // 확인 필요 후보: 그 회차에 아직 출석이 없는 사람을 앞으로 (이미 출석한 사람이면 두 번 찍힌 것일 수 있다)
    unresolved.forEach((u) => {
      u.candidates = u.candidates.map((c) => ({ ...c, already: !!people.get(c.id).marks[u.session - 1] }))
        .sort((a, b) => a.already - b.already);
    });
    const roster = [...people.values()].map((p) => {
      const count = p.marks.filter(Boolean).length;
      const rate = Math.round((count / o.sessions) * 100);
      return { ...p, count, late: p.marks.filter((m) => m === "L").length, rate, pass: rate >= o.passRate };
    }).sort((a, b) => a.dept.localeCompare(b.dept, "ko") || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));

    return { roster, unresolved, dupCheckins, homonyms: homonyms(roster), passRate: o.passRate, sessions: o.sessions };
  }

  /** 비교용: 예전처럼 '이름'으로 합쳤다면 신청자를 몇 명으로 셌을까 */
  function countByName(apps) { return new Set(apps.map((a) => a.name)).size; }

  /* ---------- 집계 ---------- */
  function stats(m) {
    const ro = m.roster;
    const perSession = Array.from({ length: m.sessions }, (_, i) => ro.filter((p) => p.marks[i]).length);
    const depts = {};
    ro.forEach((p) => {
      const d = (depts[p.dept] = depts[p.dept] || { dept: p.dept, total: 0, pass: 0 });
      d.total++; if (p.pass) d.pass++;
    });
    const applied = ro.filter((p) => p.applied).length;
    const pass = ro.filter((p) => p.applied && p.pass).length;
    return {
      applied, pass, fail: applied - pass, walkIns: ro.filter((p) => !p.applied).length,
      passPct: applied ? Math.round((pass / applied) * 100) : 0,
      perSession, unresolved: m.unresolved.length, homonyms: m.homonyms.length, dupCheckins: m.dupCheckins,
      late: ro.reduce((s, p) => s + p.late, 0),
      byDept: Object.values(depts).sort((a, b) => b.total - a.total),
    };
  }

  /** 규칙으로 쓰는 결과 보고 3문장 + 후속 조치 */
  function ruleReport(course, s) {
    const best = s.perSession.indexOf(Math.max(...s.perSession));
    const low = s.perSession.indexOf(Math.min(...s.perSession));
    const lines = [
      `${course} 신청 ${s.applied}명 중 ${s.pass}명이 이수해 이수율은 ${s.passPct}%입니다.`,
      `회차별 출석은 ${s.perSession.map((n, i) => `${i + 1}회 ${n}명`).join(", ")}으로, ${low + 1}회차가 가장 적었습니다.`,
      s.unresolved ? `출석 기록 ${s.unresolved}건은 사번이 없고 같은 이름이 있어 확인이 필요합니다.` : `동명이인 ${s.homonyms}쌍은 사번으로 나눠 셌고, 확인이 필요한 기록은 없습니다.`,
    ];
    const followups = [];
    if (s.fail) followups.push(`미이수 ${s.fail}명에게 보충 회차 안내`);
    if (s.unresolved) followups.push(`사번 없는 출석 ${s.unresolved}건 본인 확인`);
    if (s.walkIns) followups.push(`신청 없이 참석한 ${s.walkIns}명 신청 처리`);
    if (best !== low) followups.push(`${low + 1}회차 출석이 적었던 이유 확인`);
    return { lines, followups: followups.slice(0, 3) };
  }

  /** AI에 보낼 입력: 이름·사번 없이 숫자만 */
  function aiInput(course, s) {
    return { course, applied: s.applied, pass: s.pass, fail: s.fail, passPct: s.passPct, walkIns: s.walkIns, perSession: s.perSession, unresolved: s.unresolved, homonyms: s.homonyms, late: s.late, byDept: s.byDept.map((d) => ({ dept: d.dept, total: d.total, pass: d.pass })) };
  }

  /** 입력에 있는 숫자 모음 (+ 회차 번호) */
  function allowedNumbers(input) {
    const set = new Set();
    const walk = (v) => { if (typeof v === "number") set.add(v); else if (typeof v === "string") (v.match(/\d+/g) || []).forEach((x) => set.add(Number(x))); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
    walk(input);
    (input.perSession || []).forEach((_, i) => set.add(i + 1));
    return set;
  }
  /** 문장 속 숫자가 모두 입력에 있는지. 없는 숫자를 돌려준다 */
  function strayNumbers(text, allowed) {
    return (String(text).match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => !allowed.has(n));
  }

  /** Claude 응답 검사 → 쓸 수 없으면 null (형식이 틀리거나, 입력에 없는 숫자가 있거나) */
  function normalizeReport(d, input) {
    if (!d || typeof d !== "object" || !Array.isArray(d.lines)) return null;
    const lines = d.lines.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 200));
    if (lines.length < 2) return null;
    const allowed = allowedNumbers(input);
    const followups = (Array.isArray(d.followups) ? d.followups : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 3);
    if ([...lines, ...followups].some((t) => strayNumbers(t, allowed).length)) return null;
    return { lines: lines.slice(0, 3), followups };
  }

  /* ---------- 내보내기 ---------- */
  /** 사번 가리기: 앞 2자 + * + 끝 1자 */
  function maskId(id) { const s = String(id || ""); return s.length <= 3 ? "***" : s.slice(0, 2) + "*".repeat(s.length - 3) + s.slice(-1); }
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCsv(m) {
    const head = ["부서", "이름", "사번(가림)", ...Array.from({ length: m.sessions }, (_, i) => `${i + 1}회`), "출석률", "이수", "확인 사항"];
    const mark = { O: "출석", L: "지각", "": "결석" };
    const body = m.roster.map((p) => [p.dept, p.name, maskId(p.id), ...p.marks.map((x) => mark[x]), `${p.rate}%`, p.pass ? "이수" : "미이수", p.flags.join(" / ")]);
    return "﻿" + [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  /** 미이수 예정자 안내 문구 (사람마다) */
  function notice(course, p, sessions, passRate) {
    const need = Math.max(0, Math.ceil((passRate / 100) * sessions) - p.count);
    return `${p.name}님, ${course} 출석이 ${sessions}회 중 ${p.count}회로 이수 기준(${passRate}%)에 ${need}회 모자랍니다. 보충 회차 참석 여부를 회신 부탁드립니다.`;
  }

  return { normId, isId, rows, parseApplicants, parseAttendance, toMin, homonyms, merge, countByName, stats, ruleReport, aiInput, allowedNumbers, strayNumbers, normalizeReport, maskId, toCsv, notice };
});
