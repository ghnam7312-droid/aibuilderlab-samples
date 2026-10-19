/* 금요보고 · logic.js — 화면과 상관없는 순수 계산.
 * 브라우저에서는 window.WR, Node 테스트에서는 require("../logic.js").
 *
 *  날짜(KST)   dayOf · label · holiday · weekRange · nextFriday
 *  숫자        stats · pct · niceStep · parseCell(입력 검증)
 *  문장        ruleSummary — Claude가 안 될 때 쓰는 규칙 요약
 *  검산        facts(사실 목록) · checkNumbers(문장 속 숫자가 데이터에 있는지)
 *
 * '검산'이 핵심이다. AI가 쓴 요약 문장 속 숫자를 하나하나 뽑아 실제 데이터와 맞춰 보고,
 * 데이터에 없는 숫자가 하나라도 있으면 보고서에 '확인 필요'를 띄운다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WR = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ───────── 날짜 (모두 KST) ───────── */
  var DAY = 86400000, KST = 9 * 3600000;
  var WEEK_START = { last: "2026-10-02", now: "2026-10-09" }; // 둘 다 금요일 (금~목 한 주)
  var HOLIDAYS = { "2026-10-03": "개천절", "2026-10-09": "한글날" };
  var WD = ["일", "월", "화", "수", "목", "금", "토"];

  function kstMidnight(iso) { return new Date(iso + "T00:00:00+09:00"); }
  function isoKST(d) { return new Date(d.getTime() + KST).toISOString().slice(0, 10); }
  function dayOf(wk, i) { return new Date(kstMidnight(WEEK_START[wk]).getTime() + i * DAY); }
  /** 10/9(금) — 서버가 UTC여도 한국 날짜로 찍는다 (2주차 버그: 차트 날짜가 하루씩 밀림) */
  function label(d) { var k = new Date(d.getTime() + KST); return (k.getUTCMonth() + 1) + "/" + k.getUTCDate() + "(" + WD[k.getUTCDay()] + ")"; }
  function wdName(d) { return WD[new Date(d.getTime() + KST).getUTCDay()]; }
  function holiday(wk, i) { return HOLIDAYS[isoKST(dayOf(wk, i))] || ""; }
  function weekRange(wk) { return label(dayOf(wk, 0)) + " – " + label(dayOf(wk, 6)); }
  /** now 이후 첫 금요일 17:00 (KST). 금요일 17시가 지났으면 다음 주 */
  function nextFriday(now) {
    var t = now.getTime(), k = new Date(t + KST);
    var add = (5 - k.getUTCDay() + 7) % 7;
    var at = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + add, 17) - KST;
    if (at <= t) at += 7 * DAY;
    return new Date(at);
  }

  /* ───────── 숫자 ───────── */
  function sum(w, f) { return w.reduce(function (s, r) { return s + r[f]; }, 0); }
  function pct(a, b) { return b ? ((a - b) / b) * 100 : 0; }
  function stats(w) {
    var S = sum(w, "sales"), O = sum(w, "orders"), V = sum(w, "visits");
    return { S: S, O: O, V: V, R: V ? (O / V) * 100 : 0, A: O ? S / O : 0 };
  }
  /** 차트 눈금: 1·2·2.5·5 × 10ⁿ */
  function niceStep(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  /**
   * 입력 칸 검증. 쉼표·단위·공백은 허용하고 0 이상의 정수만 받는다.
   * ctx = { field, visits, orders } — 주문이 방문보다 많으면 거른다.
   */
  function parseCell(raw, ctx) {
    ctx = ctx || {};
    var s = String(raw == null ? "" : raw).trim();
    var clean = s.replace(/[,\s원건명]/g, "");
    if (!clean) return { ok: false, msg: "칸이 비어 있어요. 0이라도 적어 주세요." };
    if (/^\d+(\.\d+)?$/.test(clean) && clean.indexOf(".") >= 0) return { ok: false, msg: "소수점은 넣을 수 없어요: “" + s + "”" };
    if (!/^\d+$/.test(clean)) return { ok: false, msg: "숫자가 아닌 글자가 있어요: “" + s + "”" };
    var v = Number(clean);
    if (ctx.field === "orders" && ctx.visits != null && v > ctx.visits) return { ok: false, msg: "주문 " + v.toLocaleString("ko-KR") + "건이 방문 " + Number(ctx.visits).toLocaleString("ko-KR") + "명보다 많아요." };
    if (ctx.field === "visits" && ctx.orders != null && v < ctx.orders) return { ok: false, msg: "방문 " + v.toLocaleString("ko-KR") + "명이 주문 " + Number(ctx.orders).toLocaleString("ko-KR") + "건보다 적어요." };
    return { ok: true, value: v };
  }

  function n0(v) { return Math.round(v).toLocaleString("ko-KR"); }
  function man(v) { return Math.round(v / 10000).toLocaleString("ko-KR") + "만 원"; }

  /* ───────── 규칙 요약 (AI가 안 될 때) ─────────
     **굵게** 표시만 쓰고 HTML은 화면이 만든다. */
  function ruleSummary(weeks, top) {
    var L = weeks.last, N = weeks.now, a = stats(L), b = stats(N);
    var best = 0, worst = 0;
    N.forEach(function (r, i) { if (r.sales > N[best].sales) best = i; if (r.sales < N[worst].sales) worst = i; });
    var grow = N.map(function (r, i) { return pct(r.sales, L[i].sales); });
    var gi = grow.reduce(function (m, v, i) { return v > grow[m] ? i : m; }, 0);
    var dS = pct(b.S, a.S), dR = b.R - a.R, dA = pct(b.A, a.A);
    var hol = holiday("now", best);
    var lines = [
      "이번 주 매출은 **" + man(b.S) + "**으로 지난주보다 **" + Math.abs(dS).toFixed(1) + "% " + (dS >= 0 ? "늘었습니다" : "줄었습니다") + "**. 주문은 " + n0(b.O) + "건(" + (b.O - a.O >= 0 ? "+" : "") + n0(b.O - a.O) + "건)입니다.",
      "매출이 가장 높은 날은 **" + label(dayOf("now", best)) + "**" + (hol ? "(" + hol + " 휴일)" : "") + " " + man(N[best].sales) + ", 가장 낮은 날은 " + label(dayOf("now", worst)) + " " + man(N[worst].sales) + "입니다.",
      "전환율은 **" + b.R.toFixed(2) + "%**로 " + Math.abs(dR).toFixed(2) + "%p " + (dR >= 0 ? "올랐고" : "내렸고") + ", 객단가는 " + n0(b.A) + "원(" + (dA >= 0 ? "+" : "") + dA.toFixed(1) + "%)입니다.",
    ];
    if (top && top.now && top.last && top.now[0][0] !== top.last[0][0]) {
      lines.push("상품 1위가 바뀌었습니다. **" + top.now[0][0] + "**가 " + top.last[0][0] + "를 제치고 가장 많이 팔렸습니다. 다음 주에는 " + wdName(dayOf("now", worst)) + "요일 매출을 끌어올릴 방법을 찾겠습니다.");
    } else {
      lines.push("다음 주에는 매출이 가장 낮았던 " + wdName(dayOf("now", worst)) + "요일을 살펴보겠습니다.");
    }
    return lines;
  }

  /* ───────── 검산: 보고서에 쓸 수 있는 '사실' 숫자 목록 ───────── */
  function facts(weeks, top) {
    var L = weeks.last, N = weeks.now, a = stats(L), b = stats(N);
    var F = []; // {v, unit, note}
    var add = function (v, unit, note) { F.push({ v: v, unit: unit, note: note }); };
    [["이번 주", b], ["지난주", a]].forEach(function (p) {
      var w = p[0], s = p[1];
      add(s.S, "원", w + " 매출"); add(s.S / 10000, "만원", w + " 매출"); add(s.S / 100000000, "억원", w + " 매출");
      add(s.O, "건", w + " 주문"); add(s.V, "명", w + " 방문"); add(s.R, "%", w + " 전환율"); add(s.A, "원", w + " 객단가");
    });
    add(Math.abs(pct(b.S, a.S)), "%", "매출 증감률"); add(Math.abs(pct(b.O, a.O)), "%", "주문 증감률");
    add(Math.abs(pct(b.V, a.V)), "%", "방문 증감률"); add(Math.abs(pct(b.A, a.A)), "%", "객단가 증감률");
    add(Math.abs(b.R - a.R), "%p", "전환율 차이"); add(Math.abs(b.O - a.O), "건", "주문 차이"); add(Math.abs(b.V - a.V), "명", "방문 차이");
    add(Math.abs(b.S - a.S), "원", "매출 차이"); add(Math.abs(b.S - a.S) / 10000, "만원", "매출 차이");
    ["now", "last"].forEach(function (wk) {
      var W = weeks[wk];
      W.forEach(function (r, i) {
        var d = dayOf(wk, i), lb = label(d);
        add(r.sales, "원", lb + " 매출"); add(r.sales / 10000, "만원", lb + " 매출");
        add(r.orders, "건", lb + " 주문"); add(r.visits, "명", lb + " 방문");
        add(r.visits ? (r.orders / r.visits) * 100 : 0, "%", lb + " 전환율");
        if (wk === "now") {
          add(Math.abs(pct(r.sales, L[i].sales)), "%", lb + " 매출 증감률");
          add(Math.abs(pct(r.orders, L[i].orders)), "%", lb + " 주문 증감률");
        }
        var k = new Date(d.getTime() + KST);
        add(k.getUTCMonth() + 1, "월", lb); add(k.getUTCDate(), "일", lb);
      });
    });
    ((top && top.now) || []).concat((top && top.last) || []).forEach(function (t) {
      add(t[1], "개", t[0] + " 수량"); add(t[2], "원", t[0] + " 매출"); add(t[2] / 10000, "만원", t[0] + " 매출");
    });
    for (var r = 1; r <= 5; r++) add(r, "위", "순위");
    add(7, "일", "한 주"); add(1, "주", "한 주");
    return F;
  }

  // 단위 정규화: 같은 '종류'끼리만 비교한다
  var UNIT = { "만 원": "만원", "만원": "만원", "억 원": "억원", "억원": "억원", "원": "원", "%p": "%p", "%포인트": "%p", "%": "%", "건": "건", "명": "명", "개": "개", "월": "월", "일": "일", "위": "위", "주": "주" };
  var NUM_RE = /(\d{1,2})\/(\d{1,2})|(\d[\d,]*(?:\.\d+)?)\s*(만\s?원|억\s?원|%p|%포인트|%|원|건|명|개|월|일|위|주)?/g;

  /** 문장에서 숫자 덩어리를 뽑는다: [{raw, v, unit}] — '10/9' 같은 날짜는 월·일 둘로 */
  function numbersIn(text) {
    var out = [], m, s = String(text || "").replace(/\*\*/g, "");
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(s))) {
      if (m[1]) { out.push({ raw: m[0], v: +m[1], unit: "월" }); out.push({ raw: m[0], v: +m[2], unit: "일" }); continue; }
      var u = m[4] ? UNIT[m[4].replace(/\s/g, "")] : "";
      out.push({ raw: m[0].trim(), v: Number(m[3].replace(/,/g, "")), unit: u || "" });
    }
    return out;
  }

  /** 반올림 허용 범위: 적힌 소수 자릿수만큼 (예: 12.2% → ±0.05, 3,612만 원 → ±0.5) */
  function tolerance(raw, unit) {
    var dot = String(raw).match(/\.(\d+)/);
    var t = dot ? 0.5 * Math.pow(10, -dot[1].length) : 0.5;
    if (unit === "만원" || unit === "억원") t = Math.max(t, 0.5);
    return t + 1e-9;
  }

  /**
   * 문장 속 숫자를 사실 목록과 맞춘다.
   * 반환: { ok, total, matched, items:[{raw, ok, note}] }
   * 단위가 없는 숫자는 모든 사실과 비교한다. '1위·2개' 같은 작은 정수도 그대로 검사한다.
   */
  function checkNumbers(text, factList) {
    var nums = numbersIn(text), items = [];
    nums.forEach(function (n) {
      var tol = tolerance(n.raw, n.unit);
      var hit = null;
      for (var i = 0; i < factList.length; i++) {
        var f = factList[i];
        if (n.unit && f.unit !== n.unit) continue;
        if (Math.abs(f.v - n.v) <= tol) { hit = f; break; }
      }
      items.push({ raw: n.raw, ok: !!hit, note: hit ? hit.note : "데이터에 없는 숫자" });
    });
    var matched = items.filter(function (x) { return x.ok; }).length;
    return { ok: matched === items.length, total: items.length, matched: matched, items: items };
  }

  /** Claude 응답 → 문장 4개. 모양이 틀리면 null */
  function fromAi(d) {
    if (!d || !Array.isArray(d.lines)) return null;
    var lines = d.lines.map(function (l) { return String(l || "").trim(); }).filter(Boolean).slice(0, 6);
    return lines.length >= 2 ? lines : null;
  }

  /** Claude에 보낼 입력: 계산된 숫자만 넘겨 지어낼 여지를 줄인다 */
  function aiInput(weeks, top) {
    var a = stats(weeks.last), b = stats(weeks.now);
    var r1 = function (v) { return Math.round(v * 10) / 10; }, r2 = function (v) { return Math.round(v * 100) / 100; };
    return {
      company: "다온오피스 온라인몰",
      thisWeek: { range: weekRange("now"), sales: b.S, sales만원: Math.round(b.S / 10000), orders: b.O, visits: b.V, conversion: r2(b.R), aov: Math.round(b.A) },
      lastWeek: { range: weekRange("last"), sales: a.S, sales만원: Math.round(a.S / 10000), orders: a.O, visits: a.V, conversion: r2(a.R), aov: Math.round(a.A) },
      change: { sales: r1(pct(b.S, a.S)), orders: r1(pct(b.O, a.O)), visits: r1(pct(b.V, a.V)), conversionPoint: r2(b.R - a.R), aov: r1(pct(b.A, a.A)) },
      days: weeks.now.map(function (r, i) {
        return { date: label(dayOf("now", i)), holiday: holiday("now", i) || undefined, sales만원: Math.round(r.sales / 10000), orders: r.orders, visits: r.visits, salesVsSameDayLastWeek: r1(pct(r.sales, weeks.last[i].sales)) };
      }),
      topProducts: (top.now || []).map(function (t, i) { return { rank: i + 1, name: t[0], qty: t[1], sales만원: Math.round(t[2] / 10000) }; }),
    };
  }

  /** 샘플 데이터 (가상의 다온오피스 온라인몰) */
  function sample() {
    var mk = function (rows) { return rows.map(function (r) { return { sales: r[0], orders: r[1], visits: r[2] }; }); };
    return {
      weeks: {
        last: mk([[4120000, 61, 1820], [5480000, 80, 2310], [4960000, 72, 2150], [3980000, 58, 1760], [4550000, 66, 1910], [4700000, 70, 2010], [4390000, 64, 1880]]),
        now: mk([[6120000, 92, 2480], [5890000, 86, 2390], [5150000, 75, 2210], [4310000, 63, 1840], [4880000, 72, 1990], [5020000, 76, 2050], [4750000, 71, 1930]]),
      },
      top: {
        now: [["무선 키보드", 186, 7254000], ["A4 용지(박스)", 240, 6240000], ["노트북 거치대", 152, 4864000], ["프린터 토너", 88, 4224000], ["모니터암", 41, 3239000]],
        last: [["A4 용지(박스)", 228, 5928000], ["무선 키보드", 141, 5499000], ["프린터 토너", 95, 4560000], ["노트북 거치대", 120, 3840000], ["사무용 의자", 18, 2862000]],
      },
    };
  }

  return {
    sample: sample, WEEK_START: WEEK_START, HOLIDAYS: HOLIDAYS,
    isoKST: isoKST, dayOf: dayOf, label: label, holiday: holiday, weekRange: weekRange, nextFriday: nextFriday,
    stats: stats, pct: pct, niceStep: niceStep, parseCell: parseCell, n0: n0, man: man,
    ruleSummary: ruleSummary, facts: facts, numbersIn: numbersIn, checkNumbers: checkNumbers, fromAi: fromAi, aiInput: aiInput,
  };
});
