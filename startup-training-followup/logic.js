/* 이어감 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Ieogam, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름: 담당자 인터뷰 → needSummary(무엇을 원하나) → 상품 구성(MODULES 고르기) → price(가격) · coverage(요구 충족)
 *       → 제안 문구: checkCopy(보장·단정 표현 찾기) → ruleCopy(측정 약속 문구, 즉시) / Claude 문구(normalizeCopy)
 *
 * 원칙: '효과 보장'을 약속하지 않는다. 무엇을(지표) 어떻게(방법) 언제(시점) 재서 보고하는지를 약속한다.
 *       표시·광고 문구가 괜찮은지는 AI가 판단하지 않는다. 검사기는 후보를 표시할 뿐이고, 최종 확인은 사람이 한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Ieogam = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const NEEDS = {
    report: "윗선 보고용 효과 근거",
    apply: "현업 적용 확인",
    remind: "배운 내용 잊지 않게",
    coach: "팀장이 함께 챙기기",
    refresh: "복습 기회",
  };

  /* 후속 관리 구성 요소. 가격은 예시(부가세 별도) */
  const MODULES = [
    { key: "remind", name: "주간 리마인드 퀴즈", desc: "주 1회 5문항, 메신저로 발송", perPerson: 9000, fixed: 0, need: "remind", m: { metric: "퀴즈 정답률", method: "주 1회 5문항 퀴즈 자동 채점", timing: "12주 동안 매주" } },
    { key: "task", name: "30일 현업 적용 과제", desc: "배운 대화법 1가지를 팀에서 써 보고 기록", perPerson: 15000, fixed: 0, need: "apply", m: { metric: "적용 과제 제출률", method: "과제 기록과 팀장 확인 체크", timing: "교육 후 30일" } },
    { key: "coach", name: "60일 팀장 점검", desc: "팀장이 5문항 체크리스트로 행동 변화 확인", perPerson: 0, fixed: 600000, need: "coach", m: { metric: "팀장이 확인한 행동 변화 항목 수", method: "팀장 체크리스트 5문항", timing: "교육 후 60일" } },
    { key: "refresh", name: "온라인 복습 세션", desc: "60분, 사례 다시 풀기", perPerson: 0, fixed: 500000, need: "refresh", m: { metric: "복습 세션 참석률", method: "출석 기록", timing: "교육 후 45일" } },
    { key: "report", name: "90일 효과 측정 리포트", desc: "교육 전과 같은 설문을 다시 받아 비교", perPerson: 0, fixed: 800000, need: "report", m: { metric: "역량 자가진단 점수 변화", method: "교육 전·90일 뒤 같은 설문 비교", timing: "교육 후 90일" } },
  ];
  const byKey = (k) => MODULES.find((m) => m.key === k);

  /* ---------- 인터뷰 ---------- */
  /** 인터뷰 → 요구별 몇 명이 원했는지, 1인 예산 중앙값 */
  function needSummary(interviews) {
    const n = interviews.length;
    const counts = Object.keys(NEEDS).map((k) => ({ key: k, label: NEEDS[k], count: interviews.filter((iv) => (iv.needs || []).includes(k)).length }))
      .sort((a, b) => b.count - a.count);
    const b = interviews.map((iv) => Number(iv.budget)).filter((x) => x > 0).sort((x, y) => x - y);
    const median = b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : 0;
    return { n, counts, budgetMedian: median };
  }

  /** 고른 구성이 담당자 요구를 얼마나 채우나: 요구를 모두 채운 담당자 수 */
  function coverage(interviews, selected) {
    const have = new Set(selected.map((k) => byKey(k)).filter(Boolean).map((m) => m.need));
    const full = interviews.filter((iv) => (iv.needs || []).length && iv.needs.every((x) => have.has(x)));
    const missing = {};
    interviews.forEach((iv) => (iv.needs || []).forEach((x) => { if (!have.has(x)) missing[x] = (missing[x] || 0) + 1; }));
    return { full: full.length, n: interviews.length, missing: Object.entries(missing).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ key: k, label: NEEDS[k], count: c })) };
  }

  /* ---------- 가격 ---------- */
  const won = (x) => Math.round(x / 1000) * 1000;
  /** 3개월 총액 · 월 · 1인. 50명 이상 10%, 100명 이상 15% 할인 */
  function price(selected, headcount) {
    const hc = Math.max(0, Math.floor(Number(headcount) || 0));
    const mods = selected.map(byKey).filter(Boolean);
    const sub = mods.reduce((s, m) => s + m.perPerson * hc + m.fixed, 0);
    const rate = hc >= 100 ? 0.15 : hc >= 50 ? 0.1 : 0;
    const total = won(sub * (1 - rate));
    return { headcount: hc, subtotal: sub, rate, total, monthly: won(total / 3), perHead: hc ? won(total / hc) : 0 };
  }
  const fmt = (n) => Number(n).toLocaleString("ko-KR");

  /* ---------- 문구 검사 ---------- */
  const RULES = [
    [/(효과|성과|결과|변화)(를|을|가|이)?\s?(100\s?%\s?)?보장(?!하지|할\s?수\s?없)(합니다|해\s?드립니다|됩니다|드립니다)?|보장(합니다|해\s?드립니다|됩니다)/g, "결과를 보장하는 표현", "측정"],
    [/100\s?%|백\s?퍼센트/g, "확정된 수치처럼 읽힘", "수치"],
    [/(성과|매출|생산성|실적|이직률)(이|가|을|를)?\s?(반드시|무조건|확실히|틀림없이)?\s?(\d+\s?%\s?)?(오릅니다|올라갑니다|오른다|향상됩니다|향상시킵니다|늘어납니다|줄어듭니다|개선됩니다)/g, "재지 않는 성과를 약속함", "성과"],
    [/반드시|무조건|확실히|틀림없이|100\s?프로/g, "단정 표현", "단정"],
  ];
  /** 문구 → 걸린 표현 목록 [{phrase, reason, kind, at}] */
  function checkCopy(text) {
    const s = String(text || "");
    const out = [];
    RULES.forEach(([re, reason, kind]) => { re.lastIndex = 0; let m; while ((m = re.exec(s))) { if (!out.some((o) => m.index >= o.at && m.index < o.at + o.phrase.length)) out.push({ phrase: m[0], reason, kind, at: m.index }); } });
    return out.sort((a, b) => a.at - b.at);
  }

  /** 받침에 맞춘 조사: 을/를, 으로/로 (ㄹ 받침은 '로') */
  function josa(word, j) {
    const code = String(word).slice(-1).charCodeAt(0) - 0xac00;
    const last = code >= 0 && code < 11172 ? code % 28 : 0;
    if (j === "을") return last ? "을" : "를";
    if (j === "으로") return last && last !== 8 ? "으로" : "로";
    return j;
  }
  /** 측정 약속 한 문장 */
  const promiseLine = (p) => `${p.timing}${/매주$|동안$/.test(p.timing) ? "" : "에"} ${p.metric}${josa(p.metric, "을")} ${p.method}${josa(p.method, "으로")} 재서 보고합니다`;

  /** 걸린 표현을 '측정 약속'으로 바꾼 문장 (규칙). 문장 단위로 바꾼다 */
  function fixCopy(text, selected) {
    const mods = selected.map(byKey).filter(Boolean);
    // 바꿀 문장마다 다른 지표를 쓴다 (효과 리포트부터)
    const queue = [...mods.filter((m) => m.key === "report"), ...mods.filter((m) => m.key !== "report")];
    if (!queue.length) queue.push(MODULES[4]);
    let qi = 0;
    const out = [];
    String(text || "").split(/(?<=[.!?。])\s+|\n/).forEach((sen) => {
      const f = checkCopy(sen);
      if (!f.length) { out.push(sen); return; }
      if (f.some((x) => x.kind !== "단정")) {
        const line = `${promiseLine(queue[qi % queue.length].m)}.`;
        if (qi < queue.length && !out.includes(line)) out.push(line);
        qi++; return;
      }
      out.push(sen.replace(/\s?(반드시|무조건|확실히|틀림없이|100\s?프로)\s?/g, " ").replace(/\s{2,}/g, " ").trim());
    });
    return out.filter(Boolean).join(" ");
  }

  /** 문구에 고른 구성의 지표가 몇 개 들어갔나 */
  function promiseCheck(text, selected) {
    const s = String(text || "");
    const mods = selected.map(byKey).filter(Boolean);
    return { total: mods.length, named: mods.filter((m) => s.includes(m.m.metric)).length, missing: mods.filter((m) => !s.includes(m.m.metric)).map((m) => m.m.metric) };
  }

  /** 규칙 문구: 고른 구성에서 바로 만든다 */
  function ruleCopy(selected, sum, p) {
    const mods = selected.map(byKey).filter(Boolean);
    const top = sum.counts[0];
    return {
      headline: "교육 뒤 90일, 무엇이 바뀌었는지 재서 보고합니다",
      pitch: `${top ? `인터뷰한 담당자 ${sum.n}명 중 ${top.count}명이 ‘${top.label}’${josa(top.label, "을")} 원했습니다. ` : ""}강의 한 번으로 끝내지 않고 ${mods.map((m) => m.name).join(", ")}${mods.length ? "로" : ""} 3개월 동안 이어 갑니다.${p && p.headcount ? ` ${p.headcount}명 기준 월 ${fmt(p.monthly)}원(예시)입니다.` : ""}`,
      promises: mods.map((m) => ({ ...m.m })),
    };
  }

  /* ---------- Claude 응답 검사 ---------- */
  const str = (x) => (typeof x === "string" ? x.trim() : "");
  /** 형식이 틀리거나, AI가 쓴 문구에 보장·단정 표현이 있으면 null */
  function normalizeCopy(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const headline = str(d.headline), pitch = str(d.pitch);
    if (!headline || !pitch) return null;
    const promises = (Array.isArray(d.promises) ? d.promises : []).map((p) => (p && typeof p === "object" ? { metric: str(p.metric), method: str(p.method), timing: str(p.timing) } : null))
      .filter((p) => p && p.metric && p.method && p.timing).slice(0, 6);
    if (!promises.length) return null;
    const all = [headline, pitch, ...promises.map((p) => `${p.metric} ${p.method} ${p.timing}`)].join("\n");
    if (checkCopy(all).length) return null;
    const flags = (Array.isArray(d.flags) ? d.flags : []).filter((f) => f && str(f.phrase)).map((f) => ({ phrase: str(f.phrase), reason: str(f.reason), rewrite: checkCopy(str(f.rewrite)).length ? "" : str(f.rewrite) })).slice(0, 6);
    return { headline, pitch, promises, flags };
  }

  /* ---------- 제안서 ---------- */
  function proposalText(client, copy, selected, p) {
    const mods = selected.map(byKey).filter(Boolean);
    const L = [`[제안] ${client} · 3개월 교육 후속 관리`, "", copy.headline, "", copy.pitch, "", "■ 구성"];
    mods.forEach((m) => L.push(`  - ${m.name}: ${m.desc}`));
    L.push("", "■ 측정 약속 (지표 · 방법 · 시점)");
    copy.promises.forEach((x) => L.push(`  - ${x.metric} · ${x.method} · ${x.timing}`));
    L.push("", `■ 예시 가격 (${p.headcount}명, 부가세 별도): 3개월 ${fmt(p.total)}원 · 월 ${fmt(p.monthly)}원 · 1인 ${fmt(p.perHead)}원${p.rate ? ` (${Math.round(p.rate * 100)}% 할인 반영)` : ""}`);
    L.push("", "※ 교육 효과를 보장하지 않습니다. 위 지표를 위 방법으로 측정해 시점마다 결과를 그대로 보고합니다.");
    return L.join("\n");
  }

  return { josa, NEEDS, MODULES, needSummary, coverage, price, fmt, checkCopy, fixCopy, promiseCheck, promiseLine, ruleCopy, normalizeCopy, proposalText };
});
