/* 오늘공정 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.OneulGongjeong, Node(테스트)에서는 require('./logic.js').
 *
 * 사진은 늘 '현장 폴더' 하나에 속한다. 예전에는 사진을 한곳에 올리고 골라 썼더니
 * 다른 현장 사진이 고객에게 섞여 나갔다. 그래서
 *   1) 업로드는 지금 연 현장 폴더로만 들어가고 (assignUploads)
 *   2) 파일 이름에 다른 현장 코드(B현장_…)가 보이면 보류해 공유에서 뺀다 (photoIssues → shareable)
 * 누수·균열·누전처럼 안전과 관련된 메모는 AI가 판단하지 않는다. '담당자 확인'으로 표시하고,
 * 고객에게는 담당자가 직접 연락한다는 문장만 나간다. AI 응답이 이런 건에 '문제없다'고 쓰면 버린다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OneulGongjeong = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function withDay(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`; }

  /* ---------- 공정 ---------- */
  const PROCESSES = ["철거", "설비", "전기", "목공", "타일", "도배", "바닥", "마감"];
  const PROC_KEYS = {
    철거: ["철거", "뜯", "폐기물", "해체"],
    설비: ["배관", "수도", "설비", "방수", "하수", "양생"],
    전기: ["전기", "배선", "콘센트", "스위치", "매입등", "분전"],
    목공: ["목공", "몰딩", "문틀", "천장틀", "가벽", "걸레받이"],
    타일: ["타일", "줄눈", "덧방"],
    도배: ["도배", "벽지", "초배"],
    바닥: ["마루", "장판", "바닥재", "강마루"],
    마감: ["실리콘", "입주 청소", "조명 설치", "마감", "손잡이"],
  };
  /** 메모·파일 이름으로 공정 짐작. 못 찾으면 "" */
  function guessProcess(text) {
    const t = String(text || "");
    let best = "", bestN = 0;
    PROCESSES.forEach((p) => {
      const n = PROC_KEYS[p].reduce((a, k) => a + (t.includes(k) ? 1 : 0), 0);
      if (n > bestN) { best = p; bestN = n; }
    });
    return best;
  }

  /* ---------- 안전: 사람에게 넘기는 메모 ---------- */
  const SAFETY = [
    [/누수|물이 새|물자국|물 자국/, "누수"],
    [/균열|금이 가|크랙/, "균열"],
    [/누전|감전|타는 냄새|탄 냄새|스파크/, "전기 안전"],
    [/내력벽|구조벽|철근 노출/, "구조"],
    [/석면/, "석면"],
    [/가스/, "가스"],
    [/곰팡이/, "곰팡이"],
  ];
  /** 안전 확인이 필요한 메모면 그 종류, 아니면 "" */
  function safetyFlag(note) {
    const hit = SAFETY.find(([re]) => re.test(String(note || "")));
    return hit ? hit[1] : "";
  }

  /* ---------- 현장 폴더 ---------- */
  /** 파일 이름 앞의 현장 코드: "B현장_도배.jpg" → "B", "c-전기.jpg" → "C" */
  function siteCodeOf(filename) {
    const m = String(filename || "").match(/^([A-Za-z])(?:현장)?[_\-\s]/);
    return m ? m[1].toUpperCase() : "";
  }
  /** 사진 한 장의 문제: 다른 폴더 · 파일 이름의 현장 코드가 다름 · 안전 확인 */
  function photoIssues(photo, siteId) {
    const out = [];
    if (photo.site !== siteId) out.push({ kind: "folder", msg: "다른 현장 폴더의 사진" });
    const code = siteCodeOf(photo.file);
    if (code && code !== siteId) out.push({ kind: "mixed", msg: `파일 이름이 ${code}현장 사진이에요`, code });
    const s = safetyFlag(photo.note);
    if (s) out.push({ kind: "safety", msg: `${s} — 담당자 확인`, label: s });
    return out;
  }
  /** 고객에게 나갈 수 있는 사진: 이 현장 · 이 날짜 · 넣기로 한 것 · 다른 현장 의심 없음 */
  function shareable(photos, siteId, date) {
    return photos.filter((p) => p.site === siteId && p.date === date && p.include !== false && !photoIssues(p, siteId).some((i) => i.kind === "folder" || i.kind === "mixed"));
  }
  /** 업로드: 지금 연 폴더로만 넣는다. 파일 이름이 다른 현장이면 보류(include:false) */
  function assignUploads(files, siteId, date, startTime) {
    return files.map((f, i) => {
      const name = String(f.name || `사진${i + 1}.jpg`);
      const code = siteCodeOf(name);
      const held = !!code && code !== siteId;
      return { id: `${siteId}-${date}-${Date.now().toString(36)}-${i}`, site: siteId, date, time: startTime || "", file: name, process: guessProcess(name), note: "", include: !held, held };
    });
  }
  /** 보류한 사진을 맞는 폴더로 옮기기 */
  function moveTo(photo, siteId) { return { ...photo, site: siteId, include: true, held: false }; }

  /* ---------- 공정 일지 (규칙) ---------- */
  const byTime = (a, b) => String(a.time).localeCompare(String(b.time));
  /** 이 날짜까지 공정 진행: done(이전 날짜) · today(오늘) · next */
  function progress(photos, siteId, date, plan) {
    // 다른 현장 의심 사진은 진행에도 넣지 않는다
    const mine = photos.filter((p) => p.site === siteId && p.date <= date && p.process && !photoIssues(p, siteId).some((i) => i.kind === "mixed"));
    const today = [...new Set(mine.filter((p) => p.date === date).map((p) => p.process))];
    const seen = new Set(mine.map((p) => p.process));
    const order = plan && plan.length ? plan : PROCESSES;
    const lastIdx = Math.max(-1, ...order.map((p, i) => (seen.has(p) ? i : -1)));
    const next = order.slice(lastIdx + 1).find((p) => !seen.has(p)) || "";
    return { order, done: order.filter((p) => seen.has(p) && !today.includes(p)), today, next };
  }

  function ruleLog(site, date, photos, plan) {
    const list = shareable(photos, site.id, date).sort(byTime);
    const groups = [];
    list.forEach((p) => {
      const proc = p.process || "기타";
      let g = groups.find((x) => x.process === proc);
      if (!g) groups.push((g = { process: proc, notes: [], count: 0, flags: [] }));
      g.count++;
      const f = safetyFlag(p.note);
      if (f) g.flags.push(f);
      else if (p.note) g.notes.push(p.note.replace(/[.\s]+$/, ""));
    });
    const pr = progress(photos, site.id, date, plan);
    const items = groups.map((g) => ({
      process: g.process,
      done: g.notes.length ? g.notes.join(", ") : g.process === "기타" ? `사진 ${g.count}장` : `${g.process} 작업 (사진 ${g.count}장)`,
      next: "",
      flag: g.flags.length ? [...new Set(g.flags)].join("·") : "",
    }));
    const procs = groups.map((g) => g.process);
    return {
      summary: list.length ? `${procs.join("·")} 작업을 진행했어요. 사진 ${list.length}장을 함께 보내 드려요.` : "이 날짜에 공유할 사진이 없어요.",
      items,
      next: pr.next ? `${pr.next} 준비` : "마감 점검",
      ask: "",
      count: list.length,
    };
  }

  /* ---------- AI 응답 검사 ---------- */
  const REASSURE = /문제\s?없|이상\s?없|안전(합니다|해요|하다)|걱정\s?(안|않|없)/;
  /**
   * Claude 응답 검사. 틀리면 null → 화면은 규칙 일지를 그대로 쓴다.
   * - items 의 process 는 그날 사진에 있는 공정만 (없는 공정을 지어내면 그 항목을 뺀다)
   * - 하나도 안 남으면 null
   * - 안전 확인 건이 있는데 '문제없다·안전하다'고 쓰면 null (판단은 사람이 한다)
   */
  function normalizeLog(d, allowed, hasSafety) {
    if (!d || typeof d !== "object" || typeof d.summary !== "string" || !d.summary.trim()) return null;
    if (!Array.isArray(d.items)) return null;
    const items = d.items
      .filter((x) => x && allowed.includes(x.process) && typeof x.done === "string" && x.done.trim())
      .map((x) => ({ process: x.process, done: x.done.trim().slice(0, 160), next: typeof x.next === "string" ? x.next.trim().slice(0, 80) : "", flag: "" }));
    if (!items.length) return null;
    const ask = typeof d.ask === "string" ? d.ask.trim().slice(0, 160) : "";
    const all = [d.summary, ask, ...items.map((x) => x.done + " " + x.next)].join(" ");
    if (hasSafety && REASSURE.test(all)) return null;
    return { summary: d.summary.trim().slice(0, 200), items, ask };
  }

  /** Claude 일지 + 규칙의 다음 공정·안전 표시 (안전 표시는 늘 규칙 쪽을 따른다) */
  function mergeAi(rule, ai) {
    return {
      summary: ai.summary, ask: ai.ask, next: rule.next, count: rule.count,
      items: ai.items.map((x) => ({ ...x, flag: (rule.items.find((r) => r.process === x.process) || {}).flag || "" })),
    };
  }

  /* ---------- 고객 공유 ---------- */
  function maskName(name) {
    const s = String(name || "").trim();
    if (s.length <= 1) return s || "고객";
    if (s.length === 2) return s[0] + "*";
    return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
  }
  /** 공유 링크 토큰: 현장·날짜로 만든 8자리. 주소에 이름·현장 위치가 들어가지 않는다 */
  function shareToken(siteId, date, salt) {
    let h = 2166136261;
    for (const ch of `${siteId}|${date}|${salt || ""}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }
  function shareText(site, date, log, flags) {
    const lines = [`[오늘공정] ${maskName(site.client)} 고객님, ${withDay(date)} ${site.label} 공정 일지입니다.`, "", log.summary, "", "오늘 한 일"];
    log.items.forEach((x) => lines.push(`· ${x.process} — ${x.done}${x.next ? ` (다음: ${x.next})` : ""}${x.flag ? " · 1건은 담당자가 확인 중이에요" : ""}`));
    lines.push("", `다음 작업: ${log.next}`);
    if (log.ask) lines.push(`확인 부탁드려요: ${log.ask}`);
    if (flags.length) lines.push("", `※ ${[...new Set(flags)].join("·")} 관련 ${flags.length}건은 담당자가 현장에서 직접 확인한 뒤 따로 연락드립니다.`);
    return lines.join("\n");
  }

  const TARGET = { minBefore: 40, minAfter: 8, inquiry: "절반으로" };

  return { DAYS, d0, iso, addDays, withDay, PROCESSES, guessProcess, safetyFlag, siteCodeOf, photoIssues, shareable, assignUploads, moveTo, progress, ruleLog, normalizeLog, mergeAi, maskName, shareToken, shareText, TARGET };
});
