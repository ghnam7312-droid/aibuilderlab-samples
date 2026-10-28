/* 맞춤사례 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Matchum, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름: 사전 설문 → diagnose(고민 순위)
 *       담당자가 준 자료 → checkMaterial(기준 검사: 사용 / 확인 필요 / 제외)
 *       → buildAiInput(공개 정보 + 설문 요약만) → 규칙 사례(ruleCases, 즉시) / Claude 사례(normalizeCases)
 *       → 제외한 자료의 수치·실명이 사례에 섞였는지 마지막 검사(leakTokens)
 *
 * 기준: AI에는 '공개 정보'와 '설문 요약'만 넣는다. 회사 내부 자료(대외비·실적·인사·실명·연락처)는
 *       화면에서 걸러 내고, 판단이 애매한 수치는 사람이 출처를 확인해야 넣는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Matchum = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 고민 분류 ---------- */
  const PAINS = {
    senior: { label: "연차 많은 팀원에게 말 꺼내기", re: /연차|선배|나이|경력 많은|고참/ },
    fear: { label: "관계가 틀어질까 피드백을 미룸", re: /불편|미루|관계|눈치|싫은 소리|상처/ },
    time: { label: "교대·원격이라 대화할 시간이 없음", re: /교대|원격|재택|시간이 없|바빠|마주칠/ },
    goal: { label: "기대치·목표를 말로 정해 두지 않음", re: /기준|목표|기대|애매|모호/ },
    conflict: { label: "팀 사이 책임 떠넘기기", re: /갈등|떠넘|부서 간|팀 간|책임/ },
    newbie: { label: "신입이 빨리 적응하지 못함", re: /신입|적응|온보딩|처음 온/ },
  };

  /** 사전 설문 → 고민 순위. 고른 항목을 세고, 자유 응답은 고르지 않은 항목만 더한다 */
  function diagnose(responses) {
    const n = responses.length;
    const cnt = Object.fromEntries(Object.keys(PAINS).map((k) => [k, 0]));
    responses.forEach((r) => {
      const picked = new Set((r.pains || []).filter((k) => PAINS[k]));
      Object.entries(PAINS).forEach(([k, p]) => { if (!picked.has(k) && r.text && p.re.test(r.text)) picked.add(k); });
      picked.forEach((k) => cnt[k]++);
    });
    const ranked = Object.entries(cnt).map(([key, c]) => ({ key, label: PAINS[key].label, count: c, percent: n ? Math.round((c / n) * 100) : 0 }))
      .filter((x) => x.count).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return { n, ranked, top: ranked.slice(0, 3) };
  }

  /* ---------- 자료 기준 검사 ---------- */
  /* 이름 + 직함 ("박정우 팀장"). '신임 팀장', '현장 반장' 같은 말은 이름이 아니므로 뺀다 */
  const TITLES = "팀장|과장|차장|부장|대리|주임|사원|반장|센터장|매니저|이사|상무";
  const SURNAMES = "김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉";
  const NOT_NAME = new Set(["신임", "현장", "담당", "해당", "모든", "우리", "센터", "생산", "품질", "신규", "전임", "후임", "차기", "여러", "일부", "선임", "공장", "물류", "라인", "개발", "영업", "인사", "본부", "지점", "매장", "각팀", "현직", "부서", "고참", "주간", "야간", "교대", "임시", "대표", "수석", "책임"]);
  function findNames(text) {
    const out = [];
    const re = new RegExp(`([가-힣]{2,3})\\s?(${TITLES})`, "g");
    let m;
    while ((m = re.exec(String(text || "")))) {
      const n = m[1];
      if (SURNAMES.includes(n[0]) && !NOT_NAME.has(n) && !NOT_NAME.has(n.slice(-2))) out.push(n);
    }
    return out;
  }

  const RULES = [
    ["block", /대외비|기밀|내부용|사내 한정|외부 유출|confidential/i, "대외비·내부용 표시"],
    ["block", /인사\s?평가|평가 등급|연봉|징계|면담 기록|퇴사 사유/, "인사 정보"],
    ["block", /[\w.+-]+@[\w-]+\.[\w.]+|01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/, "연락처"],
    ["check", /\d[\d,.]*\s?(조|억|만\s?원|원|%)/, "금액·비율 수치 — 공개 출처인지 확인"],
  ];

  /** 자료 한 건 → { verdict: ok | check | block, reasons } */
  function checkMaterial(item) {
    const text = `${item.title || ""}\n${item.text || ""}`;
    const reasons = [];
    let verdict = "ok";
    if (item.source === "internal") { verdict = "block"; reasons.push("담당자가 내부 자료로 표시"); }
    if (findNames(text).length) { verdict = "block"; reasons.push("직원 실명"); }
    RULES.forEach(([v, re, why]) => {
      if (!re.test(text)) return;
      if (v === "check" && item.source === "survey") return; // 설문 요약의 비율은 우리가 낸 숫자
      reasons.push(why);
      if (v === "block" || verdict === "ok") verdict = v === "block" ? "block" : "check";
    });
    return { verdict, reasons };
  }

  /** 실제로 AI에 넣을 자료: ok + 사람이 확인한 check. block은 확인해도 넣지 않는다 */
  function usable(materials, approved) {
    const ap = approved || {};
    return materials.filter((m) => { const v = checkMaterial(m).verdict; return v === "ok" || (v === "check" && ap[m.id]); });
  }

  /** 제외한 자료에서 '이것이 사례에 나오면 새어 나간 것'인 낱말을 뽑는다 (수치·실명·따옴표 이름) */
  function leakTokens(materials, approved) {
    const ok = new Set(usable(materials, approved).map((m) => m.id));
    const toks = new Set();
    materials.filter((m) => !ok.has(m.id)).forEach((m) => {
      const t = `${m.title || ""} ${m.text || ""}`;
      (t.match(/\d[\d,.]*\s?(조|억|만\s?원|원|%|명|건)/g) || []).forEach((x) => toks.add(x.replace(/\s/g, "")));
      findNames(t).forEach((x) => toks.add(x));
      (t.match(/[‘'"“]([^’'"”]{2,20})[’'"”]/g) || []).forEach((x) => toks.add(x.slice(1, -1)));
    });
    return [...toks].filter((x) => x.length >= 2);
  }
  function findLeaks(text, tokens) { const s = String(text || "").replace(/\s/g, ""); return tokens.filter((t) => s.includes(t.replace(/\s/g, ""))); }

  /* ---------- 업종별 말 · 규칙 사례 ---------- */
  const INDUSTRY = {
    logistics: { name: "물류", place: "물류센터", unit: "교대조", work: "출고 마감", role: "현장 반장" },
    it: { name: "IT 서비스", place: "개발 조직", unit: "스쿼드", work: "배포 일정", role: "테크 리드" },
    maker: { name: "제조", place: "생산 라인", unit: "라인", work: "품질 점검", role: "라인 반장" },
  };
  const CASES = {
    senior: ["열 살 많은 {role}", "{place}에 새로 온 팀장이 {unit}에서 가장 오래 일한 {role}에게 {work} 방식 변경을 말해야 합니다. 지난 회의에서 그는 ‘원래 이렇게 해 왔다’며 말을 끊었습니다.", "존중을 지키면서 바꿔야 할 행동을 한 문장으로 말한다면?"],
    fear: ["말 못 한 3주", "{unit} 한 명이 {work}을 계속 늦게 넘기는데, 팀장은 분위기가 나빠질까 3주째 말을 미뤘습니다. 다른 팀원들이 그 일을 대신 메우기 시작했습니다.", "오늘 5분 안에 꺼낸다면 첫 문장은 무엇일까요?"],
    time: ["마주칠 시간이 없는 팀", "{place}는 근무 시간이 엇갈려 팀장과 팀원이 한 주에 10분도 함께 있지 못합니다. 피드백은 메신저 한 줄로만 오갑니다.", "짧은 시간에 피드백을 남기는 우리 팀만의 방법은?"],
    goal: ["‘알아서 잘’의 기준", "팀장은 ‘{work}은 알아서 잘 챙겨 달라’고만 했고, 팀원은 기준을 몰라 매번 다르게 처리했습니다. 문제가 생긴 뒤에야 서로 기대가 달랐음을 알았습니다.", "이 일의 ‘잘했다’를 숫자나 행동으로 정의해 본다면?"],
    conflict: ["넘어온 공, 넘긴 공", "{work}이 밀리자 두 {unit}가 서로 상대 탓을 합니다. 팀장 회의에서도 책임 범위가 정리되지 않았습니다.", "책임 경계를 정하는 대화를 누가, 어떤 순서로 열어야 할까요?"],
    newbie: ["첫 달에 그만두겠다는 신입", "{place}에 들어온 신입이 한 달 만에 ‘무엇을 잘하고 있는지 모르겠다’며 면담을 요청했습니다. 그동안 받은 말은 지적뿐이었습니다.", "신입에게 첫 2주 동안 줄 피드백 세 가지를 고른다면?"],
  };
  /** 받침에 맞춘 조사 (을/를, 이/가, 은/는, 과/와) */
  function josa(word, j) {
    const ch = String(word).slice(-1);
    const code = ch.charCodeAt(0) - 0xac00;
    const has = code >= 0 && code < 11172 ? code % 28 !== 0 : false;
    const pair = { 을: "을를", 를: "을를", 이: "이가", 가: "이가", 은: "은는", 는: "은는", 과: "과와", 와: "과와" }[j];
    return pair ? pair[has ? 0 : 1] : j;
  }
  /** 틀의 {place}{을} 같은 자리를 업종 낱말로 채우고, 바로 뒤 조사를 받침에 맞춘다 */
  const fill = (s, v) => s.replace(/\{(\w+)\}(을|를|이|가|은|는|과|와)?/g, (_, k, j) => (v[k] || "") + (j ? josa(v[k] || "", j) : ""));

  function ruleCases(company, diag) {
    const v = INDUSTRY[company.industry] || INDUSTRY.it;
    const top = diag.top.length ? diag.top : [{ key: "fear" }, { key: "goal" }, { key: "time" }];
    const cases = top.slice(0, 3).map((p) => { const c = CASES[p.key]; return { pain: p.key, title: fill(c[0], v), situation: fill(c[1], v), question: fill(c[2], v) }; });
    const first = diag.top[0];
    return {
      diagnosis: first ? `${diag.n}명 중 ${first.percent}%가 ‘${first.label}’${josa(first.label, "을")} 가장 큰 고민으로 꼽았어요.` : "설문 응답이 없어 기본 사례로 준비했어요.",
      cases,
      opener: `${v.place}에서 지난주에 하려다 못 한 말이 있다면, 누구에게 어떤 말이었나요?`,
    };
  }

  /** 자유 응답 인용은 이름·연락처를 지우고 60자까지만 */
  function cleanQuote(t) {
    return String(t || "").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "").replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, "")
      .replace(/[가-힣]{2,3}(?=\s?(팀장|과장|차장|부장|대리|주임|사원|반장|센터장|매니저|이사|상무))/g, (m) => (findNames(`${m} 팀장`).length ? "○○" : m)).trim().slice(0, 60);
  }

  /** Claude에 보낼 입력: 공개 정보와 설문 요약만 */
  function buildAiInput(company, diag, materials, approved, responses) {
    const v = INDUSTRY[company.industry] || INDUSTRY.it;
    return {
      industry: v.name, size: company.size, topic: company.topic,
      publicFacts: usable(materials, approved).filter((m) => m.source !== "survey").map((m) => String(m.text).slice(0, 300)),
      survey: {
        n: diag.n,
        top: diag.top.map((t) => ({ key: t.key, label: t.label, percent: t.percent })),
        quotes: (responses || []).map((r) => cleanQuote(r.text)).filter((x) => x.length >= 8).slice(0, 8),
      },
    };
  }

  /* ---------- Claude 응답 검사 ---------- */
  const s = (x) => (typeof x === "string" ? x.trim() : "");
  /** 형식이 틀리면 null. 제외한 자료의 낱말이 섞인 사례는 버리고 몇 건 버렸는지 알린다 */
  function normalizeCases(d, tokens) {
    if (!d || typeof d !== "object" || !Array.isArray(d.cases)) return null;
    const toks = tokens || [];
    let dropped = 0;
    const cases = d.cases.map((c) => (c && typeof c === "object" ? { pain: PAINS[s(c.pain)] ? s(c.pain) : "", title: s(c.title), situation: s(c.situation), question: s(c.question) } : null))
      .filter((c) => c && c.title && c.situation && c.question)
      .filter((c) => { const bad = findLeaks(`${c.title} ${c.situation} ${c.question}`, toks).length > 0; if (bad) dropped++; return !bad; })
      .slice(0, 3);
    if (!cases.length) return null;
    const opener = findLeaks(s(d.opener), toks).length ? "" : s(d.opener);
    const diagnosis = findLeaks(s(d.diagnosis), toks).length ? "" : s(d.diagnosis);
    return { diagnosis, cases, opener, dropped };
  }

  /* ---------- 강의 노트 ---------- */
  function notesMd(company, diag, plan) {
    const L = [`# ${company.name} · ${company.topic} 강의 준비 노트`, "", `- 업종: ${(INDUSTRY[company.industry] || {}).name || "-"} · 규모: ${company.size}`, `- 사전 설문: ${diag.n}명`];
    diag.top.forEach((t, i) => L.push(`  ${i + 1}. ${t.label} (${t.percent}%)`));
    if (plan.diagnosis) L.push("", `> ${plan.diagnosis}`);
    L.push("", "## 오프닝 질문", plan.opener || "-", "", "## 맞춤 사례");
    plan.cases.forEach((c, i) => L.push("", `### ${i + 1}. ${c.title}`, c.situation, "", `**토론 질문** ${c.question}`));
    L.push("", "---", "근거: 공개 정보와 사전 설문 요약만 사용 (회사 내부 자료는 넣지 않음)");
    return L.join("\n");
  }

  return { PAINS, INDUSTRY, findNames, diagnose, checkMaterial, usable, leakTokens, findLeaks, josa, ruleCases, cleanQuote, buildAiInput, normalizeCases, notesMd };
});
