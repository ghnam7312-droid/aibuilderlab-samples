/* 천천예약 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Cheoncheon, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 * 세 덩어리:
 *   1) 예약: 진료 시간표 → 빈 시간, 본인 정보 검사, 중복 예약 막기, 화면·내보내기용 가리기
 *   2) 배치 점검: 화면 폭·글자 크기·시안(v1/v2)에 따라 버튼이 겹치는지 계산한다 (포트폴리오의 '버튼 겹침' 수정)
 *   3) 사용성 테스트: 완료율, 단계별 이탈, 메모 정리(규칙 / Claude 응답 검사), CSV
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Cheoncheon = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  const STEPS = [["dept", "진료과"], ["time", "날짜·시간"], ["info", "본인 정보"], ["confirm", "확인"]];
  const STEP_KEYS = STEPS.map((s) => s[0]);

  /* ---------- 날짜 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function dayLabel(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`; }

  /* ---------- 진료 시간표 ---------- */
  /** 평일 9~18시(점심 13~14시 쉼), 토요일 9~13시, 일요일 휴진. 30분 단위 */
  function hoursOf(dateIso) {
    const wd = d0(dateIso).getDay();
    if (wd === 0) return [];
    const end = wd === 6 ? 13 : 18;
    const out = [];
    for (let h = 9; h < end; h++) {
      if (h === 13) continue;
      out.push(`${String(h).padStart(2, "0")}:00`, `${String(h).padStart(2, "0")}:30`);
    }
    return out;
  }
  /** 오늘부터 n일. 휴진일은 closed:true */
  function days(today, n) {
    return Array.from({ length: n }, (_, i) => { const d = addDays(today, i); return { date: d, label: dayLabel(d), closed: !hoursOf(d).length }; });
  }
  /** 그날 그 과의 시간 칸. 이미 예약됐거나 지난 시간은 막는다 */
  function slots(dateIso, dept, bookings, now) {
    const taken = new Set((bookings || []).filter((b) => b.date === dateIso && b.dept === dept).map((b) => b.time));
    const past = now && now.date === dateIso ? now.time : "";
    return hoursOf(dateIso).map((t) => ({ time: t, open: !taken.has(t) && !(past && t <= past), taken: taken.has(t) }));
  }

  /* ---------- 본인 정보 ---------- */
  const digits = (s) => String(s || "").replace(/\D/g, "");
  /** 어르신이 이해할 수 있는 말로 무엇이 틀렸는지 알려 준다 */
  function checkPatient(p) {
    const err = {};
    const name = String(p && p.name || "").trim();
    if (!name) err.name = "이름을 적어 주세요";
    else if (!/^[가-힣A-Za-z ]{2,12}$/.test(name)) err.name = "이름은 한글이나 영문 2~12자로 적어 주세요";
    const ph = digits(p && p.phone);
    if (!ph) err.phone = "휴대폰 번호를 적어 주세요";
    else if (!/^01[016789]\d{7,8}$/.test(ph)) err.phone = "휴대폰 번호 10~11자리를 숫자로 적어 주세요";
    return err;
  }
  function fmtPhone(s) {
    const d = digits(s);
    if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return d;
  }
  /** 화면 확인·기록·내보내기에는 가린 값만 쓴다 */
  function maskName(n) { const s = String(n || "").trim(); return s.length <= 1 ? s : s.length === 2 ? s[0] + "*" : s[0] + "*".repeat(s.length - 2) + s[s.length - 1]; }
  function maskPhone(p) { const d = digits(p); return d.length >= 10 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : "***"; }

  /** 예약 넣기: 같은 칸 중복, 같은 번호의 같은 날 중복을 막는다 */
  function book(bookings, req) {
    const list = bookings || [];
    if (!req || !req.dept || !req.date || !req.time) return { ok: false, error: "진료과와 시간을 먼저 골라 주세요" };
    const err = checkPatient(req);
    if (Object.keys(err).length) return { ok: false, error: err.name || err.phone };
    if (!hoursOf(req.date).includes(req.time)) return { ok: false, error: "진료하지 않는 시간이에요" };
    if (list.some((b) => b.date === req.date && b.dept === req.dept && b.time === req.time)) return { ok: false, error: "방금 다른 분이 예약한 시간이에요. 다른 시간을 골라 주세요" };
    const ph = digits(req.phone);
    if (list.some((b) => b.date === req.date && b.phoneKey === ph.slice(-4) + ph.length && b.who === maskName(req.name))) return { ok: false, error: "같은 날 예약이 이미 있어요. 예약 확인에서 바꿔 주세요" };
    const code = `${req.date.slice(5).replace("-", "")}-${req.time.replace(":", "")}`;
    // 저장하는 것은 가린 이름과 번호 끝자리 표식뿐이다
    const rec = { id: `b${code}-${req.dept}`, dept: req.dept, date: req.date, time: req.time, who: maskName(req.name), phone: maskPhone(req.phone), phoneKey: ph.slice(-4) + ph.length, code };
    return { ok: true, booking: rec, bookings: list.concat(rec) };
  }

  /* ---------- 배치 점검 (버튼 겹침) ---------- */
  /** 한글 한 글자 ≈ 글자 크기, 숫자·기호 ≈ 0.6배 */
  function textW(label, px) { let w = 0; for (const ch of String(label)) w += /[가-힣]/.test(ch) ? px : ch === " " ? px * 0.3 : px * 0.6; return Math.ceil(w); }
  const PAD = 16, GAP = 8, MIN_TOUCH = 44;
  const V1_BAR = ["이전 단계로", "전화로 예약하기", "다음 단계로 이동"];
  const V2_BAR = ["이전", "전화로 예약", "다음 단계로"];
  /**
   * 시간 칸 배치.
   *   v1(처음 시안): 데스크톱 시안 그대로 4칸 고정, 높이 40px, 글자 15px
   *   v2(고친 시안): 폭과 글자 크기에 맞춰 칸 수를 다시 계산(2~4칸), 높이 56px, 글자 18px부터
   */
  function slotLayout(width, version, scale) {
    const s = scale || 1;
    const inner = width - PAD * 2;
    if (version === "v1") {
      const px = Math.round(15 * s), cols = 4;
      return { cols, px, h: 40, w: Math.floor((inner - GAP * (cols - 1)) / cols) };
    }
    const px = Math.round(18 * s);
    const need = textW("10:30", px) + 24; // 글자 + 좌우 여백
    const cols = Math.max(2, Math.min(4, Math.floor((inner + GAP) / (need + GAP))));
    return { cols, px, h: 56, w: Math.floor((inner - GAP * (cols - 1)) / cols) };
  }
  /** 아래 버튼 줄: v1은 세 개를 한 줄에, v2는 휴대폰 폭(520px 미만)이면 '다음'을 맨 위 한 줄로 */
  function barLayout(width, version, scale) {
    const s = scale || 1;
    const inner = width - PAD * 2;
    if (version === "v1") {
      // 데스크톱 시안의 긴 문구와 좌우 여백(14px)을 그대로 가져왔다
      const px = Math.round(15 * s), w = Math.floor((inner - GAP * 2) / 3);
      return { rows: 1, px, h: 40, pad: 28, items: V1_BAR.map((l) => ({ label: l, w })) };
    }
    const labels = V2_BAR;
    const px = Math.round(18 * s);
    if (width < 520) return { rows: 2, px, h: 56, pad: 12, items: [{ label: labels[2], w: inner }, { label: labels[0], w: Math.floor((inner - GAP) / 2) }, { label: labels[1], w: Math.floor((inner - GAP) / 2) }] };
    return { rows: 1, px, h: 56, pad: 12, items: labels.map((l) => ({ label: l, w: Math.floor((inner - GAP * 2) / 3) })) };
  }
  /** 겹침·작은 버튼 찾기 → [{where, kind, msg}] */
  function layoutIssues(width, version, scale) {
    const out = [];
    const sl = slotLayout(width, version, scale);
    const tw = textW("10:30", sl.px);
    if (tw + 8 > sl.w) out.push({ where: "시간 칸", kind: "overlap", msg: `글자(${tw}px)가 칸(${sl.w}px)보다 넓어 옆 칸과 겹쳐요` });
    if (sl.w < MIN_TOUCH || sl.h < MIN_TOUCH) out.push({ where: "시간 칸", kind: "small", msg: `누르는 영역 ${sl.w}×${sl.h}px — 권장 44×44px보다 작아요` });
    const bar = barLayout(width, version, scale);
    bar.items.forEach((it) => {
      const w = textW(it.label, bar.px);
      if (w + bar.pad > it.w) out.push({ where: `‘${it.label}’ 버튼`, kind: "overlap", msg: `글자(${w}px)가 버튼(${it.w}px)을 넘쳐 옆 버튼과 겹쳐요` });
    });
    if (bar.h < MIN_TOUCH) out.push({ where: "아래 버튼 줄", kind: "small", msg: `버튼 높이 ${bar.h}px — 권장 44px보다 낮아요` });
    return out;
  }

  /* ---------- 사용성 테스트 ---------- */
  function completion(trials, version) {
    const l = (trials || []).filter((t) => t.version === version);
    const done = l.filter((t) => t.done).length;
    return { done, total: l.length, pct: l.length ? Math.round((done / l.length) * 100) : 0 };
  }
  /** 단계마다 몇 명이 그 단계까지 왔는지 (포기한 단계 = 거기서 멈춤) */
  function funnel(trials, version) {
    const l = (trials || []).filter((t) => t.version === version);
    return STEPS.map(([k, label], i) => ({ key: k, label, reached: l.filter((t) => t.done || STEP_KEYS.indexOf(t.quit) >= i).length, quit: l.filter((t) => !t.done && t.quit === k).length }));
  }
  function addTrial(trials, t) {
    if (!t || !/^P\d+$/.test(t.pid || "")) return { ok: false, error: "참가자를 골라 주세요" };
    if (!["v1", "v2"].includes(t.version)) return { ok: false, error: "시안을 골라 주세요" };
    if (!t.done && !STEP_KEYS.includes(t.quit)) return { ok: false, error: "어느 단계에서 멈췄는지 골라 주세요" };
    const rec = { id: `t${(trials || []).length + 1}-${Date.now().toString(36)}`, pid: t.pid, version: t.version, done: !!t.done, quit: t.done ? "" : t.quit, memo: String(t.memo || "").trim().slice(0, 200) };
    return { ok: true, trial: rec, trials: (trials || []).concat(rec) };
  }
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  /** 참가자 코드만 쓴다 (이름·연락처 없음) */
  function trialsCsv(trials) {
    const head = ["참가자", "시안", "결과", "멈춘 단계", "메모"];
    const name = (k) => (STEPS.find((s) => s[0] === k) || ["", ""])[1];
    return "﻿" + [head].concat((trials || []).map((t) => [t.pid, t.version, t.done ? "완료" : "중도 포기", t.done ? "" : name(t.quit), t.memo])).map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  /* ---------- 메모 정리: 규칙 ---------- */
  const THEMES = [
    ["글자", /글씨|글자|작아|안 보|안보|돋보기/, "글자를 18px 이상으로, 중요한 말은 더 크게"],
    ["버튼 겹침", /겹|잘못 눌|엉뚱|옆 (칸|버튼)|손가락|다닥|붙어/, "폭에 따라 칸 수를 줄이고 버튼 높이 56px"],
    ["찾기 어려움", /어디|못 찾|안 보여|숨|없는 줄/, "다음 할 일을 한 화면에 하나만, 버튼은 아래 고정"],
    ["말이 어려움", /무슨 말|뜻|어려운 말|용어|모르겠/, "‘진료과’ 옆에 쉬운 설명, 모르면 전화 버튼"],
    ["입력 부담", /번호|입력|자판|키보드|본인 인증|인증/, "이름·휴대폰만 받고 숫자 자판으로"],
  ];
  /** 포기한 기록과 메모를 단계·주제로 묶는다 → [{step, problem, evidence, fix, count}] */
  function ruleIssues(trials, version) {
    const map = new Map();
    (trials || []).filter((t) => (!version || t.version === version) && t.memo).forEach((t) => {
      const th = THEMES.find(([, re]) => re.test(t.memo));
      if (!th && t.done) return;
      const step = t.done ? "" : t.quit;
      const key = `${step}|${th ? th[0] : "기타"}`;
      const cur = map.get(key) || { step: step ? STEPS[STEP_KEYS.indexOf(step)][1] : "전체", problem: th ? th[0] : "기타 막힘", evidence: [], fix: th ? th[2] : "다음 테스트에서 다시 관찰", count: 0 };
      cur.count++;
      if (cur.evidence.length < 2) cur.evidence.push(`${t.pid}: ${t.memo.slice(0, 40)}`);
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.count - a.count).map((x) => ({ ...x, evidence: x.evidence.join(" / ") }));
  }

  /** Claude 응답 검사 → 쓸 수 없으면 null. 의료 판단이 섞인 항목은 버린다 */
  const MEDICAL = /진단|처방|복용|약을|질환|증상으로 보|병명/;
  function normalizeIssues(d) {
    if (!d || typeof d !== "object" || !Array.isArray(d.issues)) return null;
    const names = STEPS.map((s) => s[1]);
    const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const issues = d.issues
      .filter((x) => x && str(x.problem, 80) && !MEDICAL.test(`${x.problem} ${x.fix}`))
      .slice(0, 8)
      .map((x) => ({
        step: names.includes(str(x.step, 10)) ? str(x.step, 10) : "전체",
        problem: str(x.problem, 80),
        evidence: str(x.evidence, 120),
        fix: str(x.fix, 100) || "다음 테스트에서 다시 관찰",
        count: Number.isFinite(+x.count) && +x.count > 0 ? Math.min(99, Math.round(+x.count)) : 1,
      }));
    if (!issues.length) return null;
    return { issues, summary: str(d.summary, 160) };
  }

  return { V1_BAR, V2_BAR, DAYS, STEPS, STEP_KEYS, d0, iso, addDays, dayLabel, hoursOf, days, slots, digits, checkPatient, fmtPhone, maskName, maskPhone, book, textW, slotLayout, barLayout, layoutIssues, completion, funnel, addTrial, trialsCsv, ruleIssues, normalizeIssues };
});
