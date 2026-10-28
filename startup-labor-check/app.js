/* 열두칸 — 화면 (DOM 다루기만 한다. 추천·검사·상담 목록·가격 계산은 logic.js, AI 호출은 ai-client.js)
 *
 * 왼쪽에서 후보 40개 중 진단 항목을 고르면 오른쪽 검사 요약·사장님 미리보기·기획안이 함께 바뀐다.
 * '핵심 12개 추천'은 규칙(점수)으로 바로 고르고, AI가 연결돼 있으면 Claude가 질문을 사장님 말로 다듬는다.
 * Claude 응답이 형식에 맞지 않거나 판단 표현이 섞이면 버리고 미리 써 둔 쉬운 말을 쓴다.
 */
(function () {
  "use strict";
  const L = window.Yeoldukan;
  const STORE_KEY = "startup-labor-check-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const byId = Object.fromEntries(L.ITEMS.map((it) => [it.id, it]));

  function seed() {
    const sel = L.recommend(L.ITEMS);
    // 사장님 한 분이 미리보기로 답해 본 상태 (가상의 답)
    const answers = { [sel[0]]: "yes", [sel[1]]: "no", [sel[2]]: "unk", [sel[3]]: "yes", [sel[4]]: "yes" };
    return { sel, cat: "all", answers, tier: "t2", plain: {}, ai: { mode: "rule", reason: "" } };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.sel) && v.sel.every((id) => byId[id]) && v.answers && v.plain) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false, runToken = 0;
  const plainOf = (id) => st.plain[id] || byId[id].plain;

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 후보 항목 ---------- */
  function renderPool() {
    $("poolN").textContent = `${st.sel.length}/${L.ITEMS.length}`;
    $("cats").innerHTML = [["all", "전체"]].concat(L.CATS.map((c) => [c, c])).map(([k, label]) => {
      const n = k === "all" ? st.sel.length : st.sel.filter((id) => byId[id].cat === k).length;
      return `<button type="button" data-cat="${esc(k)}" aria-pressed="${st.cat === k}">${esc(label)}<b>${n}</b></button>`;
    }).join("");
    const list = st.cat === "all" ? L.ITEMS : L.ITEMS.filter((it) => it.cat === st.cat);
    $("items").innerHTML = list.map((it) => {
      const on = st.sel.includes(it.id);
      return `<label class="it${on ? " on" : ""}"><input type="checkbox" data-id="${it.id}" ${on ? "checked" : ""}>
        <span><span class="pro">${esc(it.pro)}</span><span class="pl">${esc(it.plain)}</span></span>
        <span class="meta"><span class="chip sc" title="우선순위 점수">${L.score(it)}점</span><span class="chip">언급 ${it.mentions}/${L.INTERVIEWS}</span>${it.easy ? "" : `<span class="chip hard">서류 확인</span>`}</span></label>`;
    }).join("");
  }
  $("cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (!b) return; st.cat = b.dataset.cat; save(); renderPool(); });
  $("items").addEventListener("change", (e) => {
    const id = e.target.dataset.id; if (!id) return;
    st.sel = e.target.checked ? L.ITEMS.filter((it) => it.id === id || st.sel.includes(it.id)).map((it) => it.id) : st.sel.filter((x) => x !== id);
    save(); renderAll();
    if (e.target.checked && st.sel.length === L.LIMIT + 1) toast(`${L.LIMIT}개를 넘었어요. 하나를 빼야 끝까지 답할 수 있어요`);
  });
  $("auto").addEventListener("click", () => {
    const before = st.sel.slice();
    st.sel = L.recommend(L.ITEMS);
    save(); renderAll();
    toast(`점수 순으로 핵심 ${st.sel.length}개를 골랐어요`, () => { st.sel = before; save(); renderAll(); });
    if (AI.status().enabled === true) plainAi();
  });
  $("all").addEventListener("click", () => {
    const before = st.sel.slice();
    st.sel = L.ITEMS.map((it) => it.id);
    save(); renderAll();
    toast("처음 만든 40개 버전이에요. 인터뷰에서 아무도 끝내지 못했어요", () => { st.sel = before; save(); renderAll(); });
  });

  /* ---------- 검사 요약 ---------- */
  function renderSummary() {
    const c = L.checkSet(st.sel, L.ITEMS);
    const box = $("summary");
    box.classList.toggle("bad", !c.ok);
    const dots = Array.from({ length: L.INTERVIEWS }, (_, i) => `<i class="${i < c.done ? "y" : ""}"></i>`).join("");
    box.innerHTML = `<h2>진단표 검사</h2>
      <div class="stats">
        <div class="stat${c.count > L.LIMIT ? " err" : ""}"><b>${c.count}개</b><span>항목 (기준 ${L.LIMIT}개)</span></div>
        <div class="stat${c.minutes > 15 ? " err" : ""}"><b>${c.minutes}분</b><span>예상 소요</span></div>
        <div class="stat"><b>${c.cats}/${L.CATS.length}</b><span>다루는 영역</span></div>
        <div class="stat${c.done < 5 ? " err" : ""}"><b>${c.done}/${L.INTERVIEWS}명</b><span>끝까지 답함(추정)</span><span class="dots" aria-hidden="true">${dots}</span></div>
      </div>
      <ul class="iss">${c.issues.map((x) => `<li class="${x.level}">${esc(x.msg)}</li>`).join("")}${c.ok ? `<li class="pass">사장님이 10~15분 안에 끝낼 수 있는 묶음이에요</li>` : ""}</ul>`;
  }

  /* ---------- 미리보기 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait">Claude가 다듬는 중</span>`;
    if (st.ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 다듬음 · ${(st.ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 미리 써 둔 쉬운 말을 보여요">규칙 기반${st.ai.reason ? ` · ${esc(st.ai.reason)}` : " · 미리 써 둔 쉬운 말"}</span>`;
  }
  function renderPreview() {
    $("modeChip").innerHTML = modeChip();
    const sel = st.sel.slice(0, 40);
    $("pv").innerHTML = sel.length ? sel.map((id) => {
      const a = st.answers[id];
      const btn = (v, t) => `<button type="button" data-id="${id}" data-v="${v}" aria-pressed="${a === v}">${t}</button>`;
      return `<li><span>${esc(plainOf(id))}</span><span class="yn" role="group" aria-label="${esc(byId[id].pro)} 답">${btn("yes", "예")}${btn("no", "아니오")}${btn("unk", "모름")}</span></li>`;
    }).join("") : `<li><span class="empty">왼쪽에서 진단 항목을 골라 주세요.</span></li>`;
    const r = L.toConsult(st.sel, st.answers, L.ITEMS);
    $("consult").innerHTML = `<b>노무사 상담에서 확인할 항목 ${r.list.length}개</b> · ${r.answered}/${r.total}개 답함
      ${r.list.length ? `<ul>${r.list.map((x) => `<li>[${esc(x.cat)}] ${esc(x.pro)} <small>(${x.a === "no" ? "아니오" : "모름"})</small></li>`).join("")}</ul>` : ""}
      <div>이 진단은 위반 여부를 판정하지 않아요. ‘아니오’와 ‘모름’은 상담에서 사실관계를 보고 함께 확인합니다.</div>`;
  }
  $("pv").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    if (st.answers[b.dataset.id] === b.dataset.v) delete st.answers[b.dataset.id]; else st.answers[b.dataset.id] = b.dataset.v;
    save(); renderPreview();
  });
  $("clearAns").addEventListener("click", () => {
    const before = { ...st.answers };
    st.answers = {}; save(); renderPreview();
    toast("답을 지웠어요", () => { st.answers = before; save(); renderPreview(); });
  });
  $("print").addEventListener("click", () => window.print());

  async function plainAi() {
    const ids = st.sel.slice(0, L.LIMIT * 2), my = ++runToken;
    waiting = AI.status().enabled !== false;
    renderPreview();
    const r = await AI.ask("laborcheck.plain", { items: ids.map((id) => ({ id, question: byId[id].pro, draft: byId[id].plain })) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizePlain(r.data, ids);
    if (n) { st.plain = { ...st.plain, ...n.plain }; st.ai = { mode: "ai", ms: r.ms }; toast(`Claude가 ${Object.keys(n.plain).length}개를 다듬었어요${n.rejected ? ` · ${n.rejected}개는 형식·판단 표현 때문에 버림` : ""}`); }
    else { st.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "AI 꺼짐") }; toast("Claude를 쓸 수 없어 미리 써 둔 쉬운 말을 그대로 써요"); }
    save(); renderPreview(); renderPool();
  }
  $("plainAi").addEventListener("click", plainAi);

  /* ---------- 가격 실험 ---------- */
  function renderTiers() {
    $("tiers").innerHTML = L.TIERS.map((t) => {
      const rv = L.revenue(t);
      const bars = Array.from({ length: L.INTERVIEWS }, (_, i) => `<i class="${i < t.signed ? "s" : i < t.want ? "w" : ""}"></i>`).join("");
      return `<label class="tier${st.tier === t.id ? " on" : ""}"><input type="radio" name="tier" value="${t.id}" ${st.tier === t.id ? "checked" : ""}>
        <span><b>${esc(t.name)} · 월 ${L.won(t.price)}</b><small>${esc(t.desc)}</small></span>
        <span class="r"><strong>${t.signed ? `계약 ${t.signed}곳` : `관심 ${t.want}명`}</strong>쓰겠다 ${t.want}/${L.INTERVIEWS}명<span class="bars" aria-hidden="true">${bars}</span>월 ${L.won(rv.sum)}${rv.assumed ? " (가정)" : ""}</span></label>`;
    }).join("");
  }
  $("tiers").addEventListener("change", (e) => { if (e.target.name !== "tier") return; st.tier = e.target.value; save(); renderTiers(); });
  $("copyPlan").addEventListener("click", async () => {
    const c = L.checkSet(st.sel, L.ITEMS);
    if (!c.ok) { toast("진단표 검사에서 막힌 곳을 먼저 고쳐 주세요"); return; }
    const md = L.planMd(st.sel, L.ITEMS, L.TIERS.find((t) => t.id === st.tier), st.plain);
    $("mdOut").textContent = md; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(md); toast("상품 기획안을 복사했어요"); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); runToken++; waiting = false;
    save(); renderAll();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  function renderAll() { renderPool(); renderSummary(); renderPreview(); renderTiers(); }
  renderAll();
  AI.probe().then((s) => { if (s.enabled && st.ai.mode !== "ai") plainAi(); });
})();
