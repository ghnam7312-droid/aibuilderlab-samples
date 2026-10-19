/*
 * logic.js — 오답지도의 채점·분류·통계 규칙 (화면과 분리한 순수 함수)
 *
 * 브라우저에서는 window.OdapLogic, Node(테스트)에서는 require("./logic.js").
 * DOM·저장소·네트워크를 만지지 않는다.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OdapLogic = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* 오답 유형 세 가지 */
  const TYPES = { k: "개념 부족", s: "계산 실수", m: "문제 이해" };
  const LABEL2TYPE = { "개념 부족": "k", "계산 실수": "s", "문제 이해": "m" };
  const TAG2TYPE = { 개념형: "k", 계산형: "s", "서술·활용형": "m" };
  const TIP = { k: "개념 정리 노트를 다시 보고 기본 문제부터", s: "풀이를 한 줄씩 적고 검산하는 습관부터", m: "문제에서 구하는 것에 밑줄 긋는 연습부터" };
  const RX = {
    k: "다음 수업 첫 15분, 틀린 단원의 개념을 학생이 직접 설명하게 하고 기본 문제 5개로 확인",
    s: "다음 수업 첫 10분, 같은 유형 계산 5문항을 풀이 과정을 모두 적게 하고 검산 표시까지",
    m: "다음 수업 첫 10분, 서술형 2문항에서 '구하는 것'에 밑줄 긋고 식 세우기까지만 연습",
  };
  const pct = (x) => Math.round(x * 100);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  /* ───────── 샘플 반 (가상의 학생 40명, 12문항) ───────── */
  function makeSample(seed0 = 7) {
    let seed = seed0;
    const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const qs = [
      ["유리수와 순환소수", "개념형", 3, 2], ["유리수와 순환소수", "계산형", 5, 4], ["단항식의 계산", "계산형", 2, 1],
      ["단항식의 계산", "개념형", 4, 5], ["다항식의 계산", "계산형", 1, 3], ["다항식의 계산", "서술·활용형", 3, 2],
      ["일차부등식", "개념형", 2, 4], ["일차부등식", "서술·활용형", 4, 1], ["연립일차방정식", "계산형", 5, 2],
      ["연립일차방정식", "서술·활용형", 1, 4], ["일차함수와 그래프", "개념형", 3, 5], ["일차함수와 그래프", "서술·활용형", 2, 3],
    ].map((q, i) => ({ no: i + 1, unit: q[0], tag: q[1], ans: q[2], trap: q[3] }));
    const fam = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진".split("");
    const giv = ["서연", "도윤", "하은", "지호", "민준", "수아", "예준", "지유", "시우", "하린", "준서", "채원", "은우", "서진", "유나", "건우", "다인", "현우", "소율", "태윤"];
    const students = Array.from({ length: 40 }, (_, i) => {
      const skill = 0.45 + r() * 0.5;
      const ans = qs.map((q) => {
        const hard = q.tag === "서술·활용형" ? 0.15 : q.unit.includes("부등식") ? 0.1 : 0;
        if (r() < skill - hard) return q.ans;
        if (r() < 0.3) return q.trap;
        let o; do { o = 1 + Math.floor(r() * 5); } while (o === q.ans); return o;
      });
      return { name: fam[i % fam.length] + giv[(i * 7) % giv.length], ans };
    });
    return { qs, students };
  }

  /* ───────── 오답 유형 판단 (규칙) ─────────
     1) 정답이면 null  2) '계산 실수 보기'를 골랐으면 계산 실수  3) 아니면 문항 태그로 */
  function classify(q, a) {
    if (a === q.ans) return null;
    if (a === q.trap) return "s";
    return TAG2TYPE[q.tag] || "k";
  }
  function reason(q, a) {
    if (a === q.trap) return `‘계산 실수 보기’인 ${a}번을 골랐어요. 풀이 방향은 맞고 계산에서 틀렸을 가능성이 커요.`;
    return `${q.tag} 문항이라 ‘${TYPES[TAG2TYPE[q.tag] || "k"]}’으로 봤어요.`;
  }

  /** 반 전체 통계: 문항별 정답률, 유형별 오답 수, 학생별 점수 */
  function stats(qs, students) {
    const n = students.length;
    const qRate = qs.map((q, qi) => students.filter((s) => s.ans[qi] === q.ans).length / (n || 1));
    const cnt = { k: 0, s: 0, m: 0 };
    const score = students.map((s) => s.ans.reduce((ok, a, qi) => { const t = classify(qs[qi], a); if (t) cnt[t]++; return ok + (t ? 0 : 1); }, 0));
    return { n, qRate, cnt, score, wrong: cnt.k + cnt.s + cnt.m, avgScore: avg(score) };
  }
  /** 단원별 정답률 (낮은 순) */
  function unitRates(qs, qRate) {
    const m = {};
    qs.forEach((q, i) => { (m[q.unit] = m[q.unit] || []).push(qRate[i]); });
    return Object.entries(m).map(([unit, a]) => ({ unit, v: avg(a) })).sort((a, b) => a.v - b.v);
  }
  /** 다시 다룰 문항 (정답률 60% 미만) */
  const retestItems = (qRate, cut = 0.6) => qRate.map((v, i) => ({ v, i })).filter((x) => x.v < cut);

  /* ───────── 선생님 검수 ─────────
     review[k] = "y"(규칙 분류가 맞음) | "n"(틀림) · fix[k] = 선생님이 고른 진짜 유형 */
  /** 선생님이 확정한 유형 (검수 전이면 null) */
  function teacherType(review, fix, k, ruleType) {
    if (review[k] === "y") return ruleType;
    if (review[k] === "n") return fix[k] || null;
    return null;
  }
  /** 규칙 분류 일치율 — 확인한 건 중 '맞음' 비율 */
  function agreement(review) {
    let y = 0, n = 0;
    Object.values(review).forEach((v) => { if (v === "y") y++; else if (v === "n") n++; });
    return { y, n, total: y + n, rate: y + n ? y / (y + n) : null };
  }
  /** 학생 한 명의 '가장 큰 오답 유형'. labels 는 [{t}] — 같으면 k > s > m 순 */
  function mainType(labels) {
    const c = { k: 0, s: 0, m: 0 };
    labels.forEach((x) => { if (x && c[x] != null) c[x]++; });
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return best[1] ? best[0] : null;
  }
  /**
   * Claude 진단(학생 단위)과 선생님 검수 결과 비교.
   * coach: { 학생번호: {main:"k"} } · teacherMain: { 학생번호: "k" } → 둘 다 있는 학생만 센다
   */
  function coachAgreement(coach, teacherMain) {
    let same = 0, total = 0;
    Object.keys(coach).forEach((si) => {
      const c = coach[si]; const t = teacherMain[si];
      if (!c || c.mode !== "ai" || !c.main || !t) return;
      total++; if (c.main === t) same++;
    });
    return { same, total, rate: total ? same / total : null };
  }

  /* ───────── 학생 코칭 (Claude 응답 검사 · 규칙 버전) ───────── */
  /** wrong.coach 입력 만들기 */
  function coachInput(qs, student, score, classAvg, review, fix, si) {
    const wrongs = student.ans.map((a, qi) => ({ a, qi })).filter(({ a, qi }) => a !== qs[qi].ans).map(({ a, qi }) => {
      const k = si + "-" + qi; const rt = classify(qs[qi], a);
      const t = teacherType(review, fix, k, rt);
      return { no: qi + 1, unit: qs[qi].unit, tag: qs[qi].tag, chosen: a, answer: qs[qi].ans, trapChoice: a === qs[qi].trap, teacherLabel: t ? TYPES[t] : "" };
    });
    return { student: student.name, score, total: qs.length, classAvg: Math.round(classAvg * 10) / 10, wrongs };
  }
  /** Claude 응답 → {main:"k", comment, prescription}. 이상하면 null */
  function normalizeCoach(data) {
    if (!data || typeof data !== "object") return null;
    const main = LABEL2TYPE[String(data.main || "").trim()] || (TYPES[data.main] ? data.main : null);
    const comment = String(data.comment || "").trim();
    const prescription = String(data.prescription || "").trim();
    if (!main || comment.length < 8 || !prescription) return null;
    return { main, comment: comment.slice(0, 220), prescription: prescription.slice(0, 160) };
  }
  /** 규칙 버전 코칭 */
  function ruleCoach(name, labels, units, score, total) {
    const main = mainType(labels);
    if (!main) return { main: null, comment: `${name} 학생은 이번 평가에서 틀린 문항이 없어요. 지금처럼 꾸준히 복습하면 됩니다.`, prescription: "다음 단원 예습 문제 5개로 실력 유지" };
    const ratio = score / total;
    const head = ratio >= 0.8 ? "기본기는 탄탄해요." : ratio >= 0.5 ? "절반 이상 맞혔고, 고칠 부분이 분명해요." : "기초부터 다시 잡으면 금방 올라올 수 있어요.";
    return {
      main,
      comment: `${name} 학생은 ${head} 오답은 주로 ${TYPES[main]}에서 나왔고, ${units.slice(0, 2).join("·")} 단원을 보완하면 좋겠어요.`,
      prescription: RX[main],
    };
  }

  /** 학부모 문구 (알림장) */
  function msgText({ exam, name, score, total, classAvg, wrongNos, counts, units, coach }) {
    return [
      `[${exam}] ${name} 학생 결과`,
      `점수 ${score} / ${total}  (반 평균 ${classAvg.toFixed(1)})`,
      wrongNos.length ? `틀린 문항 ${wrongNos.map((q) => q + "번").join(", ")}` : "틀린 문항이 없어요. 아주 잘했습니다!",
      wrongNos.length ? `오답 유형 ${Object.entries(counts).filter((x) => x[1]).map(([k, v]) => `${TYPES[k]} ${v}개`).join(", ")}` : "",
      units.length ? `보완할 단원 ${units.join(", ")}` : "",
      coach && coach.comment ? `\n${coach.comment}` : "",
      coach && coach.prescription && wrongNos.length ? `다음 수업: ${coach.prescription}` : "",
    ].filter(Boolean).join("\n");
  }

  /* ───────── 3회 시험 추이 ─────────
     지난 두 번(1월 진단, 2월 단원)은 샘플 기록, 이번(3월)은 지금 채점 결과 */
  function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  /** 학생의 지난 점수 [1월, 2월] — 이름으로 정해지는 값이라 늘 같다. 대부분 조금씩 오른 흐름 */
  function pastScores(name, current, total) {
    const h = hash(name);
    const d1 = ((h % 7) - 1) / 1;          // -1 ~ 5
    const d2 = (((h >>> 3) % 5) - 1) / 1;  // -1 ~ 3
    const feb = Math.max(0, Math.min(total, Math.round(current - d2 * 0.6)));
    const jan = Math.max(0, Math.min(total, Math.round(feb - d1 * 0.5)));
    return [jan, feb];
  }
  const PAST = [
    { name: "1월 진단 평가", short: "1월", typeShare: { k: 0.31, s: 0.52, m: 0.17 } },
    { name: "2월 단원 평가", short: "2월", typeShare: { k: 0.24, s: 0.57, m: 0.19 } },
  ];
  /** 반 추이: [{short, avg, share}] 세 번 */
  function classTrend(qs, students, st, examShort) {
    const total = qs.length;
    const past = students.map((s, i) => pastScores(s.name, st.score[i], total));
    const w = st.wrong || 1;
    return [
      { short: PAST[0].short, name: PAST[0].name, avg: avg(past.map((p) => p[0])), share: PAST[0].typeShare },
      { short: PAST[1].short, name: PAST[1].name, avg: avg(past.map((p) => p[1])), share: PAST[1].typeShare },
      { short: examShort, name: "이번 평가", avg: st.avgScore, share: { k: st.cnt.k / w, s: st.cnt.s / w, m: st.cnt.m / w } },
    ];
  }
  /** 2월 → 이번 가장 많이 오른/떨어진 학생 */
  function movers(students, st, total, n = 5) {
    const rows = students.map((s, i) => { const p = pastScores(s.name, st.score[i], total); return { i, name: s.name, d: st.score[i] - p[1], now: st.score[i], prev: p[1] }; });
    return {
      up: rows.filter((r) => r.d > 0).sort((a, b) => b.d - a.d || b.now - a.now).slice(0, n),
      down: rows.filter((r) => r.d < 0).sort((a, b) => a.d - b.d || a.now - b.now).slice(0, n),
    };
  }

  /* ───────── 답 입력 ───────── */
  /** 붙여 넣은 답안: 한 줄에 '이름, 3 5 2 ...' 또는 '이름\t3\t5...' 또는 '이름 35214...' */
  function parseAnswerPaste(text, nq) {
    const rows = []; const bad = [];
    String(text || "").split(/\r?\n/).forEach((line, li) => {
      const t = line.trim(); if (!t) return;
      const m = t.match(/^([^\s,\t\d]+)[\s,\t]+(.+)$/);
      if (!m) { bad.push(li + 1); return; }
      let nums = m[2].replace(/[,\t]/g, " ").trim().split(/\s+/);
      if (nums.length === 1 && nums[0].length === nq) nums = nums[0].split("");
      const ans = nums.map((x) => parseInt(x, 10));
      if (ans.length !== nq || ans.some((x) => !(x >= 1 && x <= 5))) { bad.push(li + 1); return; }
      rows.push({ name: m[1], ans });
    });
    return { rows, bad };
  }

  return {
    TYPES, LABEL2TYPE, TAG2TYPE, TIP, RX, pct, avg,
    makeSample, classify, reason, stats, unitRates, retestItems,
    teacherType, agreement, mainType, coachAgreement,
    coachInput, normalizeCoach, ruleCoach, msgText,
    hash, pastScores, PAST, classTrend, movers, parseAnswerPaste,
  };
});
