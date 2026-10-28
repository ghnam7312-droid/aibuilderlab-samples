/* 분기판 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Bungipan, Node(테스트)에서는 require('./logic.js').
 *
 * 거래 목록 → 양식 점검(빠진 칸·분기 밖 날짜·중복) → 분기 숫자 → 같은 양식의 리포트
 *   요약 문장은 규칙이 먼저 쓰고, Claude 문장이 오면 덮어쓴다.
 *   단, Claude 문장 속 숫자가 계산한 숫자와 하나라도 다르면 버린다 (checkNumbers).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Bungipan = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STAGES = ["수주", "실주", "진행"];

  /* ---------- 날짜 · 분기 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;
  /** "2026-08-14" → "2026-Q3" */
  function quarterOf(s) { const [y, m] = s.split("-").map(Number); return `${y}-Q${Math.floor((m - 1) / 3) + 1}`; }
  function quarterRange(key) {
    const [y, q] = key.split("-Q").map(Number);
    const start = new Date(y, (q - 1) * 3, 1), end = new Date(y, q * 3, 0);
    return { start: iso(start), end: iso(end) };
  }
  function shiftQuarter(key, n) {
    const [y, q] = key.split("-Q").map(Number);
    const i = y * 4 + (q - 1) + n;
    return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
  }
  const qLabel = (key) => { const [y, q] = key.split("-Q"); return `${y}년 ${q}분기`; };
  const inQuarter = (s, key) => isIso(s) && quarterOf(s) === key;

  /* ---------- 금액 ---------- */
  /** 3억 2,000만 원 · 4,500만 원 */
  function fmtWon(v) {
    v = Math.round(+v || 0);
    if (v === 0) return "0원";
    const eok = Math.floor(v / 1e8), man = Math.round((v % 1e8) / 1e4);
    return [eok ? `${eok}억` : "", man ? `${man.toLocaleString("ko-KR")}만` : ""].filter(Boolean).join(" ") + " 원";
  }
  /** 사람이 친 금액("3200만", "1.2억", "1억 2천만", "32000000") → 원. 못 읽으면 null */
  function parseWon(s) {
    const t = String(s || "").replace(/\s|원/g, "");
    if (!t) return null;
    if (/^\d{1,3}(,\d{3})+$|^\d+$/.test(t)) return Number(t.replace(/,/g, ""));
    const m = t.match(/^(?:(\d+(?:\.\d+)?)억)?(?:(\d{1,3}(?:,\d{3})*|\d+)(천)?만)?$/);
    if (!m || (!m[1] && !m[2])) return null;
    return Math.round((m[1] ? +m[1] * 1e8 : 0) + (m[2] ? +m[2].replace(/,/g, "") * (m[3] ? 1e7 : 1e4) : 0));
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  /* ---------- 양식 점검 ---------- */
  /** 그 분기 표에 들어가는 행 (행마다 입력한 분기 q 를 가진다) */
  const rowsOf = (rows, key) => rows.filter((r) => r.q === key);
  /** 리포트에 넣기 전에 행을 검사한다 → {ok:[행], issues:[{id, msg}]} (문제 행은 계산에서 뺀다) */
  function validate(rows, key) {
    const issues = [], ok = [], seen = new Map();
    rows.forEach((r) => {
      const p = [];
      if (!String(r.owner || "").trim()) p.push("담당 없음");
      if (!String(r.customer || "").trim()) p.push("고객사 없음");
      if (!STAGES.includes(r.stage)) p.push("단계 없음");
      if (!(typeof r.amount === "number" && r.amount > 0)) p.push("금액 없음");
      if (!isIso(r.date)) p.push("날짜 없음");
      else if (r.stage !== "진행" && !inQuarter(r.date, key)) p.push(`${qLabel(key)} 밖의 날짜`);
      const k = `${String(r.customer).replace(/\s/g, "")}|${r.amount}|${r.date}|${r.stage}`;
      if (!p.length && seen.has(k)) p.push("같은 거래가 두 번 들어감");
      if (p.length) issues.push({ id: r.id, msg: p.join(" · ") });
      else { seen.set(k, r.id); ok.push(r); }
    });
    return { ok, issues };
  }

  /* ---------- 분기 숫자 ---------- */
  /** rows: 이번 분기 검사 통과 행, prevRows: 지난 분기 검사 통과 행 */
  function compute(rows, prevRows, target) {
    const won = rows.filter((r) => r.stage === "수주"), lost = rows.filter((r) => r.stage === "실주"), open = rows.filter((r) => r.stage === "진행");
    const sum = (a) => a.reduce((s, r) => s + r.amount, 0);
    const wonAmt = sum(won), prevWon = sum((prevRows || []).filter((r) => r.stage === "수주"));
    const owners = [...new Set(rows.map((r) => r.owner))];
    const byOwner = owners.map((o) => {
      const w = won.filter((r) => r.owner === o), l = lost.filter((r) => r.owner === o);
      return { owner: o, won: sum(w), count: w.length, winRate: pct(w.length, w.length + l.length) };
    }).sort((a, b) => b.won - a.won);
    return {
      won: wonAmt, wonCount: won.length, lostCount: lost.length,
      winRate: pct(won.length, won.length + lost.length),
      avgDeal: won.length ? Math.round(wonAmt / won.length) : 0,
      target: target || 0, achieve: pct(wonAmt, target),
      prevWon, qoq: prevWon ? Math.round(((wonAmt - prevWon) / prevWon) * 1000) / 10 : 0,
      byOwner, top: won.slice().sort((a, b) => b.amount - a.amount).slice(0, 3),
      pipeline: sum(open), pipelineCount: open.length,
    };
  }

  /* ---------- 요약 (규칙) ---------- */
  function ruleSummary(r, team, key) {
    const best = r.byOwner[0];
    const sign = r.qoq > 0 ? `${r.qoq}% 늘었습니다` : r.qoq < 0 ? `${-r.qoq}% 줄었습니다` : "같습니다";
    return [
      `${team} ${qLabel(key)} 수주액은 ${fmtWon(r.won)}으로 목표 대비 ${r.achieve}%입니다.`,
      r.prevWon ? `지난 분기(${fmtWon(r.prevWon)})보다 ${sign}.` : "지난 분기 수주 기록이 없어 비교하지 않았습니다.",
      `수주 ${r.wonCount}건 · 실주 ${r.lostCount}건으로 승률 ${r.winRate}%${best ? `, ${best.owner}님이 ${fmtWon(best.won)}으로 가장 많이 수주했습니다` : ""}.`,
      `진행 중 ${r.pipelineCount}건(${fmtWon(r.pipeline)})이 다음 분기 실적 후보입니다.`,
    ];
  }

  /* ---------- Claude 응답 검사 ---------- */
  /** 문장 속 숫자 → [{text, value, unit}] ('3억 2,000만 원'은 하나로 읽는다) */
  function numbersIn(text) {
    const out = [];
    const re = /(\d+(?:\.\d+)?)\s*억(?:\s*(\d{1,3}(?:,\d{3})*|\d+)\s*(천)?\s*만)?\s*원?|(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(천)?\s*만\s*원?|(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%p|%|건|명|분기|년|원)?/g;
    let m;
    while ((m = re.exec(String(text || "")))) {
      if (m[1] !== undefined) out.push({ text: m[0].trim(), value: +m[1] * 1e8 + (m[2] ? +m[2].replace(/,/g, "") * (m[3] ? 1e7 : 1e4) : 0), unit: "원" });
      else if (m[4] !== undefined) out.push({ text: m[0].trim(), value: +m[4].replace(/,/g, "") * (m[5] ? 1e7 : 1e4), unit: "원" });
      else out.push({ text: m[0].trim(), value: +m[6].replace(/,/g, ""), unit: m[7] || "" });
    }
    return out;
  }
  /** 리포트에 실제로 있는 숫자들 */
  function facts(r, key) {
    const [y, q] = key.split("-Q").map(Number);
    const won = [r.won, r.prevWon, r.avgDeal, r.pipeline, r.target, Math.abs(r.won - r.prevWon), Math.abs(r.target - r.won)].concat(r.byOwner.map((o) => o.won), r.top.map((t) => t.amount));
    const plain = [r.achieve, r.winRate, Math.abs(r.qoq), r.wonCount, r.lostCount, r.pipelineCount, r.wonCount + r.lostCount, r.byOwner.length, y, q, y - 1, q === 1 ? 4 : q - 1, q === 4 ? 1 : q + 1].concat(r.byOwner.map((o) => o.count), r.byOwner.map((o) => o.winRate));
    return { won, plain };
  }
  /** 숫자가 하나라도 계산 결과와 다르면 bad 에 담는다 (금액은 반올림 표기 1% 허용, 나머지는 0.1 허용) */
  function checkNumbers(lines, r, key, ignore) {
    const f = facts(r, key);
    const bad = [];
    // 팀 이름('영업1팀') 같은 고유명사 속 숫자는 검사하지 않는다
    const strip = (l) => (ignore || []).reduce((s, w) => (w ? s.split(w).join(" ") : s), l);
    lines.map(strip).forEach((l) => numbersIn(l).forEach((n) => {
      const ok = n.unit === "원"
        ? f.won.some((v) => v && Math.abs(v - n.value) <= Math.max(v * 0.01, 1e4))
        : f.plain.some((v) => Math.abs(v - n.value) <= 0.1) || f.won.some((v) => v && Math.abs(v - n.value) <= Math.max(v * 0.01, 1e4));
      if (!ok) bad.push(n.text);
    }));
    return { ok: !bad.length, bad };
  }
  function normalizeSummary(d) {
    if (!d || typeof d !== "object" || !Array.isArray(d.lines)) return null;
    const lines = d.lines.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, 5);
    return lines.length >= 3 ? { lines } : null;
  }

  /* ---------- 공유 ---------- */
  function toMarkdown(r, team, key, lines) {
    return [
      `## ${team} ${qLabel(key)} 영업 리포트`,
      "",
      "| 항목 | 값 |", "|---|---|",
      `| 수주액 | ${fmtWon(r.won)} |`, `| 목표 대비 | ${r.achieve}% (목표 ${fmtWon(r.target)}) |`,
      `| 지난 분기 대비 | ${r.qoq > 0 ? "+" : ""}${r.qoq}% |`, `| 수주 · 실주 | ${r.wonCount}건 · ${r.lostCount}건 (승률 ${r.winRate}%) |`,
      `| 평균 수주 금액 | ${fmtWon(r.avgDeal)} |`, `| 진행 중 | ${r.pipelineCount}건 · ${fmtWon(r.pipeline)} |`,
      "", "### 요약", ...lines.map((l) => `- ${l}`),
      "", "### 담당별", "| 담당 | 수주액 | 건수 | 승률 |", "|---|---|---|---|",
      ...r.byOwner.map((o) => `| ${o.owner} | ${fmtWon(o.won)} | ${o.count} | ${o.winRate}% |`),
    ].join("\n");
  }

  /* ---------- 샘플 데이터 (팀마다 같은 값이 나오게 씨앗 고정) ---------- */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function sampleDeals(seed, owners, customers, key) {
    const r = rng(seed), rows = [];
    const pick = (a) => a[Math.floor(r() * a.length)];
    [shiftQuarter(key, -1), key].forEach((qk, qi) => {
      const { start } = quarterRange(qk);
      const n = 9 + Math.floor(r() * 4) + qi;
      for (let i = 0; i < n; i++) {
        const stage = r() < 0.68 ? "수주" : "실주";
        const day = Math.floor(r() * 88);
        const dt = d0(start); dt.setDate(dt.getDate() + day);
        rows.push({ id: `${seed}-${qi}-${i}`, q: qk, owner: pick(owners), customer: pick(customers), stage, amount: (12 + Math.floor(r() * 80)) * 1e6, date: iso(dt) });
      }
    });
    const next = quarterRange(shiftQuarter(key, 1)).start;
    for (let i = 0; i < 4; i++) {
      const dt = d0(next); dt.setDate(dt.getDate() + Math.floor(r() * 80));
      rows.push({ id: `${seed}-p-${i}`, q: key, owner: pick(owners), customer: pick(customers), stage: "진행", amount: (10 + Math.floor(r() * 60)) * 1e6, date: iso(dt) });
    }
    return rows;
  }

  return { STAGES, rowsOf, d0, iso, isIso, quarterOf, quarterRange, shiftQuarter, qLabel, inQuarter, fmtWon, parseWon, pct, validate, compute, ruleSummary, numbersIn, facts, checkNumbers, normalizeSummary, toMarkdown, rng, sampleDeals };
});
