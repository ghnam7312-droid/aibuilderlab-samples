/* 값찾기 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Gapchatgi, Node(테스트)에서는 require('./logic.js').
 *
 * 두 가지를 한다.
 *   1) 인터뷰 질문지 검사: '쓰실 건가요?'처럼 앞으로의 마음을 묻는 질문(유도형)을 찾아
 *      '지난번엔 어떻게 하셨어요?'처럼 지난 행동을 묻는 질문으로 바꿀 안을 준다.
 *      (처음 인터뷰에서 모두 '쓸게요'라고 했는데 무료로 열자 아무도 꾸준히 쓰지 않았다)
 *   2) 가격 3안 실험 집계: 같은 사람이 여러 가격을 보지 않게 한 사람에게 한 안만 보여 주고,
 *      말로 한 관심이 아니라 '선결제(예약금)'만 결제로 센다. 기대 매출 = 가격 × 결제율.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gapchatgi = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const KINDS = ["미래 가정", "동의 유도", "가격 직접 묻기", "지난 행동", "보통"];
  const LEADING = new Set(["미래 가정", "동의 유도", "가격 직접 묻기"]);

  /* ---------- 질문 검사 ---------- */
  const RX = {
    price: /얼마(면|까지|를\s*내|정도면)|(\d+\s*(만\s*)?원|유료)(이면|라면|이라도).*(쓰|내|결제|하)/,
    future: /(실\s*(건|거)가요|겠어요|겠습니까|하실\s*(건|거)|쓰실\s*(건|거)|이용하실|사용하실|의향|(을|를)?\s*쓸\s*것\s*같|하실\s*것\s*같|면\s*(쓰|하|사)\S*까요)/,
    agree: /(좋을\s*것\s*같지|좋지\s*않|필요하시죠|편하시겠죠|되겠죠|겠죠\s*\?|않으세요\s*\?|않나요\s*\?|그렇죠|맞죠|싶지\s*않으세요)/,
    past: /(지난|최근|마지막으로|그때|해\s*보신|하신\s*적|쓰신\s*적|써\s*보신|어떻게\s*하셨|얼마나\s*자주|무엇을\s*하셨|왜\s*그만)/,
  };
  const REASON = {
    "가격 직접 묻기": "가격을 직접 물으면 실제보다 낮게, 또는 예의상 높게 말해요. 이미 쓴 돈을 물어야 해요.",
    "미래 가정": "앞으로 쓸지는 누구나 '네'라고 하기 쉬워요. 지난번에 실제로 한 일을 물어야 해요.",
    "동의 유도": "답을 정해 둔 질문이라 '그렇죠'만 돌아와요.",
    "지난 행동": "이미 한 일을 묻는 좋은 질문이에요.",
    "보통": "유도하지는 않아요. 지난 일로 바꾸면 더 구체적인 답이 와요.",
  };
  function classify(q) {
    const t = String(q || "").trim();
    if (!t) return "보통";
    if (RX.price.test(t)) return "가격 직접 묻기";
    if (RX.agree.test(t)) return "동의 유도";
    if (RX.future.test(t)) return "미래 가정";
    if (RX.past.test(t)) return "지난 행동";
    return "보통";
  }
  /** 주제에 맞는 '지난 행동' 질문 */
  function rewrite(q) {
    const t = String(q || "");
    if (/가격|얼마|돈|유료|원|결제/.test(t)) return "지난 3개월 동안 영어 회화에 돈을 쓴 적이 있나요? 어디에, 얼마를 쓰셨어요?";
    if (/숙제|연습|혼자|공부/.test(t)) return "지난 2주 동안 수업 말고 영어로 말해 본 적이 있나요? 그때 무엇을 하셨어요?";
    if (/앱|서비스|AI|첨삭|프로그램/.test(t)) return "말하기 연습에 써 본 앱이나 방법이 있나요? 얼마나 쓰다가 왜 그만두셨어요?";
    if (/수업|튜터|학원|과외/.test(t)) return "마지막으로 회화 수업을 그만둔 게 언제였나요? 그때 이유가 뭐였어요?";
    return "그 문제를 마지막으로 겪은 게 언제였나요? 그때 어떻게 해결하셨어요?";
  }
  /** 규칙 검사 한 번 */
  function checkQuestions(list) {
    return list.map((q) => {
      const kind = classify(q);
      const leading = LEADING.has(kind);
      return { q, kind, leading, reason: REASON[kind], rewrite: kind === "지난 행동" ? "" : rewrite(q) };
    });
  }
  function countLeading(items) { return items.filter((x) => x.leading).length; }

  /** Claude 응답 검사 → 쓸 수 없으면 null
   *  개수가 질문 수와 다르면 버린다. 바꾼 질문이 또 유도형이면 규칙의 안으로 바꾼다 */
  function normalizeCheck(d, questions) {
    if (!d || typeof d !== "object" || !Array.isArray(d.items) || d.items.length !== questions.length) return null;
    const out = [];
    for (let i = 0; i < questions.length; i++) {
      const it = d.items[i];
      if (!it || typeof it !== "object" || typeof it.leading !== "boolean") return null;
      const kind = KINDS.includes(it.kind) ? it.kind : it.leading ? classify(questions[i]) : "보통";
      let rw = typeof it.rewrite === "string" ? it.rewrite.trim().slice(0, 140) : "";
      let byRule = false;
      if (kind !== "지난 행동" && (!rw || LEADING.has(classify(rw)))) { rw = rewrite(questions[i]); byRule = true; }
      out.push({ q: questions[i], kind, leading: LEADING.has(kind) || (it.leading && kind !== "지난 행동"), reason: typeof it.reason === "string" && it.reason.trim() ? it.reason.trim().slice(0, 120) : REASON[kind], rewrite: kind === "지난 행동" ? "" : rw, byRule });
    }
    return out;
  }

  /* ---------- 가격 실험 ---------- */
  const REACT = ["거절", "관심", "선결제"];
  /** 반응 바꾸기: 거절 → 관심 → 선결제 → 거절 */
  function nextReaction(r) { return REACT[(REACT.indexOf(r) + 1) % REACT.length]; }

  /** 안별 집계. basis: 'paid'(선결제만) | 'interest'(관심까지) */
  function tally(people, options, basis) {
    return options.map((o) => {
      const mine = people.filter((p) => p.option === o.id);
      const paid = mine.filter((p) => p.reaction === "선결제").length;
      const interest = mine.filter((p) => p.reaction === "관심").length;
      const hit = basis === "interest" ? paid + interest : paid;
      const rate = mine.length ? hit / mine.length : 0;
      return { id: o.id, price: o.price, shown: mine.length, paid, interest, rate, per100: Math.round(o.price * rate * 100) };
    });
  }
  /** 기대 매출(100명에게 보였을 때)이 가장 큰 안. 같으면 결제율이 높은 쪽 */
  function best(rows) {
    const ok = rows.filter((r) => r.shown > 0 && r.per100 > 0);
    if (!ok.length) return null;
    return ok.slice().sort((a, b) => b.per100 - a.per100 || b.rate - a.rate)[0];
  }
  /** 지난 행동(최근 3개월 회화에 돈을 썼나)과 선결제의 관계 */
  function pastVsPaid(people) {
    const spent = people.filter((p) => p.spent > 0);
    const none = people.filter((p) => !(p.spent > 0));
    const r = (g) => ({ n: g.length, paid: g.filter((p) => p.reaction === "선결제").length });
    return { spent: r(spent), none: r(none) };
  }
  /** 12명은 방향을 보는 숫자: 안마다 사람이 적으면 알린다 */
  function sampleNote(rows) {
    const min = Math.min(...rows.map((r) => r.shown));
    if (min < 3) return "한 안에 3명 미만이라 비교하기 어려워요. 인터뷰를 더 해 주세요.";
    const max = Math.max(...rows.map((r) => r.shown));
    if (min < 10) return `안마다 ${min === max ? min : `${min}~${max}`}명이라 방향을 보는 숫자예요. 결정 뒤 첫 달 결제로 다시 확인하세요.`;
    return "";
  }

  /* ---------- 내보내기 ---------- */
  const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  function summaryMd(rows, pick, pv, qs) {
    const lines = ["## 가격 실험 요약", "", `인터뷰 ${rows.reduce((s, r) => s + r.shown, 0)}명 · 가격 ${rows.length}안 · 한 사람에게 한 안만 제시 · 선결제만 결제로 셈`, "", "| 안 | 월 가격 | 제시 | 선결제 | 결제율 | 100명당 기대 매출 |", "|---|---|---|---|---|---|"];
    rows.forEach((r) => lines.push(`| ${r.id} | ${won(r.price)} | ${r.shown}명 | ${r.paid}명 | ${pct(r.rate)} | ${won(r.per100)} |`));
    lines.push("", pick ? `**결정: 월 ${won(pick.price)}** (${pick.id}안, 100명당 기대 매출이 가장 큼)` : "**결정 보류**: 결제한 사람이 없어요.");
    lines.push("", `- 지난 3개월 회화에 돈을 쓴 사람 ${pv.spent.n}명 중 ${pv.spent.paid}명, 안 쓴 사람 ${pv.none.n}명 중 ${pv.none.paid}명이 선결제`);
    if (qs) lines.push(`- 질문지: 유도형 ${qs.leading}개를 지난 행동 질문으로 바꿈 (전체 ${qs.total}개)`);
    lines.push("- 표본이 작아 방향을 보는 숫자이며, 첫 달 결제로 다시 확인할 예정");
    return lines.join("\n");
  }
  /** CSV: 이름 대신 번호만 */
  function csv(people) {
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["번호", "구분", "최근 3개월 회화 지출(원)", "제시한 안", "반응"];
    return "﻿" + [head, ...people.map((p) => [p.code, p.seg, p.spent || 0, p.option, p.reaction])].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
  }

  return { KINDS, LEADING, REASON, classify, rewrite, checkQuestions, countLeading, normalizeCheck, REACT, nextReaction, tally, best, pastVsPaid, sampleNote, won, pct, summaryMd, csv };
});
