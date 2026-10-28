/* 뼈대 — 화면 (DOM 다루기만 한다. 줄이기·체크리스트·설계서는 logic.js, AI 호출은 ai-client.js)
 *
 * 화면 × 테이블 체크가 바뀌면 바로 다시 줄이고(prune), 판단 기록·체크리스트·ERD·API가 함께 바뀐다.
 * 판단 근거 문장은
 *   1) 규칙으로 바로 쓰고 (기다리지 않게)
 *   2) Claude 에게 '이미 정해진 결정'과 함께 보내 근거만 다시 쓰게 한다. 결정과 어긋난 문장은 버린다.
 */
(function () {
  "use strict";
  const L = window.Ppyeodae;
  const STORE_KEY = "career-tech-spec-v1";
  const S = L.SAMPLE;
  const TABLES = S.tables, APIS = S.apis;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function seed() { return { screens: clone(S.screens), manual: {}, checks: {} }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.screens) && v.manual && v.checks) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let aiRes = null;      // { sig, data, ms }
  let aiMode = { mode: "rule", reason: "" };
  let token = 0;
  let editing = "";      // '그래도 남기기' 이유를 쓰는 중인 테이블

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 계산 ---------- */
  function compute() {
    const result = L.prune(TABLES, st.screens, st.manual);
    const names = result.kept.map((k) => k.name);
    const apis = L.apisFor(APIS, names);
    const checks = L.checklist(TABLES, st.screens, APIS, result, st.checks);
    let reasons = L.ruleReasons(TABLES, st.screens, result);
    const sig = L.signature(result);
    const fresh = aiRes && aiRes.sig === sig;
    if (fresh) reasons = L.mergeReasons(reasons, aiRes.data);
    return { result, names, apis, checks, reasons, sig, fresh };
  }
  const statusOf = (c, name) => c.result.kept.find((k) => k.name === name) || null;
  const ST = { screen: ["screen", "화면"], fk: ["fk", "참조"], manual: ["manual", "사람"] };

  /* ---------- 그리기 ---------- */
  function renderStats(c) {
    $("stats").innerHTML = `
      <div class="stat"><b><s>${TABLES.length}</s>${c.names.length}개</b><span>테이블 · AI 제안에서 줄임</span></div>
      <div class="stat"><b><s>${APIS.length}</s>${c.apis.kept.length}개</b><span>API · 뺀 테이블의 API도 뺌</span></div>
      <div class="stat"><b>${st.screens.length}개</b><span>화면</span></div>
      <div class="stat goal"><b>0회</b><span>설계 이후 구조 변경 · 목표</span></div>`;
  }
  function renderMatrix(c) {
    const cols = TABLES.map((t) => { const k = statusOf(c, t.name); return `<col${k ? "" : ' class="off"'}>`; }).join("");
    const head = TABLES.map((t) => {
      const k = statusOf(c, t.name), s = k ? ST[k.why] : ["off", "뺌"];
      return `<th scope="col" title="${esc(t.purpose)}"><div class="tn"><span class="mono">${esc(t.name)}</span><span class="st ${s[0]}">${s[1]}</span></div></th>`;
    }).join("");
    const rows = st.screens.map((sc, i) => {
      const nApi = c.apis.kept.filter((a) => a.screens.includes(sc.id)).length;
      return `<tr><th scope="row" class="row">${esc(sc.name)}<small>API ${nApi}</small><button type="button" class="del" data-del="${i}" aria-label="${esc(sc.name)} 화면 지우기">✕</button></th>` +
        TABLES.map((t) => `<td><label><span class="sr">${esc(sc.name)} 화면이 ${esc(t.name)}를 씀</span><input type="checkbox" data-s="${i}" data-t="${esc(t.name)}" ${sc.uses.includes(t.name) ? "checked" : ""}></label></td>`).join("") + "</tr>";
    }).join("");
    const u = L.usage(TABLES, st.screens);
    const foot = `<tr><th scope="row">쓰는 화면</th>${TABLES.map((t) => `<td>${u[t.name].length}</td>`).join("")}</tr>`;
    $("mx").innerHTML = `<colgroup><col>${cols}</colgroup><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot>`;
  }
  function modeChip(c) {
    if (aiMode.mode === "wait") return `<span class="mode" data-mode="wait"><i></i>Claude가 근거를 쓰는 중</span>`;
    if (c.fresh) return `<span class="mode" data-mode="ai">Claude로 정리 · ${(aiRes.ms / 1000).toFixed(1)}초</span>`;
    const why = aiRes ? "구성이 바뀜 · 근거 다시 쓰기" : aiMode.reason;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 화면 사용 여부로 근거를 썼어요">규칙 기반${why ? ` · ${esc(why)}` : ""}</span>`;
  }
  function renderReasons(c) {
    $("whyMeta").innerHTML = `<span>AI 제안 ${TABLES.length}개 → ${c.names.length}개 · 결정은 화면 기준, 근거만 AI</span>${modeChip(c)}`;
    const s = $("summary");
    s.hidden = !(c.fresh && aiRes.data.summary);
    if (c.fresh) s.textContent = aiRes.data.summary;
    const li = (r) => {
      const k = statusOf(c, r.table);
      let act = "";
      if (!r.keep) act = `<button type="button" data-keep="${esc(r.table)}">그래도 남기기</button>`;
      else if (k && k.why === "manual") act = `<button type="button" data-drop="${esc(r.table)}">다시 빼기</button>`;
      const form = editing === r.table ? `<form class="why-in" data-for="${esc(r.table)}"><label class="sr" for="why-${esc(r.table)}">${esc(r.table)}을 남기는 이유</label><input id="why-${esc(r.table)}" placeholder="남기는 이유 (설계서에 남아요)" maxlength="60"><button class="ghost-btn" type="submit">남기기</button></form>` : "";
      return `<li class="${r.keep ? "" : "off"}"><span class="nm">${esc(r.table)}</span><span class="tx">${esc(r.why)}${r.by === "ai" ? `<span class="by">Claude</span>` : ""}</span>${act}${form}</li>`;
    };
    const kept = c.reasons.filter((r) => r.keep), off = c.reasons.filter((r) => !r.keep);
    $("reasons").innerHTML = `<div class="grp"><h3>남김 ${kept.length}</h3><ul class="rs">${kept.map(li).join("")}</ul></div>` +
      `<div class="grp"><h3>뺌 ${off.length}</h3><ul class="rs">${off.map(li).join("") || "<li><span class='tx'>뺀 테이블이 없어요</span></li>"}</ul></div>`;
    if (editing) $(`why-${editing}`)?.focus();
  }
  function renderChecks(c) {
    $("checks").innerHTML = c.checks.map((x) => x.auto
      ? `<li class="${x.ok ? "ok" : "no"}"><span class="ic" aria-hidden="true">${x.ok ? "✓" : "!"}</span><span>${esc(x.label)}<span class="sr">${x.ok ? " 통과" : " 확인 필요"}</span>${x.detail ? `<small>${esc(x.detail)}</small>` : ""}</span></li>`
      : `<li><input type="checkbox" id="ck-${x.id}" data-ck="${x.id}" ${x.ok ? "checked" : ""}><label for="ck-${x.id}">${esc(x.label)}<span class="tag">사람</span>${x.detail ? `<small>${esc(x.detail)}</small>` : ""}</label></li>`).join("");
    const risks = c.fresh ? aiRes.data.risks : [];
    $("risks").hidden = !risks.length;
    $("risks").innerHTML = risks.length ? `<h3>Claude가 짚은 위험</h3><ul>${risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
  }
  function renderErd(c) {
    $("erd").innerHTML = TABLES.filter((t) => c.names.includes(t.name)).map((t) => {
      const k = statusOf(c, t.name), s = ST[k.why];
      return `<article class="ent"><div class="ent-h"><b>${esc(t.name)}</b><span class="st ${s[0]}">${s[1]}</span></div><ul>${t.columns.map((col) =>
        `<li><span class="c">${col.pk ? `<span class="b pk">PK</span>` : ""}${col.ref ? `<span class="b fk">FK</span>` : ""}${col.pii ? `<span class="b pii">개인정보</span>` : ""}${esc(col.name)}</span><span class="t">${esc(col.type)}</span>${col.ref ? `<span class="r">→ ${esc(col.ref)}</span>` : ""}</li>`).join("")}</ul></article>`;
    }).join("");
  }
  function renderApi(c) {
    const nameOf = (id) => (st.screens.find((s) => s.id === id) || { name: "" }).name;
    $("apiMeta").textContent = `${c.apis.kept.length}개 · AI 제안 ${APIS.length}개 중 뺀 테이블을 쓰는 ${c.apis.dropped.length}개는 뺐어요${c.apis.dropped.length ? ` (${c.apis.dropped.map((a) => a.path).join(", ")})` : ""}`;
    $("api").innerHTML = `<thead><tr><th>메서드</th><th>경로</th><th>설명</th><th>화면</th><th>테이블</th></tr></thead><tbody>` +
      c.apis.kept.map((a) => `<tr><td><span class="m ${a.method}">${a.method}</span></td><td><code>${esc(a.path)}</code></td><td>${esc(a.desc)}</td><td class="sc">${esc(a.screens.map(nameOf).filter(Boolean).join(", ") || "—")}</td><td class="sc mono">${esc(a.tables.join(", "))}</td></tr>`).join("") + "</tbody>";
  }
  function render() {
    const c = compute();
    renderStats(c); renderMatrix(c); renderReasons(c); renderChecks(c); renderErd(c); renderApi(c);
    return c;
  }

  /* ---------- 고치기 ---------- */
  function change(mutate, msg) {
    const before = clone(st);
    mutate();
    save(); render();
    toast(msg, () => { st = before; save(); render(); });
  }
  $("mx").addEventListener("change", (e) => {
    const b = e.target.closest("input[data-s]"); if (!b) return;
    const sc = st.screens[+b.dataset.s], t = b.dataset.t;
    const was = L.prune(TABLES, st.screens, st.manual).kept.length;
    const before = clone(st);
    sc.uses = b.checked ? [...sc.uses, t] : sc.uses.filter((x) => x !== t);
    const now = L.prune(TABLES, st.screens, st.manual).kept.length;
    save(); render();
    toast(`${sc.name} ${b.checked ? "+" : "−"} ${t}${now !== was ? ` · 테이블 ${was} → ${now}개` : ""}`, () => { st = before; save(); render(); });
  });
  $("mx").addEventListener("click", (e) => {
    const d = e.target.closest("button[data-del]"); if (!d) return;
    const sc = st.screens[+d.dataset.del];
    change(() => { st.screens.splice(+d.dataset.del, 1); }, `‘${sc.name}’ 화면을 지웠어요`);
  });
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("newScreen").value.trim();
    if (!name) { $("newScreen").focus(); toast("화면 이름을 써 주세요"); return; }
    if (st.screens.some((s) => s.name === name)) { toast("같은 이름의 화면이 있어요"); return; }
    const id = `u${Date.now().toString(36)}`;
    change(() => { st.screens.push({ id, name, uses: [] }); }, `‘${name}’ 화면을 추가했어요. 쓰는 테이블에 체크하세요`);
    $("newScreen").value = "";
  });
  $("reasons").addEventListener("click", (e) => {
    const k = e.target.closest("button[data-keep]");
    if (k) { editing = k.dataset.keep; render(); return; }
    const d = e.target.closest("button[data-drop]");
    if (d) { const t = d.dataset.drop; change(() => { delete st.manual[t]; }, `${t}을(를) 다시 뺐어요`); }
  });
  $("reasons").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target.closest("form[data-for]"); if (!f) return;
    const t = f.dataset.for, why = f.querySelector("input").value.trim();
    if (!why) { toast("남기는 이유를 적어야 남길 수 있어요"); f.querySelector("input").focus(); return; }
    editing = "";
    change(() => { st.manual[t] = why; }, `${t}을(를) 남겼어요 · 이유가 판단 기록에 남아요`);
  });
  $("reasons").addEventListener("keydown", (e) => { if (e.key === "Escape" && editing) { editing = ""; render(); } });
  $("checks").addEventListener("change", (e) => {
    const b = e.target.closest("input[data-ck]"); if (!b) return;
    st.checks[b.dataset.ck] = b.checked; save(); render();
  });

  /* ---------- Claude 근거 ---------- */
  async function writeReasons() {
    const my = ++token;
    const c = compute();
    aiMode = { mode: AI.status().enabled === false ? "rule" : "wait", reason: AI.status().reason || "" };
    if (aiMode.mode === "rule") aiRes = null;
    render();
    const input = {
      project: `${S.title} — 스터디 모임 출석·과제 앱`,
      screens: st.screens.map((s) => ({ name: s.name, uses: s.uses })),
      tables: TABLES.map((t) => ({ name: t.name, purpose: t.purpose, columns: t.columns.map((x) => x.name), refs: L.refsOf(t) })),
      decisions: c.reasons.map((r) => ({ table: r.table, keep: r.keep, rule: r.why })),
    };
    const r = await AI.ask("techspec.reasons", input);
    if (my !== token) return;
    const now = compute();
    const n = r && now.sig === c.sig && L.normalizeReview(r.data, now.result);
    if (n) { aiRes = { sig: c.sig, data: n, ms: r.ms }; aiMode = { mode: "ai" }; }
    else { aiRes = null; aiMode = { mode: "rule", reason: !r ? (AI.status().reason || "") : now.sig !== c.sig ? "그 사이 구성이 바뀜" : "응답 형식이 맞지 않음" }; }
    render();
  }
  $("aiWrite").addEventListener("click", writeReasons);

  /* ---------- 내보내기 ---------- */
  $("download").addEventListener("click", () => {
    const c = compute();
    const md = L.toMarkdown({ title: S.title, tables: TABLES, screens: st.screens, apis: APIS, result: c.result, reasons: c.reasons, checks: c.checks });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    a.download = "studylog-tech-spec.md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    const open = c.checks.filter((x) => !x.ok).length;
    toast(open ? `설계서를 내려받았어요 · 아직 확인 안 된 항목 ${open}개` : "설계서를 내려받았어요");
  });
  $("print").addEventListener("click", () => window.print());
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); editing = ""; save(); render();
    toast("샘플 설계로 되돌렸어요", () => { st = before; save(); render(); });
  });

  /* ---------- 시작 ---------- */
  render();
  AI.probe().then(writeReasons);
})();
