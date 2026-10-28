/* 차곡퀴즈 — 화면 (DOM 다루기만 한다. 차시 나누기·문항 만들기·자동 확인·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * '퀴즈 만들기'를 누르면
 *   1) 규칙으로 바로 문항을 만들어 보여 주고 (기다리지 않게)
 *   2) Claude에게 같은 자료를 보내 다시 만든다. 형식이 맞으면 덮어쓰고, 아니면 1)을 그대로 둔다.
 * 어느 쪽이든 모든 문항은 '정답 근거 문장'을 달고 자동 확인을 거친 뒤, 사람이 통과·고치기·제외로 검토한다.
 */
(function () {
  "use strict";
  const L = window.Chagok;
  const STORE_KEY = "career-quiz-maker-v1";
  const MARK = ["①", "②", "③", "④"];
  const ST_LABEL = { pass: "통과", fix: "고쳐서 통과", drop: "제외" };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 샘플 자료 (가상의 중1 과학 수업, 3차시) ---------- */
  const SAMPLE = `## 1차시 물질의 세 가지 상태
물질은 고체, 액체, 기체의 세 가지 상태로 존재한다. 고체는 모양과 부피가 일정한 상태이다. 액체는 부피는 일정하지만 담는 그릇에 따라 모양이 변하는 상태이다. 기체는 모양과 부피가 모두 일정하지 않은 상태이다. 물질을 이루는 매우 작은 알갱이를 입자라고 한다.

## 2차시 상태 변화의 종류
고체가 액체로 변하는 현상을 융해라고 한다. 액체가 고체로 변하는 현상을 응고라고 한다. 액체가 기체로 변하는 현상을 기화라고 한다. 액체 표면에서 기화가 일어나는 현상을 증발이라고 한다. 액체 내부에서도 기화가 활발하게 일어나는 현상을 끓음이라고 한다. 기체가 액체로 변하는 현상을 액화라고 한다. 고체가 기체로 바로 변하는 현상을 승화라고 한다.

## 3차시 상태 변화와 열에너지
융해와 기화가 일어날 때 물질은 주변에서 열에너지를 흡수한다. 응고와 액화가 일어날 때 물질은 주변으로 열에너지를 방출한다. 고체가 녹기 시작하는 온도를 녹는점이라고 한다. 액체가 끓기 시작하는 온도를 끓는점이라고 한다. 상태 변화에 쓰여 온도를 바꾸지 않는 열에너지를 숨은열이라고 한다.`;

  /* ---------- 상태 ---------- */
  function seed() { return { src: SAMPLE, per: 4, questions: [], review: {}, lesson: "all", ai: { mode: "rule", reason: "" }, ran: false }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.src === "string" && Array.isArray(v.questions) && v.review) return { ...seed(), ...v };
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;
  let editing = "";
  let lessons = L.splitLessons(st.src);

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

  /* ---------- 왼쪽 ---------- */
  function renderSrcInfo() {
    const ls = L.splitLessons($("src").value);
    $("srcInfo").textContent = `${ls.length}차시 · ${ls.reduce((n, l) => n + l.sentences.length, 0)}문장`;
    document.querySelectorAll("[data-per]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.per) === st.per)));
  }

  /* ---------- 오른쪽: 검토표 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 만드는 중</span>`;
    if (st.ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 생성 · ${(st.ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="‘□□라고 한다’, ‘□□는 ○○이다’ 문장으로 만들었어요">규칙 기반${st.ai.reason ? ` · ${esc(st.ai.reason)}` : ""}</span>`;
  }
  /** 근거 문장에서 정답(굵게)과 근거에 같이 나온 다른 선지(주의)를 칠한다 */
  function markEvidence(q) {
    let html = esc(q.evidence || "(근거 없음)");
    if (q.kind !== "choice") return html;
    q.options.forEach((o, i) => {
      const t = esc(o);
      if (t.length < 2 || !html.includes(t)) return;
      html = html.split(t).join(`<mark class="${i === q.answer ? "a" : "o"}">${t}</mark>`);
    });
    return html;
  }
  function renderSummary() {
    const s = L.reviewStats(st.questions, st.review);
    const warn = st.questions.filter((q) => !L.checkQuestion(q, lessons).ok).length;
    $("sum").innerHTML = `
      <div class="kpi"><small>문항</small><b>${s.total}</b></div>
      <div class="kpi${warn ? " warn" : ""}"><small>자동 확인 경고</small><b>${warn}</b></div>
      <div class="kpi"><small>검토</small><b>${s.done}<span>/ ${s.total}</span></b><i class="prog"><i style="width:${s.total ? Math.round((s.done / s.total) * 100) : 0}%"></i></i></div>
      <div class="kpi${s.done && s.rate < 88 ? " warn" : ""}"><small>통과율 (목표 88%)</small><b>${s.done ? `${s.rate}%` : "—"}</b></div>
      <p class="goal">1기 목표치 · 차시당 퀴즈 <b>1시간 → 12분</b> · 문항 검토 통과율 <b>88%</b></p>`;
  }
  function renderLessons() {
    const items = [["all", "전체"], ...lessons.map((l) => [String(l.no), `${l.no}차시`])];
    if (!items.some(([k]) => k === st.lesson)) st.lesson = "all";
    $("lessons").innerHTML = items.map(([k, label]) => {
      const n = st.questions.filter((q) => k === "all" || String(q.lesson) === k).length;
      return `<button type="button" data-lesson="${k}" aria-pressed="${st.lesson === k}">${esc(label)} <span>${n}</span></button>`;
    }).join("");
  }
  function qCard(q) {
    const c = L.checkQuestion(q, lessons);
    const r = st.review[q.id] || "";
    const title = (lessons.find((l) => l.no === q.lesson) || {}).title || "";
    if (editing === q.id) return `<li class="q editing" data-id="${esc(q.id)}">
      <div class="q-h"><span class="qid">${q.lesson}차시 · ${esc(q.id.split("-")[1])}</span><span class="kind">고치는 중</span></div>
      <label class="fld"><span>문항</span><input data-f="stem" value="${esc(q.stem)}"></label>
      <fieldset class="fld opts-ed"><legend>선지 · 정답 고르기</legend>${q.options.map((o, i) => `<div><input type="radio" name="ans-${esc(q.id)}" value="${i}" ${i === q.answer ? "checked" : ""} aria-label="${i + 1}번을 정답으로"><input data-f="opt" data-i="${i}" value="${esc(o)}" aria-label="선지 ${i + 1}" ${q.kind === "ox" ? "readonly" : ""}></div>`).join("")}</fieldset>
      <label class="fld"><span>정답 근거 문장 (자료에서 그대로)</span><textarea data-f="evidence" rows="2">${esc(q.evidence)}</textarea></label>
      <div class="rv"><button type="button" class="primary sm" data-act="save">저장 (고쳐서 통과)</button><button type="button" class="ghost-btn" data-act="cancel">취소</button></div></li>`;
    return `<li class="q${r ? ` r-${r}` : ""}${c.ok ? "" : " flagged"}" data-id="${esc(q.id)}">
      <div class="q-h"><span class="qid" title="${esc(title)}">${q.lesson}차시 · ${esc(q.id.split("-")[1])}</span><span class="kind">${q.kind === "ox" ? "OX" : "객관식"}</span>
        ${c.ok ? `<span class="flag okf">근거 확인</span>` : c.flags.map((f) => `<span class="flag">${esc(L.FLAG[f])}</span>`).join("")}
        ${r ? `<span class="st">${ST_LABEL[r]}</span>` : ""}</div>
      <p class="stem">${esc(q.stem)}</p>
      <ol class="opts">${q.options.map((o, i) => `<li class="${i === q.answer ? "ans" : ""}">${q.kind === "ox" ? "" : MARK[i] + " "}${esc(o)}${i === q.answer ? " <b>정답</b>" : ""}</li>`).join("")}</ol>
      <p class="ev"><span>정답 근거</span>${markEvidence(q)}</p>
      <div class="rv" role="group" aria-label="검토">
        <button type="button" data-act="pass" aria-pressed="${r === "pass"}">통과</button>
        <button type="button" data-act="edit">고치기</button>
        <button type="button" data-act="drop" aria-pressed="${r === "drop"}">제외</button>
      </div></li>`;
  }
  function renderQs() {
    const list = st.questions.filter((q) => st.lesson === "all" || String(q.lesson) === st.lesson);
    $("qs").innerHTML = !st.ran ? `<li class="empty">자료를 넣고 ‘퀴즈 만들기’를 누르세요.</li>`
      : list.map(qCard).join("") || `<li class="empty">이 차시에서 만든 문항이 없어요. “○○을 □□라고 한다” 같은 문장을 넣어 보세요.</li>`;
    $("qs").classList.toggle("waiting", waiting);
  }
  function render() {
    $("modeChip").innerHTML = modeChip();
    renderSrcInfo(); renderSummary(); renderLessons(); renderQs();
  }

  /* ---------- 검토 ---------- */
  $("qs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const li = b.closest("li.q"); const id = li.dataset.id;
    const q = st.questions.find((x) => x.id === id); if (!q) return;
    const act = b.dataset.act;
    const before = st.review[id];
    if (act === "edit") { editing = id; renderQs(); $("qs").querySelector(`li[data-id="${CSS.escape(id)}"] input`)?.focus(); return; }
    if (act === "cancel") { editing = ""; renderQs(); return; }
    if (act === "save") {
      const nq = { ...q, stem: li.querySelector('[data-f="stem"]').value.trim(), evidence: li.querySelector('[data-f="evidence"]').value.trim(),
        options: [...li.querySelectorAll('[data-f="opt"]')].map((x) => x.value.trim()), answer: Number((li.querySelector("input[type=radio]:checked") || {}).value) };
      const c = L.checkQuestion(nq, lessons);
      if (c.flags.includes("shape")) { toast("선지를 모두 채우고, 서로 다르게, 정답을 하나 골라 주세요"); return; }
      Object.assign(q, nq); st.review[id] = "fix"; editing = "";
      save(); render();
      toast(c.ok ? "고쳐서 통과했어요" : `저장했어요 · 아직 확인할 점: ${c.flags.map((f) => L.FLAG[f]).join(", ")}`);
      return;
    }
    if (act === "pass") {
      const c = L.checkQuestion(q, lessons);
      st.review[id] = before === "pass" ? undefined : "pass";
      if (!st.review[id]) delete st.review[id];
      save(); render();
      if (st.review[id] && !c.ok) toast("경고가 있는 문항을 통과했어요. 근거를 읽고 확인했다면 그대로 두세요");
      return;
    }
    if (act === "drop") {
      st.review[id] = "drop"; save(); render();
      toast(`${q.lesson}차시 ${id.split("-")[1]}번을 제외했어요`, () => { if (before) st.review[id] = before; else delete st.review[id]; save(); render(); });
    }
  });
  $("lessons").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-lesson]"); if (!b) return;
    st.lesson = b.dataset.lesson; save(); renderLessons(); renderQs();
  });

  /* ---------- 만들기 ---------- */
  async function run(opts) {
    const text = $("src").value;
    const ls = L.splitLessons(text);
    if (!ls.length) { toast("수업 자료를 먼저 붙여 넣어 주세요"); $("src").focus(); return; }
    const my = ++runToken;
    const before = { ...st, questions: st.questions, review: st.review };
    lessons = ls;
    st.src = text; st.ran = true; editing = "";
    st.questions = L.makeQuestions(ls, st.per);
    st.review = {};
    if (opts && opts.seedReview) st.questions.filter((q) => q.lesson === ls[0].no).forEach((q) => { if (L.checkQuestion(q, ls).ok) st.review[q.id] = "pass"; });
    st.ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    render();

    const r = await AI.ask("quizmaker.generate", { lessons: ls.map((l) => ({ no: l.no, title: l.title, text: l.sentences.join(" ").slice(0, 3000) })), perLesson: st.per });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 이 결과는 버린다
    waiting = false;
    const n = r && L.normalizeGenerated(r.data, ls);
    if (n) { st.questions = n; st.review = {}; st.ai = { mode: "ai", ms: r.ms }; }
    else st.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    save(); render();
    const warn = st.questions.filter((q) => !L.checkQuestion(q, ls).ok).length;
    if (!(opts && opts.quiet)) toast(`${ls.length}차시 ${st.questions.length}문항을 만들었어요${warn ? ` · 먼저 볼 문항 ${warn}개` : ""}`, before.ran ? () => { st = before; lessons = L.splitLessons(st.src); save(); render(); } : null);
  }
  $("run").addEventListener("click", () => run());
  $("src").addEventListener("input", renderSrcInfo);
  $("src").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  document.querySelector(".per").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-per]"); if (!b) return;
    st.per = Number(b.dataset.per); renderSrcInfo(); run();
  });

  /* ---------- 내보내기 ---------- */
  function title() { return `확인 퀴즈 · ${lessons.map((l) => l.title).slice(0, 3).join(" / ")}`; }
  function needUsable() {
    if (L.usable(st.questions, st.review).length) return true;
    toast("통과한 문항이 없어요. 검토표에서 ‘통과’를 먼저 눌러 주세요");
    return false;
  }
  $("copyStudent").addEventListener("click", async () => {
    if (!needUsable()) return;
    const out = L.toStudentText(title(), st.questions, st.review);
    $("mdOut").textContent = out; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(out); toast(`학생용 ${L.usable(st.questions, st.review).length}문항을 복사했어요 (정답 없음)`); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("csv").addEventListener("click", () => {
    if (!needUsable()) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.toCsv(st.questions, st.review)], { type: "text/csv;charset=utf-8" }));
    a.download = "chagok-quiz-teacher.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("교사용 CSV를 내려받았어요 (정답·근거 문장 포함)");
  });
  $("print").addEventListener("click", () => {
    if (!needUsable()) return;
    const list = L.usable(st.questions, st.review);
    $("printSheet").innerHTML = `<h1>${esc(title())}</h1><p>이름: ____________</p>` + [...new Set(list.map((q) => q.lesson))].map((no) =>
      `<h2>${no}차시</h2><ol>${list.filter((q) => q.lesson === no).map((q) => `<li><p>${esc(q.stem)}</p><p>${q.kind === "ox" ? "( O / X )" : q.options.map((o, k) => `${MARK[k]} ${esc(o)}`).join("&nbsp;&nbsp; ")}</p></li>`).join("")}</ol>`).join("");
    window.print();
  });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); $("src").value = st.src;
    run({ seedReview: true, quiet: true });
    toast("샘플 자료로 되돌렸어요", () => { st = before; $("src").value = st.src; lessons = L.splitLessons(st.src); save(); render(); });
  });

  /* ---------- 시작 ---------- */
  $("src").value = st.src;
  render();
  AI.probe().then(() => { if (!st.ran) run({ seedReview: true, quiet: true }); });
  if (!st.ran) setTimeout(() => { if (!st.ran) run({ seedReview: true, quiet: true }); }, reduced() ? 0 : 50);
})();
