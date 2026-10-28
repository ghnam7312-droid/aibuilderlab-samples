/* 아침한장 — 화면 (DOM 다루기만 한다. 요약 규칙·숫자 대조·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * '요약하기'를 누르면
 *   1) 원문 문장을 골라 만든 규칙 요약을 바로 보여 주고 (숫자가 틀릴 수 없다)
 *   2) Claude 에게 같은 기사를 보낸다. 돌아온 문장 중 원문에 없는 숫자가 든 것은 버리고 나머지로 덮어쓴다.
 * 사람이 문장을 고쳐도 같은 숫자 검사를 거치고, 원문과 다른 숫자가 있으면 발송 버튼이 잠긴다.
 */
(function () {
  "use strict";
  const L = window.AchimHanjang;
  const STORE_KEY = "startup-news-digest-v1";
  const ACCENT = "#D9480F";

  const $ = (id) => document.getElementById(id);
  const esc = L.esc;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DAYS = "일월화수목금토";
  const now = new Date();
  const issueName = `아침한장 · ${now.getMonth() + 1}/${now.getDate()}(${DAYS[now.getDay()]})`;

  /* ---------- 상태 ---------- */
  function seed() {
    return { added: [], pick: L.SAMPLE_PICK.slice(), tier: "paid", result: null, edits: {}, open: "" };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.pick) && Array.isArray(v.added)) return { ...seed(), ...v, open: "" };
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;
  let editing = null; // {id, k}

  const all = () => L.SAMPLE.concat(st.added);
  const byId = (id) => all().find((a) => a.id === id);
  const picked = () => st.pick.map(byId).filter(Boolean);
  /** 사람이 고친 문장을 얹은 결과 */
  function items() {
    if (!st.result) return [];
    return st.result.items.filter((it) => st.pick.includes(it.id))
      .sort((a, b) => st.pick.indexOf(a.id) - st.pick.indexOf(b.id))
      .map((it) => ({ ...it, ...(st.edits[it.id] || {}) }));
  }

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  /** 문장 속 숫자를 칠한다: 원문에 있으면 ok, 없으면 bad */
  function paintNums(text, source) {
    const c = L.checkNumbers(text, source);
    const nums = L.extractNumbers(text);
    let out = "", last = 0;
    nums.forEach((n) => {
      const ok = !c.bad.includes(n.raw);
      out += esc(text.slice(last, n.at)) + `<mark class="num ${ok ? "ok" : "bad"}" title="${ok ? "원문과 같은 숫자" : "원문에 없는 숫자"}">${esc(n.raw)}</mark>`;
      last = n.at + n.raw.length;
    });
    return out + esc(text.slice(last));
  }

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 왼쪽: 기사 목록 ---------- */
  function renderInbox() {
    const list = all();
    const dup = L.findDuplicates(list);
    $("inCount").textContent = `${list.length}건 · 고른 기사 ${st.pick.length}건`;
    $("arts").innerHTML = list.map((a) => {
      const on = st.pick.includes(a.id);
      const nums = L.extractNumbers(a.body).length;
      const twin = dup[a.id] ? list.findIndex((x) => x.id === dup[a.id]) + 1 : 0;
      const open = st.open === a.id;
      return `<li class="art${on ? " on" : ""}${twin ? " is-dup" : ""}" data-id="${esc(a.id)}">
        <input type="checkbox" id="c-${esc(a.id)}" ${on ? "checked" : ""} aria-label="${esc(a.title)} 넣기">
        <div class="art-b">
          <div class="art-m">${esc(a.source || "직접 넣은 기사")} · ${esc(a.time || "방금")}${on ? ` · <b>${st.pick.indexOf(a.id) + 1}번째</b>` : ""}</div>
          <button type="button" class="art-t" data-open aria-expanded="${open}">${esc(a.title)}</button>
          <div class="art-tags"><span class="tag">숫자 ${nums}개</span>${twin ? `<span class="tag dup">같은 소식 · ${twin}번 기사</span>` : ""}</div>
          ${open ? `<p class="art-body">${paintNums(a.body, a.body)}</p>` : ""}
        </div>
      </li>`;
    }).join("");
    $("pickInfo").textContent = st.pick.length ? `${st.pick.length}건을 요약해요` : "기사를 하나 이상 고르세요";
    $("run").disabled = !st.pick.length;
    $("run").textContent = st.pick.length ? `${st.pick.length}건 요약하기` : "요약하기";
  }
  $("arts").addEventListener("change", (e) => {
    const li = e.target.closest("li.art");
    if (!li || e.target.type !== "checkbox") return;
    const id = li.dataset.id;
    const dup = L.findDuplicates(all());
    st.pick = e.target.checked ? st.pick.concat(id) : st.pick.filter((x) => x !== id);
    save(); renderInbox(); renderIssue();
    document.getElementById(`c-${id}`)?.focus();
    if (e.target.checked && (dup[id] && st.pick.includes(dup[id]) || Object.entries(dup).some(([k, v]) => v === id && st.pick.includes(k)))) toast("같은 소식을 다룬 기사가 이미 들어 있어요. 하나만 남기는 걸 권해요");
    if (e.target.checked && st.result && !st.result.items.some((x) => x.id === id)) toast("새로 고른 기사는 '요약하기'를 다시 누르면 들어가요");
  });
  $("arts").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-open]");
    if (!b) return;
    const id = b.closest("li.art").dataset.id;
    st.open = st.open === id ? "" : id;
    renderInbox();
    document.querySelector(`li.art[data-id="${CSS.escape(id)}"] button[data-open]`)?.focus();
  });
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("addTitle").value.trim(), body = $("addBody").value.trim();
    if (!title || !body) return;
    const id = `u${Date.now().toString(36)}`;
    st.added.push({ id, source: $("addSrc").value.trim() || "직접 넣은 기사", time: "방금", title, body });
    st.pick.push(id);
    $("addForm").reset(); $("addBox").open = false;
    save(); renderInbox();
    toast("목록 맨 아래에 넣었어요. '요약하기'를 누르세요");
  });

  /* ---------- 오른쪽: 오늘 호 ---------- */
  function renderMode() {
    let h;
    if (waiting) h = `<span class="mode" data-mode="wait"><i></i>Claude가 요약하는 중</span>`;
    else if (!st.result) h = "";
    else if (st.result.mode === "ai") h = `<span class="mode" data-mode="ai">Claude로 요약 · ${(st.result.ms / 1000).toFixed(1)}초</span>`;
    else h = `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 원문 문장을 골라 썼어요">규칙 기반${st.result.reason ? ` · ${esc(st.result.reason)}` : ""}</span>`;
    $("modeChip").innerHTML = h;
  }
  function renderIssue() {
    renderMode();
    document.querySelectorAll("[data-tier]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tier === st.tier)));
    const list = L.issueFor(items(), st.tier);
    const paper = $("paper");
    if (!st.result) {
      paper.innerHTML = `<div class="empty"><b>아직 요약하지 않았어요</b>기사를 고르고 '요약하기'를 누르면 오늘 호가 만들어져요.</div>`;
      $("readTime").textContent = ""; $("check").innerHTML = ""; $("rejected").hidden = true; renderScore([]);
      return;
    }
    paper.classList.toggle("waiting", waiting);
    const full = items();
    paper.innerHTML = `<div class="p-head"><b>${esc(issueName)}</b>${st.result.intro ? `<p>${esc(st.result.intro)}</p>` : `<p>오늘 고른 물류 소식 ${full.length}건입니다.</p>`}</div>` +
      list.map((it, i) => {
        const a = byId(it.id) || { body: "", title: "" };
        const src = a.title + " " + a.body;
        const pts = it.points.map((p, k) => editing && editing.id === it.id && editing.k === k
          ? `<li class="pt editing"><label class="sr" for="ed">문장 고치기</label><input id="ed" value="${esc(p)}" data-id="${esc(it.id)}" data-k="${k}"></li>`
          : `<li class="pt"><span>${paintNums(p, src)}</span><button type="button" class="mini" data-edit="${esc(it.id)}:${k}" aria-label="${i + 1}번 기사 ${k + 1}번째 문장 고치기">고치기</button></li>`).join("");
        return `<article class="item${it.fellBack ? " fell" : ""}" data-id="${esc(it.id)}">
          <div class="it-m"><span class="n">${i + 1}</span>${esc(a.source || "")}${it.by === "rule" ? `<span class="by">원문 문장</span>` : `<span class="by ai">Claude 요약</span>`}
            <span class="mv"><button type="button" data-mv="-1" aria-label="위로" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" data-mv="1" aria-label="아래로" ${i === list.length - 1 ? "disabled" : ""}>↓</button></span></div>
          <h3>${paintNums(it.headline, src)}</h3>
          <ul>${pts}</ul>
          ${it.why ? `<p class="why">→ ${paintNums(it.why, src)}</p>` : ""}
        </article>`;
      }).join("") +
      (st.tier === "free" && full.length > list.length ? `<div class="lock">나머지 ${full.length - list.length}건과 해설은 유료 구독(월 5,900원)에서 볼 수 있어요.</div>` : "");
    $("readTime").textContent = `읽는 시간 약 ${L.readMinutes(list)}분`;
    renderCheck(full);
    renderScore(full);
    const rj = st.result.rejected || [];
    $("rejected").hidden = !rj.length;
    $("rejected").innerHTML = rj.length ? `<details><summary>원문과 숫자가 달라 뺀 Claude 문장 ${rj.length}개</summary><ul>${rj.map((r) => `<li>${esc(r.text)} <span class="bad-n">원문에 없음: ${r.bad.map(esc).join(", ")}</span></li>`).join("")}</ul></details>` : "";
    document.getElementById("ed")?.focus();
  }
  function renderCheck(full) {
    const c = L.sendCheck(full, all());
    $("check").className = `check ${c.ready ? "ok" : "no"}`;
    $("check").innerHTML = c.ready
      ? `<b>숫자 검사 통과</b> 모든 숫자가 원문 표기와 같아요. 보낼 수 있어요.`
      : `<b>원문과 다른 숫자 ${c.problems.length}건</b> ${c.problems.slice(0, 3).map((p) => `‘${esc(p.bad.join(", "))}’`).join(" · ")} — 고치기 전에는 보낼 수 없어요.`;
    $("send").disabled = !c.ready || waiting;
  }
  function renderScore(full) {
    let good = 0, n = 0;
    full.forEach((it) => {
      const a = byId(it.id); if (!a) return;
      [it.headline, ...it.points, it.why].filter(Boolean).forEach((t) => { const c = L.checkNumbers(t, a.title + " " + a.body); good += c.good.length; n += c.good.length + c.bad.length; });
    });
    $("numScore").textContent = n ? `${good}/${n}` : "—";
  }

  $("paper").addEventListener("click", (e) => {
    const ed = e.target.closest("button[data-edit]");
    if (ed) { const [id, k] = ed.dataset.edit.split(":"); editing = { id, k: Number(k) }; renderIssue(); return; }
    const mv = e.target.closest("button[data-mv]");
    if (mv) {
      const id = mv.closest(".item").dataset.id;
      const ids = L.issueFor(items(), st.tier).map((x) => x.id);
      const i = ids.indexOf(id), j = i + Number(mv.dataset.mv);
      if (j < 0 || j >= ids.length) return;
      const pi = st.pick.indexOf(id), pj = st.pick.indexOf(ids[j]);
      [st.pick[pi], st.pick[pj]] = [st.pick[pj], st.pick[pi]];
      save(); renderInbox(); renderIssue();
      document.querySelector(`.item[data-id="${CSS.escape(id)}"] button[data-mv="${mv.dataset.mv}"]:not(:disabled)`)?.focus();
    }
  });
  function commitEdit(inp, keep) {
    const id = inp.dataset.id, k = Number(inp.dataset.k);
    const base = items().find((x) => x.id === id);
    if (!base) return;
    const before = JSON.stringify(st.edits);
    const pts = base.points.slice();
    const v = inp.value.trim();
    if (keep && v && v !== pts[k]) {
      pts[k] = v;
      st.edits[id] = { ...(st.edits[id] || {}), points: pts };
      const c = L.checkNumbers(v, (byId(id).title || "") + " " + byId(id).body);
      toast(c.ok ? "고쳤어요" : `원문에 없는 숫자예요: ${c.bad.join(", ")}`, () => { st.edits = JSON.parse(before); save(); renderIssue(); });
    }
    editing = null;
    save(); renderIssue();
    document.querySelector(`button[data-edit="${CSS.escape(id + ":" + k)}"]`)?.focus();
  }
  $("paper").addEventListener("keydown", (e) => {
    if (e.target.id !== "ed") return;
    if (e.key === "Enter") { e.preventDefault(); commitEdit(e.target, true); }
    if (e.key === "Escape") commitEdit(e.target, false);
  });
  $("paper").addEventListener("focusout", (e) => { if (e.target.id === "ed" && editing) commitEdit(e.target, true); });
  document.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tier]"); if (!b) return;
    st.tier = b.dataset.tier; save(); renderIssue();
  });

  /* ---------- 내보내기 ---------- */
  function exportList() { return L.issueFor(items(), st.tier); }
  $("copyHtml").addEventListener("click", async () => {
    if (!st.result) { toast("먼저 요약해 주세요"); return; }
    const html = L.toEmailHtml(issueName, st.result.intro, exportList(), all(), ACCENT);
    $("htmlOut").textContent = html; $("htmlBox").hidden = false;
    try { await navigator.clipboard.writeText(html); toast(`${st.tier === "paid" ? "유료판" : "무료판"} 메일 HTML을 복사했어요`); }
    catch (e) { $("htmlBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("dlText").addEventListener("click", () => {
    if (!st.result) { toast("먼저 요약해 주세요"); return; }
    const txt = L.toText(issueName, st.result.intro, exportList(), all());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
    a.download = `아침한장-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${st.tier}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("텍스트 파일로 내려받았어요");
  });
  $("send").addEventListener("click", () => {
    const c = L.sendCheck(items(), all());
    if (!c.ready) { toast("원문과 다른 숫자를 먼저 고쳐 주세요"); return; }
    toast(`발송 대기열에 올렸어요 · 무료판 1,144명 · 유료판 96명 (데모라 실제로 보내지 않아요)`);
  });

  /* ---------- 요약하기 ---------- */
  async function run(opts) {
    const arts = picked();
    if (!arts.length) { toast("기사를 하나 이상 고르세요"); return; }
    const my = ++runToken;
    const prev = { result: st.result, edits: st.edits };
    st.result = { items: arts.map((a) => L.ruleSummary(a)), intro: "", mode: "rule", reason: "", rejected: [] };
    st.edits = {}; editing = null;
    waiting = AI.status().enabled !== false;
    renderIssue();
    const r = await AI.ask("newsdigest.summarize", { articles: arts.map((a) => ({ id: a.id, title: a.title, body: a.body.slice(0, 900) })) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeDigest(r.data, arts);
    if (n) st.result = { ...n, mode: "ai", ms: r.ms };
    else st.result.reason = r ? "응답 형식이 맞지 않음" : (AI.status().reason || "");
    save(); renderIssue();
    const rj = st.result.rejected.length;
    if (opts && opts.quiet) return;
    toast(`${st.result.mode === "ai" ? "Claude가" : "원문 문장으로"} ${st.result.items.length}건을 요약했어요${rj ? ` · 숫자가 다른 문장 ${rj}개는 뺐어요` : ""}`,
      prev.result ? () => { runToken++; waiting = false; st.result = prev.result; st.edits = prev.edits; save(); renderIssue(); } : null);
  }
  $("run").addEventListener("click", () => run());
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); renderInbox(); run();
    toast("샘플 기사로 되돌렸어요", () => { runToken++; waiting = false; st = before; save(); renderInbox(); renderIssue(); });
  });

  /* ---------- 시작 ---------- */
  renderInbox(); renderIssue();
  AI.probe().then(() => { if (!st.result) run({ quiet: true }); else renderIssue(); });
})();
