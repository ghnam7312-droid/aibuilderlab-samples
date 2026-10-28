/* 프롬서랍 — 화면 (DOM 다루기만 한다. 검사·채우기·점검 규칙은 logic.js, AI 호출은 ai-client.js)
 *
 * 공용 프롬프트를 고르고 빈칸·자료를 채우면 '보낼 프롬프트'가 바로 만들어지고 검사된다.
 *   넣으면 안 되는 정보가 있으면 → 복사 버튼을 막고, 맨 위 금지 목록의 해당 칸을 빨갛게, '가리고 복사'만 허용
 * 'Claude로 점검'은
 *   1) 규칙 점검(역할·목적·대상·형식·분량·조건)을 바로 보여 주고
 *   2) 가린 프롬프트만 Claude(aiguide.review)에 보낸다. 고친 프롬프트에 금지 정보가 있으면 버린다.
 */
(function () {
  "use strict";
  const L = window.Promseorap;
  const STORE_KEY = "ax-ai-guide-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- 상태 ---------- */
  function seed() {
    return { sel: "p07", values: { ...L.SAMPLE_VALUES }, material: L.SAMPLE_MATERIAL, output: L.SAMPLE_OUTPUT, checked: {}, cat: "", q: "", uses: Object.fromEntries(L.PROMPTS.map((p) => [p.id, p.uses])) };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && L.PROMPTS.some((p) => p.id === v.sel) && v.values && v.uses) return v;
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let ai = { mode: "rule", reason: "" };
  let aiResult = null;
  let waiting = false;
  let runToken = 0;

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  const cur = () => L.PROMPTS.find((p) => p.id === st.sel);
  const built = () => L.fill(cur().body, st.values, st.material);

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 1. 금지 목록 ---------- */
  function renderBan(hitIds) {
    $("ban").innerHTML = L.FORBIDDEN.map((f) => `<li class="${f.kind === "warn" ? "warn" : ""}${hitIds.has(f.id) ? " hit" : ""}"><b>${esc(f.label)}</b><span>${f.kind === "warn" ? "조심 · " : ""}${esc(f.example)}</span></li>`).join("");
  }

  /* ---------- 목록 ---------- */
  function renderLib() {
    $("cats").innerHTML = [["", "전체"], ...L.CATS.map((c) => [c, c])].map(([v, t]) => `<button type="button" data-cat="${v}" aria-pressed="${st.cat === v}">${t}</button>`).join("");
    const list = L.search(L.PROMPTS, st.q, st.cat);
    $("libCount").textContent = `${list.length} / ${L.PROMPTS.length}개`;
    $("plist").innerHTML = list.map((p) => `<li><button type="button" data-id="${p.id}" aria-current="${p.id === st.sel}"><b>${esc(p.title)}</b><span class="cat">${esc(p.cat)}</span><span class="meta">${esc(p.owner)} · 이번 달 팀 사용 ${st.uses[p.id] || 0}회</span></button></li>`).join("") || `<li class="none">맞는 프롬프트가 없어요.</li>`;
  }
  $("cats").addEventListener("click", (e) => { const b = e.target.closest("button[data-cat]"); if (!b) return; st.cat = b.dataset.cat; save(); renderLib(); });
  $("q").addEventListener("input", (e) => { st.q = e.target.value; save(); renderLib(); });
  $("plist").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b || b.dataset.id === st.sel) return;
    st.sel = b.dataset.id; aiResult = null; runToken++; waiting = false; ai = { mode: "rule", reason: "" };
    save(); renderLib(); renderVars(); renderBuilt();
    if (matchMedia("(max-width: 960px)").matches) $("workTitle").scrollIntoView({ block: "start" });
  });

  /* ---------- 작업대 ---------- */
  function renderVars() {
    const p = cur();
    $("workTitle").textContent = p.title;
    $("workMeta").textContent = `${p.cat} · ${p.owner} · 이번 달 팀 사용 ${st.uses[p.id] || 0}회`;
    const vs = L.varsOf(p.body);
    $("vars").innerHTML = vs.map((k, i) => `<label for="v${i}">${esc(k)}<input id="v${i}" data-k="${esc(k)}" value="${esc(st.values[k] || "")}" autocomplete="off" aria-invalid="${!String(st.values[k] || "").trim()}"></label>`).join("") || `<p class="none">채울 빈칸이 없는 프롬프트예요. 자료만 붙이면 됩니다.</p>`;
  }
  $("vars").addEventListener("input", (e) => {
    const k = e.target.dataset.k; if (!k) return;
    st.values[k] = e.target.value;
    e.target.setAttribute("aria-invalid", String(!e.target.value.trim()));
    save(); renderBuilt();
  });
  $("material").addEventListener("input", (e) => { st.material = e.target.value; save(); renderBuilt(); });

  /** 미리 보기: 금지 정보는 빨강, 조심할 정보는 노랑, 빈칸은 주황 */
  function highlight(text) {
    const marks = [];
    L.FORBIDDEN.forEach((f) => { for (const m of text.matchAll(new RegExp(f.re.source, "g"))) marks.push([m.index, m.index + m[0].length, f.kind === "block" ? "" : "w"]); });
    for (const m of text.matchAll(/\[[^\[\]\n]{1,12}\]/g)) if (!/^\[자료\]$/.test(m[0])) marks.push([m.index, m.index + m[0].length, "hole"]);
    marks.sort((a, b) => a[0] - b[0]);
    let out = "", at = 0;
    marks.forEach(([s, e, k]) => {
      if (s < at) return;
      out += esc(text.slice(at, s));
      const seg = esc(text.slice(s, e));
      out += k === "hole" ? `<span class="hole">${seg}</span>` : `<mark${k ? ` class="w"` : ""}>${seg}</mark>`;
      at = e;
    });
    return out + esc(text.slice(at));
  }
  function renderBuilt() {
    const b = built();
    const sc = L.scan(b.text);
    $("pv").innerHTML = highlight(b.text);
    $("emptyNote").textContent = b.empty.length ? `빈칸 ${b.empty.length}개: ${b.empty.join(", ")}` : "";
    renderBan(new Set([...sc.block, ...sc.warn].map((x) => x.id)));
    const box = $("scan");
    const lines = [];
    if (sc.block.length) lines.push(`<b>넣으면 안 되는 정보 ${sc.block.length}개</b> — ${[...new Set(sc.block.map((x) => x.label))].join(", ")}. 그대로는 복사할 수 없어요. ‘가리고 복사’를 쓰거나 자료에서 지워 주세요.`);
    if (sc.warn.length) lines.push(`<b>조심할 정보</b> — ${[...new Set(sc.warn.map((x) => x.label))].join(", ")}. 팀장 확인 뒤에 넣으세요.`);
    if (sc.human) lines.push(`<b>사람 확인</b> — ‘${esc(sc.human)}’ 판단은 AI 답을 근거로 쓰지 않고 담당자에게 확인합니다.`);
    box.className = `scan ${sc.block.length ? "bad" : sc.warn.length || sc.human ? "warn" : "ok"}`;
    box.innerHTML = lines.length ? (lines.length > 1 ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : lines[0]) : "<b>검사 통과</b> — 넣으면 안 되는 정보가 없어요.";
    $("copy").disabled = sc.block.length > 0;
    $("copy").title = sc.block.length ? "넣으면 안 되는 정보가 있어 막혔어요" : "";
    $("maskCopy").classList.toggle("hot", sc.block.length > 0);
    renderCheck();
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 아래로 */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  function used() { st.uses[st.sel] = (st.uses[st.sel] || 0) + 1; save(); renderLib(); $("workMeta").textContent = `${cur().cat} · ${cur().owner} · 이번 달 팀 사용 ${st.uses[st.sel]}회`; }
  $("copy").addEventListener("click", async () => {
    const b = built();
    if (L.scan(b.text).block.length) { toast("넣으면 안 되는 정보가 있어 복사하지 않았어요"); return; }
    const ok = await copyText(b.text);
    used();
    toast(ok ? `복사했어요${b.empty.length ? ` · 빈칸 ${b.empty.length}개가 남아 있어요` : ""}` : "복사가 막혀 있어요. 미리 보기에서 직접 복사해 주세요");
  });
  $("maskCopy").addEventListener("click", async () => {
    const before = st.material;
    const n = L.scan(built().text).block.length;
    st.material = L.mask(st.material);
    Object.keys(st.values).forEach((k) => { st.values[k] = L.mask(st.values[k]); });
    $("material").value = st.material; save(); renderVars(); renderBuilt();
    const ok = await copyText(built().text);
    used();
    toast(`${n}곳을 가리고 ${ok ? "복사했어요" : "준비했어요 (복사는 막혀 있음)"}`, () => { st.material = before; $("material").value = before; save(); renderBuilt(); });
  });

  /* ---------- 점검 ---------- */
  function renderReview() {
    const rule = L.checkPrompt(built().text);
    const r = aiResult || rule;
    const m = $("mode");
    if (waiting) m.outerHTML = `<span id="mode" class="mode" data-mode="wait"><i></i>Claude가 읽는 중</span>`;
    else if (ai.mode === "ai") m.outerHTML = `<span id="mode" class="mode" data-mode="ai">Claude로 점검 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    else m.outerHTML = `<span id="mode" class="mode" data-mode="rule" title="역할·목적·대상·형식·분량·조건이 있는지 봤어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
    $("meter").innerHTML = `<span class="score">${r.score}<small>점</small></span><span class="parts">${L.PARTS.map((p) => `<span class="part${rule.has.includes(p.id) ? "" : " miss"}">${p.label}</span>`).join("")}</span>`;
    const box = $("improved");
    box.classList.toggle("waiting", waiting);
    if (aiResult) { box.hidden = false; box.innerHTML = `<b>Claude가 고친 프롬프트</b>${aiResult.missing.length ? ` · 빠진 것: ${aiResult.missing.map(esc).join(", ")}` : ""}<pre>${esc(aiResult.improved)}</pre>`; }
    else if (rule.missing.length) { box.hidden = false; box.innerHTML = `<b>더 넣으면 좋은 것</b> · ${rule.missing.map(esc).join(", ")}. 공용 프롬프트를 고치면 팀 채널에 알려 주세요.`; }
    else box.hidden = true;
  }
  $("review").addEventListener("click", async () => {
    const my = ++runToken;
    aiResult = null; ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderReview();
    // 가린 프롬프트만 보낸다
    const r = await AI.ask("aiguide.review", { prompt: L.mask(built().text).slice(0, 4000), parts: L.PARTS.map((p) => p.label) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeReview(r.data);
    if (n) { aiResult = n; ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답 형식 오류 · 금지 정보" : (AI.status().reason || "") };
    renderReview();
  });

  /* ---------- 2. 검수표 ---------- */
  function renderCheck() {
    const auto = L.inspectOutput(st.output);
    $("cl").innerHTML = L.CHECKLIST.map((c, i) => {
      const a = c.auto ? auto[c.id] : c.id === "numbers" ? auto.numbers : null;
      const cls = a ? a.state : "";
      const autoOk = c.auto && a && a.state === "ok";
      return `<li class="${cls}"><input type="checkbox" id="c${i}" data-c="${c.id}" ${autoOk || st.checked[c.id] ? "checked" : ""} ${autoOk ? "disabled" : ""}><label for="c${i}">${esc(c.text)}${a ? `<span class="auto">${a.state === "ok" ? "자동 확인 · " : a.state === "bad" ? "고칠 것 · " : "사람 확인 · "}${esc(a.note)}</span>` : ""}</label></li>`;
    }).join("");
    const n = L.remaining(auto, st.checked);
    $("left").className = `left${n ? "" : " done"}`;
    $("left").innerHTML = n ? `남은 항목 <b>${n}개</b> — 다 끝나야 내보낼 수 있어요` : `<b>검수 완료</b> — 내보내도 됩니다`;
  }
  $("cl").addEventListener("change", (e) => { const k = e.target.dataset.c; if (!k) return; st.checked[k] = e.target.checked; save(); renderCheck(); });
  $("output").addEventListener("input", (e) => { st.output = e.target.value; save(); renderCheck(); });
  $("print").addEventListener("click", () => window.print());

  $("reset").addEventListener("click", () => {
    const before = clone(st);
    st = seed(); aiResult = null; runToken++; waiting = false; ai = { mode: "rule", reason: "" }; save(); start();
    toast("샘플로 되돌렸어요", () => { st = before; save(); start(); });
  });

  /* ---------- 시작 ---------- */
  function start() {
    $("q").value = st.q; $("material").value = st.material; $("output").value = st.output;
    renderLib(); renderVars(); renderBuilt(); renderReview();
  }
  start();
  AI.probe();
})();
