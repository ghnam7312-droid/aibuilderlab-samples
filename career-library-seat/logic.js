/* 빈자리 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Binjari, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름
 *   1) 좌석 시스템 기록: 날짜 · 구역 · 시각마다 '앉아 있던 좌석 수'. 시스템이 멈춘 시간은 빈칸(null).
 *   2) 구역 × 시각 평균 이용률. 빈칸은 0이 아니라 '모름'이므로 빼고 평균을 낸다(meanOf).
 *      예전 방식(빈칸 = 0)도 같이 계산해 차이를 보여 준다.
 *   3) 이용률 90% 이상이 이어지는 시간을 '혼잡 시간대'로 묶어 상위 3개.
 *   4) 보고서: '이 데이터로는 모르는 것'을 먼저, 그다음 결론과 재배치 제안.
 *      문장은 Claude(libseat.report)가 쓰고, 입력에 없는 숫자가 나오면 버린다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Binjari = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const HOURS = Array.from({ length: 16 }, (_, i) => i + 8); // 8시 ~ 23시
  const ZONES = [
    { id: "A", name: "1층 열람실 A", seats: 180 },
    { id: "B", name: "2층 열람실 B", seats: 220 },
    { id: "N", name: "노트북 존", seats: 80 },
    { id: "G", name: "그룹 스터디룸", seats: 48 },
    { id: "W", name: "3층 창가석", seats: 60 },
  ];
  const PERIODS = {
    exam: { label: "시험 기간", range: "6/8–6/19 평일 10일", days: ["06-08", "06-09", "06-10", "06-11", "06-12", "06-15", "06-16", "06-17", "06-18", "06-19"] },
    normal: { label: "평소", range: "5/11–5/22 평일 10일", days: ["05-11", "05-12", "05-13", "05-14", "05-15", "05-18", "05-19", "05-20", "05-21", "05-22"] },
  };
  const PEAK = 0.9;

  /* ---------- 샘플 기록 (가상의 대학 도서관) ---------- */
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
  // 구역별 시각 곡선: [시작, 끝, 이용률] 구간을 겹쳐 그린다 (뒤에 오는 구간이 우선)
  const CURVES = {
    exam: {
      A: [[8, 9, 0.45], [10, 12, 0.8], [13, 17, 0.97], [18, 20, 0.82], [21, 23, 0.5]],
      B: [[8, 9, 0.5], [10, 12, 0.95], [13, 18, 0.84], [19, 21, 0.72], [22, 23, 0.4]],
      N: [[8, 12, 0.5], [13, 18, 0.74], [19, 22, 0.97], [23, 23, 0.7]],
      G: [[8, 12, 0.35], [13, 20, 0.62], [21, 23, 0.3]],
      W: [[8, 12, 0.3], [13, 19, 0.52], [20, 23, 0.25]],
    },
    normal: {
      A: [[8, 9, 0.2], [10, 17, 0.55], [18, 20, 0.45], [21, 23, 0.2]],
      B: [[8, 9, 0.2], [10, 12, 0.6], [13, 18, 0.5], [19, 23, 0.3]],
      N: [[8, 12, 0.3], [13, 18, 0.5], [19, 22, 0.7], [23, 23, 0.4]],
      G: [[8, 12, 0.3], [13, 20, 0.66], [21, 23, 0.25]],
      W: [[8, 12, 0.2], [13, 19, 0.35], [20, 23, 0.15]],
    },
  };
  // 좌석 시스템이 멈춰 기록이 비어 있는 시간 [기간, 구역, 날짜 순번, 시작, 끝]
  const OUTAGES = [["exam", "B", 2, 10, 13], ["exam", "A", 5, 14, 15], ["exam", "N", 7, 20, 21], ["normal", "A", 3, 9, 11]];

  function curveAt(list, h) { let v = 0; list.forEach(([s, e, r]) => { if (h >= s && h <= e) v = r; }); return v; }
  /** → [{ day, zone, hour, used(null=기록 없음) }] */
  function sampleLog(period, seed = 2026) {
    const r = rng(seed + (period === "exam" ? 1 : 2));
    const out = [];
    PERIODS[period].days.forEach((day, di) => {
      ZONES.forEach((z) => {
        HOURS.forEach((h) => {
          const base = curveAt(CURVES[period][z.id], h);
          const rate = Math.min(1, Math.max(0, base + (r() - 0.5) * 0.08));
          const off = OUTAGES.some(([p, zid, d, s, e]) => p === period && zid === z.id && d === di && h >= s && h <= e);
          out.push({ day, zone: z.id, hour: h, used: off ? null : Math.round(rate * z.seats) });
        });
      });
    });
    return out;
  }

  /* ---------- 평균 ---------- */
  /** 빈칸(null)은 빼고 평균. 모두 빈칸이면 null */
  function meanOf(values, zeroForMissing = false) {
    const v = zeroForMissing ? values.map((x) => (x == null ? 0 : x)) : values.filter((x) => x != null && !Number.isNaN(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  }
  const pct = (x) => (x == null ? null : Math.round(x * 100));

  /** 구역 × 시각 평균 이용률 → { cells: {A: {8: {rate, n, missing}}}, missingHours } */
  function matrix(log, opt = {}) {
    const zero = !!opt.zeroForMissing;
    const cells = {};
    let missingHours = 0;
    ZONES.forEach((z) => {
      cells[z.id] = {};
      HOURS.forEach((h) => {
        const recs = log.filter((x) => x.zone === z.id && x.hour === h);
        const vals = recs.map((x) => (x.used == null ? null : x.used / z.seats));
        const missing = vals.filter((x) => x == null).length;
        missingHours += missing;
        const m = meanOf(vals, zero);
        cells[z.id][h] = { rate: m == null ? null : Math.round(m * 1000) / 1000, n: vals.length - missing, missing };
      });
    });
    return { cells, missingHours };
  }

  /** 이용률 PEAK 이상이 이어지는 시간 묶음 → 평균이 높은 순 상위 n개 */
  function findPeaks(mx, n = 3, threshold = PEAK) {
    const wins = [];
    ZONES.forEach((z) => {
      let cur = null;
      HOURS.forEach((h) => {
        const c = mx.cells[z.id][h];
        if (c.rate != null && c.rate >= threshold) {
          if (!cur) cur = { zone: z.id, zoneName: z.name, from: h, to: h, rates: [] };
          cur.to = h; cur.rates.push(c.rate);
        } else if (cur) { wins.push(cur); cur = null; }
      });
      if (cur) wins.push(cur);
    });
    return wins
      .map((w) => ({ zone: w.zone, zoneName: w.zoneName, from: w.from, to: w.to + 1, hours: w.rates.length, avgPct: pct(meanOf(w.rates)) }))
      .sort((a, b) => b.avgPct - a.avgPct || b.hours - a.hours)
      .slice(0, n);
  }

  /** 구역별 하루 평균, 전체 평균, 가장 붐빈 칸 */
  function summary(mx) {
    const zones = ZONES.map((z) => {
      const rates = HOURS.map((h) => mx.cells[z.id][h].rate);
      return { zone: z.id, zoneName: z.name, seats: z.seats, avgPct: pct(meanOf(rates)), maxPct: pct(Math.max(...rates.filter((x) => x != null))) };
    });
    let top = null;
    ZONES.forEach((z) => HOURS.forEach((h) => { const r = mx.cells[z.id][h].rate; if (r != null && (!top || r > top.rate)) top = { zone: z.id, zoneName: z.name, hour: h, rate: r }; }));
    const seatTotal = ZONES.reduce((s, z) => s + z.seats, 0);
    // 전체 평균: 좌석 수로 가중
    const overall = meanOf(HOURS.map((h) => {
      const parts = ZONES.map((z) => (mx.cells[z.id][h].rate == null ? null : mx.cells[z.id][h].rate * z.seats));
      return parts.includes(null) ? null : parts.reduce((s, x) => s + x, 0) / seatTotal;
    }));
    return { zones, top: top && { ...top, pct: pct(top.rate) }, overallPct: pct(overall), seatTotal };
  }

  /* ---------- 보고서 (규칙) ---------- */
  function aiInput(period, mx, opt = {}) {
    const s = summary(mx);
    return {
      period: PERIODS[period].label, range: PERIODS[period].range, threshold: Math.round(PEAK * 100),
      missingHours: mx.missingHours, missingRule: opt.zeroForMissing ? "결측을 0으로 계산" : "결측은 빼고 평균",
      overallPct: s.overallPct,
      zones: s.zones.map((z) => ({ zone: z.zoneName, seats: z.seats, avgPct: z.avgPct, maxPct: z.maxPct })),
      peaks: findPeaks(mx).map((p) => ({ zone: p.zoneName, from: p.from, to: p.to, avgPct: p.avgPct })),
    };
  }
  function ruleReport(input) {
    const zs = [...input.zones].sort((a, b) => a.avgPct - b.avgPct);
    const low = zs[0], high = zs[zs.length - 1];
    const unknowns = [
      `좌석 시스템이 멈춘 ${input.missingHours}시간은 기록이 없어 평균에서 뺐어요. 그 시간이 실제로 붐볐는지는 몰라요.`,
      "자리에 가방만 두고 비운 좌석도 ‘이용 중’으로 잡혀요. 실제로 앉아 있던 사람 수와는 달라요.",
      "자리가 없어 돌아간 학생 수는 기록되지 않아서, 모자란 좌석 수를 정확히 말할 수는 없어요.",
    ];
    if (input.missingRule === "결측을 0으로 계산") unknowns[0] = `지금은 기록이 없는 ${input.missingHours}시간을 0으로 계산하고 있어서 평균이 낮게 나와요.`;
    const findings = input.peaks.length
      ? input.peaks.map((p) => `${p.zone} ${p.from}–${p.to}시: 평균 이용률 ${p.avgPct}%`)
      : [`${input.period}에는 이용률 ${input.threshold}%를 넘는 시간대가 없어요. 가장 붐빈 구역은 ${high.zone}(최고 ${high.maxPct}%)이에요.`];
    const proposal = input.peaks.length
      ? `${input.period} 동안 ${low.zone}(평균 ${low.avgPct}%) 일부를 ${input.peaks[0].zone}처럼 붐비는 구역의 개인석으로 돌리고, ${input.peaks[0].from}–${input.peaks[0].to}시에는 빈 좌석 안내를 먼저 띄우는 것을 제안해요.`
      : `${input.period}에는 재배치가 급하지 않아요. 시험 기간 기록과 비교해 보세요.`;
    return { headline: input.peaks.length ? `${input.period} 혼잡 시간대 ${input.peaks.length}개` : `${input.period}: 혼잡 시간대 없음`, unknowns, findings, proposal };
  }

  /* ---------- Claude 응답 검사 ---------- */
  function numbersIn(text) {
    return (String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).map((s) => Number(s.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
  }
  function allowedNumbers(input) {
    const set = new Set();
    (function walk(v) {
      if (typeof v === "number") { set.add(v); set.add(Math.round(v)); }
      else if (typeof v === "string") numbersIn(v).forEach((n) => set.add(n));
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    })(input);
    for (let i = 0; i <= 10; i++) set.add(i);
    return set;
  }
  /** → { ok, report, reason } */
  function normalizeReport(d, input) {
    if (!d || typeof d !== "object") return { ok: false, reason: "응답 형식이 맞지 않음" };
    const s = (x, n) => (typeof x === "string" ? x.trim().slice(0, n) : "");
    const arr = (a, n) => (Array.isArray(a) ? a : []).map((x) => s(x, 200)).filter(Boolean).slice(0, n);
    const report = { headline: s(d.headline, 80), unknowns: arr(d.unknowns, 4), findings: arr(d.findings, 4), proposal: s(d.proposal, 300) };
    if (!report.headline || !report.unknowns.length || !report.findings.length || !report.proposal) return { ok: false, reason: "응답 형식이 맞지 않음" };
    const allowed = allowedNumbers(input);
    const bad = numbersIn([report.headline, ...report.unknowns, ...report.findings, report.proposal].join(" ")).filter((n) => !allowed.has(n));
    if (bad.length) return { ok: false, reason: `숫자 검산 실패 (${bad.slice(0, 3).join(", ")})` };
    return { ok: true, report };
  }

  /* ---------- 내보내기 ---------- */
  function toCsv(period, mx) {
    const head = ["기간", "구역", "좌석", ...HOURS.map((h) => `${h}시`)];
    const body = ZONES.map((z) => [PERIODS[period].label, z.name, z.seats, ...HOURS.map((h) => { const c = mx.cells[z.id][h]; return c.rate == null ? "" : pct(c.rate); })]);
    return "﻿" + [head, ...body].map((r) => r.join(",")).join("\r\n");
  }

  return { HOURS, ZONES, PERIODS, PEAK, OUTAGES, rng, sampleLog, meanOf, pct, matrix, findPeaks, summary, aiInput, ruleReport, numbersIn, allowedNumbers, normalizeReport, toCsv };
});
