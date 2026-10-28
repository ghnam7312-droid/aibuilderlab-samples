/* 분수콕 — 화면 (DOM 다루기만 한다. 채점·분류·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * 교사 화면: 반 전체 학생 × 오개념 5유형 표. 학생을 고르면
 *   1) 규칙 설명(유형별 이유 + 지도 활동)을 바로 보여 주고
 *   2) Claude에게 '번호와 고른 선지'만 보내 설명을 다시 받는다. 형식이 틀리면 1)을 그대로 둔다.
 * 학생 풀이 화면: 주소는 #/solve/07 처럼 번호만. 제출하면 교사 화면에 바로 반영된다.
 * 이름은 교사 화면의 명단(ROSTER)에서만 붙인다. 저장소·주소·CSV·AI 입력에는 들어가지 않는다.
 */
(function () {
  "use strict";
  const L = window.Bunsukok;
  const STORE_KEY = "career-fraction-quiz-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 (가상의 반) ---------- */
  // 교사만 보는 명단. 이 배열은 저장하지 않고, 화면에서 번호 옆에 붙일 때만 쓴다
  const ROSTER = ["강다온", "고은재", "김서진", "남하람", "문채윤", "박도하", "배시우", "서지안", "송유나", "신이든", "오하율", "유태오",
    "윤소이", "이건우", "임라온", "장민서", "정우주", "조하린", "차은호", "최다인", "한지율", "허승아", "홍예준", "황보미"].map((name, i) => ({ no: i + 1, name }));
  const SAMPLE = ["3100100011", "1110020000", "0211000000", "1100000100", "0000010000", "0100110030", "0000001100", "3100100000", "0011000000", "2000200003", "2010000000", "3101220000",
    "0000001200", "0011000000", "0020110023", "3100000010", "0000020030", "0020110101", "0011000000", "1100000000", "0220000013", "0000002100", "1101000031", "0100020000"];

  function seed() {
    const answers = {};
    SAMPLE.forEach((s, i) => { answers[i + 1] = s.split("").map(Number); });
    return { answers, hideNames: false, filter: "", sel: 12 };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.answers && typeof v.answers === "object") return { ...seed(), ...v };
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ answers: st.answers, hideNames: st.hideNames, filter: st.filter, sel: st.sel })); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  const expl = {};   // 번호 → { key, data, mode, ms, reason, waiting }
  let token = 0;
  let draft = {};    // 학생 풀이 중인 답

  const students = () => ROSTER.filter((r) => Array.isArray(st.answers[r.no])).map((r) => ({ no: r.no, answers: st.answers[r.no] }));
  const nameOf = (no) => (ROSTER.find((r) => r.no === no) || {}).name || "";
  const shownName = (no) => (st.hideNames ? "○○○" : nameOf(no));

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

  /* ---------- 그림 선지 ---------- */
  function fig(kind) {
    const cells = { q4: [[0, 16, 1], [16, 16, 0], [32, 16, 0], [48, 16, 0]], u4: [[0, 8, 1], [8, 26, 0], [34, 12, 0], [46, 18, 0]], q3: [[0, 21.3, 1], [21.3, 21.3, 0], [42.6, 21.4, 0]], q4b: [[0, 16, 1], [16, 16, 1], [32, 16, 0], [48, 16, 0]] }[kind];
    return `<svg viewBox="-1 -1 66 42" role="img" aria-label="${esc(L.FIG_LABEL[kind])}">${cells.map(([x, w, on]) => `<rect x="${x}" y="0" width="${w}" height="40" fill="${on ? "#12866A" : "#fff"}" stroke="#1A1D1B" stroke-width="1.4"/>`).join("")}</svg>`;
  }
  const optText = (q, i) => (q.fig ? L.FIG_LABEL[q.o[i]] : q.o[i]);

  /* ---------- 교사 화면 ---------- */
  function renderStats() {
    const s = L.classSummary(students());
    const sure = L.TYPE_KEYS.reduce((n, k) => n + s.byType[k].sure, 0);
    $("stats").innerHTML = `
      <div class="stat"><small>응시</small><b>${s.n}<span>/ ${ROSTER.length}명</span></b></div>
      <div class="stat"><small>평균 점수</small><b>${s.avg}<span>점</span></b></div>
      <div class="stat"><small>가장 많은 오개념</small><b style="font-size:17px">${s.top ? esc(L.TYPES[s.top].short) : "없음"}<span>${s.top ? `${s.byType[s.top].sure}명` : ""}</span></b></div>
      <div class="stat"><small>분류된 오개념 (확실)</small><b>${sure}<span>건 · 채점 즉시</span></b></div>`;
    $("types").innerHTML = L.TYPE_KEYS.map((k) => {
      const b = s.byType[k];
      const pct = s.n ? Math.round((b.sure / s.n) * 100) : 0;
      return `<button type="button" class="ty${k === s.top ? " top" : ""}" data-type="${k}" aria-pressed="${st.filter === k}" title="${esc(L.TYPES[k].hint)}">
        <b>${esc(L.TYPES[k].label)}</b><span class="n">확실 ${b.sure}명 · 의심 ${b.maybe}명</span><span class="meter"><i style="width:${pct}%"></i></span></button>`;
    }).join("");
  }
  function renderMatrix() {
    $("mxHead").innerHTML = `<tr><th class="l">번호</th><th class="l nm">이름</th><th>점수</th>${L.TYPE_KEYS.map((k) => `<th title="${esc(L.TYPES[k].label)}">${esc(L.TYPES[k].short)}</th>`).join("")}</tr>`;
    const rows = students().map((s) => ({ s, g: L.grade(s.answers) })).filter(({ g }) => !st.filter || g.counts[st.filter] > 0);
    $("mxBody").innerHTML = rows.map(({ s, g }) => `<tr data-no="${s.no}" aria-selected="${st.sel === s.no}">
        <td class="l no"><button type="button" class="pick" data-no="${s.no}" aria-label="${s.no}번 자세히 보기">${L.pad(s.no)}</button></td>
        <td class="l nm${st.hideNames ? " hid" : ""}">${esc(shownName(s.no))}</td>
        <td class="sc${g.score < 60 ? " low" : ""}">${g.score}</td>
        ${L.TYPE_KEYS.map((k) => `<td>${g.counts[k] >= 2 ? `<span class="dot" aria-label="확실">●</span>` : g.counts[k] ? `<span class="dot m" aria-label="의심">○</span>` : ""}</td>`).join("")}
      </tr>`).join("") || `<tr><td colspan="8">이 유형이 나온 학생이 없어요.</td></tr>`;
  }
  function modeChip(e) {
    if (e.waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 읽는 중</span>`;
    if (e.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 설명 · ${(e.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="선지마다 붙여 둔 오개념 표시로 설명했어요">규칙 기반${e.reason ? ` · ${esc(e.reason)}` : ""}</span>`;
  }
  function renderDetail() {
    const box = $("detail");
    const ans = st.answers[st.sel];
    if (!ans) { box.innerHTML = `<p class="lead">왼쪽 표에서 학생 번호를 누르세요.</p>`; return; }
    const g = L.grade(ans);
    const e = expl[st.sel] || { mode: "rule", data: L.ruleExplain({ no: st.sel, answers: ans }) };
    const link = L.studentLink(location.href, st.sel);
    const safe = L.addressSafe(link, ROSTER);
    box.innerHTML = `
      <div class="d-h"><h2>${L.pad(st.sel)}번<small>${esc(shownName(st.sel))}</small></h2><b>${g.score}점</b></div>
      <ol class="ans" aria-label="문항별 답">${g.items.map((x) => {
        const q = L.QUESTIONS[x.q - 1];
        const cls = x.ok ? "" : x.tag === "blank" ? "b" : x.tag === "etc" ? "e" : "x";
        const lab = x.ok ? "정답" : x.tag === "blank" ? "안 풂" : x.tag === "etc" ? "실수" : L.TYPES[x.tag].short;
        return `<li class="${cls}" title="${esc(q.ask)} → ${esc(x.picked >= 0 ? optText(q, x.picked) : "안 풂")}">${x.q}번<span>${esc(lab)}</span></li>`;
      }).join("")}</ol>
      <div class="ex-h"><h3>왜 틀렸을까</h3>${modeChip(e)}</div>
      <div class="${e.waiting ? "res-wait" : ""}">
        <p class="sum">${esc(e.data.summary)}</p>
        <ul class="ex">${e.data.types.map((t) => `<li><b>${esc(L.TYPES[t.type].label)}</b><p>${esc(t.why)}</p><p class="act">지도 활동 · ${esc(t.activity)}</p></li>`).join("")}</ul>
        ${e.data.talk ? `<p class="talk">아이에게 물어보기 · ${esc(e.data.talk)}</p>` : ""}
      </div>
      <div class="link-row"><span>풀이 주소</span><code>${esc(link.replace(/^.*#/, "…#"))}</code><span class="safe">${safe ? "이름 없음 ✓" : "이름 포함 — 복사 막음"}</span>
        <button class="ghost-btn" type="button" id="copyLink" ${safe ? "" : "disabled"}>주소 복사</button>
        <button class="primary sm" type="button" id="reExplain">설명 다시 받기</button></div>`;
  }
  function renderTeacher() {
    $("hideNames").checked = st.hideNames;
    renderStats(); renderMatrix(); renderDetail();
  }

  async function explain(no, force) {
    const ans = st.answers[no];
    if (!ans) return;
    const key = ans.join("");
    if (!force && expl[no] && expl[no].key === key && !expl[no].waiting) { renderDetail(); return; }
    const my = ++token;
    expl[no] = { key, mode: "rule", reason: "", data: L.ruleExplain({ no, answers: ans }), waiting: AI.status().enabled !== false };
    renderDetail();
    const r = await AI.ask("fractionquiz.explain", L.aiInput({ no, answers: ans }));
    if (my !== token) { if (expl[no]) expl[no].waiting = false; return; } // 그 사이 다른 학생을 골랐으면 버린다
    const n = r && L.normalizeExplain(r.data, L.grade(ans).counts);
    expl[no] = n ? { key, mode: "ai", ms: r.ms, data: n } : { ...expl[no], waiting: false, reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    if (st.sel === no) renderDetail();
  }
  function select(no) {
    st.sel = no; save();
    renderMatrix();
    explain(no);
  }

  $("mxBody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-no]"); if (tr) select(Number(tr.dataset.no)); });
  $("types").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-type]"); if (!b) return;
    st.filter = st.filter === b.dataset.type ? "" : b.dataset.type; save();
    renderStats(); renderMatrix();
    if (st.filter) toast(`${L.TYPES[st.filter].label} — ${$("mxBody").querySelectorAll("tr[data-no]").length}명`);
  });
  $("hideNames").addEventListener("change", (e) => { st.hideNames = e.target.checked; save(); renderMatrix(); renderDetail(); });
  $("detail").addEventListener("click", async (e) => {
    if (e.target.id === "reExplain") { explain(st.sel, true); return; }
    if (e.target.id !== "copyLink") return;
    const link = L.studentLink(location.href, st.sel);
    if (!L.addressSafe(link, ROSTER)) return;
    try { await navigator.clipboard.writeText(link); toast(`${L.pad(st.sel)}번 풀이 주소를 복사했어요 (번호만 들어 있어요)`); }
    catch (err) { toast(`주소: ${link}`); }
  });
  $("csv").addEventListener("click", () => {
    const csv = L.toCsv(students());
    if (!L.addressSafe(csv, ROSTER)) { toast("내보낼 내용에 이름이 있어 멈췄어요"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "bunsukok-results.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${students().length}명 결과를 내려받았어요 (번호·점수·유형만)`);
  });

  /* ---------- 학생 풀이 화면 ---------- */
  let solveNo = 0;
  function renderSolve(no) {
    solveNo = no || solveNo || 1;
    $("solveNo").innerHTML = ROSTER.map((r) => `<option value="${r.no}"${r.no === solveNo ? " selected" : ""}>${L.pad(r.no)}번</option>`).join("");
    const link = L.studentLink(location.href, solveNo);
    $("addr").innerHTML = `이 화면 주소 <b>${esc(link.replace(/^.*#/, "…#"))}</b> · 번호만 들어가고 이름은 들어가지 않아요`;
    draft = {};
    $("quiz").innerHTML = L.QUESTIONS.map((q, qi) => `<fieldset class="q" id="q${qi}">
        <legend><span>${q.id}.</span>${esc(q.ask)}</legend>
        <div class="opts">${q.o.map((o, i) => `<label class="opt"><input type="radio" name="a${qi}" value="${i}">${q.fig ? fig(o) : esc(o)}</label>`).join("")}</div>
      </fieldset>`).join("") + `<div class="solve-foot"><span id="left">10문항 남았어요</span><button class="primary" type="submit">다 풀었어요</button></div>`;
  }
  $("quiz").addEventListener("change", (e) => {
    const m = e.target.name && e.target.name.match(/^a(\d+)$/); if (!m) return;
    draft[m[1]] = Number(e.target.value);
    $(`q${m[1]}`).classList.remove("miss");
    const left = L.QUESTIONS.length - Object.keys(draft).length;
    $("left").textContent = left ? `${left}문항 남았어요` : "다 골랐어요";
  });
  $("quiz").addEventListener("submit", (e) => {
    e.preventDefault();
    const miss = L.QUESTIONS.map((q, i) => i).filter((i) => draft[i] === undefined);
    if (miss.length) {
      miss.forEach((i) => $(`q${i}`).classList.add("miss"));
      $(`q${miss[0]}`).scrollIntoView({ block: "center" });
      toast(`${miss.map((i) => i + 1).join(", ")}번을 아직 안 골랐어요`);
      return;
    }
    const no = solveNo;
    const before = st.answers[no];
    st.answers[no] = L.QUESTIONS.map((q, i) => draft[i]);
    delete expl[no];
    st.sel = no; save();
    const g = L.grade(st.answers[no]);
    $("quiz").innerHTML = `<div class="done-box"><b>다 풀었어요! ${g.score}점</b><p class="lead">선생님이 왜 틀렸는지 함께 볼 거예요.</p>
      <button class="ghost-btn" type="button" id="again">다시 풀기</button> <button class="primary sm" type="button" id="toTeacher">교사 화면에서 보기</button></div>`;
    toast(`${L.pad(no)}번 답을 교사 화면에 반영했어요`, () => { if (before) st.answers[no] = before; else delete st.answers[no]; delete expl[no]; save(); renderTeacher(); });
  });
  $("quiz").addEventListener("click", (e) => {
    if (e.target.id === "again") renderSolve(solveNo);
    if (e.target.id === "toTeacher") go("#/teacher");
  });
  $("solveNo").addEventListener("change", (e) => go(`#/solve/${L.pad(e.target.value)}`));

  /* ---------- 화면 전환 (주소에는 번호만) ---------- */
  function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
  function route() {
    const r = L.parseHash(location.hash);
    if (!L.addressSafe(location.hash, ROSTER)) { history.replaceState(null, "", "#/teacher"); }
    const solve = r.view === "solve";
    $("vTeacher").hidden = solve; $("vSolve").hidden = !solve;
    $("tabT").setAttribute("aria-selected", String(!solve)); $("tabS").setAttribute("aria-selected", String(solve));
    if (solve) renderSolve(r.no >= 1 && r.no <= ROSTER.length ? r.no : 1);
    else { renderTeacher(); explain(st.sel); }
  }
  $("tabT").addEventListener("click", () => go("#/teacher"));
  $("tabS").addEventListener("click", () => go(`#/solve/${L.pad(st.sel || 1)}`));
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = $("tabT").getAttribute("aria-selected") === "true" ? $("tabS") : $("tabT");
    next.focus(); next.click();
  });
  window.addEventListener("hashchange", route);

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed();
    Object.keys(expl).forEach((k) => delete expl[k]);
    save(); go("#/teacher"); renderTeacher(); explain(st.sel);
    toast("샘플 반으로 되돌렸어요", () => { st = before; save(); renderTeacher(); explain(st.sel); });
  });

  /* ---------- 시작 ---------- */
  AI.probe().then(() => { if (!$("vTeacher").hidden) explain(st.sel, true); });
  route();
})();
