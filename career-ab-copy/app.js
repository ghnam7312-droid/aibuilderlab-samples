/* 두문장 — 화면 (DOM 다루기만 한다. 집계·판정·문구 검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 대결을 고르면 A·B의 노출·클릭·클릭률과 판정을 보여 준다. 집계는 늘 중복(새로고침)을 뺀 값.
 * '방문자가 되어 눌러 보기'로 기록을 직접 넣어 보고, 새로고침해도 숫자가 늘지 않는 것을 확인한다.
 * '후보 3개 만들기'는 규칙 후보를 먼저 보여 주고, Claude 결과가 오면 검사해서 바꾼다.
 */
(function () {
  "use strict";
  const L = window.DuMunjang;
  const STORE_KEY = "career-ab-copy-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KIND = { need: "진행 중", win: "끝남", tie: "끝남" };

  /* ---------- 상태 ---------- */
  function seed() { return { tests: L.sampleTests(), sel: "t6", filter: "all", dedupe: true, sim: null, sug: null, seq: 7 }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.tests) && v.tests.length && v.tests.every((t) => t.id && typeof t.a === "string" && Array.isArray(t.live))) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let sugToken = 0;

  // 샘플 이벤트는 저장하지 않고 seed로 다시 만든다 (같은 seed → 같은 기록)
  const genCache = new Map();
  function eventsOf(t) {
    if (!genCache.has(t.id)) genCache.set(t.id, L.genEvents(t.id, t.gen));
    return genCache.get(t.id).concat(t.live);
  }
  function rowOf(t, dedupe = true) { const tally = L.tally(eventsOf(t), dedupe); return { test: t, tally, verdict: L.verdict(tally) }; }
  const cur = () => st.tests.find((t) => t.id === st.sel) || st.tests[0];

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
  function renderKpis() {
    const s = L.summary(st.tests.map((t) => rowOf(t)));
    const lift = s.before ? Math.round((s.after / s.before - 1) * 100) : 0;
    $("kpis").innerHTML = `
      <div class="kpi"><span>대결</span><b>${st.tests.length}쌍</b><em>끝남 ${s.done} · 진행 중 ${s.running}</em></div>
      <div class="kpi"><span>처음 문구 클릭률</span><b>${s.done ? L.pct(s.before) : "—"}</b><em>끝난 대결의 A 평균</em></div>
      <div class="kpi hi"><span>남긴 문구 클릭률</span><b>${s.done ? L.pct(s.after) : "—"}</b><em>${s.done ? `${lift >= 0 ? "+" : ""}${lift}% · B가 이긴 대결 ${s.wins}개` : "끝난 대결이 없어요"}</em></div>
      <div class="kpi goal"><span>1기 목표치</span><b>1.8% → 3.1%</b><em>문구 작성 2시간 → 20분</em></div>`;
  }

  /* ---------- 대결 목록 ---------- */
  function renderList() {
    document.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === st.filter)));
    const rows = st.tests.map((t) => rowOf(t)).filter((r) => st.filter === "all" || (st.filter === "run") === (r.verdict.kind === "need"));
    $("tests").innerHTML = rows.map((r) => {
      const v = r.verdict;
      const tag = v.kind === "need" ? `<span class="tag run">진행 중</span>` : v.kind === "tie" ? `<span class="tag">차이 없음 · A 유지</span>` : `<span class="tag win">${v.winner} 승리</span>`;
      const kc = v.keep ? L.pct(L.ctr(r.tally[v.keep].clicks, r.tally[v.keep].views)) : "";
      return `<li><button type="button" class="t-item" data-id="${esc(r.test.id)}" aria-current="${r.test.id === st.sel}">
        <span class="t-name">${esc(r.test.name)}</span>${tag}
        <span class="t-sub">노출 ${(r.tally.A.views + r.tally.B.views).toLocaleString()}${kc ? ` · 남긴 문구 ${kc}` : ""}</span></button></li>`;
    }).join("") || `<li class="none">이 조건의 대결이 없어요.</li>`;
  }

  /* ---------- 선택한 대결 ---------- */
  function variantCard(r, v) {
    const t = r.test, x = r.tally[v], keep = r.verdict.keep === v;
    const c = L.ctr(x.clicks, x.views);
    const max = Math.max(L.ctr(r.tally.A.clicks, r.tally.A.views), L.ctr(r.tally.B.clicks, r.tally.B.views), 0.0001);
    const text = v === "A" ? t.a : t.b;
    const editable = !t.gen && !t.live.length;
    return `<div class="var v${v}${keep ? " keep" : ""}">
      <div class="var-h"><span class="vl">${v}</span>${v === "B" && t.bByAi ? `<span class="ai-badge" title="AI 도움으로 쓴 문구">AI 초안</span>` : ""}${keep ? `<span class="keep-b">${r.verdict.kind === "tie" ? "유지" : "남김"}</span>` : ""}</div>
      ${editable ? `<label class="sr" for="tx${v}">문구 ${v}</label><textarea id="tx${v}" data-v="${v}" rows="2">${esc(text)}</textarea>` : `<p class="copy">${esc(text)}</p>`}
      <div class="nums"><div><span>노출</span><b>${x.views.toLocaleString()}</b></div><div><span>클릭</span><b>${x.clicks}</b></div><div class="big"><span>클릭률</span><b>${L.pct(c, 2)}</b></div></div>
      <div class="meter" aria-hidden="true"><i style="width:${Math.round((c / max) * 100)}%"></i></div>
    </div>`;
  }
  function verdictBox(r) {
    const v = r.verdict;
    const p = `p = ${v.p < 0.001 ? "0.001 미만" : v.p.toFixed(3)}`;
    if (v.kind === "need") return `<div class="verdict need"><b>아직 판단하지 않아요</b>문구마다 노출 ${L.MIN_VIEWS}회가 될 때까지 노출 ${v.need.toLocaleString()}회가 더 필요해요. 지금 차이는 우연일 수 있어요 (${p}).</div>`;
    if (v.kind === "tie") return `<div class="verdict tie"><b>차이 없음 → 원래 문구 A 유지</b>클릭률 차이가 우연 범위 안이에요 (${p}). 새 문구는 남기지 않아요.</div>`;
    const lift = v.winner === "B" ? v.lift : (1 / (1 + v.lift) - 1);
    return `<div class="verdict win"><b>${v.winner} 승리 · 클릭률 ${lift >= 0 ? "+" : ""}${Math.round(lift * 100)}%</b>유의수준 5%에서 의미 있는 차이예요 (${p}). ${v.winner} 문구만 남기고 다음 대결의 기준으로 써요.</div>`;
  }
  /** 날짜별 클릭률: 하루하루 들쭉날쭉해도 합계로 판정한다는 것을 보여 준다 */
  function dailyChart(t) {
    const days = L.daily(eventsOf(t), st.dedupe);
    if (!days.length) return "";
    const max = Math.max(...days.flatMap((d) => [L.ctr(d.A.clicks, d.A.views), L.ctr(d.B.clicks, d.B.views)]), 0.0001);
    const bar = (d, v) => { const c = L.ctr(d[v].clicks, d[v].views); return `<i class="b${v}" style="height:${Math.max(2, Math.round((c / max) * 100))}%" title="${d.day} ${v} ${L.pct(c)} (노출 ${d[v].views})"></i>`; };
    return `<div class="daily"><div class="daily-h"><b>날짜별 클릭률</b><span><i class="bA"></i>A <i class="bB"></i>B · 하루 숫자는 들쭉날쭉해서 판정은 합계로만 해요</span></div>
      <div class="cols" role="img" aria-label="날짜별 A·B 클릭률 막대">${days.map((d) => `<div class="dc"><div class="bars">${bar(d, "A")}${bar(d, "B")}</div><span>${d.day}</span></div>`).join("")}</div></div>`;
  }
  function renderDetail() {
    const t = cur();
    if (!t) { $("detail").innerHTML = `<div class="empty-out"><b>대결이 없어요</b>'샘플로 되돌리기'를 눌러 보세요.</div>`; return; }
    const r = rowOf(t, st.dedupe);
    const on = rowOf(t, true), off = rowOf(t, false);
    const dropped = on.tally.dup + on.tally.orphan;
    const rawB = L.pct(L.ctr(off.tally.B.clicks, off.tally.B.views)), fixB = L.pct(L.ctr(on.tally.B.clicks, on.tally.B.views));
    $("detail").innerHTML = `
      <div class="pane-h"><div><h2 class="t">${esc(t.name)}</h2><p class="meta">목표 행동: ${esc(t.goal || "링크 클릭")} · ${KIND[r.verdict.kind]}</p></div>
        <button class="link-btn" id="del" type="button">이 대결 지우기</button></div>
      <label class="switch"><input type="checkbox" id="dedupe" ${st.dedupe ? "checked" : ""}><span>새로고침 중복 막기</span>
        <em>${st.dedupe ? `중복 ${on.tally.dup}건${on.tally.orphan ? ` · 노출 없는 클릭 ${on.tally.orphan}건` : ""} 뺐어요` : `끈 상태: 중복 ${dropped}건까지 세는 중 · B 클릭률 ${fixB} → ${rawB}로 부풀어요`}</em></label>
      <div class="vs">${variantCard(r, "A")}<span class="vs-mark" aria-hidden="true">vs</span>${variantCard(r, "B")}</div>
      ${verdictBox(r)}
      ${dailyChart(t)}
      ${!st.dedupe ? `<p class="warn">중복을 세면 결과를 믿을 수 없어요. 고치기 전에는 클릭이 두 번씩 집계됐어요.</p>` : ""}`;
  }
  $("detail").addEventListener("change", (e) => {
    if (e.target.id === "dedupe") { st.dedupe = e.target.checked; save(); renderDetail(); renderList(); }
  });
  $("detail").addEventListener("input", (e) => {
    const ta = e.target.closest("textarea[data-v]");
    if (!ta) return;
    const t = cur();
    if (ta.dataset.v === "A") t.a = ta.value; else t.b = ta.value;
    save(); renderPhone();
  });
  $("detail").addEventListener("click", (e) => {
    if (e.target.id !== "del") return;
    const idx = st.tests.findIndex((t) => t.id === st.sel);
    const [gone] = st.tests.splice(idx, 1);
    const before = st.sel;
    st.sel = (st.tests[Math.max(0, idx - 1)] || {}).id;
    st.sim = null; st.sug = null;
    save(); renderAll();
    toast(`'${gone.name}' 대결을 지웠어요`, () => { st.tests.splice(idx, 0, gone); st.sel = before; save(); renderAll(); });
  });
  $("tests").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    st.sel = b.dataset.id; st.sim = null; st.sug = null; sugToken++;
    save(); renderAll();
  });
  document.querySelector(".list-pane .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    st.filter = b.dataset.f; save(); renderList();
  });

  /* ---------- 방문자가 되어 눌러 보기 ---------- */
  const now = () => Date.now();
  const hhmmss = (ts) => new Date(ts).toTimeString().slice(0, 8);
  function renderPhone() {
    const t = cur();
    if (!t) { $("phone").innerHTML = ""; $("log").innerHTML = ""; return; }
    $("simFor").textContent = t.name;
    const sim = st.sim && st.sim.test === t.id ? st.sim : null;
    const v = sim ? sim.v : null;
    $("phone").innerHTML = sim ? `
      <div class="post-h"><span class="pf" aria-hidden="true">CL</span><b>클릭랩</b><span class="who">방문자 #${esc(sim.vid.slice(-4))} · 문구 ${v}</span></div>
      <p class="post">${esc(v === "A" ? t.a : t.b)}</p>
      <button type="button" class="cta" id="ctaIn">자세히 보고 신청하기 →</button>` :
      `<div class="phone-empty">'새 방문자'를 누르면 이 자리에 그 사람이 본 게시물이 떠요.</div>`;
    const marked = L.markEvents(t.live, st.dedupe).slice(-6).reverse();
    $("log").innerHTML = marked.map((e) => `<li class="${e.counted ? "" : "off"}"><span class="tm">${hhmmss(e.ts)}</span><span>#${esc(e.vid.slice(-4))} · ${e.v} ${e.type === "view" ? "노출" : "클릭"}</span>
      <span class="st">${e.counted ? "집계" : e.reason === "dup" ? "중복 · 제외" : "노출 없음 · 제외"}</span></li>`).join("") || `<li class="none">아직 직접 넣은 기록이 없어요.</li>`;
  }
  function push(e) { cur().live.push(e); save(); renderAll(); }
  function newVisitor() {
    const t = cur(); if (!t) return;
    const vid = `w${Math.random().toString(36).slice(2, 8)}`;
    const v = L.assignVariant(vid, t.id);
    st.sim = { test: t.id, vid, v, clicked: false };
    push({ vid, v, type: "view", ts: now() });
    toast(`새 방문자 → 문구 ${v} 노출 1회`);
  }
  function clickLink() {
    if (!cur()) return;
    if (!st.sim || st.sim.test !== cur().id) newVisitor();
    st.sim.clicked = true;
    const before = rowOf(cur()).tally[st.sim.v].clicks;
    push({ vid: st.sim.vid, v: st.sim.v, type: "click", ts: now() });
    const after = rowOf(cur()).tally[st.sim.v].clicks;
    toast(after > before ? `문구 ${st.sim.v} 클릭 1회 집계` : "같은 방문자의 클릭이라 세지 않았어요");
  }
  function refresh() {
    if (!cur()) return;
    if (!st.sim || st.sim.test !== cur().id) { toast("먼저 '새 방문자'를 눌러 주세요"); return; }
    const { vid, v, clicked } = st.sim;
    const t = now();
    cur().live.push({ vid, v, type: "view", ts: t });
    if (clicked) cur().live.push({ vid, v, type: "click", ts: t + 1 });
    save(); renderAll();
    toast(st.dedupe ? `새로고침: 기록 ${clicked ? 2 : 1}건이 또 들어왔지만 중복이라 뺐어요` : "중복 막기가 꺼져 있어 그대로 셌어요");
  }
  $("simNew").addEventListener("click", newVisitor);
  $("simClick").addEventListener("click", clickLink);
  $("simRefresh").addEventListener("click", refresh);
  $("phone").addEventListener("click", (e) => { if (e.target.id === "ctaIn") clickLink(); });

  /* ---------- 다음 대결 후보 ---------- */
  function modeChip(s) {
    if (!s) return "";
    if (s.mode === "wait") return `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    if (s.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(s.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule">규칙 기반${s.reason ? ` · ${esc(s.reason)}` : ""}</span>`;
  }
  function renderSug() {
    const s = st.sug && st.sug.test === st.sel ? st.sug : null;
    $("sugMode").innerHTML = modeChip(s);
    $("cands").innerHTML = s ? s.items.map((c, i) => `<li><div><span class="angle">${esc(c.angle)}</span><p>${esc(c.text)}</p>${c.why ? `<small>${esc(c.why)}</small>` : ""}</div>
      <button type="button" class="ghost-btn sm" data-c="${i}">다음 대결로</button></li>`).join("") : "";
    const d = s && s.dropped;
    const parts = d ? [d.overclaim && `과장 표현 ${d.overclaim}개`, d.invented && `문구에 없는 숫자 ${d.invented}개`, d.dup && `기존과 같은 문구 ${d.dup}개`].filter(Boolean) : [];
    $("sugNote").textContent = s ? (parts.length ? `${parts.join(" · ")}를 걸러냈어요.` : s.mode === "rule" ? "행사 정보(일시·장소·혜택·정원)만 다시 배치했어요. 새 사실은 만들지 않아요." : "") : "";
  }
  async function suggest() {
    const t = cur(); if (!t) return;
    const my = ++sugToken;
    const r = rowOf(t);
    const keep = r.verdict.keep || (L.ctr(r.tally.B.clicks, r.tally.B.views) > L.ctr(r.tally.A.clicks, r.tally.A.views) ? "B" : "A");
    const other = keep === "A" ? "B" : "A";
    st.sug = { test: t.id, keep, items: L.ruleSuggest(t, keep), mode: AI.status().enabled === false ? "rule" : "wait", reason: "", dropped: null };
    renderSug();
    const res = await AI.ask("abcopy.suggest", {
      event: t.name, goal: t.goal, facts: t.facts || {},
      keep: { text: keep === "A" ? t.a : t.b, ctr: +(L.ctr(r.tally[keep].clicks, r.tally[keep].views) * 100).toFixed(2) },
      other: { text: other === "A" ? t.a : t.b, ctr: +(L.ctr(r.tally[other].clicks, r.tally[other].views) * 100).toFixed(2) },
    });
    if (my !== sugToken) return;
    const n = res && L.normalizeSuggest(res.data, t);
    if (n) Object.assign(st.sug, { items: n.items, dropped: n.dropped, mode: "ai", ms: res.ms });
    else Object.assign(st.sug, { mode: "rule", reason: res ? "응답 형식이 맞지 않음" : (AI.status().reason || "") });
    save(); renderSug();
  }
  $("suggest").addEventListener("click", suggest);
  $("cands").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]");
    if (!b || !st.sug) return;
    const t = st.tests.find((x) => x.id === st.sug.test);
    const c = st.sug.items[+b.dataset.c];
    const before = { sel: st.sel, sug: st.sug };
    const n = L.nextTest(t, st.sug.keep, c, `t${st.seq++}`);
    n.bByAi = st.sug.mode === "ai";
    st.tests.push(n); st.sel = n.id; st.sug = null; st.sim = null; st.filter = "all";
    save(); renderAll();
    toast(`'${n.name}' 대결을 만들었어요. 노출 ${L.MIN_VIEWS}회씩 모이면 판정해요`, () => { st.tests = st.tests.filter((x) => x.id !== n.id); st.sel = before.sel; st.sug = before.sug; save(); renderAll(); });
  });

  /* ---------- 내보내기 · 되돌리기 ---------- */
  $("csv").addEventListener("click", () => {
    const csv = L.toCsv(st.tests.map((t) => rowOf(t)));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `두문장-결과-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`대결 ${st.tests.length}개 결과를 내려받았어요 (방문자 정보 없이 집계만)`);
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); genCache.clear(); sugToken++;
    save(); renderAll();
    toast("샘플 대결 6쌍으로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  function renderAll() { renderKpis(); renderList(); renderDetail(); renderPhone(); renderSug(); }
  renderAll();
  AI.probe();
})();
