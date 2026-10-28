/* 자리판 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Jaripan, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름
 *   1) 공공데이터 원본 행(분기 · 구 · 행정동 · 업종 · 점포 수 · 개업 · 폐업 · 월평균 매출)을 받는다.
 *   2) 행정동 이름을 '지금 이름'으로 맞춘다. 2026년 2분기에 이름이 바뀐 동이 있어서,
 *      1분기 행은 옛 이름으로 들어온다. 대응표(RENAMES)가 없으면 그 행이 통째로 빠진다.
 *   3) 업종 하나 · 구 여러 개로 동별 집계 → 경쟁(유동인구 1만 명당 점포) · 폐업률 · 매출로 참고 점수.
 *   4) 표본 10건을 원본에서 직접 다시 세어 집계와 맞는지 검산한다.
 *   5) 요약은 Claude(district.brief)가 쓰고, 문장 속 숫자가 입력에 없는 숫자면 버린다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Jaripan = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 기준 데이터 (가상의 구·동) ---------- */
  const GUS = ["한빛구", "새솔구", "누리구"];
  // traffic: 일평균 유동인구(명)
  const DONGS = [
    { gu: "한빛구", dong: "한빛1동", traffic: 42000 }, { gu: "한빛구", dong: "한빛2동", traffic: 31000 },
    { gu: "한빛구", dong: "강변동", traffic: 18000 }, { gu: "한빛구", dong: "꽃내동", traffic: 24000 },
    { gu: "한빛구", dong: "별마루동", traffic: 36000 }, { gu: "한빛구", dong: "은행골동", traffic: 15000 },
    { gu: "새솔구", dong: "새솔1동", traffic: 28000 }, { gu: "새솔구", dong: "햇살동", traffic: 47000 },
    { gu: "새솔구", dong: "솔밭동", traffic: 33000 }, { gu: "새솔구", dong: "다온동", traffic: 21000 },
    { gu: "새솔구", dong: "시장동", traffic: 52000 }, { gu: "새솔구", dong: "새솔3동", traffic: 17000 },
    { gu: "누리구", dong: "누리동", traffic: 39000 }, { gu: "누리구", dong: "푸른들동", traffic: 26000 },
    { gu: "누리구", dong: "학당동", traffic: 44000 }, { gu: "누리구", dong: "너울동", traffic: 14000 },
    { gu: "누리구", dong: "미르동", traffic: 22000 }, { gu: "누리구", dong: "가람동", traffic: 29000 },
  ];
  /** 옛 이름 → 지금 이름 (2026년 2분기부터). 솔밭1·2동은 솔밭동 하나로 합쳐졌다 */
  const RENAMES = { "한빛3동": "별마루동", "새솔2동": "햇살동", "솔밭1동": "솔밭동", "솔밭2동": "솔밭동", "누리1동": "누리동", "누리2동": "푸른들동" };
  // 아직 대응표에 없는 옛 이름 (화면에서 직접 이어 붙이는 예시)
  const MISSING_IN_TABLE = { "가람2동": "가람동" };
  // [업종, 유동인구 1만 명당 평균 점포, 점포당 월평균 매출(만원)]
  const BIZ = [
    ["커피전문점", 6.2, 1650], ["한식음식점", 9.5, 2900], ["분식", 3.1, 1500], ["치킨", 3.6, 1900], ["제과점", 1.6, 2300],
    ["편의점", 4.4, 4100], ["미용실", 4.8, 1150], ["네일숍", 1.9, 780], ["세탁소", 1.4, 620], ["입시학원", 3.3, 2600],
    ["문구점", 0.8, 900], ["꽃집", 0.9, 850], ["반찬가게", 1.3, 1350], ["정육점", 1.1, 2700], ["과일·채소", 1.2, 1800],
    ["헬스장", 1.0, 2100], ["스터디카페", 1.5, 1250], ["코인노래방", 0.7, 1100], ["약국", 1.7, 5200], ["안경점", 0.9, 1700],
  ];
  const BIZ_NAMES = BIZ.map((b) => b[0]);
  const OLD_NAME = { "별마루동": ["한빛3동"], "햇살동": ["새솔2동"], "솔밭동": ["솔밭1동", "솔밭2동"], "누리동": ["누리1동"], "푸른들동": ["누리2동"], "가람동": ["가람2동"] };

  /** 같은 씨앗이면 같은 수열 (샘플 데이터가 열 때마다 바뀌지 않게) */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 공공데이터 원본처럼 생긴 샘플 행. 1분기는 옛 이름, 2분기는 지금 이름 */
  function sampleRows(seed = 20261) {
    const r = rng(seed);
    const rows = [];
    DONGS.forEach((d) => {
      const local = 0.75 + r() * 0.5; // 동마다 상권 성격
      BIZ.forEach(([biz, dens, sales]) => {
        const q2 = Math.max(0, Math.round(dens * d.traffic / 10000 * local * (0.6 + r() * 0.8)));
        const op2 = Math.round(q2 * (0.03 + r() * 0.09));
        const cl2 = Math.round(q2 * (0.02 + r() * 0.08));
        const q1 = Math.max(0, q2 - op2 + cl2);
        const op1 = Math.round(q1 * (0.03 + r() * 0.08));
        const cl1 = Math.round(q1 * (0.02 + r() * 0.08));
        const s2 = Math.round(sales * (0.7 + r() * 0.6));
        const s1 = Math.round(s2 * (0.94 + r() * 0.1));
        rows.push({ q: "2026Q2", gu: d.gu, dong: d.dong, biz, stores: q2, opened: op2, closed: cl2, sales: s2 });
        const olds = OLD_NAME[d.dong] || [d.dong];
        if (olds.length === 1) rows.push({ q: "2026Q1", gu: d.gu, dong: olds[0], biz, stores: q1, opened: op1, closed: cl1, sales: s1 });
        else {
          // 합쳐지기 전 두 동으로 나눠 들어온다 (합은 같다)
          const a = Math.round(q1 * 0.55), oa = Math.round(op1 * 0.55), ca = Math.round(cl1 * 0.55);
          rows.push({ q: "2026Q1", gu: d.gu, dong: olds[0], biz, stores: a, opened: oa, closed: ca, sales: s1 });
          rows.push({ q: "2026Q1", gu: d.gu, dong: olds[1], biz, stores: q1 - a, opened: op1 - oa, closed: cl1 - ca, sales: s1 });
        }
      });
    });
    return rows;
  }

  /* ---------- 이름 맞추기 ---------- */
  const CURRENT = new Set(DONGS.map((d) => d.dong));
  /** 원본 이름 → 지금 이름. 못 찾으면 "" */
  function resolveDong(name, map) {
    const n = String(name || "").replace(/\s+/g, "");
    if (CURRENT.has(n)) return n;
    if (map && map[n] && CURRENT.has(map[n])) return map[n];
    return "";
  }

  /* ---------- 집계 ---------- */
  const emptyQ = () => ({ stores: 0, opened: 0, closed: 0, salesSum: 0 });
  /** opt: { biz, gus: [구...], map: 대응표(없으면 이름 그대로만) } */
  function aggregate(rows, opt) {
    const gus = opt.gus && opt.gus.length ? opt.gus : GUS;
    const by = new Map();
    DONGS.filter((d) => gus.includes(d.gu)).forEach((d) => by.set(d.dong, { ...d, Q1: emptyQ(), Q2: emptyQ() }));
    const unmatched = new Map();
    let used = 0;
    rows.forEach((row) => {
      if (!gus.includes(row.gu)) return;
      const name = resolveDong(row.dong, opt.map);
      // 빠진 행은 업종과 상관없이 센다 (원본 파일에서 몇 행이 날아갔는지)
      if (!name) { unmatched.set(row.dong, (unmatched.get(row.dong) || 0) + 1); return; }
      if (row.biz !== opt.biz) return;
      const t = by.get(name);
      if (!t) return;
      const q = row.q === "2026Q1" ? t.Q1 : t.Q2;
      q.stores += row.stores; q.opened += row.opened; q.closed += row.closed; q.salesSum += row.sales * row.stores;
      used++;
    });
    const list = [...by.values()].map((t) => {
      const fin = (q) => ({ stores: q.stores, opened: q.opened, closed: q.closed, sales: q.stores ? Math.round(q.salesSum / q.stores) : 0 });
      const Q1 = fin(t.Q1), Q2 = fin(t.Q2);
      return {
        gu: t.gu, dong: t.dong, traffic: t.traffic, Q1, Q2,
        change: Q2.stores - Q1.stores,
        changePct: Q1.stores ? round1((Q2.stores - Q1.stores) / Q1.stores * 100) : null,
        closeRate: Q2.stores ? round1(Q2.closed / Q2.stores * 100) : 0,
        density: round1(Q2.stores / (t.traffic / 10000)),
      };
    });
    score(list);
    return { biz: opt.biz, gus, dongs: list, unmatched: [...unmatched].map(([name, n]) => ({ name, rows: n })), used };
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  /** 참고 점수 0~100: 경쟁 적음 40 · 폐업률 낮음 30 · 매출 높음 30 (고른 동끼리 비교) */
  function score(list) {
    const norm = (k) => {
      const v = list.map(k);
      const lo = Math.min(...v), hi = Math.max(...v);
      return (x) => (hi === lo ? 0.5 : (k(x) - lo) / (hi - lo));
    };
    const dN = norm((x) => x.density), cN = norm((x) => x.closeRate), sN = norm((x) => x.Q2.sales);
    list.forEach((x) => { x.score = list.length ? Math.round(100 * (0.4 * (1 - dN(x)) + 0.3 * (1 - cN(x)) + 0.3 * sN(x))) : 0; });
    return list;
  }

  const SORTS = {
    score: (a, b) => b.score - a.score,
    stores: (a, b) => b.Q2.stores - a.Q2.stores,
    density: (a, b) => a.density - b.density,
    closeRate: (a, b) => a.closeRate - b.closeRate,
    sales: (a, b) => b.Q2.sales - a.Q2.sales,
    change: (a, b) => b.change - a.change,
  };
  function sortDongs(list, key) { return [...list].sort((a, b) => (SORTS[key] || SORTS.score)(a, b) || a.dong.localeCompare(b.dong, "ko")); }

  /* ---------- 표본 검산 ---------- */
  /** 원본에서 직접 세기 (집계 함수와 다른 길: 동 이름 목록을 펼쳐 놓고 하나씩 비교) */
  function countDirect(rows, biz, dong, q, fullMap) {
    const names = [dong, ...Object.keys(fullMap).filter((k) => fullMap[k] === dong)];
    let n = 0;
    for (const row of rows) if (row.biz === biz && row.q === q && names.includes(row.dong)) n += row.stores;
    return n;
  }
  /** 동 n개를 골라 1·2분기 점포 수를 원본에서 다시 센다. fullMap은 '알려진 모든 옛 이름' */
  function verifySample(rows, agg, fullMap, n = 10, seed = 1) {
    const r = rng(seed);
    const pool = [...agg.dongs];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, n).map((d) => {
      const e1 = countDirect(rows, agg.biz, d.dong, "2026Q1", fullMap), e2 = countDirect(rows, agg.biz, d.dong, "2026Q2", fullMap);
      return { gu: d.gu, dong: d.dong, expected: [e1, e2], got: [d.Q1.stores, d.Q2.stores], ok: e1 === d.Q1.stores && e2 === d.Q2.stores };
    });
  }

  /* ---------- 요약 (규칙) ---------- */
  const fmt = (n) => Number(n).toLocaleString("ko-KR");
  function aiInput(agg) {
    const top = sortDongs(agg.dongs, "score"); // 동은 최대 18곳이라 모두 보낸다
    return {
      biz: agg.biz, gus: agg.gus, quarter: "2026년 2분기 (1분기 대비)", dongCount: agg.dongs.length,
      totalStores: agg.dongs.reduce((s, d) => s + d.Q2.stores, 0),
      totalChange: agg.dongs.reduce((s, d) => s + d.change, 0),
      dongs: top.map((d) => ({ dong: d.dong, gu: d.gu, stores: d.Q2.stores, change: d.change, closeRatePct: d.closeRate, storesPer10k: d.density, salesManwon: d.Q2.sales, score: d.score })),
    };
  }
  function ruleBrief(agg) {
    const inp = aiInput(agg);
    if (!agg.dongs.length) return { headline: "고른 구가 없어요", lines: [], caution: "" };
    const best = sortDongs(agg.dongs, "score")[0];
    const crowd = sortDongs(agg.dongs, "density").slice(-1)[0];
    const closeHi = sortDongs(agg.dongs, "closeRate").slice(-1)[0];
    return {
      headline: `${agg.biz}: ${best.dong}(${best.gu})이 참고 점수 ${best.score}점으로 가장 높아요`,
      lines: [
        `${agg.gus.join("·")} ${agg.dongs.length}개 동의 ${agg.biz} 점포는 ${fmt(inp.totalStores)}곳, 1분기보다 ${inp.totalChange >= 0 ? "+" : ""}${fmt(inp.totalChange)}곳이에요.`,
        `${best.dong}은 유동인구 1만 명당 ${best.density}곳으로 경쟁이 덜하고, 폐업률 ${best.closeRate}%예요.`,
        `${crowd.dong}은 1만 명당 ${crowd.density}곳으로 가장 붐비고, 폐업률은 ${closeHi.dong}이 ${closeHi.closeRate}%로 가장 높아요.`,
      ],
      caution: "점수는 고른 동끼리의 상대 비교예요. 임대료·유동인구 시간대는 이 데이터에 없어서 현장 확인이 필요해요.",
    };
  }

  /* ---------- Claude 응답 검사 ---------- */
  /** 문장 속 숫자 (쉼표·% 떼고) */
  function numbersIn(text) {
    return (String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).map((s) => Number(s.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
  }
  /** 입력에 들어 있는 숫자 모두 (문자열 속 숫자 포함, 반올림한 값 포함) */
  function allowedNumbers(input) {
    const set = new Set();
    const add = (n) => { set.add(n); set.add(Math.round(n)); set.add(round1(n)); set.add(Math.abs(n)); set.add(Math.abs(Math.round(n))); };
    (function walk(v) {
      if (typeof v === "number") add(v);
      else if (typeof v === "string") numbersIn(v).forEach(add);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    })(input);
    for (let i = 0; i <= 10; i++) set.add(i); // '상위 3곳' 같은 작은 수
    return set;
  }
  /** → { ok, brief, reason } */
  function normalizeBrief(d, input) {
    if (!d || typeof d !== "object") return { ok: false, reason: "응답 형식이 맞지 않음" };
    const s = (x, n) => (typeof x === "string" ? x.trim().slice(0, n) : "");
    const lines = (Array.isArray(d.lines) ? d.lines : []).map((x) => s(x, 160)).filter(Boolean).slice(0, 4);
    const brief = { headline: s(d.headline, 80), lines, caution: s(d.caution, 160) };
    if (!brief.headline || lines.length < 2) return { ok: false, reason: "응답 형식이 맞지 않음" };
    const allowed = allowedNumbers(input);
    const bad = numbersIn([brief.headline, ...lines, brief.caution].join(" ")).filter((n) => !allowed.has(n));
    if (bad.length) return { ok: false, reason: `숫자 검산 실패 (${bad.slice(0, 3).join(", ")})` };
    return { ok: true, brief };
  }

  /* ---------- 내보내기 ---------- */
  function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function toCsv(agg, sortKey) {
    const head = ["구", "행정동", "업종", "점포(2분기)", "점포(1분기)", "증감", "개업", "폐업", "폐업률(%)", "유동인구1만명당점포", "점포당월매출(만원)", "참고점수"];
    const body = sortDongs(agg.dongs, sortKey).map((d) => [d.gu, d.dong, agg.biz, d.Q2.stores, d.Q1.stores, d.change, d.Q2.opened, d.Q2.closed, d.closeRate, d.density, d.Q2.sales, d.score]);
    return "﻿" + [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
  }

  return { GUS, DONGS, RENAMES, MISSING_IN_TABLE, BIZ, BIZ_NAMES, rng, sampleRows, resolveDong, aggregate, score, sortDongs, countDirect, verifySample, aiInput, ruleBrief, numbersIn, allowedNumbers, normalizeBrief, csvCell, toCsv, fmt };
});
