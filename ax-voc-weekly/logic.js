/* 같은말 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Gateunmal, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 * 하는 일
 *   topicOf()     문의 한 건 → 불만 주제
 *   scrub()       이름·연락처·이메일·주소·주문번호를 지운다 (리포트에는 이것만 들어간다)
 *   aggregate()   지난주 vs 그 전 주, 주제별 건수·증감·급증, 대표 문장(지운 글)
 *   ruleSummary() 규칙으로 쓴 리포트 문장
 *   normalizeVoc() Claude 응답 검사: 개인정보가 섞였거나 형식이 틀리면 null
 *   piiGate()     보내기 직전 마지막 검사: 메일 본문에 개인정보가 하나라도 있으면 막는다
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gateunmal = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 날짜 ---------- */
  const DAYS = "일월화수목금토";
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function md(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  /** 리포트 주 = 오늘 기준 지난주 월~일 */
  function reportWeek(today) {
    const dow = (d0(today).getDay() + 6) % 7; // 월=0
    const start = addDays(today, -dow - 7);
    return { start, end: addDays(start, 6), label: `${md(start)}(월)–${md(addDays(start, 6))}(일)` };
  }
  /** 다음 자동 발송: 다가오는 월요일 09:00 (월요일 9시 전이면 오늘) */
  function nextSend(today, hour) {
    const dow = (d0(today).getDay() + 6) % 7;
    const day = dow === 0 && hour < 9 ? today : addDays(today, 7 - dow);
    return `${md(day)}(${DAYS[d0(day).getDay()]}) 09:00`;
  }

  /* ---------- 주제 ---------- */
  // 순서가 우선순위다 ('수거가 늦어요'는 배송 지연이 아니라 반품 수거)
  const TOPICS = [
    { id: "pickup", label: "반품 수거 지연", team: "물류", keys: ["수거"] },
    { id: "chair", label: "원목 의자 삐걱임", team: "상품", keys: ["삐걱", "소리가 나", "흔들거"] },
    { id: "rug", label: "러그 털 빠짐", team: "상품", keys: ["러그", "털 빠", "털이 빠", "털이 날", "보풀"] },
    { id: "size", label: "침구 사이즈 안내", team: "상품", keys: ["사이즈", "치수", "작아요", "안 맞"] },
    { id: "damage", label: "포장 파손", team: "물류", keys: ["파손", "깨져", "찌그러", "포장이 터"] },
    { id: "pay", label: "앱 결제 오류", team: "개발", keys: ["결제 오류", "결제가 안", "앱이 멈", "결제 화면"] },
    { id: "ship", label: "배송 지연", team: "물류", keys: ["배송", "늦어", "지연", "아직 안 와"] },
  ];
  const ETC = { id: "etc", label: "기타", team: "고객지원", keys: [] };
  const topicById = (id) => TOPICS.find((t) => t.id === id) || ETC;
  function topicOf(text) {
    const s = String(text || "");
    return (TOPICS.find((t) => t.keys.some((k) => s.includes(k))) || ETC).id;
  }

  /* ---------- 개인정보 ---------- */
  const RX = {
    email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    phone: /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
    order: /\bSD\d{6,}\b/g,
    address: /[가-힣]{1,10}(시|도)\s[가-힣]{1,10}(구|군)\s[가-힣0-9]{1,15}(로|길)\s?\d+(-\d+)?|\d{1,4}동\s?\d{1,4}호/g,
  };
  const LABEL = { name: "이름", phone: "연락처", email: "이메일", address: "주소", order: "주문번호" };
  /** 글에서 개인정보를 찾는다 → [{type, value}] */
  function findPii(text, names) {
    const s = String(text || "");
    const out = [];
    for (const type of ["email", "phone", "order", "address"]) (s.match(RX[type]) || []).forEach((v) => out.push({ type, value: v }));
    (names || []).filter((n) => n && n.length >= 2).forEach((n) => { if (s.includes(n)) out.push({ type: "name", value: n }); });
    return out;
  }
  /** 개인정보를 [연락처]처럼 바꾼다 → {text, found: {phone: 1, ...}} */
  function scrub(text, names) {
    let s = String(text || "");
    const found = {};
    const put = (type) => { found[type] = (found[type] || 0) + 1; return `[${LABEL[type]}]`; };
    for (const type of ["email", "phone", "order", "address"]) s = s.replace(RX[type], () => put(type));
    (names || []).filter((n) => n && n.length >= 2).sort((a, b) => b.length - a.length).forEach((n) => {
      s = s.split(n).join("\u0000");
      s = s.replace(/\u0000/g, () => put("name"));
    });
    return { text: s, found };
  }
  const addFound = (a, b) => { Object.keys(b).forEach((k) => { a[k] = (a[k] || 0) + b[k]; }); return a; };

  /* ---------- 모으기 ---------- */
  function aggregate(items, week, names) {
    const inThis = (d) => d >= week.start && d <= week.end;
    const lastStart = addDays(week.start, -7), lastEnd = addDays(week.start, -1);
    const inLast = (d) => d >= lastStart && d <= lastEnd;
    const removed = {};
    const rows = TOPICS.concat(ETC).map((t) => {
      const mine = items.filter((x) => topicOf(x.text) === t.id);
      const cur = mine.filter((x) => inThis(x.date));
      const quotes = cur.slice().sort((a, b) => a.text.length - b.text.length).slice(0, 2).map((x) => {
        const r = scrub(x.text, names);
        return r.text;
      });
      cur.forEach((x) => addFound(removed, scrub(x.text, names).found));
      const count = cur.length, last = mine.filter((x) => inLast(x.date)).length;
      const rising = t.id !== "etc" && count >= 3 && count - last >= 2 && count >= last * 1.5;
      return { id: t.id, label: t.label, team: t.team, count, last, delta: count - last, rising, quotes };
    }).filter((r) => r.count || r.last).sort((a, b) => b.count - a.count || b.last - a.last);
    const total = rows.reduce((a, r) => a + r.count, 0), lastTotal = rows.reduce((a, r) => a + r.last, 0);
    return { week, rows, total, lastTotal, removed, removedTotal: Object.values(removed).reduce((a, b) => a + b, 0) };
  }

  /* ---------- 규칙 리포트 ---------- */
  const times = (a, b) => (b ? `그 전 주 ${b}건의 ${Math.round((a / b) * 10) / 10}배` : `그 전 주 0건에서 새로`);
  function ruleSummary(agg) {
    const up = agg.rows.filter((r) => r.rising);
    const down = agg.rows.filter((r) => r.delta <= -3);
    const top = up[0] || agg.rows[0];
    const headline = top ? (up.length ? `${top.label} 문의가 ${top.count}건으로 ${times(top.count, top.last)}` : `가장 많은 문의는 ${top.label} ${top.count}건`) : "이번 주 문의가 없어요";
    const lines = [
      `전체 문의 ${agg.total}건, 그 전 주 ${agg.lastTotal}건보다 ${Math.abs(agg.total - agg.lastTotal)}건 ${agg.total >= agg.lastTotal ? "늘었어요" : "줄었어요"}.`,
      up.length ? `늘어난 불만: ${up.map((r) => `${r.label} ${r.last}→${r.count}건`).join(", ")}.` : "급하게 늘어난 불만은 없어요.",
    ];
    if (down.length) lines.push(`줄어든 문의: ${down.map((r) => `${r.label} ${r.last}→${r.count}건`).join(", ")}.`);
    const asks = up.slice(0, 3).map((r) => ({ topic: r.label, ask: `${r.team}팀 확인 요청 — 같은 내용 문의가 ${r.count}건 들어왔어요. 원인과 대응 계획을 회신 부탁드려요.` }));
    return { headline, lines, asks };
  }

  /* ---------- Claude 응답 검사 ---------- */
  /** 리포트에 나와도 되는 숫자: 건수·증감·합계·배수(소수 한 자리) */
  function allowedNumbers(agg) {
    const s = new Set([agg.total, agg.lastTotal, Math.abs(agg.total - agg.lastTotal)]);
    agg.rows.forEach((r) => {
      [r.count, r.last, Math.abs(r.delta)].forEach((n) => s.add(n));
      if (r.last) { s.add(Math.round((r.count / r.last) * 10) / 10); s.add(Math.round(r.count / r.last)); s.add(Math.round(((r.count - r.last) / r.last) * 100)); }
    });
    return s;
  }
  const numbersIn = (text) => (String(text).replace(/(\d+)\/(\d+)/g, "").match(/\d+(\.\d+)?/g) || []).map(Number);
  function normalizeVoc(d, agg, names) {
    if (!d || typeof d !== "object" || typeof d.headline !== "string" || !Array.isArray(d.lines)) return null;
    const ok = allowedNumbers(agg);
    const fine = (t) => typeof t === "string" && t.trim() && numbersIn(t).every((n) => ok.has(n));
    const labels = agg.rows.map((r) => r.label);
    const out = {
      headline: d.headline.trim().slice(0, 90),
      lines: d.lines.filter(fine).map((t) => t.trim().slice(0, 160)).slice(0, 4),
      asks: (Array.isArray(d.asks) ? d.asks : []).filter((a) => a && labels.includes(a.topic) && typeof a.ask === "string" && a.ask.trim()).map((a) => ({ topic: a.topic, ask: a.ask.trim().slice(0, 160) })).slice(0, 3),
    };
    if (!out.headline || !fine(out.headline) || !out.lines.length) return null;
    const all = [out.headline, ...out.lines, ...out.asks.map((a) => a.ask)].join("\n");
    if (findPii(all, names).length) return null; // 개인정보가 섞인 응답은 통째로 버린다
    return out;
  }

  /* ---------- 메일 ---------- */
  function buildMail(rep, agg) {
    const subject = `[주간 문의 동향] ${agg.week.label} · ${rep.headline}`;
    const table = agg.rows.map((r) => `- ${r.label}: ${r.count}건 (그 전 주 ${r.last}건${r.rising ? ", 급증" : ""})`).join("\n");
    const quotes = agg.rows.filter((r) => r.rising).map((r) => `■ ${r.label}\n${r.quotes.map((q) => `  “${q}”`).join("\n")}`).join("\n");
    const asks = rep.asks.length ? `\n\n요청드려요\n${rep.asks.map((a, i) => `${i + 1}. [${a.topic}] ${a.ask}`).join("\n")}` : "";
    const body = `상품팀 여러분, 지난주 고객 문의 동향입니다.\n\n${rep.lines.join("\n")}\n\n주제별 건수\n${table}${quotes ? `\n\n고객이 쓴 말 (개인정보는 지움)\n${quotes}` : ""}${asks}\n\n— 고객지원팀 · 같은말 자동 리포트`;
    return { subject, body };
  }
  /** 보내기 직전 마지막 검사 */
  function piiGate(mail, names) { return findPii(`${mail.subject}\n${mail.body}`, names); }

  /* ---------- 상품 개선 연결 ---------- */
  const LINK_STEPS = ["", "전달", "개선 확정"];
  const nextLink = (s) => LINK_STEPS[(LINK_STEPS.indexOf(s || "") + 1) % LINK_STEPS.length];
  const linkedCount = (links) => Object.values(links || {}).filter((s) => s === "개선 확정").length;

  /* ---------- CSV ---------- */
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCsv(agg) {
    const rows = [["주제", "담당 팀", "지난주", "그 전 주", "증감", "급증"], ...agg.rows.map((r) => [r.label, r.team, r.count, r.last, r.delta, r.rising ? "예" : ""])];
    return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  return { DAYS, d0, iso, addDays, md, reportWeek, nextSend, TOPICS, ETC, topicById, topicOf, findPii, scrub, aggregate, ruleSummary, allowedNumbers, numbersIn, normalizeVoc, buildMail, piiGate, LINK_STEPS, nextLink, linkedCount, csvCell, toCsv };
});
