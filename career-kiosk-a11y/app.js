/* 또렷 — 화면 (DOM 다루기만 한다. 대비 계산·기준 대조·제안 규칙은 logic.js, AI 호출은 ai-client.js)
 *
 * 왼쪽: 학생식당 주문기 '지금 화면 / 개선안'. 요소를 눌러 색·크기를 바꾸면 측정표가 바로 다시 계산된다.
 * 오른쪽: 현장 관찰 12개 → '제안서 만들기'
 *   1) 규칙으로 분류별 개선안을 바로 보여 주고 2) Claude(kioska11y.proposal) 결과가 오면 검사해서 덮어쓴다.
 * 아래: AI가 처음 알려 준 기준을 공식 지침표와 대조한 표.
 */
(function () {
  "use strict";
  const L = window.Ttoryeot;
  const STORE_KEY = "career-kiosk-a11y-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TITLE = "학생식당 키오스크 접근성 개선 제안";

  /* ---------- 샘플 ---------- */
  const E = (id, label, fg, bg, px, bold, w, h) => ({ id, label, fg, bg, px, bold, ...(w ? { w, h } : {}) });
  function screens() {
    return {
      before: { els: [E("title", "안내 문구", "#9AA0A6", "#FFFFFF", 18, true), E("menu", "메뉴 버튼", "#FFFFFF", "#F2A541", 16, true, 140, 64), E("price", "가격", "#B0B0B0", "#FFFFFF", 14, false),
        E("qty", "수량 버튼", "#555555", "#EEEEEE", 16, true, 28, 28), E("timer", "남은 시간", "#C8C8C8", "#FFFFFF", 12, false), E("home", "처음으로", "#666666", "#EEEEEE", 13, true, 56, 32), E("pay", "결제하기", "#FFFFFF", "#4CAF50", 18, true, 180, 48)],
        timer: { limit: 30, extend: false } },
      after: { els: [E("title", "안내 문구", "#161616", "#FFFFFF", 26, true), E("menu", "메뉴 버튼", "#FFFFFF", "#1F4E8C", 22, true, 140, 88), E("price", "가격", "#161616", "#FFFFFF", 20, true),
        E("qty", "수량 버튼", "#161616", "#FFD60A", 24, true, 56, 56), E("timer", "남은 시간", "#161616", "#FFFFFF", 18, true), E("home", "처음으로", "#161616", "#FFFFFF", 18, true, 96, 56), E("pay", "결제하기", "#161616", "#FFD60A", 24, true, 180, 64)],
        timer: { limit: 120, extend: true } },
    };
  }
  const O = (id, cat, who, sev, freq, text) => ({ id, cat, who, sev, freq, text });
  const OBS = [
    O("O1", "contrast", "저시력", 3, 3, "메뉴 버튼의 흰 글자가 주황 바탕에 묻혀 메뉴 이름을 못 읽음"),
    O("O2", "contrast", "어르신", 2, 3, "가격이 옅은 회색이라 직원에게 가격을 다시 물어봄"),
    O("O3", "text", "어르신", 3, 3, "메뉴 이름이 작아 화면에 얼굴을 가까이 대고 고름"),
    O("O4", "text", "저시력", 2, 2, "글자를 크게 보는 기능이 없음"),
    O("O5", "target", "어르신", 2, 3, "수량 +/− 버튼이 작아 두 번 눌리거나 옆 버튼이 눌림"),
    O("O6", "target", "모든 이용자", 2, 2, "‘처음으로’ 버튼이 작고 결제 버튼에 붙어 있어 잘못 누름"),
    O("O7", "time", "어르신", 3, 2, "30초 동안 안 누르면 처음 화면으로 돌아가 다시 고름"),
    O("O8", "time", "어르신", 2, 2, "남은 시간 표시가 작고, 시간을 늘리는 버튼이 없음"),
    O("O9", "sound", "저시력", 3, 1, "소리 안내가 없어 결제가 끝났는지 모름"),
    O("O10", "flow", "어르신", 2, 2, "메뉴 → 옵션 → 포인트 적립 → 결제 단계가 길어 중간에 포기"),
    O("O11", "flow", "처음 이용", 2, 2, "포인트 적립 화면에서 ‘건너뛰기’를 못 찾음"),
    O("O12", "reach", "휠체어", 3, 1, "카드 투입구와 화면 위쪽 버튼이 높아 휠체어에서 닿기 어려움"),
  ];
  const CLAIMS = [
    { text: "글자 대비는 WCAG 2.1 기준 4.5:1 이상", id: "contrast", value: 4.5, version: "2.1" },
    { text: "큰 글자도 대비 4.5:1 이상이어야 한다", id: "contrast", value: 4.5, large: 4.5 },
    { text: "누르는 영역은 최소 44×44px (AA)", id: "target", value: 44, level: "AA" },
    { text: "강화 기준은 44×44px (AAA)", id: "target-enh", value: 44, level: "AAA" },
    { text: "시간 제한은 끝나기 10초 전에 알리면 된다", id: "timing", value: 10 },
    { text: "글자를 200%까지 키울 수 있어야 한다", id: "resize", value: 200 },
    { text: "버튼 경계·아이콘은 바탕과 3:1 이상", id: "non-text", value: 3 },
    { text: "키오스크 버튼은 바닥에서 정해진 높이 안에 있어야 한다", id: "kiosk-height" },
  ];

  function seed() { return { ver: "before", sel: "menu", screens: screens(), obs: OBS.map((o) => ({ ...o })), who: "전체", prop: null, ai: { mode: "rule", reason: "" } }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.screens && v.screens.before && Array.isArray(v.obs)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  // 브라우저가 주는 영어 오류는 한국어로 바꿔 보여 준다
  const why = (r) => (/fetch|network|load failed/i.test(r || "") ? "서버에 연결할 수 없음" : r || "");
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${why(s.reason) || "AI 꺼짐"}`;
  });

  const scr = () => st.screens[st.ver];
  const el = (id) => scr().els.find((x) => x.id === id);

  /* ---------- 요약 ---------- */
  function renderSum() {
    const a = L.auditScreen(st.screens.before), b = L.auditScreen(st.screens.after);
    $("sum").innerHTML = `<div><b>${st.obs.length}</b><span>현장에서 관찰한 문제</span></div>
      <div><b>${st.prop ? st.prop.items.length : "–"}</b><span>개선안</span></div>
      <div><b>${a.fails} → ${b.fails}</b><span>공식 기준 미달 (지금 → 개선안)</span></div>
      <div class="goal"><span>목표치</span><b>문제 12개 발견 · 개선안 7개<br>글자 크기·대비 기준 정리</b></div>`;
  }

  /* ---------- 키오스크 미리보기 ---------- */
  function sty(e, extra) {
    return `style="color:${e.fg};background:${e.bg};font-size:${e.px}px;font-weight:${e.bold ? 700 : 400};${e.w ? `min-height:${e.h}px;` : ""}${extra || ""}"`;
  }
  function renderKiosk() {
    document.querySelectorAll("[data-ver]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ver === st.ver)));
    const au = L.auditScreen(scr());
    const bad = new Set(au.rows.filter((r) => r.contrast === "fail" || r.target === "fail").map((r) => r.id));
    if (au.timer.status === "fail") bad.add("timer");
    const k = (id, cls, inner, extra) => { const e = el(id); return `<button type="button" class="k-el ${cls}${st.sel === id ? " sel" : ""}${bad.has(id) ? " bad" : ""}" data-el="${id}" aria-label="${esc(e.label)} 고치기" ${sty(e, extra)}>${inner}</button>`; };
    const t = scr().timer;
    const menus = ["오늘의 정식", "돈가스", "비빔밥", "라면"];
    $("kiosk").innerHTML = `${k("title", "k-title", "메뉴를 골라 주세요")}
      <div class="k-menus">${menus.map((m) => k("menu", "k-menu", esc(m))).join("")}</div>
      ${k("price", "k-price", "오늘의 정식 · 5,500원")}
      <div class="k-row"><span style="display:flex;gap:8px;align-items:center">${k("qty", "k-qty", "−", `width:${el("qty").w}px;height:${el("qty").h}px;`)}<b>1</b>${k("qty", "k-qty", "+", `width:${el("qty").w}px;height:${el("qty").h}px;`)}</span>
        ${k("timer", "k-timer", `남은 시간 ${t.limit}초${t.extend ? " · 연장 가능" : ""}`)}</div>
      <div class="k-bottom">${k("home", "k-home", "처음으로", `width:${el("home").w}px;${st.ver === "after" ? "box-shadow:inset 0 0 0 2px #161616;" : ""}`)}${k("pay", "k-pay", "결제하기")}</div>`;
  }
  function renderEditor() {
    const e = el(st.sel);
    const t = scr().timer;
    const r = L.auditEl(e);
    $("editor").innerHTML = `<div class="eh"><span>고치는 요소: ${esc(e.label)} · ${st.ver === "before" ? "지금 화면" : "개선안"}</span><span class="pill ${r.contrast}">대비 ${r.ratio ?? "-"}:1</span></div>
      <label>글자색<input type="color" data-k="fg" value="${esc(e.fg)}"></label>
      <label>바탕색<input type="color" data-k="bg" value="${esc(e.bg)}"></label>
      <label>글자 크기(px)<input type="number" min="10" max="48" data-k="px" value="${e.px}"></label>
      ${e.w ? `<label>버튼 너비(px)<input type="number" min="16" max="300" data-k="w" value="${e.w}"></label><label>버튼 높이(px)<input type="number" min="16" max="120" data-k="h" value="${e.h}"></label>` : ""}
      <label class="chk"><input type="checkbox" data-k="bold" ${e.bold ? "checked" : ""}>굵게</label>
      ${st.sel === "timer" ? `<label>제한 시간(초)<input type="number" min="0" max="600" data-t="limit" value="${t.limit}"></label><label class="chk"><input type="checkbox" data-t="extend" ${t.extend ? "checked" : ""}>알림·연장</label>` : ""}`;
  }
  function renderAudit() {
    const a = L.auditScreen(scr());
    const pc = (r) => r.contrast === "bad-input" ? `<span class="pill fail">색 오류</span>` : `<span class="pill ${r.contrast}">${r.ratio}:1 ${r.contrast === "pass" ? "통과" : "미달"}</span> <small>기준 ${r.need}</small>`;
    const ps = (r) => r.target === "none" ? `<span class="pill none">—</span>` : `<span class="pill ${r.target}">${r.size} ${r.target === "pass" ? "통과" : r.target === "warn" ? "권장 미달" : "미달"}</span>`;
    $("audit").innerHTML = `<caption>측정 — ${st.ver === "before" ? "지금 화면" : "개선안"} · 기준 미달 ${a.fails}곳 · 권장 미달 ${a.warns}곳</caption>
      <thead><tr><th>요소</th><th>명도 대비 (1.4.3)</th><th class="c-size">누르는 영역 (2.5.8 / 2.5.5)</th><th>글자</th></tr></thead>
      <tbody>${a.rows.map((r) => `<tr data-el="${r.id}" class="${r.id === st.sel ? "sel" : ""}"><td>${esc(r.label)}</td><td>${pc(r)}</td><td class="c-size">${ps(r)}</td><td><span class="pill ${r.text}">${el(r.id).px}px</span></td></tr>`).join("")}
      <tr data-el="timer"><td>시간 제한 (2.2.1)</td><td colspan="3"><span class="pill ${a.timer.status}">${a.timer.status === "pass" ? "통과" : "미달"}</span> ${esc(a.timer.msg)}</td></tr></tbody>`;
  }
  function renderLeft() { renderKiosk(); renderEditor(); renderAudit(); renderSum(); }

  $("kiosk").addEventListener("click", (e) => {
    const b = e.target.closest("[data-el]");
    if (!b) return;
    st.sel = b.dataset.el; save(); renderLeft();
    $("editor").querySelector("input")?.focus();
  });
  $("audit").addEventListener("click", (e) => {
    const r = e.target.closest("tr[data-el]");
    if (!r) return;
    st.sel = r.dataset.el; save(); renderLeft();
  });
  $("editor").addEventListener("input", (e) => {
    const i = e.target;
    if (i.dataset.k) {
      const x = el(st.sel);
      const k = i.dataset.k;
      if (k === "bold") x.bold = i.checked;
      else if (k === "fg" || k === "bg") x[k] = i.value;
      else { const v = Number(i.value); if (!Number.isFinite(v) || v <= 0) return; x[k] = v; }
    }
    if (i.dataset.t) { const t = scr().timer; if (i.dataset.t === "extend") t.extend = i.checked; else t.limit = Math.max(0, Number(i.value) || 0); }
    save(); renderKiosk(); renderAudit(); renderSum();
    const r = L.auditEl(el(st.sel));
    const pill = $("editor").querySelector(".eh .pill");
    pill.className = `pill ${r.contrast}`; pill.textContent = `대비 ${r.ratio ?? "-"}:1`;
  });
  document.querySelector(".kiosk-card .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ver]");
    if (!b) return;
    st.ver = b.dataset.ver; save(); renderLeft();
  });

  /* ---------- 관찰 ---------- */
  function renderObs() {
    const whos = ["전체", ...new Set(st.obs.map((o) => o.who))];
    if (!whos.includes(st.who)) st.who = "전체";
    $("whoChips").innerHTML = whos.map((w) => `<button type="button" data-who="${esc(w)}" aria-pressed="${w === st.who}">${esc(w)}</button>`).join("");
    $("obsN").textContent = st.obs.length;
    const list = st.obs.filter((o) => st.who === "전체" || o.who === st.who);
    const dots = (n) => `<span class="sev" aria-label="심각도 ${n}">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
    $("obs").innerHTML = list.map((o) => `<li data-obs="${o.id}"><span class="id">${o.id}</span><span class="cat">${L.CATS[o.cat]}</span><span>${esc(o.text)}${dots(o.sev)}</span><span class="w">${esc(o.who)}</span>
      <button type="button" class="del" data-del="${o.id}" aria-label="${o.id} 지우기">✕</button></li>`).join("") || `<li><span></span><span></span><span>관찰이 없어요</span></li>`;
  }
  $("aCat").innerHTML = Object.entries(L.CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("whoChips").addEventListener("click", (e) => { const b = e.target.closest("button[data-who]"); if (!b) return; st.who = b.dataset.who; save(); renderObs(); });
  $("obs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-del]");
    if (!b) return;
    const idx = st.obs.findIndex((o) => o.id === b.dataset.del);
    const [gone] = st.obs.splice(idx, 1);
    save(); renderObs(); renderSum();
    toast(`${gone.id}를 지웠어요. 제안서를 다시 만들면 반영돼요`, () => { st.obs.splice(idx, 0, gone); save(); renderObs(); renderSum(); });
  });
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = L.addObs(st.obs, { cat: $("aCat").value, who: $("aWho").value, sev: $("aSev").value, freq: $("aFreq").value, text: $("aText").value });
    if (!r.ok) { toast(r.error); $("aText").focus(); return; }
    const before = st.obs;
    st.obs = r.list; $("aText").value = "";
    save(); renderObs(); renderSum();
    toast(`${r.obs.id}를 더했어요`, () => { st.obs = before; save(); renderObs(); renderSum(); });
  });

  /* ---------- 제안서 ---------- */
  function critHtml(it) {
    if (it.check === "human" || !it.criterion) return `<span class="pill human">공식 수치 없음 · 담당 부서 확인</span>`;
    const o = L.OFFICIAL[it.criterion];
    return `<span class="pill ${it.check}">${it.check === "differ" ? "AI 수치와 달라 공식값으로" : "공식 기준과 일치"}</span> WCAG ${L.VERSION} ${o.sc} ${esc(o.name)}(${o.level}) — ${esc(o.rule)}`;
  }
  function renderDoc() {
    const box = $("doc");
    box.classList.toggle("waiting", waiting);
    const chip = waiting ? `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`
      : !st.prop ? "" : st.ai.mode === "ai" ? `<span class="mode" data-mode="ai">Claude로 정리 · ${(st.ai.ms / 1000).toFixed(1)}초</span>`
      : `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 분류별 규칙으로 묶었어요">규칙 기반${st.ai.reason ? ` · ${esc(st.ai.reason)}` : ""}</span>`;
    $("modeChip").innerHTML = chip;
    if (!st.prop) { box.innerHTML = `<p class="empty">‘제안서 만들기’를 누르면 관찰한 문제를 개선안으로 묶어 드려요.</p>`; return; }
    const p = st.prop;
    box.innerHTML = `<p class="lead"><b>${TITLE}</b> · 관찰 ${p.n}개 → 개선안 ${p.items.length}개${p.summary ? ` — ${esc(p.summary)}` : ""}</p>
      <ol>${p.items.map((it) => `<li class="prop"><div class="t">${esc(it.title)}<span class="pri ${it.priority}">우선순위 ${it.priority}</span></div>
        <p>${esc(it.action)}</p><p class="crit">${critHtml(it)}</p>
        ${it.legal ? `<p class="crit"><span class="pill human">법적 판단 문장은 지움 · 담당 부서 확인</span></p>` : ""}
        <div class="refs">${it.issues.map((id) => `<button type="button" data-ref="${id}">${id}</button>`).join("")}</div></li>`).join("")}</ol>
      <p class="note">이 제안서는 법적 의무 여부를 판단하지 않아요. 설치 높이·소리 안내처럼 공식 수치가 없는 항목은 학교 담당 부서가 관련 기준을 확인해 정해요.</p>`;
  }
  function lightObs(id) {
    document.querySelectorAll(".obs li.lit").forEach((x) => x.classList.remove("lit"));
    if (id) { const li = document.querySelector(`.obs li[data-obs="${id}"]`); if (li) { li.classList.add("lit"); li.scrollIntoView({ block: "nearest" }); } }
  }
  $("doc").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ref]");
    if (!b) return;
    if (st.who !== "전체") { st.who = "전체"; renderObs(); }
    lightObs(b.dataset.ref);
  });
  $("doc").addEventListener("mouseover", (e) => { const b = e.target.closest("button[data-ref]"); if (b) lightObs(b.dataset.ref); });
  $("doc").addEventListener("mouseleave", () => lightObs(null));

  async function run(quiet) {
    const my = ++runToken;
    const obs = st.obs.map((o) => ({ ...o }));
    st.prop = { items: L.ruleProposal(obs), summary: "", n: obs.length };
    st.ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderDoc(); renderSum();
    const a = L.auditScreen(st.screens.before);
    const r = await AI.ask("kioska11y.proposal", {
      observations: obs.map((o) => ({ id: o.id, category: L.CATS[o.cat], who: o.who, severity: o.sev, frequency: o.freq, text: o.text })),
      measured: a.rows.filter((x) => x.contrast === "fail" || x.target !== "pass").map((x) => ({ element: x.label, contrast: x.ratio, size: x.size || "" })).concat([{ element: "시간 제한", note: a.timer.msg }]),
      criteria: Object.entries(L.OFFICIAL).map(([id, o]) => ({ id, sc: o.sc, name: o.name, level: o.level, rule: o.rule })),
    });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeProposal(r.data, obs);
    if (n) { st.prop = { items: n.items, summary: n.summary, n: obs.length }; st.ai = { mode: "ai", ms: r.ms }; }
    else st.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : why(AI.status().reason) };
    save(); renderDoc(); renderSum();
    if (!quiet) toast(`관찰 ${obs.length}개 → 개선안 ${st.prop.items.length}개 (${st.ai.mode === "ai" ? "Claude" : "규칙"})`);
  }
  $("run").addEventListener("click", () => run());
  $("copy").addEventListener("click", async () => {
    if (!st.prop) { toast("먼저 ‘제안서 만들기’를 눌러 주세요"); return; }
    const md = L.proposalMd(TITLE, st.prop.items, st.obs, L.auditScreen(st.screens.before));
    try { await navigator.clipboard.writeText(md); toast("제안서를 마크다운으로 복사했어요"); }
    catch (e) { toast("복사할 수 없어요. ‘인쇄 · PDF’를 써 주세요"); }
  });
  $("print").addEventListener("click", () => { if (!st.prop) { toast("먼저 ‘제안서 만들기’를 눌러 주세요"); return; } window.print(); });

  /* ---------- 기준 대조표 ---------- */
  function renderVerify() {
    const lab = { match: "일치", differ: "다름", unknown: "사람이 확인" };
    $("verify").innerHTML = `<thead><tr><th>AI가 말한 것</th><th>대조</th><th>공식 기준</th><th>다른 점 · 할 일</th></tr></thead><tbody>${CLAIMS.map((c) => {
      const v = L.verifyClaim(c);
      return `<tr><td>${esc(c.text)}</td><td><span class="pill ${v.status}">${lab[v.status]}</span></td>
        <td class="off">${v.official ? `${v.official.sc} ${esc(v.official.name)} (${v.official.level}) — ${esc(v.official.rule)}` : "공식 지침표에 없음"}</td>
        <td class="${v.status === "differ" ? "why" : "off"}">${esc(v.why || "그대로 사용")}</td></tr>`;
    }).join("")}</tbody>`;
  }

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed();
    renderAll(); run(true);
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });
  function renderAll() { renderLeft(); renderObs(); renderDoc(); renderVerify(); }

  /* ---------- 시작 ---------- */
  renderAll();
  AI.probe().then(() => { if (!st.prop) run(true); });
})();
