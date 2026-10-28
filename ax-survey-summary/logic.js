/* 빠짐없이 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Ppajim, Node(테스트)에서는 require('./logic.js').
 *
 * 교육 만족도 서술형 응답을 '주제 × 좋음/아쉬움' 의견 묶음으로 나누고 요약한다.
 * 핵심 기준: **minCount(기본 3)명 이상이 말한 의견은 요약에서 빠지면 안 된다.**
 *   - 규칙 요약은 기준 이상인 묶음을 모두 '주요 의견'으로, 1~2명 의견은 '기타 의견'으로 따로 둔다(지우지 않는다).
 *   - Claude 요약이 기준 이상인 묶음을 빠뜨리면 ensureKept()가 규칙 묶음을 되살리고 표시한다.
 * 응답 속 전화번호·메일·사번은 화면과 AI 입력 전에 가린다(maskPII).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Ppajim = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /** 주제 사전: 낱말이 들어간 구절을 그 주제로 본다. fix = 아쉬움일 때 다음 교육 개선 항목 */
  const TOPICS = [
    { key: "practice", label: "실습 시간", words: ["실습", "직접 해", "따라 해", "따라하", "손으로"], fix: "실습 시간 늘리기" },
    { key: "pace", label: "진행 속도", words: ["속도", "빨라", "빨랐", "빠르", "천천히", "따라가기"], fix: "진도 나누기 · 중간 확인 넣기" },
    { key: "teacher", label: "강사 설명", words: ["설명", "강사", "강의력", "질문에 답"], fix: "설명 방식 보완" },
    { key: "example", label: "실무 예제", words: ["예제", "실무", "업무에", "사례", "바로 쓸", "바로 써"], fix: "부서별 실무 예제 추가" },
    { key: "material", label: "자료 제공", words: ["자료", "교안", "녹화", "다시 보", "복습"], fix: "교안·녹화본 사후 제공" },
    { key: "room", label: "교육장 환경", words: ["모니터", "교육장", "의자", "에어컨", "와이파이", "자리"], fix: "교육장 모니터·좌석 점검" },
    { key: "schedule", label: "교육 시간대", words: ["시간대", "금요일", "퇴근", "일정", "요일"], fix: "교육 요일·시간대 조정" },
    { key: "break", label: "쉬는 시간", words: ["쉬는 시간", "휴식", "쉬는시간"], fix: "쉬는 시간 확보" },
    { key: "group", label: "조별 활동", words: ["조별", "토론", "팀 활동", "옆 사람"], fix: "조별 활동 방식 보완" },
  ];
  const NEG = ["아쉬", "부족", "짧", "힘들", "어려", "불편", "빨라", "빨랐", "빠르", "작아", "작았", "늦", "피곤", "없어", "없었", "안 보", "안 됐", "끊", "춥", "더웠", "했으면", "좋겠", "필요", "주시면", "주세요", "늘려", "줄여", "있으면", "있었으면", "급했", "졸렸", "을 것 같"];
  const POS = ["좋았", "좋아", "유익", "만족", "도움", "최고", "감사", "재미", "쉽게", "이해가 잘", "알찼", "명확", "친절"];

  /* ---------- 개인정보 가리기 ---------- */
  function maskPII(text) {
    return String(text || "")
      .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, "[전화번호]")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[메일]")
      .replace(/\b[A-Za-z]\d{5,7}\b/g, "[사번]");
  }

  /* ---------- 읽기 ---------- */
  /** "점수<탭 또는 |>의견" 한 줄씩. 점수가 없으면 null */
  function parseResponses(text) {
    const out = [];
    String(text || "").split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || /^(점수|번호)\s*[\t|,]/.test(t)) return;
      const m = t.match(/^([1-5])\s*[\t|]\s*(.*)$/);
      const score = m ? Number(m[1]) : null;
      const body = maskPII((m ? m[2] : t).trim());
      if (body) out.push({ id: out.length + 1, score, text: body });
    });
    return out;
  }

  /** 구절 나누기: 문장부호, '~지만', '~는데' 에서 끊는다 */
  function clauses(text) {
    return String(text).split(/[.!?\n…]+|(?<=지만|는데|고요|었고|았고)[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }
  function toneOf(clause) {
    const neg = NEG.some((w) => clause.includes(w));
    const pos = POS.some((w) => clause.includes(w));
    if (neg && !/(좋았|유익|만족)/.test(clause)) return "아쉬움";
    if (pos) return "좋음";
    return neg ? "아쉬움" : "";
  }

  /** 응답 한 건 → [{topic, tone}] (같은 주제·같은 결은 한 번) */
  function tagResponse(text) {
    const tags = [];
    const all = clauses(text);
    const whole = toneOf(text) || "좋음";
    all.forEach((c) => {
      TOPICS.forEach((tp) => {
        if (!tp.words.some((w) => c.includes(w))) return;
        const tone = toneOf(c) || whole;
        if (!tags.some((x) => x.topic === tp.key && x.tone === tone)) tags.push({ topic: tp.key, tone });
      });
    });
    return tags;
  }

  /* ---------- 규칙 요약 ---------- */
  const labelOf = (key) => (TOPICS.find((t) => t.key === key) || { label: key }).label;

  /** 의견 묶음: topic+tone 별 응답 id 목록. 많은 순 */
  function group(responses) {
    const map = new Map();
    const unclassified = [];
    responses.forEach((r) => {
      const tags = tagResponse(r.text);
      if (!tags.length) { unclassified.push(r.id); return; }
      tags.forEach((t) => {
        const k = `${t.topic}|${t.tone}`;
        if (!map.has(k)) map.set(k, { topic: t.topic, label: labelOf(t.topic), tone: t.tone, ids: [] });
        map.get(k).ids.push(r.id);
      });
    });
    const groups = [...map.values()].map((g) => ({ ...g, count: g.ids.length }))
      .sort((a, b) => b.count - a.count || (a.tone === "아쉬움" ? -1 : 1) - (b.tone === "아쉬움" ? -1 : 1) || a.label.localeCompare(b.label, "ko"));
    return { groups, unclassified };
  }

  function scoreStats(responses) {
    const scored = responses.filter((r) => r.score);
    const dist = [1, 2, 3, 4, 5].map((s) => scored.filter((r) => r.score === s).length);
    const avg = scored.length ? Math.round((scored.reduce((s, r) => s + r.score, 0) / scored.length) * 10) / 10 : 0;
    return { n: responses.length, scored: scored.length, avg, dist };
  }

  /** 기준으로 나누기: 주요(≥minCount) / 기타(그 아래) */
  function split(groups, minCount) {
    return { main: groups.filter((g) => g.count >= minCount), minor: groups.filter((g) => g.count < minCount) };
  }

  /** 예전 방식(많은 순 상위 n개만)이었다면 빠졌을 주요 의견 */
  function droppedByTopN(groups, minCount, n) {
    return groups.filter((g) => g.count >= minCount).slice(n);
  }

  /** 대표 구절: 첫 응답에서 그 주제 낱말이 든 구절 + 나머지 인원 */
  function groupSummary(g, responses) {
    const tp = TOPICS.find((t) => t.key === g.topic);
    const first = responses.find((r) => r.id === g.ids[0]);
    if (!first) return "";
    const c = clauses(first.text).find((x) => tp && tp.words.some((w) => x.includes(w))) || first.text;
    const q = c.length > 42 ? c.slice(0, 42) + "…" : c;
    return `“${q}”${g.count > 1 ? ` 외 ${g.count - 1}명` : ""}`;
  }

  function ruleSummary(responses, minCount) {
    const { groups, unclassified } = group(responses);
    const { main, minor } = split(groups, minCount);
    const s = scoreStats(responses);
    const topBad = main.find((g) => g.tone === "아쉬움");
    const topGood = main.find((g) => g.tone === "좋음");
    const lines = [
      `응답 ${s.n}명, 평균 ${s.avg}점(5점 만점)입니다.`,
      [topGood && `가장 많이 좋았던 점은 ${topGood.label}(${topGood.count}명)`, topBad && `가장 많이 아쉬웠던 점은 ${topBad.label}(${topBad.count}명)`].filter(Boolean).join(", ") + "입니다.",
      `${minCount}명 이상 나온 의견 ${main.length}개를 모두 남겼고, ${minCount - 1 > 1 ? `1~${minCount - 1}명` : "1명"} 의견 ${minor.length}개는 기타 의견으로 따로 모았습니다.`,
    ];
    const themes = main.map((g) => ({ ...g, summary: groupSummary(g, responses), source: "rule" }));
    const improvements = main.filter((g) => g.tone === "아쉬움").map((g) => TOPICS.find((t) => t.key === g.topic).fix);
    return { lines, themes, minor, unclassified, improvements };
  }

  /* ---------- Claude 응답 ---------- */
  /** 형식 검사 + id 정리. 쓸 수 없으면 null */
  function normalizeSummary(d, responses) {
    if (!d || typeof d !== "object" || !Array.isArray(d.themes) || !Array.isArray(d.lines)) return null;
    const valid = new Set(responses.map((r) => r.id));
    const themes = d.themes
      .filter((t) => t && typeof t.topic === "string" && t.topic.trim() && (t.tone === "좋음" || t.tone === "아쉬움") && Array.isArray(t.ids))
      .map((t) => {
        const ids = [...new Set(t.ids.map(Number).filter((x) => valid.has(x)))];
        return { topic: t.topic.trim().slice(0, 20), label: t.topic.trim().slice(0, 20), tone: t.tone, ids, count: ids.length, summary: typeof t.summary === "string" ? t.summary.trim().slice(0, 160) : "", source: "ai" };
      })
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count);
    const lines = d.lines.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, 3);
    if (!themes.length || !lines.length) return null;
    const improvements = (Array.isArray(d.improvements) ? d.improvements : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 5);
    return { themes, lines, improvements };
  }

  /** 규칙 묶음 g 가 AI 묶음들 안에 들어 있나: 같은 결의 한 묶음이 g 응답의 절반 이상을 담으면 들어 있다 */
  function covered(g, aiThemes) {
    return aiThemes.some((t) => t.tone === g.tone && g.ids.filter((id) => t.ids.includes(id)).length >= Math.ceil(g.count / 2));
  }

  /**
   * 소수 의견 지키기: 규칙 기준 minCount 이상인 묶음이 AI 요약에 없으면 되살린다.
   * AI 묶음 중 minCount 미만은 '기타'로 내린다.
   */
  function ensureKept(ai, rule, responses, minCount) {
    const main = ai.themes.filter((t) => t.count >= minCount);
    const aiMinor = ai.themes.filter((t) => t.count < minCount);
    const restored = rule.themes.filter((g) => !covered(g, ai.themes)).map((g) => ({ ...g, restored: true }));
    return {
      lines: ai.lines, improvements: ai.improvements.length ? ai.improvements : rule.improvements,
      themes: [...main, ...restored].sort((a, b) => b.count - a.count),
      minor: [...aiMinor.map((t) => ({ ...t })), ...rule.minor.filter((g) => !covered(g, ai.themes))],
      unclassified: rule.unclassified, restored: restored.length,
    };
  }

  /** AI 입력: 가린 응답만 */
  function aiInput(course, responses, minCount) {
    return { course, minCount, responses: responses.map((r) => ({ id: r.id, score: r.score, text: maskPII(r.text).slice(0, 300) })).slice(0, 120) };
  }

  /* ---------- 보고서 ---------- */
  function toReport(course, stats, sum, review, minCount) {
    const reviewed = sum.themes.filter((t) => review.checked[key(t)]).length;
    const adopted = sum.improvements.filter((x) => review.adopt[x]);
    const out = [
      `[${course}] 만족도 서술형 요약`,
      `응답 ${stats.n}명 · 평균 ${stats.avg}점 · 검수 ${reviewed}/${sum.themes.length}`,
      "",
      ...sum.lines.map((l) => `- ${l}`),
      "",
      `주요 의견 (${minCount}명 이상, 모두 포함)`,
      ...sum.themes.map((t) => `- [${t.tone}] ${t.label} ${t.count}명${t.restored ? " (AI 요약에서 빠져 되살림)" : ""}${review.checked[key(t)] ? "" : " · 미검수"}`),
    ];
    if (sum.minor.length) out.push("", "기타 의견 (기준 미만)", ...sum.minor.map((t) => `- [${t.tone}] ${t.label} ${t.count}명`));
    if (adopted.length) out.push("", "다음 교육 반영", ...adopted.map((x) => `- ${x}`));
    return out.join("\n");
  }
  const key = (t) => `${t.label}|${t.tone}`;

  return { TOPICS, maskPII, parseResponses, clauses, toneOf, tagResponse, labelOf, group, scoreStats, split, droppedByTopN, ruleSummary, normalizeSummary, covered, ensureKept, aiInput, toReport, key };
});
