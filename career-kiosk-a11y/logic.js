/* 또렷 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Ttoryeot, Node(테스트)에서는 require('./logic.js').
 *
 * 학교 식당 키오스크를 현장에서 관찰한 문제를 개선 제안서로 만든다.
 *   1) 측정: 화면 요소의 글자·바탕 색으로 명도 대비를 계산하고, 버튼 크기·시간 제한을 공식 기준과 비교한다
 *   2) 대조: AI가 말한 접근성 기준을 공식 지침표(OFFICIAL)와 대조한다 (포트폴리오의 '오래된 기준' 수정)
 *   3) 제안: 관찰한 문제를 분류별로 묶어 개선안으로, 우선순위는 심각도 × 빈도
 * 공식 수치가 없는 항목(소리 안내, 높이 등)과 법적 의무 여부는 판단하지 않고 사람(담당 부서)에게 넘긴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Ttoryeot = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 공식 지침표: W3C WCAG 2.2 (2023년 10월 권고안) 원문과 대조해 적은 값 ---------- */
  const VERSION = "2.2";
  const OFFICIAL = {
    contrast: { sc: "1.4.3", name: "명도 대비(최소)", level: "AA", rule: "일반 글자 4.5:1 이상, 큰 글자(24px 이상 또는 굵게 18.66px 이상) 3:1 이상", value: 4.5, large: 3 },
    "contrast-enh": { sc: "1.4.6", name: "명도 대비(강화)", level: "AAA", rule: "일반 글자 7:1 이상, 큰 글자 4.5:1 이상", value: 7, large: 4.5 },
    "non-text": { sc: "1.4.11", name: "비텍스트 대비", level: "AA", rule: "버튼 경계·아이콘 등 3:1 이상", value: 3 },
    target: { sc: "2.5.8", name: "누르는 영역 크기(최소)", level: "AA", rule: "24×24 CSS px 이상 (또는 주변 간격 확보)", value: 24 },
    "target-enh": { sc: "2.5.5", name: "누르는 영역 크기(강화)", level: "AAA", rule: "44×44 CSS px 이상", value: 44 },
    timing: { sc: "2.2.1", name: "시간 조절", level: "A", rule: "시간 제한을 끄거나, 10배 이상 늘리거나, 끝나기 전 알리고 20초 이상 여유를 주며 간단히 연장", value: 20 },
    resize: { sc: "1.4.4", name: "글자 크기 조절", level: "AA", rule: "글자를 200%까지 키워도 내용·기능이 그대로", value: 200 },
    color: { sc: "1.4.1", name: "색 사용", level: "A", rule: "색만으로 정보를 구분하지 않음", value: null },
  };
  const CATS = {
    contrast: "명도 대비", text: "글자 크기", target: "누르는 영역", time: "시간 제한", sound: "소리 안내", flow: "단계·구성", reach: "높이·위치",
  };

  /* ---------- 1) 측정 ---------- */
  function hexRgb(hex) {
    const m = String(hex || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  /** WCAG 상대 휘도 */
  function luminance(hex) {
    const rgb = hexRgb(hex);
    if (!rgb) return null;
    const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** 명도 대비 (1~21), 소수 둘째 자리에서 버림 — 4.499는 4.5로 올리지 않는다 */
  function contrast(fg, bg) {
    const a = luminance(fg), b = luminance(bg);
    if (a === null || b === null) return null;
    const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return Math.floor(r * 100) / 100;
  }
  function isLarge(px, bold) { return px >= 24 || (!!bold && px >= 18.66); }
  /** 화면 요소 하나 점검 */
  function auditEl(el) {
    const ratio = contrast(el.fg, el.bg);
    const large = isLarge(+el.px, el.bold);
    const need = large ? OFFICIAL.contrast.large : OFFICIAL.contrast.value;
    const out = { id: el.id, label: el.label, ratio, need, large, contrast: ratio === null ? "bad-input" : ratio >= need ? "pass" : "fail", target: "none" };
    if (el.w && el.h) {
      const m = Math.min(+el.w, +el.h);
      out.size = `${el.w}×${el.h}`;
      out.target = m < OFFICIAL.target.value ? "fail" : m < OFFICIAL["target-enh"].value ? "warn" : "pass";
    }
    out.text = +el.px < 18 ? "warn" : "pass"; // 18px은 공식 수치가 아니라 이 학교 식당 관찰에서 정한 권장값
    return out;
  }
  function auditTimer(t) {
    if (!t || !t.limit) return { status: "pass", msg: "시간 제한 없음" };
    if (t.extend) return { status: "pass", msg: `${t.limit}초 · 끝나기 전에 알리고 연장 가능` };
    return { status: "fail", msg: `${t.limit}초 뒤 처음 화면으로 · 알림·연장 없음` };
  }
  function auditScreen(screen) {
    const rows = (screen.els || []).map(auditEl);
    const timer = auditTimer(screen.timer);
    const fails = rows.filter((r) => r.contrast === "fail").length + rows.filter((r) => r.target === "fail").length + (timer.status === "fail" ? 1 : 0);
    const warns = rows.filter((r) => r.target === "warn").length + rows.filter((r) => r.text === "warn").length;
    return { rows, timer, fails, warns };
  }

  /* ---------- 2) AI가 말한 기준 대조 ---------- */
  /**
   * claim: {id, value?, large?, version?, level?}
   *   → {status: 'match' | 'differ' | 'unknown', official, why}
   * 공식표에 없으면 'unknown' (사람이 원문을 찾아 확인)
   */
  function verifyClaim(c) {
    const o = c && OFFICIAL[c.id];
    if (!o) return { status: "unknown", official: null, why: "공식 지침표에 없는 기준 — 원문을 찾아 사람이 확인" };
    const why = [];
    if (c.version && String(c.version) !== VERSION) why.push(`지침 버전이 WCAG ${c.version} — 지금은 ${VERSION}`);
    if (c.value !== undefined && c.value !== null && o.value !== null && +c.value !== o.value) why.push(`수치 ${c.value} — 공식은 ${o.value}`);
    if (c.large !== undefined && c.large !== null && o.large !== undefined && +c.large !== o.large) why.push(`큰 글자 ${c.large}:1 — 공식은 ${o.large}:1`);
    if (c.level && c.level !== o.level) why.push(`등급 ${c.level} — 공식은 ${o.level}`);
    return { status: why.length ? "differ" : "match", official: o, why: why.join(" · ") };
  }

  /* ---------- 3) 제안 ---------- */
  const TEMPLATES = {
    contrast: { title: "글자와 바탕의 명도 대비 높이기", action: "메뉴 버튼은 진한 바탕에 흰 글자로 바꾸고, 가격도 본문과 같은 진한 색으로", criterion: "contrast" },
    text: { title: "글자 키우기 · 크게 보기 버튼", action: "메뉴 이름 24px 이상, 첫 화면에 ‘크게 보기’ 버튼을 두어 200%까지 키워도 겹치지 않게", criterion: "resize" },
    target: { title: "버튼을 크게, 서로 떨어뜨리기", action: "수량·처음으로 버튼을 44px 이상으로 키우고 결제 버튼과 간격 두기", criterion: "target" },
    time: { title: "시간 제한 알리고 연장하기", action: "끝나기 20초 전에 ‘시간 더 쓰기’ 버튼과 남은 시간을 크게 보여 주기", criterion: "timing" },
    sound: { title: "소리 안내 더하기", action: "버튼을 누를 때와 결제가 끝날 때 소리로 알려 주고, 이어폰 연결 여부를 담당 부서와 확인", criterion: "" },
    flow: { title: "주문 단계 줄이기", action: "포인트 적립을 결제 뒤로 옮기고 ‘건너뛰기’를 큰 버튼으로, 단계를 3단계 안으로", criterion: "" },
    reach: { title: "낮은 위치에서 주문하기", action: "화면 아래쪽에 주요 버튼을 모은 ‘낮은 화면’ 모드 검토. 설치 높이 기준은 담당 부서가 관련 기준을 확인", criterion: "" },
  };
  function priorityOf(score) { return score >= 12 ? "높음" : score >= 6 ? "보통" : "낮음"; }
  /** 관찰한 문제 → 분류별 개선안 (심각도 × 빈도 합이 큰 순서) */
  function ruleProposal(obs) {
    const by = new Map();
    (obs || []).forEach((o) => { if (!by.has(o.cat)) by.set(o.cat, []); by.get(o.cat).push(o); });
    return [...by.entries()].map(([cat, list]) => {
      const t = TEMPLATES[cat] || { title: `${CATS[cat] || "기타"} 개선`, action: "현장에서 다시 관찰하고 담당 부서와 정하기", criterion: "" };
      const score = list.reduce((s, o) => s + (+o.sev || 1) * (+o.freq || 1), 0);
      return { cat, title: t.title, issues: list.map((o) => o.id), action: t.action, criterion: t.criterion, priority: priorityOf(score), score, check: t.criterion ? "match" : "human" };
    }).sort((a, b) => b.score - a.score);
  }

  const LEGAL = /법적\s*의무|의무\s*위반|위반|불법|과태료|처벌|소송/;
  /** Claude 응답 검사 → 쓸 수 없으면 null
   *  - 없는 문제 번호는 버리고, 번호가 하나도 없으면 그 항목을 버린다
   *  - 기준(criterion)은 공식표 id만. 함께 준 수치가 공식과 다르면 'differ'로 표시하고 공식값을 쓴다
   *  - 법적 판단 문장은 지우고 '담당 부서 확인'으로 넘긴다
   *  - 빠진 문제는 규칙 제안으로 채운다 */
  function normalizeProposal(d, obs) {
    if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
    const ids = new Set((obs || []).map((o) => o.id));
    const used = new Set();
    const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const items = [];
    d.items.slice(0, 10).forEach((x) => {
      if (!x || !Array.isArray(x.issues)) return;
      const iss = x.issues.map(String).filter((i) => ids.has(i) && !used.has(i));
      const title = str(x.title, 40);
      if (!iss.length || !title) return;
      iss.forEach((i) => used.add(i));
      let action = str(x.action, 140) || "담당 부서와 정하기";
      let legal = false;
      if (LEGAL.test(action)) { action = action.split(/(?<=[.。])\s*/).filter((s) => !LEGAL.test(s)).join(" ").trim(); legal = true; }
      const crit = OFFICIAL[x.criterion] ? x.criterion : "";
      let check = crit ? "match" : "human";
      if (crit && x.claimValue !== undefined && x.claimValue !== null && x.claimValue !== "") {
        if (verifyClaim({ id: crit, value: x.claimValue }).status === "differ") check = "differ";
      }
      const score = iss.reduce((s, i) => { const o = obs.find((y) => y.id === i); return s + (+o.sev || 1) * (+o.freq || 1); }, 0);
      items.push({ cat: "", title, issues: iss, action: action || "담당 부서와 정하기", criterion: crit, priority: ["높음", "보통", "낮음"].includes(x.priority) ? x.priority : priorityOf(score), score, check, legal });
    });
    if (!items.length) return null;
    const rest = (obs || []).filter((o) => !used.has(o.id));
    return { items: items.concat(ruleProposal(rest)), summary: str(d.summary, 160) };
  }

  /* ---------- 관찰 기록 ---------- */
  function addObs(list, o) {
    const text = String(o && o.text || "").trim();
    if (!CATS[o && o.cat]) return { ok: false, error: "분류를 골라 주세요" };
    if (text.length < 4) return { ok: false, error: "관찰한 내용을 한 문장으로 적어 주세요" };
    const n = (list || []).reduce((m, x) => Math.max(m, +String(x.id).slice(1) || 0), 0) + 1;
    const rec = { id: `O${n}`, cat: o.cat, text: text.slice(0, 120), who: o.who || "모든 이용자", sev: Math.min(3, Math.max(1, +o.sev || 1)), freq: Math.min(3, Math.max(1, +o.freq || 1)) };
    return { ok: true, obs: rec, list: (list || []).concat(rec) };
  }

  /** 제안서 마크다운 */
  function proposalMd(title, items, obs, audit) {
    const by = new Map((obs || []).map((o) => [o.id, o]));
    const crit = (it) => (it.criterion ? `WCAG ${VERSION} ${OFFICIAL[it.criterion].sc} ${OFFICIAL[it.criterion].name} — ${OFFICIAL[it.criterion].rule}` : "공식 수치 없음 — 담당 부서 확인");
    const lines = [`# ${title}`, "", `- 관찰한 문제 ${obs.length}개 · 개선안 ${items.length}개`];
    if (audit) lines.push(`- 화면 측정: 기준 미달 ${audit.fails}곳 · 권장 미달 ${audit.warns}곳`);
    lines.push("", "## 개선안");
    items.forEach((it, i) => {
      lines.push("", `### ${i + 1}. ${it.title} (우선순위 ${it.priority})`, `- 할 일: ${it.action}`, `- 근거 기준: ${crit(it)}${it.check === "differ" ? " (AI 수치와 달라 공식값으로 고침)" : ""}`,
        `- 관련 문제: ${it.issues.map((id) => `${id} ${by.get(id) ? by.get(id).text : ""}`).join(" / ")}`);
    });
    lines.push("", "## 공식 기준 요약 (WCAG 2.2)", ...["contrast", "target", "target-enh", "timing", "resize"].map((k) => `- ${OFFICIAL[k].sc} ${OFFICIAL[k].name} (${OFFICIAL[k].level}): ${OFFICIAL[k].rule}`));
    lines.push("", "> 이 제안서는 법적 의무 여부를 판단하지 않습니다. 설치 높이·소리 안내 등 공식 수치가 없는 항목은 학교 담당 부서가 관련 기준을 확인해 정합니다.");
    return lines.join("\n") + "\n";
  }

  return { VERSION, OFFICIAL, CATS, TEMPLATES, hexRgb, luminance, contrast, isLarge, auditEl, auditTimer, auditScreen, verifyClaim, priorityOf, ruleProposal, normalizeProposal, addObs, proposalMd };
});
