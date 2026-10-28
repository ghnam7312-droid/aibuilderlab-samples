/* 차곡퀴즈 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Chagok, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름: 수업 자료 → 차시로 나누기(splitLessons) → 문장에서 '용어-설명' 찾기(facts)
 *       → 차시별 문항 만들기(makeQuestions) → 자동 확인(checkQuestion) → 사람이 검토(통과·고치기·제외)
 *
 * 모든 문항은 '정답 근거 문장'을 함께 가진다. 자동 확인은 그 근거가 자료에 정말 있는지,
 * 근거 안에 정답이 있는지, 다른 선지도 근거에 나와 정답이 둘로 읽히지 않는지를 본다.
 * 확인은 사람이 하고, 이 검사는 어디를 먼저 볼지 알려 줄 뿐이다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Chagok = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const FLAG = {
    noEvidence: "근거 문장이 자료에 없음",
    answerMissing: "근거 문장에 정답이 없음",
    multi: "다른 선지도 근거에 나옴 — 정답이 둘인지 확인",
    shape: "선지·정답 형식이 맞지 않음",
  };
  // OX 문항을 만들 때 뒤집을 말 (근거 문장에 있는 것만)
  const FLIP = [["흡수", "방출"], ["높", "낮"], ["증가", "감소"], ["커진", "작아진"]];

  const squash = (s) => String(s || "").replace(/[\s.,·'"“”‘’()]/g, "");

  /* ---------- 자료 나누기 ---------- */
  /** "## 1차시 제목" 또는 "1차시 제목" 줄로 나눈다. 표시가 없으면 한 차시 */
  function splitLessons(text) {
    const lines = String(text || "").split(/\r?\n/);
    const out = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      const m = line.match(/^(?:#+\s*)?(\d{1,2})\s*차시\s*[.:·-]?\s*(.*)$/);
      if (m) { cur = { no: Number(m[1]), title: m[2].trim() || `${m[1]}차시`, body: [] }; out.push(cur); continue; }
      if (!line) continue;
      if (!cur) { cur = { no: 1, title: "1차시", body: [] }; out.push(cur); }
      cur.body.push(line.replace(/^[-*]\s*/, ""));
    }
    return out.filter((l) => l.body.length).map((l) => ({ ...l, sentences: sentences(l.body.join(" ")) }));
  }
  function sentences(text) {
    return String(text || "").split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => s.length > 4);
  }

  /* ---------- 용어-설명 찾기 ---------- */
  /** "A를 B라고 한다" 또는 "B는 A이다"(B가 짧은 용어일 때) */
  function fact(sentence) {
    const s = String(sentence || "").trim().replace(/\.$/, "");
    let m = s.match(/^(.{4,}?)(?:을|를)\s+(\S{1,10}?)(?:이)?라고\s*한다$/);
    if (m) return { term: m[2], stem: `${m[1]}${josa(m[1], "을", "를")} 무엇이라고 하나요?`, evidence: sentence.trim() };
    m = s.match(/^(\S{1,6}?)(?:은|는)\s+(.{6,}?)이다$/);
    if (m && !/[,]/.test(m[1])) return { term: m[1], stem: `‘${m[2]}’에 해당하는 것은?`, evidence: sentence.trim() };
    return null;
  }
  /** 받침에 따라 조사 고르기 (받침 없거나 한글이 아니면 뒤의 것) */
  function josa(word, withB, withoutB) {
    const c = String(word || "").trim().slice(-1).charCodeAt(0) - 0xAC00;
    return c >= 0 && c <= 11171 && c % 28 !== 0 ? withB : withoutB;
  }
  /** 뒤집을 말이 있는 문장 → OX 문항 재료 */
  function flip(sentence) {
    for (const [a, b] of FLIP) {
      if (sentence.includes(a)) return sentence.replace(a, b);
      if (sentence.includes(b)) return sentence.replace(b, a);
    }
    return "";
  }

  /* ---------- 문항 만들기 (규칙) ---------- */
  function makeQuestions(lessons, perLesson) {
    const per = Math.max(1, Math.min(8, Number(perLesson) || 4));
    const all = [];
    const facts = lessons.map((l) => l.sentences.map(fact).filter(Boolean));
    const pool = [...new Set(facts.flat().map((f) => f.term))];
    lessons.forEach((l, li) => {
      const fs = facts[li];
      const terms = fs.map((f) => f.term);
      const qs = [];
      fs.forEach((f, i) => {
        if (qs.length >= per) return;
        // 오답 선지: 같은 차시에서 가까이 나온 용어부터, 모자라면 다른 차시
        const near = [];
        for (let d = 1; near.length < 3 && d < terms.length; d++) [i - d, i + d].forEach((j) => { if (terms[j] && terms[j] !== f.term && !near.includes(terms[j]) && near.length < 3) near.push(terms[j]); });
        for (const t of pool) if (near.length < 3 && t !== f.term && !near.includes(t)) near.push(t);
        if (near.length < 3) return;
        const pos = (all.length + qs.length) % 4;
        const options = near.slice(0, 3);
        options.splice(pos, 0, f.term);
        qs.push({ kind: "choice", stem: f.stem, options, answer: pos, evidence: f.evidence });
      });
      // 객관식이 모자라면 OX로 채운다 (번갈아 맞는 문장 / 뒤집은 문장)
      l.sentences.forEach((s) => {
        if (qs.length >= per || fact(s)) return;
        const f = flip(s);
        if (!f) return;
        const keep = qs.filter((q) => q.kind === "ox").length % 2 === 0;
        qs.push({ kind: "ox", stem: keep ? s : f, options: ["O", "X"], answer: keep ? 0 : 1, evidence: s });
      });
      qs.forEach((q, i) => all.push({ id: `L${l.no}-${i + 1}`, lesson: l.no, source: "rule", ...q }));
    });
    return all;
  }

  /* ---------- 자동 확인 ---------- */
  function grams(s) { const t = squash(s); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
  /** 근거 문장이 자료의 어느 문장과 거의 같은지 (띄어쓰기·기호 무시, 두 글자 조각 90% 이상) */
  function inMaterial(evidence, lessons) {
    const e = squash(evidence);
    if (e.length < 5) return false;
    const eg = grams(evidence);
    return lessons.some((l) => l.sentences.some((s) => {
      if (squash(s).includes(e)) return true;
      const sg = grams(s); let hit = 0; eg.forEach((g) => sg.has(g) && hit++);
      return hit / eg.size >= 0.9 && hit / sg.size >= 0.9;
    }));
  }
  function checkQuestion(q, lessons) {
    const flags = [];
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()) : [];
    const need = q.kind === "ox" ? 2 : 4;
    if (opts.length !== need || opts.some((o) => !o) || new Set(opts).size !== opts.length || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts.length) {
      return { flags: ["shape"], ok: false };
    }
    if (!inMaterial(q.evidence, lessons)) flags.push("noEvidence");
    if (q.kind === "choice") {
      const ev = squash(q.evidence);
      const ans = squash(opts[q.answer]);
      if (!ev.includes(ans)) flags.push("answerMissing");
      // 정답이 아닌 선지가 근거에 따로 나오면 (정답 안에 포함된 글자는 빼고)
      const rest = ev.split(ans).join("|");
      if (opts.some((o, i) => i !== q.answer && squash(o).length >= 2 && rest.includes(squash(o)))) flags.push("multi");
    } else {
      const same = squash(q.stem) === squash(q.evidence);
      if (same !== (q.answer === 0)) flags.push("answerMissing");
    }
    return { flags, ok: !flags.length };
  }

  /* ---------- Claude 응답 검사 ---------- */
  function normalizeGenerated(d, lessons) {
    if (!d || typeof d !== "object" || !Array.isArray(d.questions)) return null;
    const nos = new Set((lessons || []).map((l) => l.no));
    const count = {};
    const out = [];
    for (const x of d.questions.slice(0, 60)) {
      if (!x || typeof x.stem !== "string" || !x.stem.trim() || !Array.isArray(x.options)) continue;
      const lesson = Number(x.lesson);
      if (!nos.has(lesson)) continue;
      const options = x.options.filter((o) => typeof o === "string" && o.trim()).map((o) => o.trim().slice(0, 60));
      const answer = Number(x.answer);
      if (!(options.length === 4 || options.length === 2) || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
      count[lesson] = (count[lesson] || 0) + 1;
      out.push({ id: `L${lesson}-${count[lesson]}`, lesson, source: "ai", kind: options.length === 2 ? "ox" : "choice", stem: x.stem.trim().slice(0, 200), options, answer, evidence: typeof x.evidence === "string" ? x.evidence.trim().slice(0, 300) : "" });
    }
    return out.length ? out : null;
  }

  /* ---------- 검토 · 내보내기 ---------- */
  /** 검토 상태: pass 통과(손대지 않음) · fix 고쳐서 통과 · drop 제외. 통과율 = pass / 검토한 문항 */
  function reviewStats(questions, review) {
    const r = review || {};
    const n = { total: questions.length, pass: 0, fix: 0, drop: 0, todo: 0 };
    for (const q of questions) { const s = r[q.id]; if (s === "pass" || s === "fix" || s === "drop") n[s]++; else n.todo++; }
    const done = n.pass + n.fix + n.drop;
    return { ...n, done, rate: done ? Math.round((n.pass / done) * 100) : 0 };
  }
  const usable = (questions, review) => questions.filter((q) => (review || {})[q.id] === "pass" || (review || {})[q.id] === "fix");
  const MARK = ["①", "②", "③", "④"];
  /** 학생용: 정답·근거 없이 */
  function toStudentText(title, questions, review) {
    const list = usable(questions, review);
    const lessons = [...new Set(list.map((q) => q.lesson))];
    return `${title}\n\n` + lessons.map((no) => `[${no}차시 확인 퀴즈]\n` + list.filter((q) => q.lesson === no).map((q, i) =>
      `${i + 1}. ${q.stem}\n   ${q.kind === "ox" ? "( O / X )" : q.options.map((o, k) => `${MARK[k]} ${o}`).join("  ")}`).join("\n")).join("\n\n") + "\n";
  }
  function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  /** 교사용: 정답과 근거 문장까지 */
  function toCsv(questions, review) {
    const head = ["차시", "번호", "유형", "문항", "선지1", "선지2", "선지3", "선지4", "정답", "근거 문장", "검토"];
    const rows = usable(questions, review).map((q) => [q.lesson, q.id, q.kind === "ox" ? "OX" : "객관식", q.stem, ...[0, 1, 2, 3].map((k) => q.options[k] || ""), q.options[q.answer], q.evidence, review[q.id] === "fix" ? "고쳐서 통과" : "통과"]);
    return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  return { FLAG, FLIP, squash, josa, splitLessons, sentences, fact, flip, makeQuestions, grams, inMaterial, checkQuestion, normalizeGenerated, reviewStats, usable, toStudentText, csvCell, toCsv };
});
