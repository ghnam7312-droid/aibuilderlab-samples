/* 응답대로 — 화면 (DOM 다루기만 한다. 통계·근거 검사·평가표는 logic.js, AI 호출은 ai-client.js)
 *
 * 왼쪽 설문 응답이 유일한 근거다. '기획서 다시 쓰기'를 누르면 규칙 기획(상황별 묶기)을 바로 보여 주고,
 * Claude 초안이 오면 근거 검사를 통과한 페르소나·메시지만 남겨 바꾼다. 페르소나 숫자는 늘 응답에서 다시 계산한다.
 * 효능·건강 표현이 든 메시지는 사람이 확인했다고 표시하기 전에는 채택할 수 없다.
 */
(function () {
  "use strict";
  const L = window.Eungdapdaero;
  const STORE_KEY = "career-campaign-plan-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WHEN_COLOR = { "수업·업무 사이": "#6A4BD8", "운동 후": "#0F8A6C", "식사·모임": "#C4562A" };
  const SCORE_KEYS = [["evidence", "근거"], ["target", "타깃"], ["length", "길이"], ["honest", "과장 없음"]];

  /* ---------- 상태 ---------- */
  function seed() {
    const responses = L.sampleResponses();
    return { responses, plan: { ...L.rulePlan(responses), mode: "rule", reason: "" }, chosen: 0, reviewed: {}, filter: "all", hi: null, audit: "plan" };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.responses) && v.plan && Array.isArray(v.plan.personas) && Array.isArray(v.plan.messages)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let planToken = 0;

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

  /* ---------- 요약 ---------- */
  function auditRows() { return L.auditDraft(st.audit === "draft" ? L.firstDraft() : st.plan, st.responses); }
  function renderKpis() {
    const rows = L.auditDraft(st.plan, st.responses);
    const pass = rows.filter((r) => r.ok).length;
    $("kpis").innerHTML = `
      <div class="kpi"><span>실제 설문 응답</span><b>${st.responses.length}명</b><em>응답 번호로만 근거 표기</em></div>
      <div class="kpi"><span>페르소나 · 메시지</span><b>${st.plan.personas.length}개 · ${st.plan.messages.length}안</b><em>${st.plan.mode === "ai" ? "Claude 초안 · 검사 통과분" : "상황별 규칙 묶기"}</em></div>
      <div class="kpi hi"><span>근거 검사 통과</span><b>${pass}/${rows.length}</b><em>${pass === rows.length ? "모든 주장에 응답 근거가 있어요" : "걸린 항목을 확인하세요"}</em></div>
      <div class="kpi goal"><span>1기 목표치</span><b>3 · 4안 · 52명</b><em>페르소나 · 메시지 · 실제 설문</em></div>`;
  }

  /* ---------- 왼쪽: 응답 ---------- */
  function renderResp() {
    const hi = st.hi ? new Set(st.hi.refs) : null;
    $("respCount").textContent = `${st.responses.length}건`;
    $("respFilter").innerHTML = `<button type="button" data-f="all" aria-pressed="${st.filter === "all"}">전체</button>` +
      L.WHEN.map((w) => `<button type="button" data-f="${w}" aria-pressed="${st.filter === w}"><i class="dot" style="background:${WHEN_COLOR[w]}"></i>${w}</button>`).join("") +
      (hi ? `<button type="button" data-f="hi" aria-pressed="${st.filter === "hi"}" class="hi-chip">${esc(st.hi.label)} 근거 ${hi.size}건 ✕</button>` : "");
    let list = st.responses;
    if (st.filter === "hi" && hi) list = list.filter((r) => hi.has(r.id));
    else if (st.filter !== "all") list = list.filter((r) => r.when === st.filter);
    $("resp").innerHTML = list.map((r) => `<li id="r-${r.id}" class="${hi && hi.has(r.id) ? "on" : ""}">
      <span class="rid" style="--c:${WHEN_COLOR[r.when] || "#888"}">${r.id}</span>
      <div class="rb"><div class="rmeta">${esc(r.when)} · ${r.price.toLocaleString()}원 · ${esc(r.channel)}</div>
        <div class="tags">${r.criteria.map((c) => `<span>${esc(c)}</span>`).join("")}</div>${r.quote ? `<q>${esc(r.quote)}</q>` : ""}</div>
      <button type="button" class="del" data-del="${r.id}" aria-label="${r.id} 응답 지우기">✕</button></li>`).join("") || `<li class="none">이 조건의 응답이 없어요.</li>`;
  }
  $("respFilter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    if (b.dataset.f === "hi" && st.filter === "hi") { st.hi = null; st.filter = "all"; } else st.filter = b.dataset.f;
    save(); renderResp();
  });
  $("resp").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-del]"); if (!b) return;
    const idx = st.responses.findIndex((r) => r.id === b.dataset.del);
    const [gone] = st.responses.splice(idx, 1);
    changed(`${gone.id} 응답을 지웠어요`, () => { st.responses.splice(idx, 0, gone); changed(`${gone.id} 응답을 되살렸어요`); });
  });
  function showRefs(label, refs) {
    st.hi = { label, refs }; st.filter = "hi"; save(); renderResp();
    const first = $(`r-${refs[0]}`);
    if (first) first.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // 응답 추가 폼
  $("fWhen").innerHTML = L.WHEN.map((w) => `<option>${w}</option>`).join("");
  $("fCh").innerHTML = L.CHANNELS.map((c) => `<option>${c}</option>`).join("");
  $("fCrit").innerHTML = L.CRITERIA.map((c, i) => `<label><input type="checkbox" name="crit" value="${c}" ${i === 0 ? "checked" : ""}>${c}</label>`).join("");
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const x = { id: L.nextId(st.responses), age: 0, status: "", when: f.when.value, criteria: [...f.querySelectorAll("input[name=crit]:checked")].map((i) => i.value), price: Number(f.price.value), channel: f.channel.value, quote: f.quote.value.trim().slice(0, 60) };
    const errs = L.validateResponse(x);
    $("addErr").hidden = !errs.length; $("addErr").textContent = errs.join(" · ");
    if (errs.length) return;
    st.responses.push(x); f.quote.value = "";
    changed(`${x.id} 응답을 추가했어요 · 이제 ${st.responses.length}명`, () => { st.responses = st.responses.filter((r) => r.id !== x.id); changed("추가한 응답을 뺐어요"); });
  });
  /** 응답이 바뀌면 숫자가 바뀌므로 기획서를 다시 쓴다 */
  function changed(msg, undo) { st.hi = null; if (st.filter === "hi") st.filter = "all"; save(); rewrite(); toast(msg, undo); }

  /* ---------- 오른쪽: 기획서 ---------- */
  function modeChip(p) {
    if (p.mode === "wait") return `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    if (p.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(p.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule">규칙 기반${p.reason ? ` · ${esc(p.reason)}` : ""}</span>`;
  }
  function renderDoc() {
    $("docTitle").textContent = `${L.PRODUCT.name} 20대 캠페인 기획서`;
    $("docMeta").textContent = `${L.PRODUCT.line} · 근거: 실제 설문 ${st.responses.length}명`;
    $("planMode").innerHTML = modeChip(st.plan);
    $("doc").classList.toggle("waiting", st.plan.mode === "wait");
    $("personas").innerHTML = st.plan.personas.map((p, i) => {
      const s = L.statsOf(p.refs, st.responses);
      const color = WHEN_COLOR[p.when] || "#6A4BD8";
      const quotes = s.list.filter((r) => r.quote).slice(0, 2);
      return `<div class="persona" style="--c:${color}">
        <div class="p-h"><b>${esc(p.name)}</b><span class="share">${s.n}명 · ${s.share}%</span></div>
        <p class="p-sum">${esc(p.summary)}</p>
        <ul class="cbars">${s.criteria.slice(0, 3).map(([c, n]) => `<li><span>${esc(c)}</span><i style="width:${Math.round((n / s.n) * 100)}%"></i><em>${n}명</em></li>`).join("")}</ul>
        <p class="p-fact">살 만한 가격 중간값 <b>${s.price.toLocaleString()}원</b> · 주로 <b>${esc(s.channel)}</b></p>
        ${quotes.map((q) => `<p class="quote">“${esc(q.quote)}” <button type="button" class="rref" data-r="${q.id}">${q.id}</button></p>`).join("")}
        <button type="button" class="link-btn sm" data-show="p${i}">근거 응답 ${s.n}건 보기</button></div>`;
    }).join("") || `<p class="none">근거 응답이 3건 이상인 상황이 없어요.</p>`;
    renderMsgs();
    renderAudit();
  }
  function renderMsgs() {
    const ps = st.plan.personas;
    const flagged = [];
    $("msgs").innerHTML = `<thead><tr><th class="c-pick"><span class="sr">채택</span></th><th>문구</th><th>대상</th>${SCORE_KEYS.map(([, l]) => `<th class="c-s">${l}</th>`).join("")}<th class="c-s">합계</th></tr></thead><tbody>` +
      st.plan.messages.map((m, i) => {
        const sc = L.score(m, ps);
        const blocked = sc.health && !st.reviewed[i];
        if (sc.health) flagged.push({ i, word: sc.health });
        return `<tr class="${st.chosen === i ? "chosen" : ""}${sc.health ? " flag" : ""}">
          <td class="c-pick"><input type="radio" name="pick" value="${i}" aria-label="${i + 1}안 채택" ${st.chosen === i ? "checked" : ""} ${blocked ? "disabled" : ""}></td>
          <td><label class="sr" for="mc${i}">${i + 1}안 문구</label><input class="copy" id="mc${i}" data-i="${i}" value="${esc(m.copy)}" maxlength="40">
            <button type="button" class="link-btn sm" data-show="m${i}">근거 ${m.refs.length}명</button>${sc.health ? `<span class="hflag">효능 표현 ‘${esc(sc.health)}’ · 사람 확인 ${st.reviewed[i] ? "완료" : "필요"}</span>` : ""}</td>
          <td class="who">${esc(m.persona)}</td>
          ${SCORE_KEYS.map(([k]) => `<td class="c-s"><span class="sc s${sc[k]}">${sc[k]}</span></td>`).join("")}
          <td class="c-s"><b>${sc.total}</b></td></tr>`;
      }).join("") + "</tbody>";
    $("hand").hidden = !flagged.length;
    $("hand").innerHTML = flagged.map((f) => `<label><input type="checkbox" data-rev="${f.i}" ${st.reviewed[f.i] ? "checked" : ""}> ${f.i + 1}안의 ‘${esc(f.word)}’ 표현을 담당 교수·법무와 확인했어요</label>`).join("") +
      `<span>음료의 효능·건강 표현은 광고 규정에 걸릴 수 있어 이 도구가 판단하지 않아요. 확인 전에는 채택할 수 없어요.</span>`;
  }
  function renderAudit() {
    document.querySelectorAll("[data-audit]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.audit === st.audit)));
    const rows = auditRows();
    $("audit").innerHTML = rows.map((r) => `<li class="${r.ok ? "ok" : "bad"}"><span class="ic" aria-hidden="true">${r.ok ? "✓" : "!"}</span>
      <div><span class="kd">${r.kind}</span> ${esc(r.text)}<div class="why">${r.ok ? `근거 응답 ${r.refs.length}건` : esc(r.issues.join(" · "))}</div></div></li>`).join("") +
      (st.audit === "draft" ? `<li class="note">처음 과제 초안은 AI가 만든 ‘설문 결과’를 사실처럼 썼어요. 실제 응답 ${st.responses.length}건만 근거로 다시 쓰면서 이 검사를 만들었어요.</li>` :
        st.plan.dropped && st.plan.dropped.length ? `<li class="note">Claude 초안에서 ${st.plan.dropped.length}개 항목을 근거 부족으로 뺐어요: ${st.plan.dropped.map((d) => esc(d.text)).join(", ")}</li>` : "");
  }
  $("doc").addEventListener("click", (e) => {
    const s = e.target.closest("[data-show]");
    if (s) {
      const k = s.dataset.show, i = +k.slice(1);
      const item = k[0] === "p" ? st.plan.personas[i] : st.plan.messages[i];
      if (item) showRefs(k[0] === "p" ? item.name : `${i + 1}안`, item.refs);
      return;
    }
    const r = e.target.closest("button.rref");
    if (r) { st.filter = "all"; renderResp(); const li = $(`r-${r.dataset.r}`); if (li) { li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash"); li.scrollIntoView({ behavior: "smooth", block: "nearest" }); } return; }
    const a = e.target.closest("[data-audit]");
    if (a) { st.audit = a.dataset.audit; save(); renderAudit(); }
  });
  $("doc").addEventListener("change", (e) => {
    if (e.target.name === "pick") { st.chosen = +e.target.value; save(); renderMsgs(); toast(`${st.chosen + 1}안을 채택했어요`); return; }
    if (e.target.dataset.rev !== undefined) {
      const i = +e.target.dataset.rev;
      st.reviewed[i] = e.target.checked;
      if (!e.target.checked && st.chosen === i) st.chosen = -1;
      save(); renderMsgs();
      return;
    }
    const inp = e.target.closest("input.copy");
    if (inp) {
      const i = +inp.dataset.i, before = st.plan.messages[i].copy;
      const v = inp.value.trim();
      if (!v) { inp.value = before; return; }
      st.plan.messages[i].copy = v; delete st.reviewed[i];
      if (L.healthClaim(v) && st.chosen === i) st.chosen = -1;
      save(); renderMsgs(); renderAudit(); renderKpis();
      toast(`${i + 1}안 문구를 고쳤어요 · 평가표를 다시 매겼어요`, () => { st.plan.messages[i].copy = before; save(); renderMsgs(); renderAudit(); renderKpis(); });
    }
  });

  /* ---------- 기획서 쓰기: 규칙 즉시 → Claude ---------- */
  async function rewrite() {
    const my = ++planToken;
    const rule = L.rulePlan(st.responses);
    st.plan = { ...rule, mode: AI.status().enabled === false ? "rule" : "wait", reason: "" };
    st.reviewed = {};
    if (st.chosen >= st.plan.messages.length) st.chosen = 0;
    renderAll();
    const r = await AI.ask("campaign.plan", {
      product: L.PRODUCT, total: st.responses.length, criteria: L.CRITERIA,
      responses: st.responses.map((x) => ({ id: x.id, when: x.when, criteria: x.criteria, price: x.price, channel: x.channel, quote: x.quote })),
    });
    if (my !== planToken) return; // 그 사이 응답이 바뀌었으면 버린다
    const n = r && L.normalizePlan(r.data, st.responses);
    if (n) st.plan = { ...n, mode: "ai", ms: r.ms };
    else st.plan.mode = "rule", st.plan.reason = r ? "근거 검사를 통과하지 못한 응답" : (AI.status().reason || "");
    if (st.chosen >= st.plan.messages.length) st.chosen = 0;
    save(); renderAll();
  }
  $("rewrite").addEventListener("click", rewrite);
  $("copyMd").addEventListener("click", async () => {
    const out = L.toMarkdown(st.plan, st.responses, st.chosen);
    $("mdOut").textContent = out; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(out); toast("기획서를 마크다운으로 복사했어요"); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("print").addEventListener("click", () => window.print());
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); rewrite();
    toast("샘플 응답 52건으로 되돌렸어요", () => { planToken++; st = before; save(); renderAll(); });
  });

  function renderAll() { renderKpis(); renderResp(); renderDoc(); }
  renderAll();
  AI.probe().then(() => rewrite());
})();
