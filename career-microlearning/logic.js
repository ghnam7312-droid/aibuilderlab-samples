/* 십분설계 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Sipbun, Node(테스트)에서는 require('./logic.js').
 *
 * 마이크로러닝 과정 설계서의 차시마다 세 가지를 본다.
 *   1) 학습 목표가 '행동 동사' 하나로 끝나는가 (‘이해한다’, ‘안다’는 관찰할 수 없다)
 *   2) 평가 문항이 그 동사와 짝이 맞는가 (작성한다 → 실습 과제, 구분한다 → 선택형 …, 문항에 그 행동이 들어가는가)
 *   3) 분량이 10분 안인가 (영상 + 실습 + 퀴즈)
 * 고칠 때는 규칙(ruleRewrite)이 바로 제안하고, Claude 제안이 오면 normalizeRewrite 검사를 거쳐 덮어쓴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Sipbun = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const LIMIT = 10;
  const TYPES = ["선택형", "서술형", "사례 판단", "실습 과제"];
  /* 측정할 수 있는 행동 동사: 어떤 평가와 짝이 되는지, 평가 문항에 들어가야 할 말 */
  const VERBS = {
    고른다: { re: /고를 수 있다|고른다/, level: "기억", types: ["선택형"], act: /고르/ },
    구분한다: { re: /구분할 수 있다|구분한다/, level: "이해", types: ["선택형", "사례 판단"], act: /구분/ },
    설명한다: { re: /설명할 수 있다|설명한다/, level: "이해", types: ["서술형"], act: /설명/ },
    작성한다: { re: /작성할 수 있다|작성한다/, level: "적용", types: ["실습 과제", "서술형"], act: /작성/ },
    적용한다: { re: /적용할 수 있다|적용한다/, level: "적용", types: ["사례 판단", "실습 과제"], act: /적용/ },
    시연한다: { re: /시연할 수 있다|시연한다/, level: "적용", types: ["실습 과제"], act: /시연/ },
    분석한다: { re: /분석할 수 있다|분석한다/, level: "분석", types: ["사례 판단", "서술형"], act: /분석/ },
    세운다: { re: /세울 수 있다|세운다|계획할 수 있다|계획한다/, level: "창안", types: ["실습 과제"], act: /세우|세워|계획/ },
  };
  const VERB_KEYS = Object.keys(VERBS);
  /* 관찰할 수 없는 동사 */
  const VAGUE = /이해한다|이해할 수 있다|이해하고|알 수 있다|알게 된다|안다|알고|익힌다|익힐 수 있다|느낀다|인식한다|인식하고|깨닫는다|함양한다|기른다|친숙해진다/g;
  const PHRASE = { 고른다: "고를 수 있다", 구분한다: "구분할 수 있다", 설명한다: "설명할 수 있다", 작성한다: "작성할 수 있다", 적용한다: "적용할 수 있다", 시연한다: "시연할 수 있다", 분석한다: "분석할 수 있다", 세운다: "세울 수 있다" };

  const FLAG = {
    vague: "관찰할 수 없는 동사",
    noVerb: "행동 동사가 없음",
    multiVerb: "목표 하나에 행동이 둘 이상",
    noAssess: "평가 문항이 없음",
    mismatch: "목표 동사와 평가 유형이 맞지 않음",
    noAct: "평가 문항에 목표의 행동이 없음",
    tooLong: "10분을 넘음",
    tooShort: "5분보다 짧음",
  };

  /* ---------- 목표 읽기 ---------- */
  function analyzeObjective(text) {
    const t = String(text || "").trim();
    const vague = [...new Set(t.match(VAGUE) || [])];
    const verbs = VERB_KEYS.filter((k) => VERBS[k].re.test(t));
    return { verbs, vague, measurable: verbs.length === 1 && !vague.length };
  }
  const minutes = (l) => ["video", "practice", "quiz"].reduce((n, k) => n + Math.max(0, Number((l.seg || {})[k]) || 0), 0);

  /** 차시 하나 검사 → { flags[], pair, measurable, total } */
  function checkLesson(l) {
    const a = analyzeObjective(l.objective);
    const flags = [];
    if (a.vague.length) flags.push("vague");
    if (!a.verbs.length && !a.vague.length) flags.push("noVerb");
    if (a.verbs.length + a.vague.length > 1) flags.push("multiVerb");
    const stem = String((l.assess || {}).stem || "").trim();
    const type = (l.assess || {}).type;
    let pair = false;
    if (!stem) flags.push("noAssess");
    else if (a.measurable) {
      const v = VERBS[a.verbs[0]];
      const typeOk = v.types.includes(type);
      const actOk = v.act.test(stem);
      if (!typeOk) flags.push("mismatch");
      if (!actOk) flags.push("noAct");
      pair = typeOk && actOk;
    }
    const total = minutes(l);
    if (total > LIMIT) flags.push("tooLong");
    if (total < 5) flags.push("tooShort");
    return { flags, ok: !flags.length, pair, measurable: a.measurable, verb: a.measurable ? a.verbs[0] : "", total };
  }
  function summary(lessons) {
    const cs = (lessons || []).map(checkLesson);
    return {
      n: cs.length,
      total: cs.reduce((n, c) => n + c.total, 0),
      measurable: cs.filter((c) => c.measurable).length,
      paired: cs.filter((c) => c.pair).length,
      long: cs.filter((c) => c.flags.includes("tooLong")).length,
      ready: cs.filter((c) => c.ok).length,
    };
  }

  /* ---------- 규칙으로 고치기 ---------- */
  const PICK = [
    [/중요성|필요성|목적|이유|의미|원칙/, "설명한다"],
    [/작성|쓰기|문장|메모|기록|양식/, "작성한다"],
    [/구분|차이|유형|종류/, "구분한다"],
    [/계획|일정|다음 면담/, "세운다"],
    [/원인|분석/, "분석한다"],
    [/사례|상황|판단/, "적용한다"],
    [/시연|연습|역할극|대화/, "시연한다"],
  ];
  /** 목표에서 동사를 걷어낸 '무엇을' 부분. 행동이 둘이면 동사를 고를 단서가 있는 쪽 */
  function objectPart(objective) {
    // 동사(관찰 가능·불가능 모두) 자리를 표시로 바꾼 뒤, 표시로 나눈다 → 행동마다 '무엇을' 하나씩
    let t = String(objective || "").replace(/[.。]\s*$/, "");
    VERB_KEYS.forEach((k) => { t = t.replace(new RegExp(VERBS[k].re.source, "g"), "¦"); });
    t = t.replace(VAGUE, "¦");
    const parts = t.split("¦").map((p) => p.trim()).filter(Boolean);
    const withHint = parts.filter((p) => PICK.some(([re]) => re.test(p)));
    const obj = (withHint.length ? withHint[withHint.length - 1] : parts[parts.length - 1]) || "";
    return /[을를]$/.test(obj) ? obj : obj ? `${obj}을(를)` : "";
  }
  function pickVerb(obj, l) {
    for (const [re, v] of PICK) if (re.test(obj)) return v;
    const hay = `${l.title || ""} ${l.content || ""}`;
    for (const [re, v] of PICK) if (re.test(hay)) return v;
    return "설명한다";
  }
  function assessFor(verb, obj) {
    const o = obj || "배운 내용을";
    return {
      고른다: { type: "선택형", stem: `보기에서 ${o} 고르시오.` },
      구분한다: { type: "선택형", stem: `보기 다섯 개 중 ${o} 구분하여 고르시오.` },
      설명한다: { type: "서술형", stem: `${o} 2~3문장으로 설명하시오.` },
      작성한다: { type: "실습 과제", stem: `제시된 상황에 맞게 ${o} 작성하시오.` },
      적용한다: { type: "사례 판단", stem: `사례를 읽고 ${o} 적용해 첫 대응을 고르고 이유를 쓰시오.` },
      시연한다: { type: "실습 과제", stem: `짝과 역할을 나눠 ${o} 3분 동안 시연하시오.` },
      분석한다: { type: "사례 판단", stem: `사례에서 ${o} 분석해 핵심 원인 1가지를 쓰시오.` },
      세운다: { type: "실습 과제", stem: `팀원 1명을 정해 ${o} 세우시오.` },
    }[verb];
  }
  /** 목표가 이미 측정 가능하면 동사는 두고 평가만 짝 맞춘다 */
  function ruleRewrite(l) {
    const a = analyzeObjective(l.objective);
    if (a.measurable) {
      const verb = a.verbs[0];
      const obj = objectPart(l.objective);
      const cur = l.assess || {};
      const keep = VERBS[verb].types.includes(cur.type) && VERBS[verb].act.test(cur.stem || "");
      return { objective: l.objective.trim(), verb, level: VERBS[verb].level, assessment: keep ? { type: cur.type, stem: cur.stem } : assessFor(verb, obj), reason: keep ? "목표와 평가가 이미 짝이 맞아요." : `‘${verb}’는 ${VERBS[verb].types.join("·")}으로 확인해야 해서 평가 문항을 바꿨어요.` };
    }
    const obj = objectPart(l.objective) || `${String(l.title || "이 차시 내용").trim()}을(를)`;
    const verb = pickVerb(obj, l);
    return { objective: `${obj} ${PHRASE[verb]}.`, verb, level: VERBS[verb].level, assessment: assessFor(verb, obj),
      reason: a.vague.length ? `‘${a.vague.join("’, ‘")}’는 학습자가 했는지 볼 수 없어서, ‘${verb}’로 바꾸고 그 행동을 확인하는 문항을 붙였어요.` : `행동 동사가 하나가 되도록 ‘${verb}’로 정리했어요.` };
  }

  /* ---------- Claude 응답 검사 ---------- */
  function normalizeRewrite(d) {
    if (!d || typeof d !== "object") return null;
    const objective = typeof d.objective === "string" ? d.objective.trim().slice(0, 160) : "";
    const a = analyzeObjective(objective);
    if (!a.measurable) return null;                        // 여전히 ‘이해한다’거나 행동이 둘
    const verb = a.verbs[0];
    if (d.verb && VERBS[d.verb] && d.verb !== verb) return null; // 말한 동사와 목표 문장이 다름
    const as = d.assessment && typeof d.assessment === "object" ? d.assessment : {};
    const type = String(as.type || "").trim();
    const stem = typeof as.stem === "string" ? as.stem.trim().slice(0, 240) : "";
    if (!VERBS[verb].types.includes(type) || !stem || !VERBS[verb].act.test(stem)) return null;
    return { objective, verb, level: VERBS[verb].level, assessment: { type, stem }, reason: typeof d.reason === "string" ? d.reason.trim().slice(0, 200) : "" };
  }

  /* ---------- 내보내기 ---------- */
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  function toMarkdown(course, lessons) {
    const s = summary(lessons);
    const head = `# ${course.title}\n\n- 대상: ${course.audience}\n- 차시: ${s.n}개 · 총 ${s.total}분 (차시당 ${LIMIT}분 이내)\n- 측정 가능한 목표 ${s.measurable}/${s.n} · 목표-평가 짝 ${s.paired}/${s.n}\n\n`;
    const rows = lessons.map((l, i) => {
      const c = checkLesson(l);
      return `| ${i + 1} | ${cell(l.title)} | ${cell(l.objective)} | ${cell((l.assess || {}).type)} | ${cell((l.assess || {}).stem)} | ${c.total}분 | ${c.ok ? "완료" : c.flags.map((f) => FLAG[f]).join(", ")} |`;
    });
    return head + "| 차시 | 제목 | 학습 목표 | 평가 유형 | 평가 문항 | 분량 | 확인 |\n|---|---|---|---|---|---|---|\n" + rows.join("\n") + "\n";
  }

  return { LIMIT, TYPES, VERBS, VERB_KEYS, VAGUE, PHRASE, FLAG, analyzeObjective, minutes, checkLesson, summary, objectPart, pickVerb, assessFor, ruleRewrite, normalizeRewrite, toMarkdown };
});
