/* 효과먼저 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Hyogwa, Node(테스트)에서는 require('./logic.js').
 *
 * 처음 쓴 제안서는 강사 소개가 대부분이었다. 기관이 사는 것은 강사의 경력이 아니라
 * '부모 참여율이 오르고, 만족도 숫자가 남고, 담당자 일이 줄어드는 것'이다.
 *   lint()         — 문장마다 강사 중심 / 기관 효과 / 기타로 나누고 과장 문구를 찾는다.
 *   buildProposal()— 기관 인터뷰와 패키지로 '기관의 고민 → 기대 효과 → 연간 구성 → 측정 → 비용 → 강사'
 *                    순서의 제안서를 만든다 (규칙).
 *   normalizeRewrite() — Claude가 다시 쓴 제안서를 검사한다 (과장 문장 제거, 목표 숫자 고정, 강사 소개는 맨 뒤).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Hyogwa = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 문장 점검 ---------- */
  const ORG_WORDS = ["기관", "참여율", "참여", "출석", "만족도", "부모님", "학부모", "보호자", "담당자", "운영", "평가", "보고", "실적", "지표", "설문", "예산", "센터", "복지관", "어린이집", "유치원", "가정"];
  const ME_WORDS = ["저는", "제가", "저의", "제 강의", "경력", "전공", "자격", "출강", "수상", "저서", "강사 소개", "이력", "년 동안", "년간"];
  const HYPE = ["반드시", "무조건", "100%", "최고", "최고의", "보장", "완벽", "확실히", "누구나", "획기적", "압도적"];

  function sentences(text) {
    return String(text || "").replace(/\r/g, "").split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1);
  }
  const count = (s, words) => words.filter((w) => s.includes(w)).length;
  /** 한 문장 → "me"(강사 중심) | "org"(기관 효과) | "etc" */
  function kindOf(s) {
    const me = count(s, ME_WORDS), org = count(s, ORG_WORDS);
    if (me === 0 && org === 0) return "etc";
    return org > me ? "org" : "me"; // 같으면 강사 중심으로 본다 (보수적으로)
  }
  function hypeIn(s) { return HYPE.filter((w) => s.includes(w)); }

  /**
   * 제안서 점검 → {list, ratio:{org, me}(%), etc, hype, problems, ok}
   * 비율은 '누구 이야기인가'가 드러난 문장(기관 효과 + 강사 중심) 안에서 잰다. 주제 목록 같은 기타 문장은 뺀다.
   */
  function lint(text) {
    const list = sentences(text).map((s) => ({ text: s, kind: kindOf(s), hype: hypeIn(s) }));
    const org = list.filter((x) => x.kind === "org").length, me = list.filter((x) => x.kind === "me").length;
    const base = org + me;
    const ratio = { org: base ? Math.round((org / base) * 100) : 0, me: base ? Math.round((me / base) * 100) : 0 };
    const hype = list.reduce((a, x) => a + x.hype.length, 0);
    const problems = [];
    if (list.length && ratio.org < 60) problems.push(`기관 효과 이야기가 ${ratio.org}%예요 (목표 60% 이상)`);
    if (hype) problems.push(`과장 문구 ${hype}개 — 약속할 수 없는 말은 빼요`);
    return { list, ratio, etc: list.length - base, hype, problems, ok: list.length > 0 && problems.length === 0 };
  }

  /* ---------- 가격 ---------- */
  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  const man = (n) => (n % 10000 === 0 ? `${(n / 10000).toLocaleString("ko-KR")}만 원` : won(n));
  /** 연간 패키지 금액. 천 원 아래는 버린다 */
  function price(pkg) {
    const sessions = Math.max(1, Math.min(24, Math.round(pkg.sessions || 0)));
    const per = Math.max(0, Math.round(pkg.perSession || 0));
    const disc = Math.max(0, Math.min(40, Number(pkg.discount) || 0));
    const list = per * sessions;
    const total = Math.floor((list * (1 - disc / 100)) / 1000) * 1000;
    return { sessions, per, disc, list, total, perAfter: Math.round(total / sessions), saved: list - total };
  }
  function budgetFit(total, budget) {
    if (!budget) return { kind: "unknown", gap: 0 };
    return total <= budget ? { kind: "fit", gap: budget - total } : { kind: "over", gap: total - budget };
  }

  /* ---------- 연간 구성 ---------- */
  const TOPICS = {
    "어린이집": ["영아기 애착과 반응하기", "집에서 하는 월령별 놀이", "떼쓰기 대처 대화법", "미디어 사용 약속", "배변·수면 습관 함께 잡기", "형제 갈등 다루기", "등원 거부와 분리불안", "칭찬보다 구체적으로 말하기"],
    "유치원": ["아이 마음 읽는 대화법", "놀이로 키우는 집중력", "미디어 사용 약속", "초등 입학 준비", "친구 관계와 감정 표현", "형제 갈등 다루기", "스스로 하는 생활 습관", "책 읽어 주기"],
    "복지관": ["아이 마음 읽는 대화법", "집에서 하는 월령별 놀이", "미디어 사용 약속", "부모의 감정 돌보기", "아빠와 함께하는 놀이", "조부모 양육과 소통", "떼쓰기 대처 대화법", "가족 놀이 한마당"],
  };
  /** 회차 수만큼 주제를 고르고 시작 달부터 고르게 배치 */
  function plan(type, sessions, startMonth) {
    const list = TOPICS[type] || TOPICS["복지관"];
    const n = Math.max(1, sessions);
    const gap = 12 / n;
    return Array.from({ length: n }, (_, i) => ({ month: ((startMonth - 1 + Math.floor(i * gap)) % 12) + 1, topic: list[i % list.length] + (i >= list.length ? " (심화)" : "") }));
  }

  /* ---------- 지표 ---------- */
  /** 기관이 말한 지금 숫자와, 강사가 정한 목표. 목표는 '약속'이 아니라 측정해 보고할 기준 */
  function metrics(org, pkg) {
    return [
      { name: "참여율 (신청 대비 출석)", now: org.attendNow ? `${org.attendNow}%` : "기록 없음", target: `${pkg.attendTarget}%`, how: "회차별 출석부 (강사가 작성해 전달)" },
      { name: "부모 만족도 (5점)", now: org.satisfactionNow || "조사 없음", target: `${pkg.satTarget}점`, how: "회차 끝 2분 설문 · 문항 5개" },
      { name: "담당자 준비 시간 (회당)", now: org.prepHours ? `${org.prepHours}시간` : "기록 없음", target: "30분", how: "홍보물·신청 접수·설문을 강사가 맡음" },
    ];
  }

  /** 규칙으로 만드는 효과 중심 제안서 */
  function buildProposal(org, pkg, instructor) {
    const p = price(pkg);
    const m = metrics(org, pkg);
    const pl = plan(org.type, p.sessions, pkg.startMonth || 3);
    return {
      headline: `${org.name} 부모 교육, 연 ${p.sessions}회로 참여율 ${pkg.attendTarget}%를 목표로 합니다`,
      sections: [
        { key: "pain", title: `${org.name}의 고민`, body: org.quotes.map((q) => `“${q}”`).join("\n") + (org.quotes.length ? `\n— ${org.contact} 인터뷰에서` : "") },
        { key: "effect", title: "기대 효과", body: `참여율 ${m[0].now} → ${m[0].target}, 만족도 ${m[1].now} → ${m[1].target}, 담당자 준비 시간 ${m[2].now} → ${m[2].target}을 목표로 하고, 매 회차 측정해 보고합니다.` },
        { key: "plan", title: `연간 구성 (${p.sessions}회)`, body: pl.map((x) => `${x.month}월 · ${x.topic}`).join("\n") },
        { key: "measure", title: "측정과 보고", body: `회차마다 출석부와 만족도 설문 결과를 드리고, ${p.sessions >= 6 ? "분기마다" : "반기마다"} 한 장짜리 결과 보고서를 드립니다. 기관 평가·실적 보고에 그대로 쓸 수 있는 형식입니다.` },
        { key: "cost", title: "비용", body: `회당 ${man(p.per)} × ${p.sessions}회 = ${man(p.list)}, 연간 계약 ${p.disc}% 할인 → 연 ${man(p.total)} (회당 ${man(p.perAfter)})` + (org.budget ? `\n기관 연간 예산 ${man(org.budget)} 기준 ${budgetFit(p.total, org.budget).kind === "fit" ? "예산 안" : "예산 초과 — 회차 조정 제안"}` : "") },
        { key: "me", title: "강사", body: instructor },
      ],
      metrics: m,
    };
  }

  /* ---------- Claude 응답 검사 ---------- */
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  /**
   * Claude가 다시 쓴 제안서 → 검사한 제안서 | null
   * - headline·sections(3~8개)가 없으면 null
   * - 과장 문구가 든 문장은 지운다 (removed 개수로 알린다)
   * - 강사 소개 절은 맨 뒤로, 지표·비용 숫자는 화면이 계산한 값으로 고정한다
   */
  function normalizeRewrite(data, fixed) {
    if (!data || typeof data !== "object") return null;
    const headline = str(data.headline, 80);
    if (!headline || !Array.isArray(data.sections)) return null;
    let removed = 0;
    const clean = (t) => sentences(t).filter((s) => { const h = hypeIn(s).length; removed += h ? 1 : 0; return !h; }).join(" ");
    let sections = data.sections.map((s) => s && { title: str(s.title, 30), body: clean(str(s.body, 600)) }).filter((s) => s && s.title && s.body);
    if (sections.length < 3 || sections.length > 8) return null;
    const isMe = (s) => /강사|소개/.test(s.title);
    sections = [...sections.filter((s) => !isMe(s)), ...sections.filter(isMe)];
    // 비용은 계산한 문장으로 바꾼다 (Claude가 숫자를 바꿔 쓰지 않게)
    const cost = fixed.sections.find((s) => s.key === "cost");
    const ci = sections.findIndex((s) => /비용|금액|가격/.test(s.title));
    if (ci >= 0) sections[ci] = { title: sections[ci].title, body: cost.body };
    else sections.splice(sections.filter((s) => !isMe(s)).length, 0, { title: cost.title, body: cost.body });
    return { headline: hypeIn(headline).length ? fixed.headline : headline, sections, metrics: fixed.metrics, removed };
  }

  /** 복사·인쇄용 글 */
  function toText(prop, orgName) {
    return [`[제안서] ${orgName}`, prop.headline, "", ...prop.sections.flatMap((s, i) => [`${i + 1}. ${s.title}`, s.body, ""]),
      "측정 지표", ...prop.metrics.map((m) => `- ${m.name}: 지금 ${m.now} → 목표 ${m.target} (${m.how})`), "",
      "※ 목표 수치는 측정·보고 기준이며, 결과를 약속하는 숫자가 아닙니다."].join("\n");
  }

  /* ---------- 영업 현황 ---------- */
  const STATUSES = ["제안 전", "제안함", "협의 중", "연간 계약", "보류"];
  function pipeline(orgs) {
    const proposed = orgs.filter((o) => o.status !== "제안 전").length;
    const contracts = orgs.filter((o) => o.status === "연간 계약").length;
    return { proposed, contracts, rate: proposed ? Math.round((contracts / proposed) * 100) : 0 };
  }

  return { ORG_WORDS, ME_WORDS, HYPE, sentences, kindOf, hypeIn, lint, won, man, price, budgetFit, TOPICS, plan, metrics, buildProposal, normalizeRewrite, toText, STATUSES, pipeline };
});
