/* 값매김 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Gapmaegim, Node(테스트)에서는 require('./logic.js').
 *
 * 수강생 한 명이 결제하면 얼마가 남는가를 끝까지 계산한다.
 *   가격 − 플랫폼 수수료 − 결제 수수료 − 재료 키트 − 배송 − 작가 시간(피드백·라이브) = 1인당 남는 돈
 *   남는 돈 × 수강생 − 고정비(광고) = 기수 이익
 * 1기는 수수료 두 줄을 빼먹고 계산했다. unit(plan, costs, {legacy:true})가 그 방식이고,
 * missingCosts()가 빠진 비용을 찾아 경고한다.
 * 추천은 사전 신청 테스트(가격 카드별 방문·신청)에서 '방문자 1명당 남는 돈'이 가장 큰 구성.
 * Claude 추천은 normalizeReview()가 구성 id와 숫자(입력에 있는 숫자만)를 검사한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gapmaegim = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  const man = (n) => `${(Math.round(n / 1000) / 10).toLocaleString("ko-KR")}만`;
  const pct = (r) => `${Math.round(r * 1000) / 10}%`;

  /* ---------- 샘플 숫자 (가상의 클래스) ---------- */
  const COSTS = { platformRate: 0.15, payRate: 0.035, kitCost: 18000, shipCost: 3500, hourValue: 20000, fixed: 900000, visitors: 480 };
  const COHORT1_STUDENTS = 60; // 1기 실제 수강생 수 (샘플)
  const COHORT1 = { id: "G1", name: "1기 · 영상 + 키트 + 피드백", price: 69000, kit: true, minutes: 60 };
  const PLANS = [
    { id: "A", name: "영상만", price: 59000, kit: false, minutes: 20, desc: "영상 24강 · 과제 피드백 1회" },
    { id: "B", name: "영상 + 재료 키트", price: 99000, kit: true, minutes: 60, desc: "영상 24강 · 키트 · 과제 피드백 4회" },
    { id: "C", name: "키트 + 1:1 라이브", price: 149000, kit: true, minutes: 100, desc: "B 구성 + 1:1 라이브 첨삭 1회" },
  ];
  const PRESIGN = { A: { visits: 275, signups: 21 }, B: { visits: 272, signups: 34 }, C: { visits: 273, signups: 9 } };

  /* ---------- 1인당 계산 ---------- */
  function unit(plan, costs, opts) {
    const c = costs, legacy = !!(opts && opts.legacy);
    const price = Math.max(0, Number(plan.price) || 0);
    const rows = [];
    const platform = legacy ? 0 : Math.round(price * c.platformRate);
    const pay = legacy ? 0 : Math.round(price * c.payRate);
    const kit = plan.kit ? c.kitCost : 0;
    const ship = plan.kit ? c.shipCost : 0;
    const time = Math.round(((Number(plan.minutes) || 0) / 60) * c.hourValue);
    rows.push(["플랫폼 수수료", platform], ["결제 수수료", pay], ["재료 키트", kit], ["배송", ship], ["작가 시간", time]);
    const net = price - platform - pay - kit - ship - time;
    return { price, platform, pay, kit, ship, time, rows, net, margin: price ? net / price : 0 };
  }
  /** 고정비를 메우는 데 필요한 인원 (남는 돈이 0 이하면 Infinity) */
  function breakEven(net, fixed) { return net > 0 ? Math.ceil(fixed / net) : Infinity; }
  function cohort(plan, costs, students, opts) {
    const u = unit(plan, costs, opts);
    const n = Math.max(0, Math.round(Number(students) || 0));
    return { ...u, students: n, profit: u.net * n - costs.fixed, breakEven: breakEven(u.net, costs.fixed) };
  }

  /** 빠뜨린 비용 찾기 (1기의 실수: 플랫폼 수수료를 빼먹음) */
  function missingCosts(costs, plans) {
    const out = [];
    if (!(costs.platformRate > 0)) out.push("플랫폼 수수료가 0%예요. 판매 플랫폼에서 떼는 몫을 넣어 주세요.");
    if (!(costs.payRate > 0)) out.push("결제 수수료가 0%예요. 카드·간편결제 수수료를 넣어 주세요.");
    if ((plans || []).some((p) => p.kit) && !(costs.kitCost > 0)) out.push("키트가 들어간 구성이 있는데 재료비가 0원이에요.");
    if ((plans || []).some((p) => p.kit) && !(costs.shipCost > 0)) out.push("키트를 보내는데 배송비가 0원이에요.");
    if (!(costs.hourValue > 0) && (plans || []).some((p) => p.minutes > 0)) out.push("피드백에 쓰는 작가 시간이 0원으로 잡혀 있어요.");
    if ((plans || []).some((p) => unit(p, costs).net <= 0)) out.push("팔수록 손해인 구성이 있어요.");
    return out;
  }

  /* ---------- 사전 신청 테스트 ---------- */
  function presignRows(plans, costs, pre) {
    return plans.map((p) => {
      const t = pre[p.id] || { visits: 0, signups: 0 };
      const conv = t.visits > 0 ? t.signups / t.visits : 0;
      const u = unit(p, costs);
      const students = Math.round(conv * (costs.visitors || 0));
      return { id: p.id, name: p.name, price: u.price, net: u.net, margin: u.margin, visits: t.visits, signups: t.signups, conv, perVisitor: Math.round(conv * u.net), students, profit: u.net * students - costs.fixed };
    });
  }
  const totalSignups = (pre) => Object.values(pre).reduce((a, t) => a + (Number(t.signups) || 0), 0);

  /* ---------- 규칙 추천 ---------- */
  function reviewRule(rows, costs) {
    const ok = rows.filter((r) => r.net > 0 && r.visits > 0);
    if (!ok.length) return { pick: "", reasons: ["남는 돈이 있는 구성이 없어요. 가격이나 비용을 다시 보세요."], risks: [] };
    const best = ok.slice().sort((a, b) => b.perVisitor - a.perVisitor)[0];
    const topUnit = rows.slice().sort((a, b) => b.net - a.net)[0];
    const reasons = [
      `방문자 1명당 남는 돈이 ${won(best.perVisitor)}으로 가장 커요 (신청률 ${pct(best.conv)} × 1인당 ${won(best.net)}).`,
      `모집 페이지 방문자 ${costs.visitors}명이면 약 ${best.students}명이 듣고, 고정비를 빼고 ${won(best.profit)}이 남아요.`,
    ];
    if (topUnit.id !== best.id) reasons.push(`${topUnit.id}는 1인당 ${won(topUnit.net)}으로 더 남지만 신청률이 ${pct(topUnit.conv)}라 전체로는 적어요.`);
    const risks = [];
    rows.forEach((r) => { if (r.margin < 0.3) risks.push(`${r.id} 구성은 남는 비율이 ${pct(r.margin)}로 낮아요.`); });
    rows.forEach((r) => { if (r.signups < 10) risks.push(`${r.id} 구성은 신청이 ${r.signups}명뿐이라 숫자가 흔들릴 수 있어요.`); });
    return { pick: best.id, reasons, risks: risks.slice(0, 3) };
  }

  /* ---------- Claude 응답 검사 ---------- */
  function allowedNumbers(rows, costs) {
    const base = [costs.fixed, costs.visitors, costs.kitCost, costs.shipCost, costs.hourValue, costs.platformRate * 100, costs.payRate * 100];
    rows.forEach((r) => base.push(r.price, r.net, r.visits, r.signups, r.perVisitor, r.margin * 100, r.conv * 100, r.students, r.profit));
    const out = new Set();
    base.forEach((v) => {
      if (!Number.isFinite(v)) return;
      [v, Math.round(v), Math.round(v * 10) / 10, Math.round(v / 1000) / 10, Math.round(v / 10000), Math.round(v / 1000)].forEach((x) => out.add(x));
    });
    return out;
  }
  /** 글 속 숫자가 모두 입력에서 나온 숫자인가 (10 이하 작은 수는 허용: '1:1', '3가지') */
  function numbersGrounded(text, allowed) {
    const toks = String(text || "").match(/\d[\d,]*(\.\d+)?/g) || [];
    return toks.every((t) => {
      const n = parseFloat(t.replace(/,/g, ""));
      if (n <= 10) return true;
      for (const v of allowed) if (Math.abs(v - n) < 0.051) return true;
      return false;
    });
  }
  function normalizeReview(data, rows, costs) {
    if (!data || typeof data !== "object") return null;
    const ids = rows.map((r) => r.id);
    const pick = typeof data.pick === "string" ? data.pick.trim().toUpperCase() : "";
    if (!ids.includes(pick)) return null;
    const clean = (a, max) => (Array.isArray(a) ? a : []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()).slice(0, max);
    const reasons = clean(data.reasons, 3), risks = clean(data.risks, 3);
    if (!reasons.length) return null;
    const allowed = allowedNumbers(rows, costs);
    if (![...reasons, ...risks].every((s) => numbersGrounded(s, allowed))) return null;
    return { pick, reasons, risks };
  }

  /* ---------- 내보내기 ---------- */
  function exportCsv(plans, costs, pre) {
    const rows = presignRows(plans, costs, pre);
    const head = ["구성", "가격", "플랫폼 수수료", "결제 수수료", "재료+배송", "작가 시간", "1인당 남는 돈", "남는 비율", "손익분기 인원", "사전 방문", "사전 신청", "신청률", "방문자당 남는 돈", "예상 수강생", "예상 기수 이익"];
    const lines = [head];
    plans.forEach((p, i) => {
      const u = unit(p, costs), r = rows[i], be = breakEven(u.net, costs.fixed);
      lines.push([`${p.id} ${p.name}`, u.price, u.platform, u.pay, u.kit + u.ship, u.time, u.net, pct(u.margin), Number.isFinite(be) ? be : "불가", r.visits, r.signups, pct(r.conv), r.perVisitor, r.students, r.profit]);
    });
    const q = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return "﻿" + lines.map((l) => l.map(q).join(",")).join("\n");
  }

  return { won, man, pct, COSTS, COHORT1, COHORT1_STUDENTS, PLANS, PRESIGN, unit, breakEven, cohort, missingCosts, presignRows, totalSignups, reviewRule, allowedNumbers, numbersGrounded, normalizeReview, exportCsv };
});
