/* 두문장 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.DuMunjang, Node(테스트)에서는 require('./logic.js').
 *
 * 한 대결(test)은 문구 A·B와 이벤트 기록(노출 view · 클릭 click)을 가진다.
 * 집계는 늘 markEvents()를 거친다.
 *   - 같은 방문자 · 같은 문구 · 같은 종류가 30분 안에 또 들어오면 '중복'(새로고침)으로 빼고
 *   - 노출 없이 들어온 클릭은 '노출 없음'으로 뺀다.
 * 판정은 두 비율 z검정(유의수준 5%)과 최소 표본(문구마다 노출 300회) 기준.
 * AI가 낸 새 문구 후보는 normalizeSuggest()로 과장 표현 · 지어낸 숫자 · 중복을 거른다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DuMunjang = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEDUPE_MS = 30 * 60 * 1000;
  const MIN_VIEWS = 300;
  const ALPHA = 0.05;
  const OVERCLAIM = /(무조건|100\s*%|역대급|최고의|최고|완벽|절대|대박|국내\s*1위|1등)/;

  /* ---------- 샘플 이벤트 만들기 (같은 seed면 늘 같은 결과) ---------- */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  /** gen: {seed, start, span, views:[a,b], clicks:[a,b], dupViews, dupClicks} */
  function genEvents(id, g) {
    if (!g) return [];
    const r = rng(g.seed);
    const out = [];
    const clicks = [];
    ["A", "B"].forEach((v, vi) => {
      for (let i = 0; i < g.views[vi]; i++) {
        const vid = `${id}${v}${i.toString(36)}`;
        const ts = g.start + Math.floor(r() * g.span);
        out.push({ vid, v, type: "view", ts });
        if (i < g.clicks[vi]) { const c = { vid, v, type: "click", ts: ts + 4000 + Math.floor(r() * 90000) }; out.push(c); clicks.push(c); }
      }
    });
    const views = out.filter((e) => e.type === "view");
    // 새로고침: 같은 이벤트가 2분 안에 한 번 더 들어온다
    for (let k = 0; k < (g.dupClicks || 0) && clicks.length; k++) { const e = clicks[Math.floor(r() * clicks.length)]; out.push({ ...e, ts: e.ts + 1500 + Math.floor(r() * 110000) }); }
    for (let k = 0; k < (g.dupViews || 0); k++) { const e = views[Math.floor(r() * views.length)]; out.push({ ...e, ts: e.ts + 1500 + Math.floor(r() * 110000) }); }
    return out.sort((a, b) => a.ts - b.ts);
  }

  /** 방문자 → A/B (같은 방문자는 늘 같은 문구를 본다) */
  function assignVariant(vid, testId) {
    let h = 2166136261;
    for (const ch of `${testId}:${vid}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h % 2 ? "B" : "A";
  }

  /* ---------- 중복 막기 + 집계 ---------- */
  /** 이벤트마다 counted · reason("dup" | "orphan")을 붙인다. dedupe=false면 모두 센다(고치기 전 방식) */
  function markEvents(events, dedupe = true) {
    const list = (events || []).filter((e) => e && (e.v === "A" || e.v === "B") && (e.type === "view" || e.type === "click") && Number.isFinite(e.ts))
      .slice().sort((a, b) => a.ts - b.ts);
    const last = new Map();
    const seen = new Set();
    return list.map((e) => {
      if (!dedupe) return { ...e, counted: true };
      const k = `${e.vid}|${e.v}|${e.type}`;
      const p = last.get(k);
      if (p !== undefined && e.ts - p < DEDUPE_MS) return { ...e, counted: false, reason: "dup" };
      if (e.type === "click" && !seen.has(`${e.vid}|${e.v}`)) return { ...e, counted: false, reason: "orphan" };
      last.set(k, e.ts);
      if (e.type === "view") seen.add(`${e.vid}|${e.v}`);
      return { ...e, counted: true };
    });
  }
  function tally(events, dedupe = true) {
    const res = { A: { views: 0, clicks: 0 }, B: { views: 0, clicks: 0 }, dup: 0, orphan: 0 };
    for (const e of markEvents(events, dedupe)) {
      if (!e.counted) { res[e.reason]++; continue; }
      res[e.v][e.type === "view" ? "views" : "clicks"]++;
    }
    return res;
  }

  /** 날짜별(한국 시간) 집계: 중복을 뺀 기록만 → [{day:"MM/DD", A:{views,clicks}, B:{views,clicks}}] */
  function daily(events, dedupe = true) {
    const map = new Map();
    for (const e of markEvents(events, dedupe)) {
      if (!e.counted) continue;
      const d = new Date(e.ts + 9 * 3600000);
      const key = `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, { day: key, A: { views: 0, clicks: 0 }, B: { views: 0, clicks: 0 } });
      map.get(key)[e.v][e.type === "view" ? "views" : "clicks"]++;
    }
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  /* ---------- 통계 ---------- */
  const ctr = (c, v) => (v > 0 ? c / v : 0);
  const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
  /** 표준정규 누적분포 (Abramowitz–Stegun 7.1.26) */
  function normCdf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  /** 두 비율 z검정 → {z, p} (양측) */
  function zTest(a, b) {
    const n = a.views + b.views;
    if (!a.views || !b.views) return { z: 0, p: 1 };
    const pool = (a.clicks + b.clicks) / n;
    const se = Math.sqrt(pool * (1 - pool) * (1 / a.views + 1 / b.views));
    if (!se) return { z: 0, p: 1 };
    const z = (ctr(b.clicks, b.views) - ctr(a.clicks, a.views)) / se;
    return { z, p: 2 * (1 - normCdf(Math.abs(z))) };
  }
  /** 판정: need(표본 부족) · win(winner A|B) · tie(차이 없음 → 원래 문구 A 유지) */
  function verdict(t) {
    const { A, B } = t;
    const lack = Math.max(0, MIN_VIEWS - A.views) + Math.max(0, MIN_VIEWS - B.views);
    const { z, p } = zTest(A, B);
    const lift = ctr(A.clicks, A.views) ? ctr(B.clicks, B.views) / ctr(A.clicks, A.views) - 1 : 0;
    if (lack > 0) return { kind: "need", need: lack, p, z, lift, keep: null };
    if (p < ALPHA) { const w = z > 0 ? "B" : "A"; return { kind: "win", winner: w, keep: w, p, z, lift }; }
    return { kind: "tie", keep: "A", p, z, lift };
  }
  /** 끝난 대결들: 처음 문구(A) 평균 vs 남긴 문구 평균 */
  function summary(rows) {
    const done = rows.filter((r) => r.verdict.kind !== "need");
    const sum = (f) => done.reduce((s, r) => s + f(r), 0);
    const before = ctr(sum((r) => r.tally.A.clicks), sum((r) => r.tally.A.views));
    const after = ctr(sum((r) => r.tally[r.verdict.keep].clicks), sum((r) => r.tally[r.verdict.keep].views));
    return { done: done.length, running: rows.length - done.length, before, after, wins: done.filter((r) => r.verdict.kind === "win" && r.verdict.keep === "B").length };
  }

  /* ---------- 문구 검사 ---------- */
  const overclaim = (text) => { const m = String(text || "").match(OVERCLAIM); return m ? m[1] : ""; };
  /** 문구 속 숫자 중 facts·기존 문구에 없는 것 (지어낸 숫자) */
  function inventedNumbers(text, known) {
    const pool = new Set(String(known || "").match(/\d+/g) || []);
    return (String(text || "").match(/\d+/g) || []).filter((n) => !pool.has(n));
  }
  const factsText = (t) => [t.a, t.b, ...Object.values(t.facts || {})].join(" ");
  const squash = (s) => String(s || "").replace(/[\s.,!?·~'"“”‘’]/g, "");

  /** 규칙 후보: 문구 속 사실(facts)만 다시 배치한다. 새 사실을 만들지 않는다 */
  function ruleSuggest(t, keep) {
    const f = t.facts || {};
    const base = keep === "B" ? t.b : t.a;
    const first = base.split(/[.!?·]/)[0].trim();
    const head = first.split(",")[0].trim();
    const core = head.length >= 10 ? head : first;
    const raw = [
      f.seats && { angle: "숫자 먼저", text: `${f.seats}명만 받아요 · ${core}` },
      f.benefit && { angle: "혜택 먼저", text: `${f.benefit} · ${core}` },
      f.who && f.when && { angle: "질문으로", text: `${f.who}, ${f.when} 비어 있나요?` },
      f.deadline && { angle: "마감 강조", text: `${f.deadline} 마감 · ${core}` },
    ].filter(Boolean);
    return clean(raw, t).items.slice(0, 3);
  }
  /** 후보 거르기 공통: 길이 · 과장 · 지어낸 숫자 · 기존 문구와 중복 */
  function clean(list, t) {
    const dropped = { overclaim: 0, invented: 0, dup: 0, bad: 0 };
    const items = [];
    const known = factsText(t);
    const have = new Set([squash(t.a), squash(t.b)]);
    for (const c of list) {
      const text = String((c && c.text) || "").replace(/^["'“‘]+|["'”’]+$/g, "").trim();
      if (text.length < 8 || text.length > 70) { dropped.bad++; continue; }
      if (overclaim(text)) { dropped.overclaim++; continue; }
      if (inventedNumbers(text, known).length) { dropped.invented++; continue; }
      if (have.has(squash(text))) { dropped.dup++; continue; }
      have.add(squash(text));
      items.push({ text, angle: String(c.angle || "").trim().slice(0, 12) || "새 각도", why: String(c.why || "").trim().slice(0, 80) });
    }
    return { items, dropped };
  }
  /** Claude 응답 검사: {candidates:[{text, angle, why}]} → {items, dropped} 또는 null */
  function normalizeSuggest(data, t) {
    if (!data || typeof data !== "object" || !Array.isArray(data.candidates)) return null;
    const r = clean(data.candidates.slice(0, 5), t);
    r.items = r.items.slice(0, 3);
    return r.items.length ? r : null;
  }

  /** 다음 대결: 남긴 문구(A) vs 새 후보(B), 기록 없음 */
  function nextTest(t, keep, cand, id) {
    return { id, name: `${t.name} 2차`, goal: t.goal, a: keep === "B" ? t.b : t.a, b: cand.text, bByAi: true, facts: { ...(t.facts || {}) }, gen: null, live: [] };
  }


  /* ---------- 샘플: 마케팅 학회 '클릭랩'의 행사 홍보 6쌍 (가상) ---------- */
  function sampleTests() {
    const day = (m, d) => Date.UTC(2026, m - 1, d, 0, 0, 0);
    const W = 6 * 86400000;
    return [
      { id: "t1", name: "신입 부원 모집", goal: "모집 글 클릭", a: "마케팅 학회 클릭랩에서 2학기 신입 부원을 모집합니다.", b: "광고 하나로 클릭률 바꿔 볼 사람, 클릭랩으로 와요",
        facts: { who: "마케팅이 궁금한 새내기", when: "9/12(금) 저녁", where: "경영관 204호", benefit: "첫 모임 피자 제공", seats: "30", deadline: "9/10(수)" },
        gen: { seed: 11, start: day(9, 1), span: W, views: [980, 975], clicks: [17, 33], dupClicks: 48, dupViews: 40 }, live: [] },
      { id: "t2", name: "현직 마케터 특강", goal: "특강 신청 클릭", a: "현직 퍼포먼스 마케터 초청 특강 안내", b: "광고비 0원으로 첫 고객 모은 이야기, 1시간 특강", bByAi: true,
        facts: { who: "광고 일 해 보고 싶은 사람", when: "9/24(수) 18시", where: "경영관 대강의실", benefit: "질문 시간 30분", seats: "80", deadline: "9/22(월)" },
        gen: { seed: 23, start: day(9, 15), span: W, views: [1040, 1032], clicks: [19, 34], dupClicks: 50, dupViews: 52 }, live: [] },
      { id: "t3", name: "가을 플리마켓", goal: "참여 신청 클릭", a: "학생회관 앞 가을 플리마켓에 놀러 오세요", b: "안 입는 옷이 커피값 되는 날, 가을 플리마켓", bByAi: true,
        facts: { who: "옷장 정리할 사람", when: "10/2(목) 낮", where: "학생회관 앞", benefit: "판매 자리 무료" },
        gen: { seed: 37, start: day(9, 26), span: W, views: [860, 870], clicks: [16, 14], dupClicks: 28, dupViews: 30 }, live: [] },
      { id: "t4", name: "데이터 분석 스터디", goal: "스터디 신청 클릭", a: "구글 시트로 배우는 데이터 분석 스터디원 모집", b: "엑셀 함수 몰라도 괜찮아요, 6주 뒤엔 대시보드를 만들어요",
        facts: { who: "숫자 앞에서 작아지는 사람", when: "매주 화요일 저녁", benefit: "실습 시트 제공", seats: "12", deadline: "10/8(수)" },
        gen: { seed: 41, start: day(10, 3), span: W, views: [720, 715], clicks: [13, 27], dupClicks: 38, dupViews: 25 }, live: [] },
      { id: "t5", name: "광고 공모전 팀원", goal: "팀 지원 클릭", a: "광고 공모전 함께 나갈 팀원 구해요", b: "기획 1명, 디자인 1명만 더 오면 출품합니다", bByAi: true,
        facts: { who: "공모전 처음인 사람", when: "10/20(월)부터 3주", benefit: "지난 출품작 자료 공유", seats: "2", deadline: "10/17(금)" },
        gen: { seed: 53, start: day(10, 10), span: W, views: [900, 905], clicks: [15, 29], dupClicks: 42, dupViews: 33 }, live: [] },
      { id: "t6", name: "연말 네트워킹 데이", goal: "참석 신청 클릭", a: "클릭랩 연말 네트워킹 데이에 초대합니다", b: "졸업한 선배 12명이 직접 오는 연말 모임",
        facts: { who: "진로 고민 중인 3·4학년", when: "12/5(금) 19시", where: "경영관 라운지", benefit: "선배와 1:1 대화", seats: "40", deadline: "12/1(월)" },
        gen: { seed: 67, start: day(10, 24), span: 4 * 86400000, views: [140, 136], clicks: [3, 5], dupClicks: 7, dupViews: 6 }, live: [] },
    ];
  }

  /* ---------- 내보내기 (방문자 정보 없이 집계만) ---------- */
  function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  const KIND = { need: "표본 부족", win: "승리", tie: "차이 없음" };
  function toCsv(rows) {
    const head = ["대결", "문구A", "문구B", "A노출", "A클릭", "A클릭률", "B노출", "B클릭", "B클릭률", "판정", "남긴문구", "p값", "중복제외"];
    const body = rows.map((r) => [r.test.name, r.test.a, r.test.b, r.tally.A.views, r.tally.A.clicks, pct(ctr(r.tally.A.clicks, r.tally.A.views), 2),
      r.tally.B.views, r.tally.B.clicks, pct(ctr(r.tally.B.clicks, r.tally.B.views), 2),
      r.verdict.kind === "win" ? `${r.verdict.winner} ${KIND.win}` : KIND[r.verdict.kind], r.verdict.keep || "", r.verdict.p.toFixed(3), r.tally.dup + r.tally.orphan]);
    return "﻿" + [head, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  return { sampleTests, DEDUPE_MS, MIN_VIEWS, ALPHA, rng, genEvents, assignVariant, markEvents, tally, daily, ctr, pct, normCdf, zTest, verdict, summary, overclaim, inventedNumbers, ruleSuggest, normalizeSuggest, nextTest, csvCell, toCsv };
});
