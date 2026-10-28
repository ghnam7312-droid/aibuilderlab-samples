/* 광고한장 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Gwanggo, Node(테스트)에서는 require('./logic.js').
 *
 * 핵심: 채널마다 '전환'으로 세는 사건이 다르다.
 *   찾다 검색광고는 장바구니 담기까지, 모아 SNS광고는 '본 뒤 7일 안 구매'까지, 보다 동영상광고는 회원가입까지 전환으로 센다.
 *   그대로 더하면 합계가 부풀어 오른다. 그래서 먼저 '리포트 기준'(기본: 클릭 후 구매만)을 정하고,
 *   채널마다 그 기준에 해당하는 사건만 다시 세어서 더한다. 자료가 없어 기준을 맞출 수 없는 칸은 경고로 남긴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gwanggo = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /** 전환으로 셀 수 있는 사건 */
  const EVENTS = [
    { id: "purchase", label: "구매", hint: "광고 클릭 후 7일 안 구매" },
    { id: "cart", label: "장바구니", hint: "장바구니 담기" },
    { id: "signup", label: "회원가입", hint: "회원가입 완료" },
    { id: "view", label: "본 뒤 구매", hint: "클릭 없이 광고를 본 뒤 7일 안 구매" },
  ];
  /** 채널 4곳: reports = 그 채널이 자기 보고서의 '전환' 칸에 더해 넣는 사건 (= 내려받은 파일에 들어 있는 사건) */
  const CHANNELS = [
    { id: "search", name: "찾다 검색광고", short: "검색", reports: ["purchase", "cart"] },
    { id: "social", name: "모아 SNS광고", short: "SNS", reports: ["purchase", "view"] },
    { id: "video", name: "보다 동영상광고", short: "동영상", reports: ["purchase", "signup"] },
    { id: "shop", name: "쇼핑픽 쇼핑광고", short: "쇼핑", reports: ["purchase"] },
  ];
  const DEFAULT_STD = ["purchase"];
  const FIELDS = ["imp", "click", "cost", "purchase", "cart", "signup", "view", "revenue"];

  /* ---------- 숫자 ---------- */
  const comma = (n) => Math.round(n).toLocaleString("ko-KR");
  const won = (n) => `${comma(n)}원`;
  /** 1만 원 이상은 '248만 원' 처럼 */
  const man = (n) => (Math.abs(n) >= 10000 ? `${comma(n / 10000)}만 원` : won(n));
  const pct1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "–");
  const ratio = (a, b) => (b > 0 ? a / b : NaN);
  /** 증감률(%) — 지난주가 0이면 NaN */
  const change = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : NaN);

  /* ---------- 원본 검사 ---------- */
  /** 한 채널 한 주의 원본 숫자를 검사 → 오류 문장 목록 */
  function validateRow(row, ch) {
    const errs = [];
    const need = ["imp", "click", "cost", "revenue", ...ch.reports];
    need.forEach((k) => {
      const v = row[k];
      if (typeof v !== "number" || !Number.isFinite(v)) errs.push(`${label(k)} 칸이 비었거나 숫자가 아닙니다`);
      else if (v < 0) errs.push(`${label(k)}는 0보다 작을 수 없습니다`);
      else if (k !== "cost" && k !== "revenue" && !Number.isInteger(v)) errs.push(`${label(k)}는 정수여야 합니다`);
    });
    if (errs.length) return errs;
    if (row.click > row.imp) errs.push("클릭이 노출보다 많습니다");
    if (row.purchase > row.click) errs.push("클릭 후 구매가 클릭보다 많습니다");
    return errs;
  }
  function label(k) {
    const e = EVENTS.find((x) => x.id === k);
    return e ? e.label : { imp: "노출", click: "클릭", cost: "광고비", revenue: "구매 매출" }[k] || k;
  }

  /* ---------- 전환 기준 ---------- */
  /** 채널이 스스로 보고한 전환 = 그 채널이 세는 사건을 모두 더한 값 */
  function reportedConv(row, ch) { return ch.reports.reduce((s, k) => s + (row[k] || 0), 0); }

  /** 리포트 기준으로 다시 센 전환. 그 채널 파일에 없는 사건은 missing 으로 알린다 */
  function stdConv(row, ch, std) {
    let value = 0; const missing = [];
    std.forEach((k) => {
      if (ch.reports.includes(k)) value += row[k] || 0;
      else missing.push(k);
    });
    return { value, missing };
  }

  /** 기준표: 채널 × 사건 → 'both'(채널도 세고 기준에도 있음), 'extra'(채널만 셈 → 빼야 함), 'missing'(기준엔 있는데 자료 없음), 'none' */
  function standardTable(std) {
    return CHANNELS.map((ch) => ({
      id: ch.id, name: ch.name,
      cells: EVENTS.map((e) => {
        const inCh = ch.reports.includes(e.id), inStd = std.includes(e.id);
        return { event: e.id, state: inCh && inStd ? "both" : inCh ? "extra" : inStd ? "missing" : "none" };
      }),
    }));
  }

  /* ---------- 한 주 요약 ---------- */
  function channelStats(row, ch, std) {
    const conv = stdConv(row, ch, std);
    const reported = reportedConv(row, ch);
    return {
      id: ch.id, name: ch.name, short: ch.short,
      imp: row.imp, click: row.click, cost: row.cost, revenue: row.revenue,
      reported, conv: conv.value, missing: conv.missing,
      ctr: ratio(row.click, row.imp) * 100,
      cpa: ratio(row.cost, conv.value),
      roas: ratio(row.revenue, row.cost) * 100,
    };
  }
  /** week = { search: {...}, social: {...}, ... } */
  function summarize(week, std) {
    const rows = CHANNELS.map((ch) => channelStats(week[ch.id] || {}, ch, std));
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const t = { imp: sum("imp"), click: sum("click"), cost: sum("cost"), revenue: sum("revenue"), reported: sum("reported"), conv: sum("conv") };
    t.ctr = ratio(t.click, t.imp) * 100;
    t.cpa = ratio(t.cost, t.conv);
    t.roas = ratio(t.revenue, t.cost) * 100;
    t.gap = t.reported - t.conv;
    return { rows, total: t };
  }

  /** 이번 주 · 지난주 → 리포트 한 장에 필요한 모든 숫자 */
  function buildReport(cur, prev, std, meta) {
    const a = summarize(cur, std), b = summarize(prev, std);
    const rows = a.rows.map((r, i) => ({ ...r, prevConv: b.rows[i].conv, convChange: change(r.conv, b.rows[i].conv) }));
    const errors = [];
    CHANNELS.forEach((ch) => validateRow(cur[ch.id] || {}, ch).forEach((m) => errors.push({ channel: ch.name, msg: m })));
    const warnings = [];
    rows.forEach((r) => r.missing.forEach((k) => warnings.push(`${r.name}는 '${label(k)}' 자료가 없어 기준을 맞출 수 없습니다 (0건으로 셈)`)));
    const valid = rows.filter((r) => Number.isFinite(r.cpa));
    const byCpa = valid.slice().sort((x, y) => x.cpa - y.cpa);
    const byRoas = rows.filter((r) => Number.isFinite(r.roas)).sort((x, y) => y.roas - x.roas);
    return {
      week: meta.week, prevWeek: meta.prevWeek, std: std.slice(),
      rows, total: a.total, prevTotal: b.total,
      delta: {
        cost: change(a.total.cost, b.total.cost),
        conv: change(a.total.conv, b.total.conv),
        cpa: change(a.total.cpa, b.total.cpa),
        roas: a.total.roas - b.total.roas, // %p
      },
      bestCpa: byCpa[0] || null, worstCpa: byCpa[byCpa.length - 1] || null,
      bestRoas: byRoas[0] || null, worstRoas: byRoas[byRoas.length - 1] || null,
      errors, warnings,
    };
  }

  /* ---------- 규칙 요약 (AI를 못 쓸 때) ---------- */
  function updown(n) { return n >= 0 ? "늘었" : "줄었"; }
  function ruleSummary(rep) {
    const t = rep.total, d = rep.delta;
    const lines = [];
    lines.push(`이번 주 광고비는 ${man(t.cost)}, 기준 전환은 ${comma(t.conv)}건으로 지난주보다 ${pct1(Math.abs(d.conv))}% ${updown(d.conv)}습니다.`);
    if (rep.bestCpa && rep.worstCpa && rep.bestCpa !== rep.worstCpa) {
      lines.push(`전환 1건당 비용은 ${rep.bestCpa.name}가 ${won(rep.bestCpa.cpa)}으로 가장 낮고, ${rep.worstCpa.name}가 ${won(rep.worstCpa.cpa)}으로 가장 높습니다.`);
    } else {
      lines.push(`전환 1건당 비용은 전체 ${Number.isFinite(t.cpa) ? won(t.cpa) : "계산 불가"}입니다.`);
    }
    lines.push(t.gap > 0
      ? `채널 보고서의 전환을 그대로 더하면 ${comma(t.reported)}건이지만, 기준을 맞추면 ${comma(t.conv)}건입니다. ${comma(t.gap)}건은 채널마다 다른 전환 기준에서 나온 차이입니다.`
      : `모든 채널이 같은 기준으로 전환을 세고 있어 보고 합계와 기준 합계가 ${comma(t.conv)}건으로 같습니다.`);
    let action = "다음 주에도 같은 기준으로 비교합니다.";
    if (rep.bestRoas && rep.worstRoas && rep.bestRoas !== rep.worstRoas) {
      action = `다음 주 할 일: 광고비 대비 매출이 가장 낮은 ${rep.worstRoas.name}(${pct1(rep.worstRoas.roas)}%)의 소재를 점검하고, ${rep.bestRoas.name}(${pct1(rep.bestRoas.roas)}%) 예산을 늘릴지 검토합니다.`;
    }
    return { lines, action };
  }

  /* ---------- AI 응답 검사 ---------- */
  /** 문장에서 숫자만 뽑는다: "1,284건", "12.5%", "248만" → [1284, 12.5, 248] */
  function numbersIn(text) {
    const out = [];
    String(text).replace(/\d[\d,]*(?:\.\d+)?/g, (m) => { out.push(Number(m.replace(/,/g, ""))); return m; });
    return out.filter((n) => Number.isFinite(n));
  }
  /** 리포트에서 문장에 나와도 되는 숫자 모음 (원 단위·만 원 단위·소수 1자리 모두) */
  function allowedNumbers(rep) {
    const s = new Set();
    const add = (n) => {
      if (!Number.isFinite(n)) return;
      const a = Math.abs(n);
      [a, Math.round(a), Math.round(a * 10) / 10, Math.round(a / 10000), Math.round(a / 1000) / 10, Math.floor(a / 10000)].forEach((x) => s.add(x));
    };
    const each = (o) => Object.values(o).forEach((v) => { if (typeof v === "number") add(v); });
    each(rep.total); each(rep.prevTotal); each(rep.delta);
    rep.rows.forEach((r) => { each(r); add(r.reported - r.conv); });
    String(rep.week + " " + rep.prevWeek).replace(/\d+/g, (m) => { s.add(Number(m)); return m; });
    for (let i = 0; i <= 10; i++) s.add(i); // '4개 채널', '7일' 같은 작은 수
    return s;
  }
  /** 데이터에 없는 숫자 목록 */
  function unknownNumbers(text, rep) {
    const ok = allowedNumbers(rep);
    return numbersIn(text).filter((n) => ![...ok].some((a) => Math.abs(a - n) <= 0.051));
  }
  /** Claude 응답 → {lines, action} 또는 null(형식이 틀렸거나 없는 숫자를 지어냄) */
  function normalizeSummary(d, rep) {
    if (!d || typeof d !== "object" || !Array.isArray(d.lines)) return null;
    const lines = d.lines.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 220)).slice(0, 4);
    const action = typeof d.action === "string" ? d.action.trim().slice(0, 220) : "";
    if (lines.length < 2 || !action) return null;
    if ([...lines, action].some((x) => unknownNumbers(x, rep).length)) return null;
    return { lines, action };
  }

  /** AI에 보낼 입력: 숫자는 화면과 같은 값, 개인정보는 애초에 없다 */
  function aiInput(rep) {
    return {
      week: rep.week, prevWeek: rep.prevWeek,
      standard: rep.std.map(label),
      total: { cost: rep.total.cost, conv: rep.total.conv, reported: rep.total.reported, cpa: Math.round(rep.total.cpa) || 0, roas: Number(pct1(rep.total.roas)) || 0 },
      change: { costPct: Number(pct1(rep.delta.cost)) || 0, convPct: Number(pct1(rep.delta.conv)) || 0 },
      channels: rep.rows.map((r) => ({ name: r.name, cost: r.cost, conv: r.conv, reported: r.reported, cpa: Math.round(r.cpa) || 0, roas: Number(pct1(r.roas)) || 0, convChangePct: Number(pct1(r.convChange)) || 0 })),
    };
  }

  /* ---------- 내보내기 ---------- */
  function toMailText(rep, summary) {
    const t = rep.total;
    const out = [
      `[주간 광고 리포트] ${rep.week}`,
      `기준: ${rep.std.map(label).join("+")} (채널별 기준을 맞춘 뒤 합산)`,
      "",
      `광고비 ${won(t.cost)} · 기준 전환 ${comma(t.conv)}건 · CPA ${Number.isFinite(t.cpa) ? won(t.cpa) : "–"} · ROAS ${pct1(t.roas)}%`,
      "",
      ...summary.lines.map((l) => `- ${l}`),
      `- ${summary.action}`,
      "",
      "채널 | 광고비 | 채널 보고 전환 | 기준 전환 | CPA | ROAS",
      ...rep.rows.map((r) => `${r.name} | ${won(r.cost)} | ${comma(r.reported)} | ${comma(r.conv)} | ${Number.isFinite(r.cpa) ? won(r.cpa) : "–"} | ${pct1(r.roas)}%`),
    ];
    if (rep.warnings.length) out.push("", "주의:", ...rep.warnings.map((w) => `- ${w}`));
    return out.join("\n");
  }
  const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  function toCsv(rep) {
    const head = ["채널", "노출", "클릭", "광고비", "채널보고전환", "기준전환", "CPA", "ROAS(%)", "매출"];
    const rows = rep.rows.map((r) => [r.name, r.imp, r.click, r.cost, r.reported, r.conv, Number.isFinite(r.cpa) ? Math.round(r.cpa) : "", pct1(r.roas), r.revenue]);
    const t = rep.total;
    rows.push(["합계", t.imp, t.click, t.cost, t.reported, t.conv, Number.isFinite(t.cpa) ? Math.round(t.cpa) : "", pct1(t.roas), t.revenue]);
    return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  }

  /* ---------- 발행 기록 ---------- */
  /** 같은 주는 한 번만 발행. 이미 있으면 그대로 돌려준다 */
  function publish(log, entry) {
    if (log.some((x) => x.week === entry.week)) return { log, added: false };
    return { log: [entry, ...log], added: true };
  }
  /** 끊기지 않고 이어진 주 수 (가장 최근부터, 7일 간격) */
  function streak(log) {
    const ds = log.map((x) => x.date).sort().reverse();
    let n = ds.length ? 1 : 0;
    for (let i = 1; i < ds.length; i++) {
      const gap = (Date.parse(ds[i - 1]) - Date.parse(ds[i])) / 86400000;
      if (gap === 7) n++; else break;
    }
    return n;
  }

  /* ---------- 샘플 (가상의 생활용품 온라인몰 '하루살림') ---------- */
  function sample() {
    return {
      week: "10/19(월)–10/25(일)", prevWeek: "10/12(월)–10/18(일)",
      cur: {
        search: { imp: 182400, click: 5210, cost: 2480000, purchase: 148, cart: 312, revenue: 9620000 },
        social: { imp: 356000, click: 4380, cost: 1920000, purchase: 61, view: 174, revenue: 3904000 },
        video: { imp: 241000, click: 1870, cost: 1350000, purchase: 22, signup: 96, revenue: 1452000 },
        shop: { imp: 98500, click: 3960, cost: 1640000, purchase: 133, revenue: 8512000 },
      },
      prev: {
        search: { imp: 175300, click: 4980, cost: 2410000, purchase: 139, cart: 287, revenue: 8896000 },
        social: { imp: 341000, click: 4120, cost: 1880000, purchase: 58, view: 162, revenue: 3654000 },
        video: { imp: 228000, click: 1760, cost: 1300000, purchase: 25, signup: 88, revenue: 1600000 },
        shop: { imp: 94200, click: 3710, cost: 1600000, purchase: 121, revenue: 7744000 },
      },
      log: ["2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14", "2026-09-07"].map((date, i) => ({ date, week: `W${43 - i}`, at: "09:10", by: "자동" })),
    };
  }

  return { sample, EVENTS, CHANNELS, DEFAULT_STD, FIELDS, comma, won, man, pct1, change, label, validateRow, reportedConv, stdConv, standardTable, summarize, buildReport, ruleSummary, numbersIn, allowedNumbers, unknownNumbers, normalizeSummary, aiInput, toMailText, toCsv, publish, streak };
});
