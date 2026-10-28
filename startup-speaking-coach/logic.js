/* 말해봄 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Malhaebom, Node(테스트)에서는 require('./logic.js').
 *
 * 핵심 결정: 한 번에 고칠 점은 최대 2개 (MAX_FIXES).
 *   처음엔 찾은 실수를 전부 보여 줬더니 학생이 7~8개를 보고 숙제를 그만뒀다.
 *   그래서 찾은 실수를 '뜻이 달라지는 정도(weight) → 반복 횟수 → 먼저 나온 순서'로 줄 세우고
 *   위의 2개만 학생에게 보여 준다. 나머지는 튜터만 보는 '다음 숙제에서 볼 것'으로 미룬다.
 *
 * 규칙: 자주 나오는 실수 패턴을 문장에서 찾는다 (과거 시제, -ed/-ing 감정, 3인칭 don't …).
 * Claude: 같은 문장을 읽고 고칠 점을 준다. normalizeFeedback()이 검사한다:
 *   - 학생이 실제로 말한 표현(wrong)이 받아쓴 문장에 없으면 버린다 (지어낸 지적 금지)
 *   - 몇 개를 주든 2개까지만 남긴다
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Malhaebom = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const MAX_FIXES = 2;

  const PAST = { go: "went", eat: "ate", meet: "met", see: "saw", have: "had", buy: "bought", take: "took", make: "made", come: "came", get: "got", drink: "drank", do: "did", feel: "felt", write: "wrote", spend: "spent", watch: "watched", play: "played", visit: "visited", stay: "stayed", study: "studied", try: "tried", walk: "walked", cook: "cooked", travel: "traveled", discuss: "discussed", decide: "decided" };
  const FEEL = { boring: "bored", exciting: "excited", tiring: "tired", confusing: "confused", interesting: "interested" };
  const PAST_MARK = /\b(yesterday|last\s+(night|week|weekend|month|year|summer|winter|spring|fall|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+\s+(days?|weeks?|months?|years?)\s+ago|ago)\b/i;
  const NOW_MARK = /\b(now|these days|usually|every|always|i think)\b/i;
  const FILLER = /\b(um+|uh+|erm|you know)\b/gi;

  /** 'ing' 만들기: enjoy to play → enjoy playing */
  function ing(v) {
    const w = v.toLowerCase();
    if (/^(swim|run|sit|shop|get|stop)$/.test(w)) return v + v.slice(-1) + "ing";
    if (/[^e]e$/.test(w)) return v.slice(0, -1) + "ing";
    return v + "ing";
  }
  /** 첫 글자 대소문자를 원문에 맞춘다 */
  function keepCase(src, out) { return /^[A-Z]/.test(src) ? out.charAt(0).toUpperCase() + out.slice(1) : out; }

  /* ---------- 규칙 ----------
   * find(sentence, ctx) → [{wrong, better}] 원문 그대로의 조각과 고친 조각
   * weight: 3 뜻이 달라지거나 듣는 사람이 헷갈림 · 2 문법이 틀렸지만 뜻은 통함 · 1 다듬으면 좋은 것 */
  function reAll(re, s, fn) {
    const out = [];
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(s))) { const b = fn(m); if (b) out.push({ wrong: m[0], better: keepCase(m[0], b), at: m.index }); }
    return out;
  }
  const VERBS = Object.keys(PAST).join("|");
  const RULES = [
    { id: "past", weight: 3, title: "지난 일은 과거형으로", why: "어제·지난주 이야기인데 동사가 현재형이에요. 듣는 사람은 '늘 그렇게 한다'로 들어요.",
      find: (s, ctx) => (ctx.past ? reAll(new RegExp(`\\b(I|we|he|she|they|my \\w+|our \\w+)\\s+(also\\s+|just\\s+)?(${VERBS})\\b`, "i"), s, (m) => `${m[1]} ${m[2] || ""}${keepCase(m[3], PAST[m[3].toLowerCase()])}`) : []) },
    { id: "feel", weight: 3, title: "내 기분은 -ed", why: "'I was boring'은 '내가 지루한 사람이었다'로 들려요. 내가 느낀 건 bored, 그 일이 주는 느낌은 boring.",
      find: (s) => reAll(/\b(I|I'm|I am|I was|we were|we're|we are|I felt)\s+((?:so|very|really)\s+)?(boring|exciting|tiring|confusing|interesting)\b/i, s, (m) => `${m[1]} ${m[2] || ""}${FEEL[m[3].toLowerCase()]}`) },
    { id: "agree", weight: 2, title: "agree는 그 자체가 동사", why: "agree는 '동의하다'라서 am을 붙이지 않아요.",
      find: (s) => reAll(/\b(I|we|they)\s+(am|are)\s+agree\b/i, s, (m) => `${m[1]} agree`) },
    { id: "third", weight: 2, title: "he·she 뒤에는 doesn't", why: "주어가 한 사람(he, she, my brother)이면 don't가 아니라 doesn't예요.",
      find: (s) => reAll(/\b(he|she|it|my (?:brother|sister|mom|dad|friend))\s+don't\b/i, s, (m) => `${m[1]} doesn't`) },
    { id: "since", weight: 2, title: "기간은 for", why: "since 뒤에는 시작 시점(2020, last year), 기간(5 years)에는 for를 써요.",
      find: (s) => reAll(/\bsince\s+(\d+|two|three|four|five|six|ten)\s+(years?|months?|weeks?)\b/i, s, (m) => `for ${m[1]} ${m[2]}`) },
    { id: "plural", weight: 2, title: "people은 여러 명", why: "people은 이미 여러 사람이라 is가 아니라 are예요.",
      find: (s) => reAll(/\bpeople\s+(is|was)\b/i, s, (m) => `people ${m[1].toLowerCase() === "is" ? "are" : "were"}`) },
    { id: "enjoy", weight: 2, title: "enjoy 뒤에는 -ing", why: "enjoy 다음에는 to 대신 -ing를 써요 (enjoy playing).",
      find: (s) => reAll(/\b(enjoys?|enjoyed)\s+to\s+([a-z]+)\b/i, s, (m) => `${m[1]} ${ing(m[2])}`) },
    { id: "more", weight: 2, title: "better에는 more가 이미 들어 있어요", why: "better·easier는 그 자체가 비교라서 more를 빼요.",
      find: (s) => reAll(/\bmore\s+(better|easier|bigger|cheaper|faster|worse)\b/i, s, (m) => m[1]) },
    { id: "have", weight: 2, title: "have 뒤에는 p.p.", why: "have 다음에는 went가 아니라 gone처럼 과거분사를 써요.",
      find: (s) => reAll(/\b(have|has)\s+(went|ate|saw|did)\b/i, s, (m) => `${m[1]} ${{ went: "gone", ate: "eaten", saw: "seen", did: "done" }[m[2].toLowerCase()]}`) },
    { id: "discuss", weight: 1, title: "discuss에는 about이 없어요", why: "discuss가 '~에 대해 이야기하다'라서 about을 빼요.",
      find: (s) => reAll(/\b(discuss(?:ed|es)?)\s+about\b/i, s, (m) => m[1]) },
    { id: "verylike", weight: 1, title: "very like → really like", why: "like 앞에는 very가 아니라 really를 써요.",
      find: (s) => reAll(/\bvery\s+like\b/i, s, () => "really like") },
  ];
  const FILLER_RULE = { rule: "filler", weight: 1, title: "um·uh 줄이기", why: "생각할 때는 소리 없이 1초 쉬어도 괜찮아요. 듣는 사람에게 더 자신 있게 들려요." };

  /** 문장 나누기 (마침표·물음표·느낌표) */
  function sentences(text) {
    return String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  }
  function countFillers(text) { return (String(text || "").match(FILLER) || []).length; }
  function words(text) { return String(text || "").replace(FILLER, " ").split(/\s+/).filter((w) => /[a-z]/i.test(w)).length; }

  /** 찾은 실수 전부 (규칙별로 묶음) */
  function findIssues(text) {
    const byId = {};
    const ctx = { past: false };
    let offset = 0;
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    sentences(flat).forEach((s) => {
      const base = flat.indexOf(s, offset);
      offset = base + s.length;
      if (PAST_MARK.test(s)) ctx.past = true;
      else if (NOW_MARK.test(s)) ctx.past = false;
      RULES.forEach((r) => {
        r.find(s, ctx).forEach((hit) => {
          const it = (byId[r.id] = byId[r.id] || { rule: r.id, title: r.title, why: r.why, weight: r.weight, occ: [] });
          it.occ.push({ wrong: hit.wrong.trim(), better: hit.better.replace(/\s+/g, " ").trim(), at: base + hit.at });
        });
      });
    });
    const f = countFillers(flat);
    if (f >= 3) byId.filler = { ...FILLER_RULE, occ: [{ wrong: "um·uh", better: "(잠깐 쉬기)", at: flat.search(FILLER) }], count: f };
    return Object.values(byId).map((it) => ({ ...it, count: it.count || it.occ.length, wrong: it.occ[0].wrong, better: it.occ[0].better }));
  }

  /** 우선순위: 무게 → 반복 횟수 → 먼저 나온 순서 */
  function rank(issues) {
    return issues.slice().sort((a, b) => b.weight - a.weight || b.count - a.count || a.occ[0].at - b.occ[0].at);
  }
  /** 학생에게 보여 줄 것과 미룰 것 */
  function limitFixes(issues, max) {
    const r = rank(issues);
    const n = max == null ? MAX_FIXES : max;
    return { fixes: r.slice(0, n), later: r.slice(n) };
  }

  /** 고친 조각을 원문에 바꿔 넣은 '다시 말하기' 대본 */
  function applyFixes(text, fixes) {
    let out = String(text || "").replace(/\s+/g, " ").trim();
    fixes.forEach((f) => {
      if (f.rule === "filler") { out = out.replace(/\s*\b(um+|uh+|erm)\b,?/gi, "").replace(/\s+,/g, ",").replace(/,\s*,/g, ","); return; }
      (f.occ || [{ wrong: f.wrong, better: f.better }]).forEach((o) => {
        const i = out.toLowerCase().indexOf(o.wrong.toLowerCase());
        if (i >= 0) out = out.slice(0, i) + keepCase(out.slice(i, i + 1), o.better) + out.slice(i + o.wrong.length);
      });
    });
    return out.replace(/\s{2,}/g, " ").trim();
  }

  /** 측정값 */
  function metrics(text, seconds, target) {
    const w = words(text);
    const sec = Number(seconds) > 0 ? Number(seconds) : 0;
    const t = target && target.re ? new RegExp(target.re, "i") : null;
    const m = t ? String(text || "").match(t) : null;
    return { words: w, seconds: sec, wpm: sec ? Math.round(w / (sec / 60)) : 0, fillers: countFillers(text), target: !!m, targetText: m ? m[0] : "" };
  }

  /** 잘한 점 한 줄 (규칙) */
  function goodPoint(m, target) {
    if (m.target) return `목표 표현 '${target.label}'을 썼어요: "${m.targetText}"`;
    if (m.seconds >= 30) return `${m.seconds}초 동안 끝까지 말했어요. 다음엔 '${target.label}'도 넣어 보세요.`;
    return `끝까지 말해 본 것부터 숙제의 절반이에요. 다음엔 30초를 채워 보세요.`;
  }

  /** 규칙으로 첨삭 한 번 */
  function review(text, seconds, target) {
    const m = metrics(text, seconds, target);
    const { fixes, later } = limitFixes(findIssues(text));
    return { mode: "rule", fixes, later, good: goodPoint(m, target), retry: applyFixes(text, fixes), metrics: m };
  }

  /** Claude 응답 검사 → 쓸 수 없으면 null */
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim(); }
  function normalizeFeedback(d, text) {
    if (!d || typeof d !== "object") return null;
    const src = norm(text);
    const given = Array.isArray(d.fixes) ? d.fixes : [];
    const fixes = given
      .filter((f) => f && typeof f.wrong === "string" && typeof f.better === "string" && f.wrong.trim() && f.better.trim())
      .filter((f) => norm(f.wrong) && src.includes(norm(f.wrong)) && norm(f.wrong) !== norm(f.better))
      .map((f) => ({ rule: "ai", title: String(f.title || "").trim().slice(0, 30) || "고칠 점", wrong: f.wrong.trim().slice(0, 80), better: f.better.trim().slice(0, 80), why: typeof f.why === "string" ? f.why.trim().slice(0, 160) : "", weight: 0, count: 1, occ: [{ wrong: f.wrong.trim(), better: f.better.trim(), at: src.indexOf(norm(f.wrong)) }] }));
    if (given.length && !fixes.length) return null; // 준 지적이 전부 학생이 말하지 않은 표현이면 버린다
    if (typeof d.good !== "string" || !d.good.trim()) return null;
    const kept = fixes.slice(0, MAX_FIXES);
    const later = fixes.slice(MAX_FIXES).map((f) => f.title)
      .concat((Array.isArray(d.later) ? d.later : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 80)))
      .slice(0, 5);
    const retry = typeof d.retry === "string" && d.retry.trim() && d.retry.length <= 800 ? d.retry.trim() : applyFixes(text, kept);
    return { mode: "ai", fixes: kept, later: later.map((t) => ({ title: t, count: 1 })), good: d.good.trim().slice(0, 160), retry };
  }

  /** 다시 말하기: 지난번 고칠 점을 이번에 고쳤는지 */
  function checkRetry(fixes, text) {
    const now = findIssues(text);
    const src = norm(text);
    return fixes.map((f) => {
      let fixed;
      if (f.rule === "ai") fixed = !src.includes(norm(f.wrong)) || src.includes(norm(f.better));
      else if (f.rule === "filler") fixed = countFillers(text) < 3;
      else fixed = !now.some((x) => x.rule === f.rule);
      return { title: f.title, fixed };
    });
  }

  /** 제출 현황 */
  function submitRate(students) {
    const n = students.length;
    const done = students.filter((s) => s.submitted).length;
    return { done, n, pct: n ? Math.round((done / n) * 100) : 0 };
  }

  /** 내보내기 전에 개인정보 가리기 (받아쓴 문장에 전화번호·메일이 섞일 때가 있다) */
  function maskPii(s) {
    return String(s || "")
      .replace(/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "010-****-****")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "(메일 주소)");
  }

  /** 카톡용 첨삭 문구 */
  function toMessage(name, fb, homework) {
    const lines = [`[말해봄] ${name} 님 · ${homework}`, "", `잘한 점: ${fb.good}`, ""];
    fb.fixes.forEach((f, i) => lines.push(`고칠 점 ${i + 1}. ${f.title}`, `  ${f.wrong} → ${f.better}`, f.why ? `  ${f.why}` : ""));
    if (!fb.fixes.length) lines.push("이번엔 고칠 점이 없어요. 다음엔 조금 더 길게 말해 보세요.");
    lines.push("", "다시 말하기 대본:", fb.retry);
    return maskPii(lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"));
  }

  /** 받아쓴 문장에서 고칠 조각 위치 (화면 강조용) → [{start, end, n}] */
  function marks(text, fixes) {
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    const low = flat.toLowerCase();
    const out = [];
    fixes.forEach((f, n) => {
      if (f.rule === "filler") { reAll(FILLER, flat, () => "x").forEach((h) => out.push({ start: h.at, end: h.at + h.wrong.length, n })); return; }
      (f.occ || []).forEach((o) => {
        const i = low.indexOf(o.wrong.toLowerCase(), Math.max(0, (o.at || 0) - 3));
        const j = i >= 0 ? i : low.indexOf(o.wrong.toLowerCase());
        if (j >= 0) out.push({ start: j, end: j + o.wrong.length, n });
      });
    });
    out.sort((a, b) => a.start - b.start);
    return { flat, marks: out.filter((m, i) => !i || m.start >= out[i - 1].end) };
  }

  return { MAX_FIXES, RULES, sentences, words, countFillers, findIssues, rank, limitFixes, applyFixes, metrics, goodPoint, review, normalizeFeedback, checkRetry, submitRate, maskPii, toMessage, marks, ing };
});
