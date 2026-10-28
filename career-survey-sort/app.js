/* 갈래 — 화면 (DOM 다루기만 한다. 가리기·분류·검사·통계는 logic.js, AI 호출은 ai-client.js)
 *
 * '다시 분류하기'를 누르면
 *   1) 고정 기준으로 규칙 분류한 결과를 바로 보여 주고
 *   2) Claude(survey.classify)에게 같은 기준과 (개인정보를 가린) 응답을 보내 다시 분류한다.
 *      기준 밖의 이름이나 없는 번호는 버리고, 쓸 만한 답이 절반 미만이면 통째로 버린다.
 * 사람이 오른쪽 칸에서 검수하면 일치율이 바로 다시 계산된다.
 */
(function () {
  "use strict";
  const L = window.Gallae;
  const STORE_KEY = "career-survey-sort-v1";
  const COLORS = { c1: "#2F6FEB", c2: "#7A4BD8", c3: "#0E8A7A", c4: "#D9731A", c5: "#C2457E", review: "#7C8190" };
  const TARGET = 91;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 상태 ---------- */
  function seed() { return { items: L.sampleItems(), filter: "all", next: L.SAMPLE.length + 1 }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.items) && v.items.every((i) => i && typeof i.id === "string" && typeof i.text === "string" && i.rule)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let ai = { mode: "rule", reason: "", ms: 0, valid: 0, dropped: 0 };
  let waiting = false;
  let token = 0;

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  const chip = (cat) => `<span class="cat" style="--c:${COLORS[cat]}">${esc(L.nameOf(cat))}</span>`;

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 현황 ---------- */
  function renderStats() {
    const a = L.agreement(st.items);
    const c = L.counts(st.items);
    const sens = st.items.filter((i) => i.sensitive).length;
    const pct = st.items.length ? Math.round(a.reviewed / st.items.length * 100) : 0;
    const good = a.rate !== null && a.rate >= TARGET;
    $("count").textContent = st.items.length;
    $("stats").innerHTML = `
      <div class="st big ${a.rate === null ? "" : good ? "good" : "low"}">
        <span>사람 검수 일치율</span>
        <b>${a.rate === null ? "—" : a.rate}<small>%</small></b>
        <em>${a.reviewed}건 검수 중 ${a.agree}건 일치 · 목표 ${TARGET}%</em>
      </div>
      <div class="st"><span>검수 진행</span><b>${a.reviewed}<small>/${st.items.length}</small></b><span class="prog" aria-hidden="true"><i style="width:${pct}%"></i></span></div>
      <div class="st"><span>검토 필요</span><b>${c.review}<small>건</small></b><em>${sens ? `민감한 응답 ${sens}건 포함` : "짧거나 기준 핵심어가 없는 응답"}</em></div>
      <div class="st"><span>개인정보 가림</span><b>${st.items.filter((i) => i.pii.length).length}<small>건</small></b><em>학번 · 전화번호 · 이메일</em></div>`;
  }

  /* ---------- 거르기 ---------- */
  const FILTERS = [["all", "전체"], ...L.CATS.map((c) => [c.id, c.name]), ["todo", "검수 전"], ["diff", "불일치"]];
  function pass(i) {
    const f = st.filter;
    if (f === "all") return true;
    if (f === "todo") return !i.human;
    if (f === "diff") return i.human && i.human !== L.autoCat(i);
    return L.autoCat(i) === f;
  }
  function renderFilters() {
    $("filters").innerHTML = FILTERS.map(([id, label]) => {
      const n = id === "all" ? st.items.length : st.items.filter((i) => { const o = st.filter; st.filter = id; const r = pass(i); st.filter = o; return r; }).length;
      return `<button type="button" data-filter="${id}" aria-pressed="${st.filter === id}">${esc(label)} <span>${n}</span></button>`;
    }).join("");
  }

  /* ---------- 목록 ---------- */
  function modeBadge() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 분류하는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 분류 · ${(ai.ms / 1000).toFixed(1)}초${ai.dropped ? ` · ${ai.dropped}건은 규칙` : ""}</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 기준 핵심어로 분류했어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function renderList() {
    $("mode").innerHTML = modeBadge();
    const rows = st.items.filter(pass);
    const opts = (cur) => `<option value="" ${!cur ? "selected" : ""}>검수 전</option>` + L.CATS.map((c) => `<option value="${c.id}" ${cur === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    $("list").className = `list${waiting ? " waiting" : ""}`;
    $("list").innerHTML = rows.map((i) => {
      const auto = L.autoCat(i);
      const src = i.sensitive ? "사람에게" : i.ai ? "Claude" : "규칙";
      const why = i.sensitive ? "민감한 내용 · 담당 교수가 직접 확인" : i.ai ? (i.ai.reason || "") : i.rule.reason;
      const mark = i.human ? (i.human === auto ? `<em class="ok" title="일치">✓</em>` : `<em class="no" title="불일치">✕</em>`) : `<em class="todo" title="검수 전">·</em>`;
      return `<li class="it${i.sensitive ? " sens" : ""}${i.human && i.human !== auto ? " diff" : ""}">
        <span class="it-id">${esc(i.id)}</span>
        <div class="it-body">
          <p class="it-t">${esc(i.text)}</p>
          <div class="it-meta">${chip(auto)}<span class="src" data-src="${src}">${src}</span><span class="why">${esc(why)}</span>
            ${i.pii.length ? `<span class="tag">개인정보 ${i.pii.length}종 가림</span>` : ""}${i.sensitive ? `<span class="tag warn">민감 · AI 제외</span>` : ""}</div>
        </div>
        <div class="it-rev">
          <label class="sr" for="fix-${esc(i.id)}">${esc(i.id)} 사람 검수</label>
          <select id="fix-${esc(i.id)}" data-fix="${esc(i.id)}">${opts(i.human)}</select>${mark}
        </div>
      </li>`;
    }).join("") || `<li class="none">이 조건에 맞는 응답이 없어요.</li>`;
  }

  /* ---------- 기준 · 분포 ---------- */
  function renderSide() {
    $("crit").innerHTML = L.CRITERIA.map((c) => `<li><div>${chip(c.id)} <span class="def">${esc(c.def)}</span></div><p class="ex">예) ${esc(c.ex[0])}</p></li>`).join("") +
      `<li><div>${chip("review")} <span class="def">어느 기준에도 맞지 않음 · 너무 짧음 · 민감한 내용</span></div></li>`;
    const c = L.counts(st.items);
    const max = Math.max(...Object.values(c), 1);
    $("dist").innerHTML = L.CATS.map((x) => `<button type="button" class="dr" data-filter="${x.id}" aria-label="${esc(x.name)} ${c[x.id]}건만 보기">
      <span class="dl">${esc(x.name)}</span><span class="db"><i style="width:${c[x.id] / max * 100}%;background:${COLORS[x.id]}"></i></span><b>${c[x.id]}</b></button>`).join("");
  }

  function render() { renderStats(); renderFilters(); renderList(); renderSide(); save(); }

  /* ---------- 분류 (규칙 → Claude) ---------- */
  async function classify(subset, label) {
    const my = ++token;
    if (AI.status().enabled === false) { ai = { mode: "rule", reason: AI.status().reason || "AI 꺼짐", ms: 0, valid: 0, dropped: 0 }; render(); return; }
    waiting = true; render();
    const r = await AI.ask("survey.classify", L.aiInput(subset));
    if (my !== token) return;
    waiting = false;
    const n = r && L.normalizeAi(r.data, subset);
    if (n) {
      st.items.forEach((i) => { if (n.byId[i.id]) i.ai = n.byId[i.id]; });
      ai = { mode: "ai", reason: "", ms: r.ms, valid: n.valid, dropped: subset.filter((i) => !i.sensitive).length - n.valid };
    } else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "AI 응답 없음"), ms: 0, valid: 0, dropped: 0 };
    render();
    if (label) toast(`${ai.mode === "ai" ? "Claude가" : "규칙으로"} ${label}`);
  }
  function rerun() {
    st.items.forEach((i) => { i.ai = null; if (!i.sensitive) i.rule = L.classifyRule(i.text); });
    ai = { mode: "rule", reason: "", ms: 0, valid: 0, dropped: 0 };
    render();
    classify(st.items, `${st.items.length}건을 분류했어요`);
  }

  /* ---------- 이벤트 ---------- */
  $("run").addEventListener("click", rerun);
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (!f) return;
    st.filter = st.filter === f.dataset.filter && f.classList.contains("dr") ? "all" : f.dataset.filter;
    render();
    const again = document.querySelector(`#filters [data-filter="${st.filter}"]`);
    if (again && f.closest("#filters")) again.focus();
  });
  $("list").addEventListener("change", (e) => {
    const s = e.target.closest("[data-fix]");
    if (!s) return;
    const it = st.items.find((i) => i.id === s.dataset.fix);
    const before = it.human;
    const rateBefore = L.agreement(st.items).rate;
    it.human = s.value;
    render();
    const a = L.agreement(st.items);
    toast(`${it.id} 검수 저장 · 일치율 ${rateBefore ?? "—"}% → ${a.rate ?? "—"}%`, () => { it.human = before; render(); });
    const again = $(`fix-${it.id}`);
    if (again) again.focus();
  });
  $("consist").addEventListener("click", () => {
    const c = L.consistency(st.items, 3, (Date.now() % 997) + 1);
    const out = $("consistOut");
    out.hidden = false;
    out.className = `consist ${c.same === c.runs ? "good" : "bad"}`;
    out.innerHTML = `<b>${c.items}건을 순서를 섞어 ${c.runs}번 다시 분류 → ${c.same}번 같은 결과</b> · 기준 ${L.CRITERIA_VERSION}과 동점 순서를 고정해 두어서 같은 글은 언제나 같은 갈래로 가요.`;
  });
  $("csv").addEventListener("click", () => {
    const blob = new Blob([L.toCsv(st.items)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "설문_서술형_검수시트.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${st.items.length}건을 검수 시트로 내보냈어요 (개인정보는 가린 채로)`);
  });
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("addText").value.trim();
    if (!raw) { $("addText").focus(); toast("응답을 먼저 넣어 주세요"); return; }
    const id = `R${String(st.next++).padStart(3, "0")}`;
    const it = L.makeItem(id, raw);
    $("addText").value = ""; // 원문(가리기 전)은 남기지 않는다
    st.items.unshift(it);
    st.filter = "all";
    render();
    const msg = `${id} 추가 · ${L.nameOf(L.autoCat(it))}${it.pii.length ? ` · ${it.pii.join("·")} 가림` : ""}${it.sensitive ? " · 민감한 내용이라 사람에게" : ""}`;
    toast(msg, () => { st.items = st.items.filter((x) => x.id !== id); render(); });
    if (!it.sensitive) classify([it]);
  });
  $("addText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("addForm").requestSubmit(); });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); ai = { mode: "rule", reason: "", ms: 0, valid: 0, dropped: 0 };
    $("consistOut").hidden = true;
    render();
    classify(st.items);
    toast("샘플 응답 42건으로 되돌렸어요", () => { st = before; render(); });
  });

  /* ---------- 시작 ---------- */
  render();
  AI.probe().then(() => classify(st.items));
})();
