/* 한줄더 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Hanjulde, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 * 초안은 두 가지 길이 있다.
 *   규칙: 작가가 직접 쓴 피드백 예시 30개(EXAMPLES)에서, 고른 관찰 항목에 맞는 문장을 그대로 가져온다.
 *   Claude: 같은 예시만 보고 과제에 맞게 다시 쓴다. 근거로 쓴 예시 번호(basis)를 반드시 붙이고,
 *           normalizeDraft()가 예시 밖 번호·작가가 쓰지 않는 표현을 찾으면 버린다.
 * 마지막 한 줄은 늘 작가가 쓴다. canSend()가 그 줄이 없으면 보내지 못하게 막는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Hanjulde = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAY_MS = 86400000;
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((d0(b) - d0(a)) / DAY_MS); }
  function md(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }

  /* ---------- 관찰 항목 ---------- */
  const TAGS = [
    { id: "form", label: "형태·비례" },
    { id: "value", label: "명암" },
    { id: "comp", label: "구도·여백" },
    { id: "line", label: "선" },
    { id: "color", label: "색" },
    { id: "habit", label: "꾸준함" },
  ];
  const tagLabel = (id) => (TAGS.find((t) => t.id === id) || { label: id }).label;

  /* ---------- 작가가 실제로 쓴 피드백 예시 30개 (항목마다 좋은 점 2 · 다음에 해 볼 것 3) ---------- */
  const EX = [
    ["form", "good", "컵 입구 타원이 바닥 타원보다 얇게 그려져서 눈높이가 자연스럽게 느껴져요."],
    ["form", "good", "큰 덩어리부터 잡고 들어가서 전체 비율이 안정적이에요."],
    ["form", "next", "손잡이가 몸통에 붙는 위치를 한 번만 더 확인해 보면 좋겠어요. 위아래 간격을 손가락으로 재 보세요."],
    ["form", "next", "그리기 전에 연필을 눕혀 가로세로 비율을 먼저 재 보면 길쭉해지는 걸 막을 수 있어요."],
    ["form", "next", "귀 두 개의 크기가 조금 달라요. 대칭인 부분은 중심선을 옅게 그어 두고 시작해 보세요."],
    ["value", "good", "그림자 쪽을 과감하게 눌러서 형태가 단단해 보여요."],
    ["value", "good", "밝은 면을 비워 둔 용기가 좋아요. 종이 색이 빛 역할을 하고 있어요."],
    ["value", "next", "가장 어두운 곳과 가장 밝은 곳을 먼저 정해 보세요. 지금은 중간 톤이 넓어서 조금 흐릿해 보여요."],
    ["value", "next", "바닥에 닿는 그림자를 한 단계 더 어둡게 눌러 주면 물건이 바닥에 앉아요."],
    ["value", "next", "눈을 반쯤 감고 보면 명암 덩어리가 보여요. 그 덩어리 세 개만 먼저 칠해 보세요."],
    ["comp", "good", "주인공을 살짝 옆으로 비켜 둬서 시선이 머무는 자리가 생겼어요."],
    ["comp", "good", "위아래 여백이 넉넉해서 그림이 편하게 숨 쉬어요."],
    ["comp", "next", "그림이 종이 한쪽으로 쏠려 있어요. 시작 전에 네 귀퉁이에 점을 찍고 들어갈 자리를 정해 보세요."],
    ["comp", "next", "주인공이 조금 작아요. 종이의 3분의 2 정도를 채운다는 느낌으로 크게 시작해 보세요."],
    ["comp", "next", "가장자리에 너무 붙어 있어서 답답해 보여요. 손가락 한 마디만큼 여백을 남겨 주세요."],
    ["line", "good", "선을 한 번에 긋지 않고 여러 번 찾아간 흔적이 그대로 살아 있어서 좋아요."],
    ["line", "good", "외곽선 굵기에 강약이 있어서 앞뒤가 느껴져요."],
    ["line", "next", "빛 받는 쪽 외곽선은 조금 가늘게, 그림자 쪽은 굵게 바꿔 보세요."],
    ["line", "next", "같은 곳을 여러 번 덧그린 선이 겹쳐 보여요. 마지막에 남길 선 하나만 고르고 나머지는 지우개로 살짝 눌러 주세요."],
    ["line", "next", "손목 말고 팔꿈치로 긴 선을 그어 보세요. 선이 훨씬 편안해져요."],
    ["color", "good", "같은 계열 색 안에서 온도를 바꿔 쓴 게 눈에 띄어요."],
    ["color", "good", "배경 색을 주인공 색과 반대로 잡아서 주인공이 또렷해요."],
    ["color", "next", "색이 모두 비슷하게 진해요. 주인공 한 곳만 진하게 두고 나머지는 물을 더 섞어 보세요."],
    ["color", "next", "그림자에 검정 대신 보색을 살짝 섞어 보세요. 그림이 탁해지지 않아요."],
    ["color", "next", "칠하기 전에 쓸 색 세 가지만 팔레트에 따로 짜 두고 시작해 보세요."],
    ["habit", "good", "지난 과제보다 손이 훨씬 편해졌어요. 꾸준히 그린 게 그림에 보여요."],
    ["habit", "good", "어려웠던 부분을 메모로 남겨 줘서 어디를 봐 드릴지 바로 알 수 있었어요."],
    ["habit", "next", "다음 과제 전에 오늘 그림을 10분만 다시 따라 그려 보세요. 같은 그림을 두 번 그리면 손이 기억해요."],
    ["habit", "next", "완성이 안 돼도 괜찮으니 정해 둔 시간에 멈추고 올려 주세요. 멈춘 자리를 보는 게 더 도움이 돼요."],
    ["habit", "next", "그리기 전에 참고 사진을 1분만 관찰하고 시작해 보세요."],
  ];
  const EXAMPLES = EX.map(([tag, kind, text], i) => ({ id: `E${String(i + 1).padStart(2, "0")}`, tag, kind, text }));
  const exById = (id) => EXAMPLES.find((e) => e.id === id);

  /* ---------- 작가 말투 검사: 작가가 한 번도 쓰지 않은 표현 ---------- */
  const OFF_STYLE = ["전문가", "학원", "포토샵", "틀렸", "잘못", "반드시", "하십시오", "기초부터 다시", "재능", "실력이 부족", "프로처럼", "완벽"];
  function styleIssues(text) {
    const s = String(text || "");
    return OFF_STYLE.filter((w) => s.includes(w));
  }

  /* ---------- 그림 분석 (밝기 배열만 받는다: 0~255, 길이 w*h) ---------- */
  function analyze(gray, w, h) {
    const n = w * h;
    if (!gray || gray.length < n || n === 0) return null;
    // 바탕 밝기: 네 귀퉁이 8x8 의 중앙값
    const corner = [];
    for (const [cx, cy] of [[0, 0], [w - 8, 0], [0, h - 8], [w - 8, h - 8]])
      for (let y = cy; y < cy + 8; y++) for (let x = cx; x < cx + 8; x++) corner.push(gray[y * w + x]);
    corner.sort((a, b) => a - b);
    const bg = corner[corner.length >> 1];
    const hist = new Array(256).fill(0);
    let minX = w, minY = h, maxX = -1, maxY = -1, ink = 0, sx = 0, sy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      hist[v]++;
      if (Math.abs(v - bg) > 24) {
        ink++; sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
    const contrast = (pct(0.98) - pct(0.02)) / 255;
    if (!ink) return { bg, contrast: round2(contrast), offset: 0, fill: 0, ink: 0, box: null };
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const mx = sx / ink / w - 0.5, my = sy / ink / h - 0.5;
    return {
      bg,
      contrast: round2(contrast),                       // 0~1, 가장 어두운 곳과 밝은 곳의 차이
      offset: round2(Math.sqrt(mx * mx + my * my) * 2),  // 0 = 가운데, 1 = 귀퉁이
      fill: round2((bw * bh) / n),                       // 그림이 차지한 상자의 넓이 비율
      ink: round2(ink / n),
      box: { x: minX, y: minY, w: bw, h: bh },
    };
  }
  const round2 = (v) => Math.round(v * 100) / 100;

  /** 분석 숫자로 먼저 볼 항목을 고른다 (작가가 바꿀 수 있다) */
  function suggestTags(a) {
    if (!a) return [];
    const out = [];
    if (a.contrast < 0.5) out.push("value");
    if (a.offset > 0.3 || a.fill < 0.2 || a.fill > 0.82) out.push("comp");
    return out;
  }
  function analysisNotes(a) {
    if (!a) return [];
    const out = [];
    out.push(a.contrast < 0.5 ? `명암 대비 ${Math.round(a.contrast * 100)}% · 어두운 곳이 약해요` : `명암 대비 ${Math.round(a.contrast * 100)}% · 충분해요`);
    if (a.offset > 0.3) out.push(`그림 중심이 가운데서 ${Math.round(a.offset * 100)}% 벗어났어요`);
    if (a.fill < 0.2) out.push(`그림이 종이의 ${Math.round(a.fill * 100)}%만 차지해요`);
    else if (a.fill > 0.82) out.push(`그림이 종이의 ${Math.round(a.fill * 100)}%를 채워 가장자리가 답답해요`);
    return out;
  }

  /* ---------- 대기열 ---------- */
  const waitDays = (sub, today) => Math.max(0, daysBetween(sub.submitted, today));
  function sortQueue(subs, today) {
    return subs.slice().sort((a, b) => waitDays(b, today) - waitDays(a, today) || a.id.localeCompare(b.id));
  }
  function queueStats(subs, sent, today) {
    const ws = subs.map((s) => waitDays(s, today));
    const done = (sent || []).map((s) => s.waited);
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);
    return { pending: subs.length, avgWait: avg(ws), maxWait: ws.length ? Math.max(...ws) : 0, late: ws.filter((w) => w >= 3).length, sent: done.length, avgSentWait: avg(done) };
  }

  /* ---------- 규칙 초안: 예시 문장을 그대로 가져온다 ---------- */
  function hash(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  function pick(list, seed) { return list.length ? list[seed % list.length] : null; }
  function allowedExamples(tags) {
    const set = new Set(tags);
    return EXAMPLES.filter((e) => set.has(e.tag) || e.kind === "good");
  }
  function draftRule(sub, tags) {
    const seed = hash(sub.id);
    const issue = tags.length ? tags : ["habit"];
    // 좋은 점: 고친 항목이 아닌 쪽에서 하나 (같은 항목을 칭찬하고 고치라 하지 않게)
    const goods = EXAMPLES.filter((e) => e.kind === "good" && !issue.includes(e.tag));
    const good = pick(goods.length ? goods : EXAMPLES.filter((e) => e.kind === "good"), seed);
    const nexts = issue.slice(0, 2).map((t, i) => pick(EXAMPLES.filter((e) => e.kind === "next" && e.tag === t), seed + i)).filter(Boolean);
    return { good: good.text, next: nexts.map((e) => e.text).join(" "), basis: [good.id, ...nexts.map((e) => e.id)] };
  }

  /** Claude 응답 검사: 형식·근거 예시·말투가 하나라도 어긋나면 null (규칙 초안 유지) */
  function normalizeDraft(data, allowedIds) {
    if (!data || typeof data !== "object") return null;
    const good = typeof data.good === "string" ? data.good.trim() : "";
    const next = typeof data.next === "string" ? data.next.trim() : "";
    if (good.length < 8 || next.length < 8 || good.length > 300 || next.length > 400) return null;
    const allow = new Set(allowedIds || []);
    const basis = Array.isArray(data.basis) ? [...new Set(data.basis.map((x) => String(x).trim().toUpperCase()))] : [];
    if (!basis.length || basis.some((b) => !allow.has(b))) return null;
    if (styleIssues(good).length || styleIssues(next).length) return null;
    return { good, next, basis };
  }

  /* ---------- 보내기 ---------- */
  function canSend(finalLine) {
    const s = String(finalLine || "").trim();
    if (s.length < 8) return { ok: false, reason: "마지막 한 줄을 8자 이상 직접 써 주세요" };
    const off = styleIssues(s);
    if (off.length) return { ok: false, reason: `평소 쓰지 않는 표현이 있어요: ${off.join(", ")}` };
    return { ok: true, reason: "" };
  }
  function compose(nick, draft, finalLine) {
    return [`${nick}님, 과제 잘 받았어요.`, "", `좋은 점 · ${draft.good}`, `다음에 해 볼 것 · ${draft.next}`, "", String(finalLine).trim()].join("\n");
  }

  /** 보낸 기록 내보내기: 닉네임·본문은 빼고 번호·항목·대기일만 */
  function exportCsv(sent) {
    const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [["과제번호", "과제", "보낸 날", "대기일", "관찰 항목", "근거 예시", "초안"]];
    (sent || []).forEach((s) => rows.push([s.id, s.title, s.date, s.waited, s.tags.map(tagLabel).join(" / "), s.basis.join(" "), s.mode === "ai" ? "Claude" : "규칙"]));
    return "﻿" + rows.map((r) => r.map(q).join(",")).join("\n");
  }

  return { d0, iso, addDays, daysBetween, md, TAGS, tagLabel, EXAMPLES, exById, OFF_STYLE, styleIssues, analyze, suggestTags, analysisNotes, waitDays, sortQueue, queueStats, allowedExamples, draftRule, normalizeDraft, canSend, compose, exportCsv };
});
