/* 한줄더 — 화면 (DOM 다루기만 한다. 분석·초안 규칙·검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 과제를 고르면
 *   1) 그림을 캔버스에 그리고 밝기를 읽어 명암·구도를 잰다 (logic.analyze)
 *   2) 숫자로 먼저 볼 항목을 고르고, 작가 예시 30개에서 초안을 바로 만든다 (규칙)
 *   3) Claude 에게 같은 예시만 주고 다시 쓰게 한다. 근거 예시 번호·말투 검사를 통과하면 덮어쓴다.
 * 마지막 한 줄은 작가가 직접 써야 '보내기'가 열린다.
 */
(function () {
  "use strict";
  const L = window.Hanjulde;
  const STORE_KEY = "startup-class-feedback-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());

  /* ---------- 샘플 과제 (가상의 수강생 · 그림은 캔버스로 그린 샘플) ---------- */
  function samples() {
    const t = today();
    const S = (id, nick, title, ago, scene, note) => ({ id, nick, title, submitted: L.addDays(t, -ago), scene, note });
    return [
      S("S-031", "솜사탕", "3주차 · 컵 정물 명암", 6, { kind: "cup", cx: 0.5, cy: 0.52, s: 1, light: 214, dark: 178 }, "그림자를 넣으면 자꾸 지저분해져서 연하게만 칠했어요."),
      S("S-027", "밤산책", "4주차 · 고양이 실루엣", 5, { kind: "cat", cx: 0.27, cy: 0.62, s: 0.9, light: 190, dark: 52 }, "고양이가 너무 구석에 있는 것 같은데 어디에 둬야 할지 모르겠어요."),
      S("S-044", "연필깎이", "3주차 · 컵 정물 명암", 4, { kind: "cup", cx: 0.5, cy: 0.5, s: 0.5, light: 200, dark: 60 }, "명암은 이번에 좀 자신 있게 넣어 봤어요!"),
      S("S-052", "주말화가", "5주차 · 사과 색칠", 3, { kind: "apple", cx: 0.5, cy: 0.52, s: 1, light: 120, dark: 40, color: true }, "빨간색이 너무 한 가지 색처럼 보여요."),
      S("S-019", "초록잉크", "4주차 · 화분 구도", 2, { kind: "plant", cx: 0.5, cy: 0.5, s: 1.5, light: 170, dark: 70 }, "잎을 크게 그리고 싶었어요."),
      S("S-012", "새벽드로잉", "4주차 · 고양이 실루엣", 2, { kind: "cat", cx: 0.5, cy: 0.55, s: 1.05, light: 185, dark: 40 }, "꼬리 선이 마음에 안 들어요."),
      S("S-060", "토끼발", "3주차 · 컵 정물 명암", 1, { kind: "cup", cx: 0.55, cy: 0.52, s: 0.95, light: 205, dark: 75 }, "손잡이 위치가 어색한 것 같아요."),
      S("S-063", "고양이손", "5주차 · 사과 색칠", 0, { kind: "apple", cx: 0.48, cy: 0.5, s: 0.95, light: 190, dark: 150, color: true, pale: true }, "물을 많이 섞었더니 흐려졌어요."),
    ];
  }
  function sentSamples() {
    const t = today();
    return [
      { id: "S-008", nick: "오후세시", title: "3주차 · 컵 정물 명암", date: L.addDays(t, -1), waited: 1, tags: ["value"], basis: ["E16", "E08"], mode: "rule", text: "오후세시님, 과제 잘 받았어요.\n\n좋은 점 · 선을 한 번에 긋지 않고 여러 번 찾아간 흔적이 그대로 살아 있어서 좋아요.\n다음에 해 볼 것 · 가장 어두운 곳과 가장 밝은 곳을 먼저 정해 보세요.\n\n다음 컵은 유리컵으로 해 봐요. 그림자가 더 재밌어질 거예요." },
      { id: "S-015", nick: "물감한방울", title: "4주차 · 화분 구도", date: L.addDays(t, -1), waited: 2, tags: ["comp"], basis: ["E06", "E13"], mode: "rule", text: "물감한방울님, 과제 잘 받았어요.\n\n좋은 점 · 그림자 쪽을 과감하게 눌러서 형태가 단단해 보여요.\n다음에 해 볼 것 · 그림이 종이 한쪽으로 쏠려 있어요.\n\n잎 표현은 이미 충분해요. 자리만 잡으면 돼요." },
    ];
  }

  /* ---------- 상태 ---------- */
  const seed = () => ({ subs: samples(), sent: sentSamples(), sel: "S-031", work: {}, onlyLate: false });
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.subs) && Array.isArray(v.sent) && v.work) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  const analyses = {}; // 그림 분석은 매번 다시 잰다 (저장하지 않음)
  let runToken = 0;
  let waiting = false;
  const cur = () => st.subs.find((s) => s.id === st.sel) || null;
  const workOf = (id) => (st.work[id] = st.work[id] || { tags: null, draft: null, mode: "rule", reason: "", ms: 0, final: "", stale: false });

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 그림 그리기 (샘플 과제 그림) ---------- */
  function rng(seedStr) { let h = 9; for (const c of seedStr) h = (h * 33 + c.charCodeAt(0)) >>> 0; return () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function drawScene(cv, sub) {
    const c = cv.getContext("2d");
    const W = cv.width, H = cv.height, sc = sub.scene, r = rng(sub.id);
    const g = (v) => `rgb(${v},${v},${v})`;
    const lightC = sc.color ? (sc.pale ? "#E9B7AE" : "#D2412F") : g(sc.light);
    const darkC = sc.color ? (sc.pale ? "#D9A39A" : "#7A1F17") : g(sc.dark);
    c.fillStyle = "#F7F3EA"; c.fillRect(0, 0, W, H);
    // 종이 결
    c.globalAlpha = 0.05; c.fillStyle = "#8A7E68";
    for (let i = 0; i < 260; i++) c.fillRect(r() * W, r() * H, 1.4, 1.4);
    c.globalAlpha = 1;
    const cx = sc.cx * W, cy = sc.cy * H, u = Math.min(W, H) * 0.32 * sc.s;
    c.lineJoin = "round"; c.lineCap = "round";
    // 바닥 그림자
    c.fillStyle = darkC; c.globalAlpha = sc.pale ? 0.35 : 0.55;
    c.beginPath(); c.ellipse(cx + u * 0.25, cy + u * 0.92, u * 0.95, u * 0.16, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
    c.fillStyle = lightC; c.strokeStyle = darkC; c.lineWidth = 2.2;
    if (sc.kind === "cup") {
      c.beginPath(); c.moveTo(cx - u * 0.6, cy - u * 0.7); c.lineTo(cx - u * 0.5, cy + u * 0.8);
      c.quadraticCurveTo(cx, cy + u * 1.0, cx + u * 0.5, cy + u * 0.8); c.lineTo(cx + u * 0.6, cy - u * 0.7); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(cx, cy - u * 0.7, u * 0.6, u * 0.16, 0, 0, Math.PI * 2); c.fillStyle = "#F3EEE4"; c.fill(); c.stroke();
      c.beginPath(); c.lineWidth = u * 0.12; c.arc(cx + u * 0.72, cy, u * 0.3, -Math.PI / 2.2, Math.PI / 2.2); c.stroke(); c.lineWidth = 2.2;
      shade(c, darkC, () => { c.beginPath(); c.moveTo(cx + u * 0.1, cy - u * 0.6); c.lineTo(cx + u * 0.6, cy - u * 0.7); c.lineTo(cx + u * 0.5, cy + u * 0.8); c.quadraticCurveTo(cx + u * 0.3, cy + u * 0.92, cx + u * 0.1, cy + u * 0.92); c.closePath(); }, r, sc.pale);
    } else if (sc.kind === "cat") {
      c.fillStyle = darkC;
      c.beginPath(); c.ellipse(cx, cy + u * 0.3, u * 0.62, u * 0.58, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(cx - u * 0.05, cy - u * 0.45, u * 0.36, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(cx - u * 0.38, cy - u * 0.55); c.lineTo(cx - u * 0.3, cy - u * 0.98); c.lineTo(cx - u * 0.08, cy - u * 0.72); c.fill();
      c.beginPath(); c.moveTo(cx + u * 0.26, cy - u * 0.58); c.lineTo(cx + u * 0.22, cy - u * 0.98); c.lineTo(cx, cy - u * 0.74); c.fill();
      c.beginPath(); c.lineWidth = u * 0.14; c.moveTo(cx + u * 0.55, cy + u * 0.65); c.bezierCurveTo(cx + u * 1.1, cy + u * 0.6, cx + u * 1.0, cy - u * 0.1, cx + u * 0.75, cy - u * 0.2); c.stroke();
      c.fillStyle = g(Math.min(250, sc.light + 40)); c.beginPath(); c.arc(cx - u * 0.18, cy - u * 0.5, u * 0.05, 0, 7); c.arc(cx + u * 0.08, cy - u * 0.5, u * 0.05, 0, 7); c.fill();
    } else if (sc.kind === "plant") {
      c.fillStyle = darkC;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.42;
        c.save(); c.translate(cx, cy - u * 0.05); c.rotate(a + Math.PI / 2);
        c.beginPath(); c.ellipse(0, -u * 0.55, u * 0.17, u * 0.5, 0, 0, Math.PI * 2); c.fillStyle = i % 2 ? darkC : g(Math.round((sc.light + sc.dark) / 2)); c.fill(); c.restore();
      }
      c.fillStyle = lightC; c.beginPath(); c.moveTo(cx - u * 0.48, cy); c.lineTo(cx + u * 0.48, cy); c.lineTo(cx + u * 0.36, cy + u * 0.85); c.lineTo(cx - u * 0.36, cy + u * 0.85); c.closePath(); c.fill(); c.stroke();
      shade(c, darkC, () => { c.beginPath(); c.moveTo(cx + u * 0.1, cy); c.lineTo(cx + u * 0.48, cy); c.lineTo(cx + u * 0.36, cy + u * 0.85); c.lineTo(cx + u * 0.05, cy + u * 0.85); c.closePath(); }, r);
    } else {
      c.beginPath(); c.arc(cx - u * 0.22, cy + u * 0.1, u * 0.55, 0, Math.PI * 2); c.arc(cx + u * 0.22, cy + u * 0.1, u * 0.55, 0, Math.PI * 2); c.fill();
      shade(c, darkC, () => { c.beginPath(); c.arc(cx + u * 0.3, cy + u * 0.2, u * 0.45, -Math.PI / 2, Math.PI / 1.4); c.closePath(); }, r, sc.pale);
      c.strokeStyle = "#5B4630"; c.lineWidth = u * 0.07; c.beginPath(); c.moveTo(cx, cy - u * 0.35); c.quadraticCurveTo(cx + u * 0.05, cy - u * 0.6, cx + u * 0.15, cy - u * 0.75); c.stroke();
      c.fillStyle = sc.pale ? "#B9CDB0" : "#4F7D3A"; c.beginPath(); c.ellipse(cx + u * 0.32, cy - u * 0.62, u * 0.2, u * 0.09, -0.5, 0, Math.PI * 2); c.fill();
    }
  }
  function shade(c, color, path, r, pale) {
    c.save(); path(); c.clip();
    c.strokeStyle = color; c.globalAlpha = pale ? 0.25 : 0.7; c.lineWidth = 1.3;
    for (let x = -400; x < 400; x += 4.5) { c.beginPath(); c.moveTo(x + r() * 2, 0); c.lineTo(x + 300, 300); c.stroke(); }
    c.restore();
  }
  function grayOf(cv) {
    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    const out = new Uint8Array(cv.width * cv.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    return out;
  }
  function analysisFor(sub) {
    if (analyses[sub.id]) return analyses[sub.id];
    const cv = document.createElement("canvas"); cv.width = 360; cv.height = 270;
    drawScene(cv, sub);
    return (analyses[sub.id] = L.analyze(grayOf(cv), cv.width, cv.height));
  }

  /* ---------- 위: 현황 ---------- */
  function renderStats() {
    const s = L.queueStats(st.subs, st.sent, today());
    const tile = (k, v, sub, warn) => `<div class="tile${warn ? " warn" : ""}"><span>${k}</span><b>${v}</b><em>${sub}</em></div>`;
    $("stats").innerHTML = tile("대기 과제", `${s.pending}건`, "오래 기다린 순", false)
      + tile("평균 대기", `${s.avgWait}일`, `가장 오래 ${s.maxWait}일`, s.avgWait > 1)
      + tile("3일 넘은 과제", `${s.late}건`, "먼저 보내기", s.late > 0)
      + tile("보낸 피드백", `${s.sent}건`, s.sent ? `보낼 때까지 평균 ${s.avgSentWait}일` : "아직 없음", false);
  }

  /* ---------- 왼쪽: 대기열 ---------- */
  function renderQueue() {
    const list = L.sortQueue(st.subs, today()).filter((s) => !st.onlyLate || L.waitDays(s, today()) >= 3);
    $("queue").innerHTML = list.map((s) => {
      const w = L.waitDays(s, today());
      const done = st.work[s.id] && st.work[s.id].final.trim();
      return `<li><button type="button" data-id="${s.id}" aria-current="${s.id === st.sel}">
        <span class="q-top"><b>${esc(s.nick)}</b><span class="wait ${w >= 3 ? "late" : w >= 1 ? "mid" : ""}">${w ? `${w}일 대기` : "오늘"}</span></span>
        <span class="q-t">${esc(s.title)}</span>${done ? `<span class="q-ready">한 줄 씀</span>` : ""}</button></li>`;
    }).join("") || `<li class="q-empty">${st.subs.length ? "3일 넘게 기다린 과제가 없어요." : "모든 과제에 피드백을 보냈어요."}</li>`;
  }

  /* ---------- 가운데: 과제 + 분석 ---------- */
  function meter(label, v, bad, hint) {
    return `<div class="meter${bad ? " bad" : ""}"><span>${label}</span><i><s style="width:${Math.round(Math.min(1, v) * 100)}%"></s></i><b>${Math.round(v * 100)}%</b><em>${hint}</em></div>`;
  }
  function renderWork() {
    const sub = cur();
    if (!sub) { $("work").innerHTML = `<div class="empty"><b>대기 중인 과제가 없어요</b>‘샘플로 되돌리기’로 다시 볼 수 있어요.</div>`; return; }
    const a = analysisFor(sub), wk = workOf(sub.id);
    if (!wk.tags) wk.tags = L.suggestTags(a);
    const sug = L.suggestTags(a);
    const w = L.waitDays(sub, today());
    $("work").innerHTML = `
      <div class="w-h"><div><h2>${esc(sub.title)}</h2><p>${esc(sub.nick)} · ${sub.id} · ${L.md(sub.submitted)} 제출</p></div><span class="wait big ${w >= 3 ? "late" : w >= 1 ? "mid" : ""}">${w ? `${w}일 대기` : "오늘 제출"}</span></div>
      <div class="art"><canvas id="art" width="360" height="270" role="img" aria-label="${esc(sub.nick)}님의 과제 그림 (샘플)"></canvas></div>
      <div class="meters">
        ${meter("명암 대비", a.contrast, a.contrast < 0.5, "50% 미만이면 명암")}
        ${meter("중심 벗어남", a.offset, a.offset > 0.3, "30% 넘으면 구도")}
        ${meter("화면 채움", a.fill, a.fill < 0.2 || a.fill > 0.82, "20~82%가 편해요")}
      </div>
      <ul class="notes">${L.analysisNotes(a).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      <blockquote class="memo"><span>수강생 메모</span>${esc(sub.note)}</blockquote>
      <div class="tags-h"><h3>이번에 짚을 항목</h3><span>분석이 고른 항목은 <i class="dot"></i> 표시</span></div>
      <div class="tags" role="group" aria-label="관찰 항목">${L.TAGS.map((t) => `<button type="button" data-tag="${t.id}" aria-pressed="${wk.tags.includes(t.id)}">${sug.includes(t.id) ? `<i class="dot" aria-label="분석 추천"></i>` : ""}${t.label}</button>`).join("")}</div>
      <button class="primary" id="runDraft" type="button">${wk.draft ? "초안 다시 쓰기" : "초안 쓰기"}</button>`;
    drawScene($("art"), sub);
  }

  /* ---------- 오른쪽: 초안 ---------- */
  function modeChip(wk) {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 예시를 보는 중</span>`;
    if (wk.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 초안 · ${(wk.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 예시 문장을 그대로 가져왔어요">규칙 기반${wk.reason ? ` · ${esc(wk.reason)}` : ""}</span>`;
  }
  function renderDraft() {
    const sub = cur();
    if (!sub) { $("draft").innerHTML = ""; return; }
    const wk = workOf(sub.id);
    if (!wk.draft) { $("draft").innerHTML = `<div class="empty"><b>아직 초안이 없어요</b>항목을 고르고 ‘초안 쓰기’를 누르세요.</div>`; return; }
    const d = wk.draft;
    const off = [...L.styleIssues(d.good), ...L.styleIssues(d.next)];
    const ok = L.canSend(wk.final);
    $("draft").innerHTML = `
      <div class="d-h"><h2>피드백 초안</h2>${modeChip(wk)}</div>
      ${wk.stale ? `<p class="stale">항목을 바꿨어요. ‘초안 다시 쓰기’를 누르면 새 항목으로 써요.</p>` : ""}
      <div class="d-body${waiting ? " waiting" : ""}">
        <label for="dGood">좋은 점</label><textarea id="dGood" data-k="good" rows="3">${esc(d.good)}</textarea>
        <label for="dNext">다음에 해 볼 것</label><textarea id="dNext" data-k="next" rows="4">${esc(d.next)}</textarea>
        <p class="style ${off.length ? "bad" : ""}" id="styleLine">${off.length ? `평소 쓰지 않는 표현: ${off.map(esc).join(", ")}` : "내 예시 30개 기준 · 평소 쓰지 않는 표현 0개"}</p>
        <div class="basis"><span>근거 예시</span>${d.basis.map((b) => `<button type="button" class="ex" data-ex="${b}" title="${esc((L.exById(b) || {}).text)}">${b}</button>`).join("")}</div>
      </div>
      <div class="final">
        <label for="final"><b>마지막 한 줄</b> · 작가가 직접 써요</label>
        <textarea id="final" rows="2" placeholder="예) 다음 컵은 유리컵으로 해 봐요. 그림자가 더 재밌어질 거예요.">${esc(wk.final)}</textarea>
        <p class="why" id="why">${ok.ok ? "보낼 준비가 됐어요." : esc(ok.reason)}</p>
      </div>
      <details class="preview"><summary>보낼 글 미리 보기</summary><pre id="pv">${esc(L.compose(sub.nick, d, wk.final || "(마지막 한 줄)"))}</pre></details>
      <button class="primary send" id="send" type="button" ${ok.ok && !off.length && !waiting ? "" : "disabled"}>${esc(sub.nick)}님께 보내기</button>`;
  }
  function refreshDraftBits() {
    const sub = cur(); if (!sub) return;
    const wk = workOf(sub.id), d = wk.draft; if (!d) return;
    const off = [...L.styleIssues(d.good), ...L.styleIssues(d.next)];
    const sl = $("styleLine");
    sl.className = `style ${off.length ? "bad" : ""}`;
    sl.textContent = off.length ? `평소 쓰지 않는 표현: ${off.join(", ")}` : "내 예시 30개 기준 · 평소 쓰지 않는 표현 0개";
    const ok = L.canSend(wk.final);
    $("why").textContent = ok.ok ? (off.length ? "초안의 표현을 고치면 보낼 수 있어요." : "보낼 준비가 됐어요.") : ok.reason;
    $("send").disabled = !ok.ok || !!off.length || waiting;
    $("pv").textContent = L.compose(sub.nick, d, wk.final || "(마지막 한 줄)");
  }

  /* ---------- 초안 쓰기: 규칙 먼저, Claude 가 오면 덮어쓰기 ---------- */
  async function runDraft() {
    const sub = cur(); if (!sub) return;
    const my = ++runToken;
    const wk = workOf(sub.id);
    const a = analysisFor(sub);
    wk.draft = L.draftRule(sub, wk.tags);
    wk.mode = "rule"; wk.reason = ""; wk.stale = false; wk.touched = false;
    waiting = AI.status().enabled !== false;
    renderWork(); renderDraft(); renderQueue();
    const allowed = L.allowedExamples(wk.tags.length ? wk.tags : ["habit"]);
    const r = await AI.ask("classfeedback.draft", {
      title: sub.title, note: sub.note,
      tags: wk.tags.map(L.tagLabel), analysis: L.analysisNotes(a),
      examples: allowed.map((e) => ({ id: e.id, tag: L.tagLabel(e.tag), kind: e.kind === "good" ? "좋은 점" : "다음에 해 볼 것", text: e.text })),
    });
    if (my !== runToken) return; // 그 사이 다른 과제를 골랐으면 버린다
    waiting = false;
    const n = r && L.normalizeDraft(r.data, allowed.map((e) => e.id));
    if (n && !wk.touched) { wk.draft = n; wk.mode = "ai"; wk.ms = r.ms; save(); renderDraft(); return; }
    wk.reason = n ? "직접 고친 초안 유지" : r ? "예시 밖 내용이라 버림" : (AI.status().reason || "");
    save();
    // 규칙 초안을 그대로 쓰므로 입력 중인 칸은 다시 그리지 않는다 (포커스 유지)
    const chip = document.querySelector("#draft .mode");
    if (chip) chip.outerHTML = modeChip(wk);
    const body = document.querySelector("#draft .d-body");
    if (body) body.classList.remove("waiting");
    refreshDraftBits();
  }

  function select(id) {
    runToken++; waiting = false;
    st.sel = id; save();
    renderQueue(); renderWork(); renderDraft();
    if (!workOf(id).draft) runDraft();
  }

  /* ---------- 아래: 보낸 피드백 · 예시 ---------- */
  function renderSent() {
    $("sent").innerHTML = st.sent.slice().reverse().map((s) => `<li><details><summary><b>${esc(s.nick)}</b> · ${esc(s.title)} <span class="s-meta">${L.md(s.date)} · ${s.waited}일 만에 · ${s.mode === "ai" ? "Claude 초안" : "규칙 초안"}</span></summary><pre>${esc(s.text)}</pre></details></li>`).join("") || `<li class="q-empty">아직 보낸 피드백이 없어요.</li>`;
  }
  function renderLib() {
    $("libList").innerHTML = L.TAGS.map((t) => `<div class="lib-g"><h3>${t.label}</h3><ul>${L.EXAMPLES.filter((e) => e.tag === t.id).map((e) => `<li id="ex-${e.id}"><code>${e.id}</code><span class="k ${e.kind}">${e.kind === "good" ? "좋은 점" : "해 볼 것"}</span>${esc(e.text)}</li>`).join("")}</ul></div>`).join("");
  }
  const renderAll = () => { renderStats(); renderQueue(); renderWork(); renderDraft(); renderSent(); };

  /* ---------- 이벤트 ---------- */
  $("queue").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) select(b.dataset.id); });
  $("onlyLate").addEventListener("change", (e) => { st.onlyLate = e.target.checked; save(); renderQueue(); });
  $("work").addEventListener("click", (e) => {
    const t = e.target.closest("button[data-tag]");
    if (t) {
      const wk = workOf(st.sel), id = t.dataset.tag;
      wk.tags = wk.tags.includes(id) ? wk.tags.filter((x) => x !== id) : [...wk.tags, id];
      if (wk.draft) wk.stale = true;
      save(); renderWork(); renderDraft();
      const again = document.querySelector(`#work button[data-tag="${id}"]`); if (again) again.focus();
      return;
    }
    if (e.target.closest("#runDraft")) runDraft();
  });
  $("draft").addEventListener("input", (e) => {
    const wk = workOf(st.sel);
    if (e.target.id === "final") wk.final = e.target.value;
    else if (e.target.dataset.k && wk.draft) { wk.draft[e.target.dataset.k] = e.target.value; wk.touched = true; }
    save(); refreshDraftBits();
    if (e.target.id === "final") renderQueue();
  });
  $("draft").addEventListener("click", (e) => {
    const ex = e.target.closest("button[data-ex]");
    if (ex) {
      $("lib").open = true;
      const li = $(`ex-${ex.dataset.ex}`);
      if (li) { li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash"); li.scrollIntoView({ block: "center" }); }
      return;
    }
    if (e.target.closest("#send")) send();
  });
  function send() {
    const sub = cur(); if (!sub) return;
    const wk = workOf(sub.id);
    if (!L.canSend(wk.final).ok || L.styleIssues(wk.draft.good + wk.draft.next).length) return;
    const before = JSON.parse(JSON.stringify(st));
    const rec = { id: sub.id, nick: sub.nick, title: sub.title, date: today(), waited: L.waitDays(sub, today()), tags: wk.tags.slice(), basis: wk.draft.basis.slice(), mode: wk.mode, text: L.compose(sub.nick, wk.draft, wk.final) };
    st.sent.push(rec);
    st.subs = st.subs.filter((s) => s.id !== sub.id);
    delete st.work[sub.id];
    const next = L.sortQueue(st.subs, today())[0];
    st.sel = next ? next.id : null;
    save(); renderAll();
    if (next && !workOf(next.id).draft) runDraft();
    toast(`${sub.nick}님께 보냈어요 · ${rec.waited}일 만에`, () => { runToken++; waiting = false; st = before; save(); renderAll(); });
  }
  $("csv").addEventListener("click", () => {
    const blob = new Blob([L.exportCsv(st.sent)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `feedback-log-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`보낸 피드백 ${st.sent.length}건을 내보냈어요 (닉네임·본문 제외)`);
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    runToken++; waiting = false;
    st = seed(); save(); renderAll(); runDraft();
    toast("샘플 과제로 되돌렸어요", () => { runToken++; waiting = false; st = before; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  $("onlyLate").checked = !!st.onlyLate;
  if (!cur() && st.subs.length) st.sel = L.sortQueue(st.subs, today())[0].id;
  renderLib(); renderAll();
  AI.probe().then(() => { if (cur() && !workOf(st.sel).draft) runDraft(); else renderDraft(); });
})();
