/* 고객말 — 화면 (DOM 다루기만 한다. 분류 규칙·검사·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * '분류하기'를 누르면
 *   1) 규칙으로 모든 리뷰를 바로 분류해 보여 주고 (기다리지 않게)
 *   2) Claude(reviewsort.classify)에게 같은 리뷰(작성자 이름 없이, 연락처는 가려서)를 보낸다.
 *      돌아오면 리뷰마다 Claude 분류로 바꾸되, 규칙이 잡은 반어·어긋남·안전 신호는 그대로 '사람 확인'에 남긴다.
 * 사람 확인 칸의 리뷰는 사람이 긍정·중립·부정을 정해야 집계(개선 요청 상위 5)에 들어간다.
 */
(function () {
  "use strict";
  const L = window.Gogaekmal;
  const STORE_KEY = "ax-review-sort-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- 상태 ---------- */
  function seed() { return { reviews: L.sample(), decisions: {}, filter: "all", product: "", nextId: 1 }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.reviews) && v.decisions && typeof v.decisions === "object") return v;
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let results = {};           // id → 분류 (규칙 또는 Claude)
  let ai = { mode: "rule", reason: "" };
  let waiting = false;
  let runToken = 0;
  let fresh = new Set();

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  const items = () => L.finalize(st.reviews, results, st.decisions);
  const stars = (n) => `<span class="stars" aria-label="별점 ${n}점">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 위: 숫자 ---------- */
  function renderStats(all) {
    const s = L.stats(all);
    const tile = (f, label, v, cls, unit = "건") => `<button type="button" class="st ${cls || ""}" data-f="${f}" aria-pressed="${st.filter === f}"><span>${label}</span><b>${v}<small>${unit}</small></b></button>`;
    $("stats").innerHTML = [
      tile("all", "리뷰", s.total),
      tile("pos", "긍정", s.pos),
      tile("neg", "부정", s.neg),
      tile("request", "개선 요청", s.requests),
      tile("human", "사람 확인", s.human, "hum"),
      tile("safety", "안전 관련", s.safety, "safe"),
    ].join("");
  }

  /* ---------- 왼쪽: 리뷰 목록 ---------- */
  const FILTERS = {
    all: () => true,
    human: (x) => x.needsHuman,
    request: (x) => x.request && !x.needsHuman,
    neg: (x) => x.sentiment === "부정" && !x.needsHuman,
    pos: (x) => x.sentiment === "긍정" && !x.needsHuman,
    safety: (x) => x.safety,
  };
  const TIPS = {
    all: "", human: "AI도 규칙도 확신하지 못한 리뷰예요. 읽고 감정을 정하면 집계에 들어갑니다.",
    request: "상품팀에 넘길 개선 요청이에요. 사람 확인이 끝난 리뷰만 들어 있어요.",
    neg: "", pos: "", safety: "안전 관련 리뷰는 분류하지 않고 품질안전 담당자에게 넘깁니다.",
  };
  function modeBadge() {
    if (waiting) return `<span id="mode" class="mode" data-mode="wait"><i></i>Claude가 읽는 중</span>`;
    if (ai.mode === "ai") return `<span id="mode" class="mode" data-mode="ai">Claude로 분류 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span id="mode" class="mode" data-mode="rule" title="칭찬·불만 말과 별점으로 분류했어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function card(x) {
    const flags = x.flags.map((f) => `<span class="chip flag${f === "안전 관련" ? " safe" : ""}">${esc(f)}</span>`).join("");
    const chips = x.needsHuman && !x.decided
      ? `${flags}<span class="chip">${x.by === "ai" ? "Claude" : "규칙"} 제안: ${esc(x.sentiment)} · ${esc(x.category)}</span>`
      : `<span class="chip ${esc(x.sentiment)}">${esc(x.sentiment)}</span><span class="chip">${esc(x.category)}</span>${x.request ? `<span class="chip req">개선 요청</span>` : ""}${x.safety ? `<span class="chip flag safe">안전 관련</span>` : ""}`;
    let tail = "";
    if (x.needsHuman) {
      tail = x.safety
        ? `<div class="hc"><span>AI가 판단하지 않아요</span><button type="button" class="esc" data-act="escalate" data-id="${x.id}">품질안전 담당에게 넘기기</button></div>`
        : `<div class="hc"><span>사람 확인</span>${L.SENTIMENTS.map((s) => `<button type="button" data-act="decide" data-s="${s}" data-id="${x.id}">${s}</button>`).join("")}</div>`;
    } else if (x.decided) {
      const d = st.decisions[x.id];
      tail = `<div class="done-note">${d.escalated ? "품질안전 담당에게 넘김" : `사람이 ‘${esc(d.sentiment)}’으로 정함`} · <button type="button" data-act="undo" data-id="${x.id}">되돌리기</button></div>`;
    }
    const conf = x.decided ? "" : `<span class="chip by">${x.by === "ai" ? "Claude" : "규칙"} · 확신 ${Math.round(x.confidence * 100)}%</span>`;
    return `<article class="rv${x.needsHuman ? " human" : ""}${x.safety ? " safety" : ""}${fresh.has(x.id) ? " new" : ""}" aria-label="${esc(x.product)} 리뷰">
      <div class="rv-h">${stars(x.rating)}<b>${esc(x.product)}</b><span class="who">${esc(L.maskName(x.author) || "붙여 넣음")}${x.date ? ` · ${Number(x.date.slice(5, 7))}/${Number(x.date.slice(8))}` : ""}</span></div>
      <p>${esc(L.maskPII(x.text))}</p>
      <div class="chips">${chips}${conf}</div>${tail}</article>`;
  }
  function render() {
    const all = items();
    renderStats(all);
    const products = [...new Set(st.reviews.map((r) => r.product))];
    $("product").innerHTML = `<option value="">상품 전체</option>${products.map((p) => `<option${p === st.product ? " selected" : ""}>${esc(p)}</option>`).join("")}`;
    const s = L.stats(all);
    document.querySelectorAll("#seg button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.f === st.filter));
      b.innerHTML = b.dataset.f === "human" ? `사람 확인<span class="n">${s.human}</span>` : b.textContent;
    });
    const shown = all.filter(FILTERS[st.filter] || FILTERS.all).filter((x) => !st.product || x.product === st.product);
    // 사람 확인 · 안전 관련을 위로
    shown.sort((a, b) => (b.safety && b.needsHuman) - (a.safety && a.needsHuman) || b.needsHuman - a.needsHuman);
    $("listInfo").textContent = `${shown.length}건 보는 중`;
    $("tip").textContent = TIPS[st.filter] || `월 800건 중 샘플 ${st.reviews.length}건입니다. 애매한 리뷰는 위로 올라와요.`;
    $("mode").outerHTML = modeBadge();
    $("reviews").classList.toggle("waiting", waiting);
    $("reviews").innerHTML = shown.map(card).join("") || `<p class="empty">이 조건에 맞는 리뷰가 없어요.</p>`;
    renderTop(all);
    fresh = new Set();
  }

  /* ---------- 오른쪽: 상품팀 전달 ---------- */
  function renderTop(all) {
    const top = L.topRequests(all);
    const max = Math.max(1, ...top.map((t) => t.count));
    $("top").innerHTML = top.map((t) => `<li><span class="t-what">${esc(t.product)}<small>${esc(t.category)}</small></span><span class="t-n">${t.count}건</span>
      <span class="bar-n" aria-hidden="true"><i style="width:${Math.round((t.count / max) * 100)}%"></i></span>
      ${t.quotes[0] ? `<p class="t-q">“${esc(t.quotes[0])}”</p>` : ""}</li>`).join("") || `<li class="empty">아직 개선 요청이 없어요.</li>`;
    const s = L.stats(all);
    $("topNote").hidden = !s.human;
    $("topNote").textContent = `사람 확인 ${s.human}건은 아직 반영하지 않았어요.`;
  }
  $("copy").addEventListener("click", async () => {
    const all = items();
    const text = L.toHandoff(L.topRequests(all), L.stats(all), "10월");
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
    $("mdOut").textContent = text; $("mdBox").hidden = false; $("mdBox").open = !ok;
    toast(ok ? "상품팀에 보낼 글을 복사했어요 (작성자 이름 없음)" : "복사가 막혀 있어요. 아래 글을 직접 복사해 주세요");
  });

  /* ---------- 분류 ---------- */
  async function classify(onlyNew) {
    const my = ++runToken;
    const targets = onlyNew ? st.reviews.filter((r) => onlyNew.includes(r.id)) : st.reviews;
    targets.forEach((r) => { results[r.id] = L.classifyRule(r); });
    ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    render();
    const r = await AI.ask("reviewsort.classify", L.aiInput(targets));
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeAi(r.data, targets);
    if (n) {
      targets.forEach((x) => { if (n[x.id]) results[x.id] = L.mergeAi(results[x.id], n[x.id]); });
      ai = { mode: "ai", ms: r.ms };
    } else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    render();
    const s = L.stats(items());
    toast(`${ai.mode === "ai" ? "Claude가" : "규칙으로"} ${targets.length}건 분류 · 사람 확인 ${s.human}건`);
  }
  $("run").addEventListener("click", () => classify());

  /* ---------- 사람 확인 ---------- */
  $("reviews").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const before = st.decisions[id];
    if (b.dataset.act === "decide") st.decisions[id] = { sentiment: b.dataset.s };
    else if (b.dataset.act === "escalate") st.decisions[id] = { sentiment: "부정", escalated: true };
    else if (b.dataset.act === "undo") delete st.decisions[id];
    save(); render();
    const restore = () => { if (before) st.decisions[id] = before; else delete st.decisions[id]; save(); render(); };
    if (b.dataset.act === "decide") toast(`‘${b.dataset.s}’으로 정했어요`, restore);
    else if (b.dataset.act === "escalate") toast("품질안전 담당에게 넘겼어요 (데모: 기록만 남김)", restore);
  });

  /* ---------- 거르기 ---------- */
  function setFilter(f) { st.filter = f; save(); render(); }
  $("seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (b) setFilter(b.dataset.f); });
  $("stats").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (b) setFilter(b.dataset.f); });
  $("product").addEventListener("change", (e) => { st.product = e.target.value; save(); render(); });

  /* ---------- 리뷰 붙여넣기 ---------- */
  $("add").addEventListener("click", () => {
    const { reviews, errors } = L.parsePasted($("paste").value, L.PRODUCTS, st.nextId);
    $("pasteErr").hidden = !errors.length;
    $("pasteErr").textContent = errors.join("\n");
    if (!reviews.length) { if (!errors.length) toast("붙여 넣은 리뷰가 없어요"); return; }
    st.nextId += reviews.length;
    st.reviews = [...reviews.map((r) => ({ ...r, date: "2026-10-28" })), ...st.reviews];
    reviews.forEach((r) => fresh.add(r.id));
    st.filter = "all"; st.product = "";
    $("paste").value = "";
    save();
    classify(reviews.map((r) => r.id));
  });

  $("reset").addEventListener("click", () => {
    const before = clone(st), beforeRes = results;
    st = seed(); results = {}; save();
    classify();
    toast("샘플 리뷰로 되돌렸어요", () => { runToken++; waiting = false; st = before; results = beforeRes; save(); render(); });
  });

  /* ---------- 시작 ---------- */
  st.reviews.forEach((r) => { results[r.id] = L.classifyRule(r); });
  render();
  AI.probe().then(() => classify());
})();
