/*
 * logic.js — 다음주의 계산 규칙 (화면과 분리한 순수 함수)
 *
 * 브라우저에서는 window.DaeumLogic, Node(테스트)에서는 require("./logic.js") 로 쓴다.
 * DOM·localStorage·네트워크를 만지지 않는다. 그래서 tests/logic.test.js 로 전부 검사할 수 있다.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DaeumLogic = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ───────── 숫자 도우미 ───────── */
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const pct = (x) => Math.round(x * 100);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* ───────── 샘플 점수 ─────────
     실제 버전은 시험 결과를 받아 오지만, 데모는 이름·단원이 같으면 늘 같은 정답률이 나오도록 해시로 만든다. */
  function hash(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rnd(seed) {
    let x = hash(seed) || 1;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  }
  /** 학생 한 명의 단원 정답률 (0~1). month 를 주면 그 달 기준 (지난달일수록 조금 낮게) */
  function rate(academyId, student, unitName, month) {
    const base = 0.55 + rnd(academyId + student) * 0.35;          // 학생 실력
    const diff = (rnd(academyId + unitName) - 0.5) * 0.3;         // 단원 난이도
    const noise = (rnd(student + unitName) - 0.5) * 0.45;         // 개인 편차
    const ago = month == null ? 0 : month;                         // 0 = 이번 달, 1 = 지난달 ...
    const grow = ago * (0.025 + rnd(student + "grow") * 0.03);    // 다니는 동안 조금씩 오른다
    return clamp(base + diff + noise - grow, 0.15, 1);
  }
  /** [{name, r}] — 단원표 순서 그대로 */
  function rates(academy, student, month) {
    return academy.units.map((u) => ({ name: u[1], r: rate(academy.id, student, u[1], month) }));
  }

  /* ───────── 보완 단원 · 다음 주 계획 (규칙 버전) ───────── */
  /** 정답률이 낮은 단원 n개. 같으면 단원표 순서가 앞선 것 */
  function weakUnits(rs, n = 3) {
    return rs.map((x, i) => ({ ...x, i }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, n)
      .map(({ i, ...x }) => x);
  }
  /** 보완 단원으로 요일이 들어간 계획 3줄을 만든다. 정답률이 낮을수록 문항 수를 늘린다 */
  function rulePlan(weak) {
    const q = (r, lo, hi) => Math.round((lo + (1 - r) * (hi - lo)) / 2) * 2;   // 짝수 문항
    const w = weak;
    return [
      w[0] ? `월·수 ${w[0].name} 개념 복습, 기본 문제 ${q(w[0].r, 8, 16)}문항` : "월·수 이번 주 단원 복습",
      w[1] ? `목 ${w[1].name} 틀린 유형만 ${q(w[1].r, 6, 12)}문항` : "목 오답 다시 풀기",
      w[2] ? `토 ${w[2].name} 포함 누적 테스트 15분` : "토 누적 테스트 15분",
    ];
  }
  /** 학부모 카톡 첫 문장 (규칙 버전) */
  function ruleMessage(student, rs) {
    const a = pct(avg(rs.map((x) => x.r)));
    const best = [...rs].sort((x, y) => y.r - x.r)[0];
    const head = a >= 85 ? "이번 달도 안정적으로 잘 따라오고 있어요." : a >= 70 ? "이번 달 기본기는 잘 다져지고 있어요." : "이번 달은 기초를 다시 잡는 중이에요.";
    return `${student} 학생, ${head}${best ? ` 특히 ${best.name}은(는) ${pct(best.r)}%로 가장 좋았어요.` : ""}`;
  }

  /**
   * Claude 응답(academy.plan)을 검사해 화면에 쓸 수 있는 모양으로 바꾼다.
   * 형식이 어긋나면 null — 화면은 규칙 버전을 쓴다.
   */
  function normalizeAiPlan(data, unitNames) {
    if (!data || typeof data !== "object") return null;
    const plan = Array.isArray(data.plan) ? data.plan.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 3) : [];
    if (plan.length < 3) return null;
    const names = new Set(unitNames);
    const weak = (Array.isArray(data.weak) ? data.weak : []).map((s) => String(s || "").trim()).filter((s) => names.has(s)).slice(0, 3);
    const message = String(data.message || "").trim().slice(0, 140);
    return { plan: plan.map((s) => s.slice(0, 70)), weak, message };
  }

  /* ───────── 월별 추이 · 대시보드 ───────── */
  const MONTHS = ["5월", "6월", "7월", "8월", "9월", "10월"];
  /** 학생 한 명의 최근 k달 평균 정답률 [{m, v}] (오래된 달부터) */
  function trend(academy, student, k = 3) {
    const out = [];
    for (let ago = k - 1; ago >= 0; ago--) out.push({ m: MONTHS[MONTHS.length - 1 - ago], v: avg(rates(academy, student, ago).map((x) => x.r)) });
    return out;
  }
  /** 학원 전체 / 반별 6개월 평균 추이 */
  function academyTrend(academy, classOf) {
    const series = [{ name: "전체", students: academy.students }].concat(
      academy.classes.map((c) => ({ name: c, students: academy.students.filter((s) => classOf(s) === c) }))
    );
    return series.map((s) => ({
      name: s.name,
      points: MONTHS.map((m, i) => ({ m, v: avg(s.students.map((n) => avg(rates(academy, n, MONTHS.length - 1 - i).map((x) => x.r)))) })),
    }));
  }
  /** 지난달 대비 %p (반올림) */
  function deltaPoint(points) {
    if (!points || points.length < 2) return 0;
    return Math.round((points[points.length - 1].v - points[points.length - 2].v) * 1000) / 10;
  }

  /* ───────── 교재 단원표 CSV ─────────
     "교재,단원명" 두 칸. 따옴표·쉼표가 든 칸, BOM, 제목 줄을 견딘다. */
  function parseCsvLine(line) {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  /** → { units: [[교재, 단원]], skipped: 줄번호[] } */
  function parseUnitCsv(text) {
    const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/);
    const units = []; const skipped = [];
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const r = parseCsvLine(line);
      if (i === 0 && /교재|book|단원/i.test(r[0] || "") && /단원|unit|name/i.test(r[1] || "")) return; // 제목 줄
      if (r.length < 2 || !r[0] || !r[1]) { skipped.push(i + 1); return; }
      units.push([r[0].slice(0, 40), r[1].slice(0, 40)]);
    });
    return { units, skipped };
  }
  /** 학생 등록 글상자: 한 줄에 한 명, 중복·빈 줄 제거 */
  function parseStudents(text, existing = []) {
    const seen = new Set(existing);
    const added = []; const dup = [];
    String(text || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean).forEach((n) => {
      const name = n.slice(0, 12);
      if (seen.has(name)) dup.push(name); else { seen.add(name); added.push(name); }
    });
    return { added, dup };
  }

  /* ───────── 학부모 링크 (서버 없이 주소 안에 리포트를 담는다) ─────────
     JSON → UTF-8 → (deflate) → base64url. 주소 # 뒤는 서버로 가지 않아 학생 정보가 서버에 남지 않는다. */
  function bytesToB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlToBytes(s) {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  }
  const b64urlEncode = (str) => bytesToB64url(new TextEncoder().encode(str));
  const b64urlDecode = (s) => new TextDecoder().decode(b64urlToBytes(s));

  /** 압축 (브라우저·Node 18+의 CompressionStream). 없으면 null */
  async function pipeBytes(bytes, Stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw")));
    return new Uint8Array(await out.arrayBuffer());
  }
  const canZip = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

  /** 리포트 → 주소에 넣을 짧은 객체 */
  function packReport(r) {
    return {
      v: 1, a: r.academy, t: r.teacher, c: r.className, n: r.student, m: r.month,
      u: r.units.map((x) => [x.name, pct(x.r)]),
      w: r.weak, p: r.plan, msg: r.message || "", note: r.note || "",
      tr: (r.trend || []).map((x) => [x.m, pct(x.v)]),
      ai: r.ai ? 1 : 0, d: r.date || "",
    };
  }
  function unpackReport(o) {
    if (!o || o.v !== 1 || !o.n || !Array.isArray(o.u) || !Array.isArray(o.p)) return null;
    return {
      academy: String(o.a || ""), teacher: String(o.t || ""), className: String(o.c || ""), student: String(o.n), month: String(o.m || ""),
      units: o.u.filter((x) => Array.isArray(x)).map((x) => ({ name: String(x[0]), r: clamp(Number(x[1]) / 100, 0, 1) })),
      weak: (o.w || []).map(String), plan: o.p.map(String), message: String(o.msg || ""), note: String(o.note || ""),
      trend: (o.tr || []).map((x) => ({ m: String(x[0]), v: clamp(Number(x[1]) / 100, 0, 1) })),
      ai: !!o.ai, date: String(o.d || ""),
    };
  }
  /** 'j' + base64url(JSON) — 압축 없이 (동기) */
  function encodeReport(r) { return "j" + b64urlEncode(JSON.stringify(packReport(r))); }
  /** 'z' + base64url(deflate(JSON)) — QR이 촘촘해지지 않게 압축. 압축을 못 하면 'j' 형식 */
  async function encodeReportZ(r) {
    if (!canZip()) return encodeReport(r);
    const z = await pipeBytes(new TextEncoder().encode(JSON.stringify(packReport(r))), CompressionStream);
    return "z" + bytesToB64url(z);
  }
  /** 'j' 형식만 동기로 읽는다. 깨졌거나 모양이 다르면 null */
  function decodeReport(s) {
    try {
      const t = String(s || "").replace(/^#/, "");
      if (t[0] !== "j") return null;
      return unpackReport(JSON.parse(b64urlDecode(t.slice(1))));
    } catch (e) { return null; }
  }
  /** 'j'·'z' 둘 다 읽는다 (학부모 화면은 이것을 쓴다) */
  async function decodeReportAny(s) {
    const t = String(s || "").replace(/^#/, "");
    if (t[0] === "j") return decodeReport(t);
    if (t[0] !== "z" || !canZip()) return null;
    try {
      const bytes = await pipeBytes(b64urlToBytes(t.slice(1)), DecompressionStream);
      return unpackReport(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) { return null; }
  }

  /** 카카오톡에 붙일 문구 */
  function shareText(r, link) {
    return [
      `[${r.academy}] ${r.student} 학생 ${r.month} 학습 리포트`,
      r.message ? `\n${r.message}` : "",
      ``,
      `평균 정답률 ${pct(avg(r.units.map((x) => x.r)))}%`,
      `보완할 단원: ${r.weak.join(", ")}`,
      ``,
      `다음 주에는 이렇게 공부해요`,
      ...r.plan.map((l, i) => `${i + 1}. ${l}`),
      r.note ? `\n선생님 한마디: ${r.note}\n- ${r.teacher}` : "",
      link ? `\n리포트 자세히 보기: ${link}` : "",
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ───────── 요금제 (예시 가격) ───────── */
  const PLANS = [
    { id: "small", nm: "스몰", cap: 30, month: 49000, items: ["학생 30명까지", "월 리포트 무제한", "단원표 1개", "학부모 링크·QR"] },
    { id: "basic", nm: "베이직", cap: 80, month: 99000, items: ["학생 80명까지", "월 리포트 무제한", "단원표 5개", "원장 대시보드", "Claude 다음 주 계획"] },
    { id: "pro", nm: "프로", cap: 200, month: 190000, items: ["학생 200명까지", "단원표 무제한", "강사 계정 10개", "반별 비교 리포트", "카카오 알림톡 자동 발송"] },
  ];
  /** 학생 수에 맞는 요금제 (넘으면 마지막) */
  function recommendPlan(n) {
    const i = PLANS.findIndex((p) => n <= p.cap);
    return PLANS[i < 0 ? PLANS.length - 1 : i];
  }
  /** 연 결제는 2개월 무료 → 월 환산 가격 */
  function priceOf(plan, yearly) {
    return yearly ? Math.round((plan.month * 10) / 12 / 100) * 100 : plan.month;
  }
  /** 학생 1명당 월 비용 */
  function perStudent(plan, n, yearly) {
    return n > 0 ? Math.round(priceOf(plan, yearly) / n) : 0;
  }

  /* ───────── 시작하기 체크리스트 ───────── */
  function onboarding(academy, made, sent) {
    const k = (n) => academy.id + "|" + n;
    const steps = [
      { id: "units", label: "교재 단원표 올리기", done: academy.units.length >= 3, hint: "단원 3개 이상" },
      { id: "students", label: "학생 등록", done: academy.students.length >= 1, hint: "한 줄에 한 명" },
      { id: "report", label: "첫 리포트 만들기", done: academy.students.some((n) => made[k(n)]), hint: "학생 한 명이면 충분해요" },
      { id: "send", label: "학부모 링크 보내기", done: academy.students.some((n) => sent[k(n)]), hint: "링크·QR·카톡 문구" },
    ];
    return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
  }

  return {
    avg, pct, clamp, hash, rnd, rate, rates, weakUnits, rulePlan, ruleMessage, normalizeAiPlan,
    MONTHS, trend, academyTrend, deltaPoint,
    parseCsvLine, parseUnitCsv, parseStudents,
    b64urlEncode, b64urlDecode, encodeReport, encodeReportZ, decodeReport, decodeReportAny, canZip, shareText,
    PLANS, recommendPlan, priceOf, perStudent, onboarding,
  };
});
