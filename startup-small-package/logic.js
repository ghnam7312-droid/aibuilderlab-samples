/* 작은집 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.JageunJip, Node(테스트)에서는 require('./logic.js').
 *
 * 소형 평수 리모델링을 맞춤 견적 대신 '패키지'로 팔 때, 패키지마다 원가·이익·마진을 계산한다.
 * 단가는 기록마다 기준일(asOf)이 있다. 처음 기획 때 작년 단가로 계산해 마진이 실제보다 높게 보였다.
 * 그래서 계산은 늘 pickPrice() 로 '기준일 이전의 가장 최신 단가'를 고르고,
 * staleItems() 가 오래된 단가를 쓰는 항목을 찾아 화면에 알린다.
 *
 * 단가는 모두 가상의 샘플 단가다. 실제 자재·인건비 시세가 아니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JageunJip = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const round1 = (n) => Math.round(n * 10) / 10;
  const M2_PER_PY = 400 / 121;
  const toPy = (m2) => round1(m2 / M2_PER_PY);
  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  const manwon = (n) => `${(Math.round(n / 1000) / 10).toLocaleString("ko-KR")}만 원`;
  const pct = (x) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;

  /* ---------- 단가 (가상의 샘플 단가, 부가세 별도) ---------- */
  const ITEMS = {
    wall: { name: "도배", unit: "㎡" },
    floor: { name: "장판", unit: "㎡" },
    light: { name: "LED 조명", unit: "개" },
    film: { name: "문 필름", unit: "짝" },
    seal: { name: "실리콘·줄눈", unit: "식" },
    waste: { name: "폐기물 처리", unit: "식" },
    bath: { name: "욕실 부분 교체", unit: "식" },
    top: { name: "주방 상판", unit: "식" },
    labor: { name: "시공 인건비", unit: "인·일" },
  };
  const SAMPLE_PRICES = [
    ["wall", 7600, 8500], ["floor", 21000, 24000], ["light", 34000, 38000], ["film", 85000, 95000],
    ["seal", 160000, 180000], ["waste", 200000, 250000], ["bath", 1300000, 1450000], ["top", 720000, 820000], ["labor", 250000, 280000],
  ].flatMap(([item, old, now]) => [{ item, price: old, asOf: "2025-09-01" }, { item, price: now, asOf: "2026-09-01" }]);

  /** 기준일(on) 이전 단가 중 가장 최신. 없으면 null */
  function pickPrice(prices, item, on) {
    return prices.filter((p) => p.item === item && p.asOf <= on).sort((a, b) => b.asOf.localeCompare(a.asOf))[0] || null;
  }
  /** 그 항목의 가장 최신 단가 날짜 */
  function latestDate(prices, item) {
    return prices.filter((p) => p.item === item).reduce((m, p) => (p.asOf > m ? p.asOf : m), "");
  }
  function daysBetween(a, b) {
    const t = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400000);
  }
  /**
   * 오래된 단가를 쓰는 항목: 더 새 단가가 있는데 옛것을 고른 경우, 또는 고른 단가가 maxAge일보다 오래된 경우
   */
  function staleItems(prices, items, on, today, maxAge) {
    return items.map((item) => {
      const used = pickPrice(prices, item, on);
      const latest = latestDate(prices, item);
      if (!used) return { item, reason: "단가 없음" };
      if (used.asOf < latest) return { item, reason: "더 최신 단가가 있음", used: used.asOf, latest };
      if (daysBetween(used.asOf, today) > (maxAge || 365)) return { item, reason: `${maxAge || 365}일 넘은 단가`, used: used.asOf, latest };
      return null;
    }).filter(Boolean);
  }

  /* ---------- 패키지 ---------- */
  const WALL_FACTOR = 2.6; // 벽·천장 도배 면적 ≈ 바닥 × 2.6 (추정)
  const PACKAGES = [
    { id: "one", name: "원룸 기본", area: 20, laborDays: 5, price: 4300000, parts: [["wall", "wall"], ["floor", "floor"], ["light", 4], ["film", 2], ["seal", 1], ["waste", 1]] },
    { id: "plus", name: "원룸 플러스", area: 20, laborDays: 8, price: 8900000, parts: [["wall", "wall"], ["floor", "floor"], ["light", 4], ["film", 2], ["seal", 1], ["waste", 1], ["bath", 1], ["top", 1]] },
    { id: "two", name: "투룸 기본", area: 40, laborDays: 8, price: 6900000, parts: [["wall", "wall"], ["floor", "floor"], ["light", 7], ["film", 4], ["seal", 1], ["waste", 1]] },
  ];
  const itemsOf = (pkg) => pkg.parts.map(([item]) => item).concat("labor");

  function qtyOf(rule, area) {
    if (rule === "wall") return round1(area * WALL_FACTOR);
    if (rule === "floor") return area;
    return Number(rule) || 0;
  }

  /**
   * 패키지 하나 계산. on = 단가 기준일, overhead = 현장 관리비 비율
   * 결과: lines, material, labor, overhead, cost, price, profit, margin
   */
  function calcPackage(pkg, prices, on, overheadRate) {
    const oh = overheadRate == null ? 0.1 : overheadRate;
    const lines = pkg.parts.map(([item, rule]) => {
      const p = pickPrice(prices, item, on);
      const qty = qtyOf(rule, pkg.area);
      const price = p ? p.price : 0;
      return { item, name: ITEMS[item].name, unit: ITEMS[item].unit, qty, price, asOf: p ? p.asOf : "", amount: Math.round(qty * price), est: rule === "wall" };
    });
    const lp = pickPrice(prices, "labor", on);
    const material = lines.reduce((s, l) => s + l.amount, 0);
    const labor = Math.round((lp ? lp.price : 0) * pkg.laborDays);
    const overhead = Math.round((material + labor) * oh);
    const cost = material + labor + overhead;
    const profit = pkg.price - cost;
    return { id: pkg.id, lines, laborRate: lp ? lp.price : 0, laborAsOf: lp ? lp.asOf : "", material, labor, overhead, cost, price: pkg.price, profit, margin: pkg.price > 0 ? profit / pkg.price : 0 };
  }

  /** 목표 마진을 맞추는 최소 판매가 (10만 원 단위 올림) */
  function minPrice(cost, target) {
    if (target >= 1) return Infinity;
    return Math.ceil(cost / (1 - target) / 100000) * 100000;
  }
  function status(calc, target) {
    if (calc.profit < 0) return "loss";
    return calc.margin >= target ? "ok" : "low";
  }

  /* ---------- 내보내기 ---------- */
  function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function toCsv(pkgs, calcs, on) {
    const head = ["패키지", "기준 면적(㎡)", "기준 면적(평)", "판매가", "자재비", "인건비", "관리비", "원가", "이익", "마진", "단가 기준일"];
    const rows = pkgs.map((p, i) => [p.name, p.area, toPy(p.area), p.price, calcs[i].material, calcs[i].labor, calcs[i].overhead, calcs[i].cost, calcs[i].profit, pct(calcs[i].margin), on]);
    return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n# 가상의 샘플 단가로 계산한 예시 (부가세 별도)\r\n";
  }

  /* ---------- 소개 문구 (규칙 · AI 검사) ---------- */
  const EXCLUDE_POOL = ["샷시·창호 교체", "구조 변경·확장", "가구·가전", "욕실 전체 교체", "주방 전체 교체"];
  function rulePitch(pkg) {
    const inc = pkg.parts.map(([item]) => ITEMS[item].name);
    return {
      name: pkg.name,
      tagline: `${pkg.area}㎡(${toPy(pkg.area)}평) 기준, ${inc.slice(0, 3).join("·")}까지 한 번에 정리하는 패키지`,
      includes: inc,
      excludes: EXCLUDE_POOL.slice(0, 4),
      faq: [
        { q: "기준 면적보다 넓으면요?", a: "실측 후 넘는 면적만큼 도배·장판 수량을 더해 다시 안내해 드려요." },
        { q: "자재를 바꿀 수 있나요?", a: "같은 등급 안에서는 색과 무늬를 고르실 수 있어요. 등급을 올리면 맞춤 견적으로 안내해요." },
      ],
    };
  }
  const MONEY_RE = /\d[\d,.]*\s*(만\s*)?원/;
  const HYPE_RE = /최저가|업계\s?최고|무조건|100\s?%|국내\s?유일|평생\s?보증/;
  /**
   * Claude 소개 문구 검사. 틀리면 null → 규칙 문구 유지.
   * - includes 는 실제 패키지 구성 이름만 (구성에 없는 것을 넣으면 그 항목을 뺀다, 다 빠지면 null)
   * - 금액·과장 문구가 있으면 null (가격은 패키지 카드만 말한다)
   */
  function normalizePitch(d, pkg) {
    if (!d || typeof d !== "object") return null;
    const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const tagline = str(d.tagline, 80);
    if (!tagline) return null;
    const real = pkg.parts.map(([item]) => ITEMS[item].name);
    const includes = (Array.isArray(d.includes) ? d.includes : []).map((x) => str(x, 30)).filter((x) => real.includes(x));
    if (!includes.length) return null;
    const excludes = (Array.isArray(d.excludes) ? d.excludes : []).map((x) => str(x, 30)).filter((x) => x && !real.includes(x)).slice(0, 5);
    const faq = (Array.isArray(d.faq) ? d.faq : []).filter((f) => f && str(f.q, 60) && str(f.a, 160)).map((f) => ({ q: str(f.q, 60), a: str(f.a, 160) })).slice(0, 3);
    const all = [tagline, ...excludes, ...faq.map((f) => f.q + f.a)].join(" ");
    if (MONEY_RE.test(all) || HYPE_RE.test(all)) return null;
    return { name: str(d.name, 20) || pkg.name, tagline, includes, excludes, faq };
  }
  function pitchText(p, pkg, calc) {
    return [`[${p.name}] ${p.tagline}`, `가격: ${manwon(calc.price)} (부가세 별도, ${pkg.area}㎡ 기준)`, `포함: ${p.includes.join(", ")}`, p.excludes.length ? `제외: ${p.excludes.join(", ")}` : "", ...p.faq.map((f) => `Q. ${f.q}\nA. ${f.a}`)].filter(Boolean).join("\n");
  }

  const TARGET = { packages: 3, inquiries: 26 };

  return { round1, toPy, won, manwon, pct, ITEMS, SAMPLE_PRICES, pickPrice, latestDate, daysBetween, staleItems, WALL_FACTOR, PACKAGES, itemsOf, qtyOf, calcPackage, minPrice, status, toCsv, rulePitch, normalizePitch, pitchText, TARGET };
});
