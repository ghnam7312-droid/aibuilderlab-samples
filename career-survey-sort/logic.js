/* 갈래 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Gallae, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름
 *   1) 서술형 응답을 받으면 먼저 개인정보(학번·전화·이메일)를 가린다. 가린 글만 화면·AI·내보내기에 쓴다.
 *   2) 괴롭힘·폭언 같은 민감한 응답은 자동 분류하지 않고 '검토 필요'로 사람에게 넘긴다(AI에도 보내지 않는다).
 *   3) 고정한 분류 기준 5개(정의 · 핵심어 · 예시)로 규칙 분류 → 같은 글이면 언제나 같은 결과.
 *   4) Claude(survey.classify)에게 같은 기준을 보내 다시 분류. 기준 밖의 이름·없는 id는 버린다.
 *   5) 사람이 검수한 응답과 자동 분류의 일치율을 숫자로 남긴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gallae = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 분류 기준 v3 (고정) ---------- */
  // strong: 2점, weak: 1점. 동점이면 아래 순서가 앞선 쪽 (언제나 같은 결과가 나오게)
  const CRITERIA = [
    { id: "c1", name: "교과과정", def: "과목 구성 · 개설 · 선수과목 · 이수 요건", strong: ["과목", "커리큘럼", "교과", "전공필수", "전공선택", "선수", "개설", "이수", "졸업요건", "학년"], weak: ["학점", "순서"],
      ex: ["회귀분석 전에 선형대수를 먼저 들어야 하는데 선수과목 안내가 없어요.", "베이즈 통계가 격년 개설이라 못 들을 것 같아요."] },
    { id: "c2", name: "수업 방식", def: "강의 진행 · 과제 · 시험 · 평가 · 피드백", strong: ["강의", "피드백", "녹화", "팀플", "진도", "질의응답", "평가", "복습"], weak: ["수업", "과제", "시험", "중간고사", "기말고사", "교수님", "조교", "데이터"],
      ex: ["과제 피드백이 늦게 와서 다음 과제에 반영을 못 했어요.", "중간고사 이후 진도가 너무 빨라요."] },
    { id: "c3", name: "실습·환경", def: "실습실 · 장비 · 소프트웨어 · 공간 · 네트워크", strong: ["실습실", "컴퓨터", "장비", "소프트웨어", "라이선스", "노트북", "공간", "와이파이", "모니터", "서버", "패키지", "세미나실", "좌석", "자리"], weak: ["실습", "시스템", "오류"],
      ex: ["실습실 컴퓨터가 오래돼서 R이 자주 멈춰요.", "스터디할 공간이 부족해요."] },
    { id: "c4", name: "진로·취업", def: "취업 · 인턴 · 자격증 · 대학원 · 선배 연결", strong: ["진로", "취업", "인턴", "자격증", "현장실습", "선배", "멘토", "포트폴리오", "대학원", "기업", "채용", "특강", "직무"], weak: ["졸업"],
      ex: ["데이터 분석 직무 취업 특강을 열어 주세요.", "졸업한 선배와 이야기할 기회가 있었으면 해요."] },
    { id: "c5", name: "학과 운영", def: "공지 · 행정 · 상담 · 행사 · 소통", strong: ["공지", "행정", "사무실", "상담", "면담", "행사", "학생회", "소통", "장학", "간담회", "홈페이지", "개강총회"], weak: ["안내", "신청", "일정"],
      ex: ["학과 공지가 여러 곳에 흩어져 있어요.", "장학금 신청 안내가 늦게 와요."] },
  ];
  const REVIEW = { id: "review", name: "검토 필요" };
  const CATS = [...CRITERIA, REVIEW];
  const CRITERIA_VERSION = "v3";
  const nameOf = (id) => (CATS.find((c) => c.id === id) || REVIEW).name;

  /* ---------- 개인정보 가리기 ---------- */
  const PII = [
    ["이메일", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[이메일]"],
    ["전화번호", /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[전화번호]"],
    ["학번", /(?<!\d)20\d{6}(?!\d)/g, "[학번]"],
  ];
  /** → { text, found: ["전화번호", ...] } */
  function maskPII(text) {
    let t = String(text ?? "");
    const found = [];
    PII.forEach(([label, re, rep]) => { if (t.match(re)) { found.push(label); t = t.replace(re, rep); } });
    return { text: t, found };
  }

  /* ---------- 민감한 응답: 사람에게 ---------- */
  const SENSITIVE = ["폭언", "괴롭힘", "괴롭혀", "성희롱", "성추행", "차별", "따돌림", "협박", "자해", "죽고", "폭행", "갑질"];
  function isSensitive(text) { const t = squash(text); return SENSITIVE.some((w) => t.includes(w)); }

  /* ---------- 규칙 분류 ---------- */
  function squash(s) { return String(s ?? "").replace(/\s+/g, "").toLowerCase(); }
  /** → { cat, score, hits, reason } 언제나 같은 입력이면 같은 출력 */
  function classifyRule(text) {
    const t = squash(text);
    if (t.length < 6) return { cat: "review", score: 0, hits: [], reason: "응답이 너무 짧아요" };
    let best = null;
    CRITERIA.forEach((c) => {
      const hits = [];
      let s = 0;
      c.strong.forEach((k) => { if (t.includes(squash(k))) { s += 2; hits.push(k); } });
      c.weak.forEach((k) => { if (t.includes(squash(k))) { s += 1; hits.push(k); } });
      if (!best || s > best.score) best = { cat: c.id, score: s, hits };
    });
    if (!best || best.score === 0) return { cat: "review", score: 0, hits: [], reason: "기준 핵심어가 없어요" };
    return { ...best, reason: `핵심어: ${best.hits.slice(0, 3).join(", ")}` };
  }

  /** 원문 → 화면용 항목 (가림 · 민감 · 규칙 분류까지) */
  function makeItem(id, raw, human) {
    const m = maskPII(raw);
    const sensitive = isSensitive(m.text);
    return { id, text: m.text, pii: m.found, sensitive, rule: sensitive ? { cat: "review", score: 0, hits: [], reason: "민감한 내용 · 사람이 확인" } : classifyRule(m.text), ai: null, human: human || "" };
  }
  /** 지금 자동 분류: 민감 → 검토 필요, Claude 결과가 있으면 그것, 없으면 규칙 */
  function autoCat(item) { return item.sensitive ? "review" : (item.ai ? item.ai.cat : item.rule.cat); }

  /* ---------- Claude 응답 검사 ---------- */
  function aiInput(items) {
    return {
      criteriaVersion: CRITERIA_VERSION,
      criteria: CRITERIA.map((c) => ({ name: c.name, definition: c.def, examples: c.ex })),
      items: items.filter((i) => !i.sensitive).slice(0, 60).map((i) => ({ id: i.id, text: i.text.slice(0, 300) })),
    };
  }
  /** 카테고리 이름 → id. 기준 밖이면 "" */
  function catId(name) {
    const n = squash(name).replace(/[·・.]/g, "");
    const c = CATS.find((x) => squash(x.name).replace(/[·・.]/g, "") === n || x.id === n);
    return c ? c.id : "";
  }
  /** → { byId: {id: {cat, reason}}, valid, dropped } 또는 null (쓸 만한 게 절반 미만) */
  function normalizeAi(d, items) {
    if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
    const ids = new Set(items.filter((i) => !i.sensitive).map((i) => i.id));
    const byId = {};
    let dropped = 0;
    d.items.forEach((x) => {
      if (!x || typeof x !== "object" || !ids.has(x.id) || byId[x.id]) { dropped++; return; }
      const cat = catId(x.category);
      if (!cat) { dropped++; return; }
      byId[x.id] = { cat, reason: typeof x.reason === "string" ? x.reason.trim().slice(0, 80) : "" };
    });
    const valid = Object.keys(byId).length;
    if (!ids.size || valid < ids.size / 2) return null;
    return { byId, valid, dropped };
  }

  /* ---------- 통계 ---------- */
  function counts(items) {
    const c = Object.fromEntries(CATS.map((x) => [x.id, 0]));
    items.forEach((i) => { c[autoCat(i)]++; });
    return c;
  }
  /** 사람이 검수한 것 중 자동 분류와 같은 비율 */
  function agreement(items) {
    const rev = items.filter((i) => i.human);
    const agree = rev.filter((i) => i.human === autoCat(i)).length;
    return { reviewed: rev.length, agree, rate: rev.length ? Math.round(agree / rev.length * 100) : null };
  }
  /** 일관성 확인: 순서를 섞어 여러 번 돌려도 같은 결과인지 */
  function consistency(items, runs = 3, seed = 7) {
    let a = seed;
    const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    const base = Object.fromEntries(items.map((i) => [i.id, i.sensitive ? "review" : classifyRule(i.text).cat]));
    let same = 0;
    for (let r = 0; r < runs; r++) {
      const sh = [...items];
      for (let k = sh.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [sh[k], sh[j]] = [sh[j], sh[k]]; }
      if (sh.every((i) => (i.sensitive ? "review" : classifyRule(i.text).cat) === base[i.id])) same++;
    }
    return { runs, same, items: items.length };
  }

  /* ---------- 샘플: 통계학과 교육과정 설문 서술형 (가상의 응답 42건, 앞 22건 중 일부는 사람이 검수) ---------- */
  // [응답 원문, 사람 검수 결과(없으면 "")]
  const SAMPLE = [
    ["회귀분석 들으려면 선형대수를 먼저 들어야 하는데 선수과목 안내가 없어서 순서가 꼬였어요.", "c1"],
    ["전공 선택 과목이 2학기에 몰려 있어서 1학기에 들을 게 없어요.", "c1"],
    ["파이썬으로 데이터 분석하는 과목이 더 개설됐으면 좋겠습니다.", ""],
    ["베이즈 통계 과목이 격년 개설이라 졸업 전에 못 들을 것 같아요.", ""],
    ["수리통계 과제 피드백이 늦게 와서 다음 과제에 반영을 못 했어요.", "c2"],
    ["강의 녹화본을 올려 주시면 복습할 때 큰 도움이 될 것 같아요.", "c2"],
    ["팀플 비중이 너무 높아서 무임승차가 생겨요. 개인 평가 비중을 늘려 주세요.", "c2"],
    ["시험 범위 공지가 늦어요.", "c2"],
    ["실습실 컴퓨터가 오래돼서 R 스튜디오가 자주 멈춰요.", "c3"],
    ["SAS 라이선스가 학과 컴퓨터에만 있어서 집에서 과제를 못 해요.", "c3"],
    ["스터디할 공간이 부족해요. 학과 세미나실을 저녁에도 열어 주세요.", ""],
    ["실습실 와이파이가 수업 중에 자주 끊겨요.", ""],
    ["데이터 분석 직무 취업 특강을 학기마다 열어 주세요.", "c4"],
    ["졸업한 선배와 이야기할 수 있는 멘토링이 있었으면 해요.", "c4"],
    ["ADsP 같은 자격증 준비 스터디를 학과에서 지원해 주면 좋겠어요.", "c4"],
    ["인턴 공고를 학과 단톡방에도 공유해 주세요.", ""],
    ["대학원 진학 상담을 받을 곳이 없어요.", ""],
    ["학과 사무실 운영 시간이 짧아서 서류 떼기가 어려워요.", "c5"],
    ["학과 공지가 여러 곳에 흩어져 있어서 놓치게 돼요. 한 곳에 모아 주세요.", "c5"],
    ["학생회와 교수님들이 만나는 간담회가 있었으면 해요.", ""],
    ["장학금 신청 기간 안내가 너무 늦게 와요.", "c5"],
    ["개강총회 같은 학과 행사가 너무 술 위주예요.", ""],
    ["통계 패키지 사용법을 수업 시간에 따로 알려 주시면 좋겠어요.", "c2"],
    ["기초통계가 너무 이론 위주라 실제 데이터를 다뤄 보는 시간이 부족해요.", ""],
    ["졸업 프로젝트를 기업 데이터로 해 볼 수 있으면 좋겠어요.", ""],
    ["전공필수가 너무 많아서 복수전공 이수가 어려워요.", "c1"],
    ["교수님 면담 시간을 정해서 알려 주세요.", ""],
    ["좋았어요.", ""],
    ["특별히 없습니다.", ""],
    ["중간고사 이후 진도가 너무 빨라요.", "c2"],
    ["모니터가 작아서 코드 두 개를 띄우기 어려워요. 듀얼 모니터 부탁드려요.", "c3"],
    ["현장실습 학점 인정 기준을 명확히 해 주세요.", ""],
    ["선배들이 쓴 포트폴리오 예시를 볼 수 있으면 좋겠어요.", "c4"],
    ["시계열 분석 과목을 3학년 1학기로 옮겨 주세요.", "c1"],
    ["과제 제출 시스템이 자꾸 오류가 나요.", ""],
    ["조교 선생님 질의응답 시간이 더 있었으면 해요.", "c2"],
    ["학과 홈페이지 정보가 오래됐어요.", "c5"],
    ["수업에서 쓰는 예제가 너무 옛날 거예요. 최신 공공데이터로 바꿔 주세요.", ""],
    ["학번 20231187 입니다. 실습실 자리 예약 제도가 있었으면 해요. 연락은 010-2345-6789", ""],
    ["팀플에서 한 선배가 계속 폭언을 해서 힘들어요. 어디에 말해야 할지 모르겠어요.", ""],
    ["졸업요건 확인 방법을 정리해 주세요. 답변은 stat.minji@example.com 으로 부탁해요.", ""],
    ["R과 파이썬 중 하나로 실습 언어를 통일해 주세요.", ""],
  ];
  function sampleItems() { return SAMPLE.map(([t, h], i) => makeItem(`R${String(i + 1).padStart(3, "0")}`, t, h)); }

  /* ---------- 내보내기 ---------- */
  function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function toCsv(items) {
    const head = ["번호", "응답(개인정보 가림)", "자동 분류", "분류 근거", "처리", "사람 검수", "일치"];
    const body = items.map((i) => [i.id, i.text, nameOf(autoCat(i)), i.sensitive ? "민감한 내용 · 사람이 확인" : (i.ai ? i.ai.reason : i.rule.reason), i.ai && !i.sensitive ? "Claude" : "규칙", i.human ? nameOf(i.human) : "", i.human ? (i.human === autoCat(i) ? "O" : "X") : ""]);
    return "﻿" + [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
  }

  return { SAMPLE, sampleItems, CRITERIA, REVIEW, CATS, CRITERIA_VERSION, nameOf, maskPII, isSensitive, classifyRule, makeItem, autoCat, aiInput, catId, normalizeAi, counts, agreement, consistency, csvCell, toCsv };
});
