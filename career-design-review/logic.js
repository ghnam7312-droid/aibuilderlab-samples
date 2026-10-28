/* 모아닫기 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Moadatgi, Node(테스트)에서는 require('./logic.js').
 *
 * 카톡·메일·피그마에 흩어진 시안 피드백을 한곳에 모아
 *   1) 똑같은 코멘트(여러 채널로 전달된 것)는 하나로 지우고
 *   2) 같은 화면에서 비슷한 코멘트는 한 '수정 항목'으로 합친다 (포트폴리오의 '같은 의견이 여러 번' 수정)
 *   3) 항목마다 반영함 · 보류 · 안 함으로 끝까지 닫는다. 보류·안 함은 이유가 있어야 닫힌다.
 * Claude(designreview.group)가 묶어 주면 normalizeGroups()로 검사하고, 틀리면 규칙 결과를 쓴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Moadatgi = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SOURCES = { kakao: "카톡", mail: "메일", figma: "피그마" };
  const STATUS = { open: "남음", done: "반영함", hold: "보류", wont: "안 함" };

  /* ---------- 붙여 넣기 읽기 ---------- */
  /** "[카톡] 지우 · 홈: 배너 글씨가 작아요" → {source, author, screen, text} */
  function parseLine(raw) {
    const m = String(raw || "").trim().match(/^\[(카톡|메일|피그마)\]\s*([^·:]+?)\s*·\s*([^:]+?)\s*[:：]\s*(.+)$/);
    if (!m) return null;
    const source = Object.keys(SOURCES).find((k) => SOURCES[k] === m[1]);
    return { source, author: m[2].trim(), screen: m[3].trim(), text: m[4].trim() };
  }
  function parsePaste(text) {
    const ok = [], bad = [];
    String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean).forEach((l, i) => { const c = parseLine(l); if (c) ok.push(c); else bad.push(i + 1); });
    return { ok, bad };
  }

  /* ---------- 비슷한 정도 ---------- */
  // 뜻 없이 자주 나오는 말은 빼고 비교한다
  const STOP = /(좋겠어요|좋겠습니다|좋을 것 같아요|것 같아요|같아요|해 주세요|해주세요|주세요|입니다|있어요|해요|너무|조금|좀|더|요|은|는|이|가|을|를|의|에|도|게)(?=\s|$)/g;
  const SYN = [[/메인|홈 화면/g, "홈"], [/텍스트|글씨|폰트/g, "글자"], [/크기를? 키우|키워|크게/g, "크게"], [/작음|작아|작다|작네/g, "작"], [/버튼|CTA/gi, "버튼"], [/색상|컬러|색깔/g, "색"]];
  function norm(s) {
    let t = String(s || "").toLowerCase();
    SYN.forEach(([re, to]) => { t = t.replace(re, to); });
    return t.replace(STOP, " ").replace(/[^\p{L}\p{N}]+/gu, "");
  }
  function grams(s) { const t = norm(s); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
  /** 두 글자 조각 겹침 (Dice 계수, 0~1) */
  function similarity(a, b) {
    const A = grams(a), B = grams(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    A.forEach((x) => { if (B.has(x)) hit++; });
    return (2 * hit) / (A.size + B.size);
  }

  /* ---------- 1) 똑같은 코멘트 지우기 ---------- */
  /** 같은 사람이 같은 말을 다른 채널로 다시 보낸 것 → 하나만 남기고 alsoIn에 채널을 적는다 */
  function dedupe(comments) {
    const out = [];
    const removed = [];
    (comments || []).forEach((c) => {
      const twin = out.find((o) => o.author === c.author && o.screen === c.screen && norm(o.text) === norm(c.text));
      if (twin) { twin.alsoIn = [...new Set([...(twin.alsoIn || []), c.source])].filter((s) => s !== twin.source); removed.push(c.id); }
      else out.push({ ...c });
    });
    return { comments: out, removed };
  }

  /* ---------- 2) 비슷한 코멘트 합치기 ---------- */
  const THRESHOLD = 0.33;
  /**
   * 같은 화면 안에서 비슷한 코멘트를 한 항목으로. 합치기는 이어짐(A~B, B~C → A·B·C).
   * 코멘트 하나는 정확히 한 항목에만 들어간다.
   */
  function groupComments(comments, threshold) {
    const th = threshold || THRESHOLD;
    const list = comments || [];
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[i].screen !== list[j].screen) continue;
      if (similarity(list[i].text, list[j].text) >= th) parent[find(j)] = find(i);
    }
    const map = new Map();
    list.forEach((c, i) => { const r = find(i); if (!map.has(r)) map.set(r, []); map.get(r).push(c); });
    return [...map.values()].map((cs) => makeGroup(cs.map((c) => c.id), cs));
  }
  function makeGroup(ids, cs, summary) {
    // 대표 문장: 따로 주지 않으면 가장 긴 코멘트
    const rep = summary || cs.slice().sort((a, b) => b.text.length - a.text.length)[0].text;
    return { id: `g-${ids.slice().sort().join("-")}`, ids, screen: cs[0].screen, summary: maskContact(rep), sources: [...new Set(cs.map((c) => c.source))], status: "open", reason: "" };
  }

  /** Claude 응답 검사 → 쓸 수 없으면 null
   *  - 없는 id는 버리고, 두 항목에 들어간 id는 앞 항목에만 남긴다
   *  - 화면이 섞인 항목은 화면별로 나눈다
   *  - 빠진 코멘트는 혼자 한 항목으로 붙인다 (놓친 수정 0건) */
  function normalizeGroups(d, comments) {
    if (!d || typeof d !== "object" || !Array.isArray(d.groups)) return null;
    const byId = new Map((comments || []).map((c) => [c.id, c]));
    const used = new Set();
    const out = [];
    d.groups.forEach((g) => {
      if (!g || !Array.isArray(g.ids)) return;
      const ids = g.ids.map(String).filter((id) => byId.has(id) && !used.has(id));
      if (!ids.length) return;
      ids.forEach((id) => used.add(id));
      const screens = [...new Set(ids.map((id) => byId.get(id).screen))];
      const sum = typeof g.summary === "string" && g.summary.trim() ? g.summary.trim().slice(0, 80) : "";
      screens.forEach((s) => {
        const part = ids.filter((id) => byId.get(id).screen === s);
        out.push(makeGroup(part, part.map((id) => byId.get(id)), screens.length === 1 ? sum : ""));
      });
    });
    if (!out.length) return null;
    (comments || []).forEach((c) => { if (!used.has(c.id)) out.push(makeGroup([c.id], [c])); });
    return out;
  }

  /* ---------- 3) 닫기 ---------- */
  /** 보류·안 함은 이유가 있어야 닫힌다 */
  function setStatus(groups, gid, status, reason) {
    if (!STATUS[status]) return { ok: false, error: "알 수 없는 상태" };
    const r = String(reason || "").trim();
    if ((status === "hold" || status === "wont") && !r) return { ok: false, error: `${status === "hold" ? "보류는" : "안 함은"} 이유를 적어야 닫혀요` };
    let hit = false;
    const next = groups.map((g) => (g.id === gid ? ((hit = true), { ...g, status, reason: status === "done" || status === "open" ? "" : r }) : g));
    return hit ? { ok: true, groups: next } : { ok: false, error: "항목을 찾지 못했어요" };
  }
  function stats(groups) {
    const s = { total: groups.length, open: 0, done: 0, hold: 0, wont: 0 };
    groups.forEach((g) => { s[g.status] = (s[g.status] || 0) + 1; });
    s.closed = s.total - s.open;
    s.pct = s.total ? Math.round((s.closed / s.total) * 100) : 0;
    return s;
  }
  /** 다시 묶어도 이미 닫은 결정은 지킨다: 코멘트가 가장 많이 겹치는 예전 항목의 상태를 가져온다.
   *  단, 처음 보는 코멘트가 끼어 있으면 새 의견이 온 것이므로 다시 '남음'으로 연다 */
  function carryStatus(oldGroups, newGroups) {
    const seen = new Set((oldGroups || []).flatMap((o) => o.ids));
    return newGroups.map((g) => {
      if (g.ids.some((id) => !seen.has(id))) return g;
      let best = null, score = 0;
      (oldGroups || []).forEach((o) => {
        const hit = o.ids.filter((id) => g.ids.includes(id)).length;
        if (hit > score) { score = hit; best = o; }
      });
      return best && best.status !== "open" && score * 2 >= g.ids.length ? { ...g, status: best.status, reason: best.reason } : g;
    });
  }
  /** 합친 항목 풀기 (잘못 합쳤을 때) */
  function splitGroup(groups, gid, comments) {
    const i = groups.findIndex((g) => g.id === gid);
    if (i < 0 || groups[i].ids.length < 2) return groups;
    const byId = new Map(comments.map((c) => [c.id, c]));
    const parts = groups[i].ids.map((id) => makeGroup([id], [byId.get(id)]));
    return groups.slice(0, i).concat(parts, groups.slice(i + 1));
  }

  /* ---------- 내보내기 ---------- */
  /** 메일 주소·전화번호는 지운다 */
  function maskContact(s) {
    return String(s || "")
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "(메일 주소 지움)")
      .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, "(전화번호 지움)");
  }
  function toNotionMd(title, groups, comments) {
    const byId = new Map(comments.map((c) => [c.id, c]));
    const screens = [...new Set(groups.map((g) => g.screen))];
    const s = stats(groups);
    const head = `## ${title || "시안 피드백"}\n\n수정 항목 ${s.total}개 · 닫음 ${s.closed} · 남음 ${s.open}\n`;
    const body = screens.map((sc) => `\n### ${sc}\n` + groups.filter((g) => g.screen === sc).map((g) => {
      const who = [...new Set(g.ids.map((id) => byId.get(id)).filter(Boolean).map((c) => c.author))].join(", ");
      const tag = g.status === "open" ? "" : ` — **${STATUS[g.status]}**${g.reason ? `: ${maskContact(g.reason)}` : ""}`;
      return `- [${g.status === "open" ? " " : "x"}] ${maskContact(g.summary)} (${who} · ${g.sources.map((x) => SOURCES[x]).join("·")} ${g.ids.length}건)${tag}`;
    }).join("\n")).join("\n");
    return head + body + "\n";
  }

  return { SOURCES, STATUS, THRESHOLD, parseLine, parsePaste, norm, grams, similarity, dedupe, groupComments, makeGroup, normalizeGroups, setStatus, stats, carryStatus, splitGroup, maskContact, toNotionMd };
});
