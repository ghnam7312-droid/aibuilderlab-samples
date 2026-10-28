/* 팀한장 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.TeamHanjang, Node(테스트)에서는 require('./logic.js').
 *
 * 처음 기획은 '팀 전체 무제한 월 49,000원'이었다. 85명 회사도 49,000원이라 인당 576원이 된다.
 * 그래서 인원 구간별 요금으로 바꿨다.
 *   누적(권장): 1~5명은 기본료, 6명부터는 구간마다 정한 인당 요금을 더한다. 사람이 늘면 금액도 늘어난다.
 *   전체 적용: 인원이 속한 구간 요금을 전원에게 적용. 구간 경계에서 '한 명 늘었는데 더 싸지는' 절벽이 생긴다.
 * findCliffs() 가 그 절벽을 찾는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TeamHanjang = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PERSONAL = 5900;     // 개인 유료 구독 월 요금
  const UNLIMITED = 49000;   // 처음 기획한 '팀 전체 무제한' 월 요금
  const QUOTE_OVER = 100;    // 이 인원을 넘으면 따로 견적

  /** 기본 구간: base 는 1~5명 묶음 요금, 나머지는 인당 요금 */
  const TIERS = { base: 25000, baseSeats: 5, steps: [{ upTo: 20, per: 4500 }, { upTo: 50, per: 3800 }, { upTo: QUOTE_OVER, per: 3200 }] };

  /* ---------- 샘플: 인터뷰한 물류사 5곳 (모두 가상) ---------- */
  const COMPANIES = [
    { id: "c1", name: "한결로지스", kind: "3PL · 창고 운영", seats: 12, status: "계약", contact: "물류기획팀 과장", need: "영업팀이 아침 회의 전에 같은 뉴스를 보고 들어오게 하고 싶다", quote: "인원이 늘 때마다 다시 계약하는 건 번거로워요." },
    { id: "c2", name: "바닷길포워딩", kind: "해운 포워딩", seats: 38, status: "계약", contact: "전략팀 팀장", need: "운임·항만 소식을 영업 담당 전원이 받아야 한다", quote: "무제한이라고 하면 오히려 품질이 걱정돼요." },
    { id: "c3", name: "새솔창고", kind: "냉동·냉장 창고", seats: 7, status: "제안", contact: "대표", need: "창고 임대 시장 숫자를 매주 확인하고 싶다", quote: "개인 구독 몇 개 하는 거랑 비교해서 싸야 해요." },
    { id: "c4", name: "다온운송", kind: "화물 운송", seats: 85, status: "검토", contact: "경영지원팀 대리", need: "배차 담당자들에게 운임 소식을 공유하려 한다", quote: "사람이 많아서 인당 요금이 내려가야 해요." },
    { id: "c5", name: "푸른택배대리점협의회", kind: "택배 대리점 모임", seats: 22, status: "보류", contact: "사무국장", need: "회원 대리점에 단가 소식을 전하고 싶다", quote: "회원사마다 따로 결제하는 게 나을 수도 있어요." },
  ];
  const STATUSES = ["인터뷰", "제안", "검토", "계약", "보류"];

  /* ---------- 요금 ---------- */
  /** 누적 방식 월 요금. 0명 이하면 0, 견적 인원을 넘으면 마지막 구간 요금으로 계속 계산 */
  function graduated(seats, t) {
    t = t || TIERS;
    const n = Math.max(0, Math.floor(seats));
    if (!n) return 0;
    let total = t.base, from = t.baseSeats;
    for (const s of t.steps) {
      if (n <= from) break;
      total += (Math.min(n, s.upTo) - from) * s.per;
      from = s.upTo;
    }
    if (n > from) total += (n - from) * t.steps[t.steps.length - 1].per;
    return total;
  }
  /** 전체 적용 방식: 인원이 속한 구간의 인당 요금 × 전원 (기본 구간은 기본료) */
  function volume(seats, t) {
    t = t || TIERS;
    const n = Math.max(0, Math.floor(seats));
    if (!n) return 0;
    if (n <= t.baseSeats) return t.base;
    const step = t.steps.find((s) => n <= s.upTo) || t.steps[t.steps.length - 1];
    return n * step.per;
  }
  function price(seats, t, mode) { return mode === "volume" ? volume(seats, t) : graduated(seats, t); }

  /** 한 명 늘었는데 월 요금이 줄어드는 인원 목록 */
  function findCliffs(t, mode, max) {
    const out = [];
    for (let n = 1; n < (max || QUOTE_OVER); n++) if (price(n + 1, t, mode) < price(n, t, mode)) out.push(n + 1);
    return out;
  }
  /** 구간 표 검사 → 문제 목록 (빈 배열이면 통과) */
  function checkTiers(t, mode) {
    const p = [];
    if (!(t.base > 0)) p.push("기본료는 0원보다 커야 해요");
    let prev = t.base / t.baseSeats, from = t.baseSeats;
    t.steps.forEach((s, i) => {
      if (!(s.per > 0)) p.push(`${from + 1}~${s.upTo}명 인당 요금은 0원보다 커야 해요`);
      if (s.upTo <= from) p.push(`${i + 1}번째 구간의 끝 인원이 앞 구간보다 작아요`);
      if (s.per > prev) p.push(`${from + 1}~${s.upTo}명 인당 요금이 앞 구간보다 비싸요`);
      if (s.per >= PERSONAL) p.push(`${from + 1}~${s.upTo}명 인당 요금이 개인 구독(${won(PERSONAL)})보다 싸지 않아요`);
      prev = s.per; from = s.upTo;
    });
    const cliffs = findCliffs(t, mode);
    if (cliffs.length) p.push(`${cliffs.slice(0, 3).map((n) => `${n}명`).join(", ")}에서 한 명 늘었는데 요금이 내려가요`);
    return p;
  }

  /** 회사 한 곳 견적 */
  function quote(company, t, mode, annual) {
    const monthly = price(company.seats, t, mode);
    const yearly = annual ? monthly * 10 : monthly * 12; // 연 결제는 2개월분 할인
    return {
      seats: company.seats,
      monthly,
      perSeat: company.seats ? Math.round(monthly / company.seats) : 0,
      yearly,
      personalTotal: company.seats * PERSONAL,
      saving: company.seats * PERSONAL - monthly,
      unlimitedGap: monthly - UNLIMITED, // 무제한이었다면 덜 받았을 금액 (양수)
      overQuote: company.seats > QUOTE_OVER,
    };
  }
  /** 계약한 회사의 월 매출 합계 */
  function contractMrr(companies, t, mode) {
    return companies.filter((c) => c.status === "계약").reduce((s, c) => s + price(c.seats, t, mode), 0);
  }

  /* ---------- 글 ---------- */
  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  /** 규칙으로 쓰는 제안 메일 (AI 가 없을 때) */
  function ruleProposal(c, q, annual) {
    return {
      subject: `[아침한장] ${c.name} 팀 구독 제안 · ${c.seats}명 기준 월 ${won(q.monthly)}`,
      body: [
        `안녕하세요, ${c.name} ${c.contact}님. 아침한장입니다.`,
        `인터뷰 때 말씀하신 "${c.need}"에 맞춰 팀 구독을 제안드립니다.`,
        `${c.seats}명 기준 월 ${won(q.monthly)}이며, 인당 ${won(q.perSeat)}으로 개인 구독(${won(PERSONAL)})보다 낮습니다.`,
        annual ? `연 결제 시 2개월분을 빼 연 ${won(q.yearly)}입니다.` : `월 결제이며, 연 결제로 바꾸면 2개월분을 빼 드립니다.`,
        `인원이 늘거나 줄면 다음 달 요금에 구간대로 반영됩니다.`,
        `계약 조건(세금계산서, 해지, 개인정보 처리)은 담당자가 별도로 안내드리겠습니다.`,
      ].join("\n"),
      questions: ["받아 볼 분들의 메일 주소는 담당자 한 분이 모아 주실 수 있을까요?", "첫 발송을 원하는 날짜가 있으신가요?"],
    };
  }
  /** Claude 에게 보낼 입력: 계산이 끝난 숫자와 인터뷰 메모만 */
  function aiInput(c, q, annual) {
    return { company: c.name, kind: c.kind, contactRole: c.contact, need: c.need, interviewQuote: c.quote, seats: c.seats, monthly: q.monthly, perSeat: q.perSeat, personalPrice: PERSONAL, annual: !!annual, yearly: q.yearly };
  }

  /* ---------- Claude 응답 검사 ---------- */
  // 계약·법률 조건은 AI 가 쓰지 않는다: 이런 말이 든 문장은 빼고 사람이 확인한다
  const LEGAL = ["위약금", "해지", "환불", "개인정보", "세금계산서", "계약서", "법적", "책임", "손해배상", "약관"];
  function legalHits(s) { return LEGAL.filter((w) => String(s).includes(w)); }
  /** 문장 속 금액(원)·인원(명) 숫자 */
  function moneyIn(s) { return (String(s).match(/\d[\d,]*(?=\s*(원|명))/g) || []).map((x) => Number(x.replace(/,/g, ""))); }
  /** 형식이 틀리면 null. 금액·인원이 계산값과 다르면 null(통째로 버림). 계약 조건 문장은 빼고 removed 로 알린다 */
  function normalizeProposal(d, inp) {
    if (!d || typeof d !== "object" || typeof d.subject !== "string" || typeof d.body !== "string") return null;
    const subject = d.subject.trim().slice(0, 80), body = d.body.trim().slice(0, 1500);
    if (!subject || body.length < 20) return null;
    const allowed = new Set([inp.monthly, inp.perSeat, inp.personalPrice, inp.yearly, inp.seats]);
    if (moneyIn(subject + " " + body).some((n) => !allowed.has(n))) return null;
    const removed = [];
    const kept = body.split(/\n/).map((line) => line.split(/(?<=[.!?])\s+/).filter((s) => {
      if (legalHits(s).length) { removed.push(s.trim()); return false; }
      return true;
    }).join(" ")).filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
    const questions = (Array.isArray(d.questions) ? d.questions : []).filter((q) => typeof q === "string" && q.trim() && !legalHits(q).length).map((q) => q.trim().slice(0, 120)).slice(0, 3);
    return { subject, body: kept.join("\n").trim(), questions, removed };
  }

  /* ---------- 내보내기 ---------- */
  function toCsv(companies, t, mode, annual) {
    const head = "회사,업종,인원,단계,월 요금,인당,연 요금,개인 구독 합계,무제한 대비";
    const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    return [head].concat(companies.map((c) => {
      const x = quote(c, t, mode, annual);
      return [c.name, c.kind, c.seats, c.status, x.monthly, x.perSeat, x.yearly, x.personalTotal, x.unlimitedGap].map(q).join(",");
    })).join("\n") + "\n";
  }

  return { PERSONAL, UNLIMITED, QUOTE_OVER, TIERS, COMPANIES, STATUSES, graduated, volume, price, findCliffs, checkTiers, quote, contractMrr, won, ruleProposal, aiInput, LEGAL, legalHits, moneyIn, normalizeProposal, toCsv };
});
