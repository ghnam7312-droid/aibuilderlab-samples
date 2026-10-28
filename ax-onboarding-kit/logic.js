/* 첫주노트 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Cheotju, Node(테스트)에서는 require('./logic.js').
 *
 * 1) 자료 정리: 부서마다 가진 온보딩 자료 목록을 같은 문서끼리 묶고, **개정일이 가장 늦은 최신본만** 남긴다.
 *    개정일이 없는 문서는 자동으로 남기지 않고 '확인 필요'로 둔다(담당자가 인정하면 남김).
 * 2) 질문 모음: 신입들이 부서마다 물어본 질문을 비슷한 것끼리 묶어, 2개 부서 이상에서 나온 것을 공통 질문으로.
 *    각 질문은 최신본 자료에만 연결한다. 급여·근로계약 같은 질문은 자료로 답하지 않고 인사 담당자에게 넘긴다.
 * 3) 확산 계획: 부서 × 단계 진행 상태.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Cheotju = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STEPS = ["최신본 자료 확인", "공통 질문 공유", "부서 담당자 지정", "신입 첫 주 적용"];
  const STATES = ["예정", "진행", "완료"];
  /** 자료가 아니라 사람이 답해야 하는 질문 (급여·계약·징계 등) */
  const SENSITIVE = ["급여", "월급", "연봉", "성과급", "근로계약", "계약서", "징계", "퇴직금", "산재", "4대보험", "해고"];

  const cells = (l) => l.split(/\t|,/).map((c) => c.trim());
  const lines = (text) => String(text || "").split(/\r?\n/).map((l, i) => ({ l: l.trim(), n: i + 1 })).filter((x) => x.l);

  /* ---------- 자료 ---------- */
  /** "2025.9.15", "2025-09-15", "25.9.15" → "2025-09-15" (읽을 수 없으면 "") */
  function normDate(s) {
    const m = String(s || "").trim().match(/^(\d{2}|\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
    if (!m) return "";
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const d = new Date(y, +m[2] - 1, +m[3]);
    if (d.getMonth() !== +m[2] - 1) return "";
    return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  }
  /** 같은 문서로 볼 이름: 공백·괄호 꼬리표·_최종·v2·개정 등을 지운다 */
  function docKey(title) {
    return String(title || "")
      .replace(/[([［【].*?[)\]］】]/g, "")
      .replace(/[_\s-]*(최종|수정본|개정판?|사본|복사본)$/g, "")
      .replace(/[_\s-]*v\d+(\.\d+)?$/i, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }
  function parseDocs(text) {
    const out = [], errors = [];
    lines(text).forEach(({ l, n }) => {
      const [dept, title, kind, date] = cells(l);
      if (/^부서$/.test(dept) && /^(문서|문서명|자료)$/.test(title || "")) return;
      if (!dept || !title) { errors.push({ line: n, why: "부서·문서명이 비어 있음" }); return; }
      const raw = (date || "").trim();
      const d = normDate(raw);
      if (raw && !d) { errors.push({ line: n, why: "개정일을 읽을 수 없음" }); }
      out.push({ id: `D${n}`, dept, title, kind: kind || "자료", date: d, key: docKey(title) });
    });
    return { docs: out, errors };
  }

  /**
   * 최신본만 남기기. confirmed: { [문서 id]: true } — 개정일 없는 문서를 담당자가 인정한 것
   * → { kept, old, undated }
   *   kept: 최신본 (같은 문서의 다른 부서 사본은 copies, 예전 개정본은 replaced)
   *   old: 제외된 구버전 (replacedBy 로 최신본 id)
   *   undated: 개정일이 없어 확인이 필요한 문서 (newer: 같은 문서의 개정본이 있으면 그 날짜)
   */
  function latestOnly(docs, confirmed) {
    const ok = confirmed || {};
    const by = new Map();
    docs.forEach((d) => { if (!by.has(d.key)) by.set(d.key, []); by.get(d.key).push(d); });
    const kept = [], old = [], undated = [];
    by.forEach((group) => {
      const dated = group.filter((d) => d.date).sort((a, b) => b.date.localeCompare(a.date));
      const top = dated[0];
      group.filter((d) => !d.date).forEach((d) => {
        if (top) old.push({ ...d, replacedBy: top.id, why: "개정일 없음 · 개정본 있음" });
        else if (ok[d.id]) dated.push({ ...d, confirmed: true });
        else undated.push({ ...d });
      });
      if (!dated.length) return;
      const head = dated[0];
      const copies = dated.filter((d) => d !== head && d.date === head.date);
      const replaced = dated.filter((d) => d !== head && !copies.includes(d));
      kept.push({ ...head, copies: copies.map((d) => d.dept), replaced: replaced.length });
      replaced.forEach((d) => old.push({ ...d, replacedBy: head.id, why: `${head.date || "인정본"} 개정본으로 대체` }));
      copies.forEach((d) => old.push({ ...d, replacedBy: head.id, why: "같은 개정본 사본" }));
    });
    kept.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    return { kept, old, undated };
  }

  /* ---------- 질문 ---------- */
  function parseQuestions(text) {
    const out = [];
    lines(text).forEach(({ l }) => {
      const m = l.match(/^([^\t,]+)[\t,]\s*(.+)$/);
      if (!m || /^부서$/.test(m[1].trim())) return;
      out.push({ id: out.length + 1, dept: m[1].trim(), text: m[2].trim() });
    });
    return out;
  }
  /** 비교용으로 다듬기: 기호·공백과 흔한 어미를 지운다 */
  function normQ(s) {
    return String(s || "").replace(/(은|는|이|가|을|를|도|에|로|의)(?=[\s?？]|$)/g, "").replace(/신청/g, "").replace(/[?？!.\s~]/g, "")
      .replace(/(인가요|하나요|해요|되나요|나요|있나요|있어요|할수있어요|가능한가요|궁금합니다|궁금해요|알려주세요|주세요|어떻게|언제|어디서|어디에|누가)/g, "");
  }
  function grams(s) {
    const t = normQ(s);
    const set = new Set();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  }
  /** 두 질문의 비슷한 정도 (0~1): 두 글자 조각 겹침 (Dice 계수) */
  function sim(a, b) {
    const A = grams(a), B = grams(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    A.forEach((x) => { if (B.has(x)) hit++; });
    return (2 * hit) / (A.size + B.size);
  }
  const isSensitive = (text) => SENSITIVE.some((w) => String(text).replace(/\s/g, "").includes(w.replace(/\s/g, "")));

  /** 비슷한 질문 묶기 (앞에서부터, 묶음의 첫 질문과 비교) */
  function cluster(qs, threshold) {
    const thr = threshold || 0.4;
    const groups = [];
    qs.forEach((q) => {
      let best = null, score = 0;
      groups.forEach((g) => { const s = Math.max(...g.ids.slice(0, 3).map((id) => sim(q.text, qs.find((x) => x.id === id).text))); if (s > score) { score = s; best = g; } });
      if (best && score >= thr) best.ids.push(q.id);
      else groups.push({ question: q.text, ids: [q.id] });
    });
    return groups;
  }

  /** 질문에 맞는 최신본 자료: 자료 이름 조각이 질문에 얼마나 들어 있나 */
  function linkDoc(text, kept) {
    const q = normQ(text);
    let best = "", score = 0;
    kept.forEach((d) => {
      const t = docKey(d.title).replace(/안내|방법|절차|규정|지침|가이드|양식|매뉴얼|신청/g, "");
      const g = [];
      for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
      if (!g.length) return;
      const s = g.filter((x) => q.includes(x)).length / g.length;
      if (s > score) { score = s; best = d.id; }
    });
    return score >= 0.5 ? best : "";
  }

  /** 묶음 → 화면용: 부서, 인원, 공통 여부, 인사 담당자 넘김, 연결 자료 */
  function finish(groups, qs, kept, minDepts) {
    return groups.map((g) => {
      const members = g.ids.map((id) => qs.find((q) => q.id === id)).filter(Boolean);
      const depts = [...new Set(members.map((m) => m.dept))];
      const sensitive = members.some((m) => isSensitive(m.text)) || isSensitive(g.question);
      const docId = sensitive ? "" : (g.docId && kept.some((d) => d.id === g.docId) ? g.docId : linkDoc([g.question, ...members.map((m) => m.text)].join(" "), kept));
      return { question: g.question, ids: g.ids, depts, count: members.length, common: depts.length >= minDepts, sensitive, docId, category: g.category || "" };
    }).sort((a, b) => b.common - a.common || b.depts.length - a.depts.length || b.count - a.count);
  }

  /** Claude 응답 검사: 질문 번호는 한 번씩만, 빠진 질문은 따로 붙인다. 자료는 최신본 id만 */
  function normalizeFaq(d, qs, kept) {
    if (!d || typeof d !== "object" || !Array.isArray(d.groups)) return null;
    const valid = new Set(qs.map((q) => q.id));
    const used = new Set();
    const keptIds = new Set(kept.map((k) => k.id));
    const groups = [];
    d.groups.forEach((g) => {
      if (!g || typeof g.question !== "string" || !g.question.trim() || !Array.isArray(g.ids)) return;
      const ids = g.ids.map(Number).filter((id) => valid.has(id) && !used.has(id));
      if (!ids.length) return;
      ids.forEach((id) => used.add(id));
      groups.push({ question: g.question.trim().slice(0, 80), ids, docId: typeof g.docId === "string" && keptIds.has(g.docId) ? g.docId : "", category: typeof g.category === "string" ? g.category.trim().slice(0, 12) : "" });
    });
    if (!groups.length) return null;
    // AI가 빠뜨린 질문도 버리지 않는다
    qs.filter((q) => !used.has(q.id)).forEach((q) => groups.push({ question: q.text, ids: [q.id], docId: "", category: "", missed: true }));
    return groups;
  }

  /** AI 입력: 질문(부서·글)과 최신본 자료 목록만 */
  function aiInput(qs, kept, minDepts) {
    return { minDepts, questions: qs.map((q) => ({ id: q.id, dept: q.dept, text: q.text.slice(0, 120) })).slice(0, 200), docs: kept.map((d) => ({ id: d.id, title: d.title, date: d.date })) };
  }

  /* ---------- 확산 계획 ---------- */
  function emptyPlan(depts) {
    const p = {};
    depts.forEach((d) => { p[d] = STEPS.map(() => 0); });
    return p;
  }
  /** 상태 한 칸 넘기기 (예정 → 진행 → 완료 → 예정) */
  function cycle(plan, dept, step) {
    const next = JSON.parse(JSON.stringify(plan));
    next[dept][step] = (next[dept][step] + 1) % STATES.length;
    return next;
  }
  function progress(plan) {
    const depts = Object.keys(plan);
    const applied = depts.filter((d) => plan[d].every((s) => s === 2));
    const cells = depts.reduce((n, d) => n + plan[d].filter((s) => s === 2).length, 0);
    return { applied: applied.length, total: depts.length, pct: depts.length ? Math.round((cells / (depts.length * STEPS.length)) * 100) : 0 };
  }

  /* ---------- 내보내기 ---------- */
  function toKitMd(res, qs, plan) {
    const doc = (id) => res.kept.find((d) => d.id === id);
    const common = res.groups.filter((g) => g.common);
    const out = ["# 신입 온보딩 키트", "", `## 최신본 자료 (${res.kept.length}개)`];
    res.kept.forEach((d) => out.push(`- ${d.title} · ${d.kind} · ${d.date || "개정일 미기재(담당자 확인)"} · ${d.dept}`));
    out.push("", `## 공통 질문 (${common.length}개)`);
    common.forEach((g, i) => {
      const d = doc(g.docId);
      out.push(`${i + 1}. ${g.question} — ${g.depts.join(", ")}`);
      out.push(`   - ${g.sensitive ? "인사 담당자에게 직접 확인 (자료로 답하지 않음)" : d ? `관련 자료: ${d.title} (${d.date || "개정일 미기재"})` : "관련 자료 없음 — 새로 만들 것"}`);
    });
    out.push("", "## 팀 확산 계획", `| 부서 | ${STEPS.join(" | ")} |`, `|---|${STEPS.map(() => "---").join("|")}|`);
    Object.keys(plan).forEach((dp) => out.push(`| ${dp} | ${plan[dp].map((s) => STATES[s]).join(" | ")} |`));
    return out.join("\n");
  }

  return { STEPS, STATES, SENSITIVE, normDate, docKey, parseDocs, latestOnly, parseQuestions, normQ, grams, sim, isSensitive, cluster, linkDoc, finish, normalizeFaq, aiInput, emptyPlan, cycle, progress, toKitMd };
});
