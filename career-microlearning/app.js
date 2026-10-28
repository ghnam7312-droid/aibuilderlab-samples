/* 십분설계 — 화면 (DOM 다루기만 한다. 목표 읽기·짝 검사·고치기 규칙·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * 왼쪽: 차시 8개 목록 (목표의 동사·평가 짝·분량을 한눈에)
 * 오른쪽: 고른 차시 고치기. 입력할 때마다 검사가 다시 돈다.
 * '행동 동사로 고치기'를 누르면
 *   1) 규칙 제안을 바로 보여 주고
 *   2) Claude에게 같은 차시를 보내 제안을 받는다. normalizeRewrite 검사를 통과해야 덮어쓴다.
 *   적용은 사람이 누르고, 되돌릴 수 있다.
 */
(function () {
  "use strict";
  const L = window.Sipbun;
  const STORE_KEY = "career-microlearning-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 (가상의 사내 과정) ---------- */
  const COURSE = { title: "신임 파트장을 위한 1:1 면담 기술", audience: "입사 3~7년 차, 처음 팀원을 맡은 파트장 · 출퇴근길 모바일 학습" };
  const SAMPLE = [
    { title: "1:1 면담은 왜 하나", objective: "1:1 면담의 목적을 이해한다.", content: "면담의 세 가지 목적: 관계 쌓기, 성장 돕기, 일의 걸림돌 치우기", assess: { type: "서술형", stem: "" }, seg: { video: 6, practice: 2, quiz: 2 } },
    { title: "면담 전 준비", objective: "면담 전에 확인할 항목 3가지를 고를 수 있다.", content: "지난 면담 메모, 최근 업무 변화, 팀원이 먼저 꺼낸 주제", assess: { type: "선택형", stem: "다음 중 면담 전에 확인할 항목 3가지를 고르시오." }, seg: { video: 5, practice: 3, quiz: 2 } },
    { title: "열린 질문 만들기", objective: "닫힌 질문과 열린 질문을 구분할 수 있다.", content: "‘네/아니오’로 끝나는 질문을 ‘무엇이·어떻게’ 질문으로 바꾸기", assess: { type: "선택형", stem: "다음 질문 중 열린 질문을 구분하여 고르시오." }, seg: { video: 4, practice: 4, quiz: 2 } },
    { title: "경청 신호 보내기", objective: "경청의 중요성을 안다.", content: "고개 끄덕임, 요약해 되묻기, 끼어들지 않기", assess: { type: "서술형", stem: "경청이 중요한 이유를 쓰시오." }, seg: { video: 7, practice: 3, quiz: 2 } },
    { title: "피드백 말하기", objective: "상황-행동-영향 순서로 피드백 문장을 작성할 수 있다.", content: "언제·어디서, 무엇을 했고, 그래서 어떤 영향이 있었는지", assess: { type: "선택형", stem: "다음 중 올바른 피드백 문장을 고르시오." }, seg: { video: 4, practice: 4, quiz: 2 } },
    { title: "어려운 대화 이어 가기", objective: "성과가 낮은 팀원과의 면담 사례에 대화 순서를 적용할 수 있다.", content: "사실 확인 → 팀원 이야기 듣기 → 함께 다음 행동 정하기", assess: { type: "사례 판단", stem: "사례를 읽고 대화 순서를 적용해 첫마디를 고르고 이유를 쓰시오." }, seg: { video: 5, practice: 3, quiz: 2 } },
    { title: "면담 기록 남기기", objective: "면담 기록의 필요성을 인식하고 기록 양식을 익힌다.", content: "합의한 일, 다음 확인 날짜, 팀원이 요청한 지원", assess: { type: "실습 과제", stem: "면담 기록 양식을 채워 보시오." }, seg: { video: 4, practice: 4, quiz: 2 } },
    { title: "다음 면담 계획", objective: "팀원별 다음 면담 계획을 세울 수 있다.", content: "주기, 주제, 준비할 자료", assess: { type: "실습 과제", stem: "팀원 2명의 다음 면담 계획을 세우시오." }, seg: { video: 3, practice: 5, quiz: 2 } },
  ];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function seed() { return { lessons: clone(SAMPLE), sel: 0, onlyIssue: false }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.lessons) && v.lessons.length) return { ...seed(), ...v };
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let sug = null;      // { i, data, mode, ms, reason, waiting }
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

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 표시 도우미 ---------- */
  /** 목표 문장에서 동사를 칠한다: 행동 동사는 초록, 관찰할 수 없는 동사는 빨강 */
  function markObjective(text) {
    let h = esc(text);
    L.VERB_KEYS.forEach((k) => { h = h.replace(new RegExp(L.VERBS[k].re.source, "g"), (m) => `<b class="vb ok">${m}</b>`); });
    return h.replace(new RegExp(L.VAGUE.source, "g"), (m) => `<b class="vb no">${m}</b>`);
  }
  function segBar(l) {
    const s = l.seg || {};
    const total = L.minutes(l);
    const scale = Math.max(12, total);
    const w = (n) => `${((Math.max(0, Number(n) || 0) / scale) * 100).toFixed(1)}%`;
    return `<span class="segbar${total > L.LIMIT ? " over" : ""}" role="img" aria-label="영상 ${s.video}분, 실습 ${s.practice}분, 퀴즈 ${s.quiz}분, 합계 ${total}분">
      <i class="sg v" style="width:${w(s.video)}"></i><i class="sg p" style="width:${w(s.practice)}"></i><i class="sg q" style="width:${w(s.quiz)}"></i>
      <span class="lim" style="left:${((L.LIMIT / scale) * 100).toFixed(1)}%"></span></span><span class="mins${total > L.LIMIT ? " over" : ""}">${total}분</span>`;
  }

  /* ---------- 위: 과정 요약 ---------- */
  function renderKpis() {
    const s = L.summary(st.lessons);
    $("aud").textContent = `대상 · ${COURSE.audience}`;
    const k = (label, v, of, bad) => `<div class="kpi${bad ? " bad" : ""}"><small>${label}</small><b>${v}${of !== undefined ? `<span>/ ${of}</span>` : ""}</b></div>`;
    $("kpis").innerHTML = k("차시 · 총 분량", `${s.n}개`, undefined) .replace("</b>", `<span>${s.total}분</span></b>`) +
      k("측정 가능한 목표", s.measurable, s.n, s.measurable < s.n) + k("목표–평가 짝", s.paired, s.n, s.paired < s.n) +
      k("10분 넘는 차시", s.long, undefined, s.long > 0) + k("제작 준비 완료", s.ready, s.n, false);
  }

  /* ---------- 왼쪽: 차시 목록 ---------- */
  function renderList() {
    $("onlyIssue").checked = st.onlyIssue;
    $("lessons").innerHTML = st.lessons.map((l, i) => {
      const c = L.checkLesson(l);
      if (st.onlyIssue && c.ok && i !== st.sel) return "";
      return `<li class="ls${i === st.sel ? " on" : ""}${c.ok ? " ok" : ""}">
        <button type="button" data-i="${i}" aria-current="${i === st.sel}">
          <span class="nb">${i + 1}</span>
          <span class="body">
            <span class="t">${esc(l.title)}</span>
            <span class="obj">${markObjective(l.objective) || "<em>목표 없음</em>"}</span>
            <span class="as">${esc(l.assess.type)} · ${l.assess.stem ? esc(l.assess.stem) : "<em>평가 문항 없음</em>"}</span>
            <span class="row">${segBar(l)}</span>
          </span>
          <span class="state">${c.ok ? `<span class="pill ok">완료</span>` : `<span class="pill">${c.flags.length}곳 확인</span>`}${c.pair ? `<span class="pair" title="목표와 평가 짝이 맞음">짝 ✓</span>` : ""}</span>
        </button></li>`;
    }).join("") || `<li class="none">확인할 차시가 없어요. 모두 제작 준비 완료!</li>`;
  }

  /* ---------- 오른쪽: 고치기 ---------- */
  function checkRows(l) {
    const c = L.checkLesson(l);
    const a = L.analyzeObjective(l.objective);
    const has = (f) => c.flags.includes(f);
    const row = (ok, title, text) => `<li class="${ok ? "ok" : "no"}"><b>${ok ? "✓" : "!"} ${title}</b><span>${text}</span></li>`;
    const verbText = a.measurable ? `‘${esc(c.verb)}’ · ${L.VERBS[c.verb].level} 단계` : has("vague") ? `‘${esc(a.vague.join("’, ‘"))}’는 학습자가 했는지 볼 수 없어요` : has("multiVerb") ? "목표 하나에 행동 하나만 두세요" : "‘~할 수 있다’로 끝나는 행동 동사를 쓰세요";
    const pairText = c.pair ? `${esc(l.assess.type)}으로 ‘${esc(c.verb)}’를 확인해요` : has("noAssess") ? "평가 문항을 쓰세요" : !a.measurable ? "목표 동사를 먼저 정해야 짝을 볼 수 있어요"
      : `${has("mismatch") ? `‘${esc(c.verb)}’는 ${L.VERBS[c.verb].types.join("·")}으로 확인해요. ` : ""}${has("noAct") ? `문항에 ‘${esc(c.verb.replace(/한다|는다|운다$/, ""))}’ 행동이 들어가야 해요` : ""}`;
    return `<ul class="checks">${row(a.measurable, "목표 동사", verbText)}${row(c.pair, "평가 짝", pairText)}${row(!has("tooLong") && !has("tooShort"), "분량", `${c.total}분 / ${L.LIMIT}분${has("tooLong") ? " — 영상이나 실습을 줄이세요" : has("tooShort") ? " — 5분보다 짧아요" : ""}`)}</ul>`;
  }
  function modeChip(s) {
    if (s.waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다듬는 중</span>`;
    if (s.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 다듬음 · ${(s.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="목표 문장의 낱말로 동사를 고르고, 동사에 맞는 평가 틀을 붙였어요">규칙 기반${s.reason ? ` · ${esc(s.reason)}` : ""}</span>`;
  }
  function sugBox() {
    if (!sug || sug.i !== st.sel) return "";
    const d = sug.data;
    return `<div class="sug${sug.waiting ? " wait" : ""}" aria-live="polite">
      <div class="sug-h"><b>고친 제안</b>${modeChip(sug)}</div>
      <p class="sug-obj">${markObjective(d.objective)}</p>
      <p class="sug-as"><span>${esc(d.assessment.type)}</span>${esc(d.assessment.stem)}</p>
      ${d.reason ? `<p class="sug-why">${esc(d.reason)}</p>` : ""}
      <div class="sug-b"><button class="primary sm" type="button" id="apply" ${sug.waiting ? "disabled" : ""}>적용</button><button class="ghost-btn" type="button" id="dismiss">버리기</button></div></div>`;
  }
  function renderEditor() {
    const l = st.lessons[st.sel];
    const c = L.checkLesson(l);
    $("editor").innerHTML = `
      <div class="ed-h"><h2>${st.sel + 1}차시 고치기</h2>${c.ok ? `<span class="pill ok">제작 준비 완료</span>` : `<span class="pill">${c.flags.length}곳 확인</span>`}</div>
      <div id="checks">${checkRows(l)}</div>
      <button class="primary" type="button" id="rewrite" ${c.measurable && c.pair ? "disabled" : ""}>${c.measurable && c.pair ? "목표와 평가가 짝이 맞아요" : c.measurable ? "평가 문항 짝 맞추기" : "행동 동사로 고치기"}</button>
      <div id="sugWrap">${sugBox()}</div>
      <h3 class="ed-sub">직접 고치기</h3>
      <label class="fld"><span>제목</span><input data-k="title" value="${esc(l.title)}"></label>
      <label class="fld"><span>학습 목표 <small>‘~할 수 있다’로 끝나는 행동 하나</small></span><textarea data-k="objective" rows="2">${esc(l.objective)}</textarea></label>
      <label class="fld"><span>핵심 내용</span><input data-k="content" value="${esc(l.content || "")}"></label>
      <div class="fld-row">
        <label class="fld"><span>평가 유형</span><select data-k="type">${L.TYPES.map((t) => `<option${t === l.assess.type ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        ${["video", "practice", "quiz"].map((k) => `<label class="fld num"><span>${{ video: "영상", practice: "실습", quiz: "퀴즈" }[k]}(분)</span><input type="number" min="0" max="15" inputmode="numeric" data-seg="${k}" value="${Number(l.seg[k]) || 0}"></label>`).join("")}
      </div>
      <label class="fld"><span>평가 문항</span><textarea data-k="stem" rows="2" placeholder="예: 제시된 상황에 맞게 면담 기록을 작성하시오.">${esc(l.assess.stem)}</textarea></label>`;
  }
  function renderAll() { renderKpis(); renderList(); renderEditor(); }
  function refreshLive() {
    // 입력 중에는 편집기 전체를 다시 그리지 않는다 (커서 유지)
    const l = st.lessons[st.sel];
    const c = L.checkLesson(l);
    $("checks").innerHTML = checkRows(l);
    const b = $("rewrite");
    b.disabled = c.measurable && c.pair;
    b.textContent = c.measurable && c.pair ? "목표와 평가가 짝이 맞아요" : c.measurable ? "평가 문항 짝 맞추기" : "행동 동사로 고치기";
    const p = $("editor").querySelector(".ed-h .pill");
    p.className = `pill${c.ok ? " ok" : ""}`; p.textContent = c.ok ? "제작 준비 완료" : `${c.flags.length}곳 확인`;
    renderKpis(); renderList();
  }

  $("editor").addEventListener("input", (e) => {
    const l = st.lessons[st.sel];
    const t = e.target;
    if (t.dataset.k === "type" || t.dataset.k === "stem") l.assess[t.dataset.k] = t.value;
    else if (t.dataset.k) l[t.dataset.k] = t.value;
    else if (t.dataset.seg) l.seg[t.dataset.seg] = Math.max(0, Math.min(30, Number(t.value) || 0));
    else return;
    save(); refreshLive();
  });
  $("editor").addEventListener("click", (e) => {
    if (e.target.id === "rewrite") { rewrite(st.sel); return; }
    if (e.target.id === "dismiss") { sug = null; renderEditor(); return; }
    if (e.target.id !== "apply" || !sug) return;
    const i = sug.i;
    const before = clone(st.lessons[i]);
    st.lessons[i].objective = sug.data.objective;
    st.lessons[i].assess = { ...sug.data.assessment };
    sug = null; save(); renderAll();
    const c = L.checkLesson(st.lessons[i]);
    toast(c.ok ? `${i + 1}차시 목표와 평가를 바꿨어요` : `바꿨어요 · 남은 확인: ${c.flags.map((f) => L.FLAG[f]).join(", ")}`, () => { st.lessons[i] = before; save(); renderAll(); });
  });

  async function rewrite(i) {
    const l = st.lessons[i];
    const my = ++token;
    sug = { i, data: L.ruleRewrite(l), mode: "rule", reason: "", waiting: AI.status().enabled !== false };
    $("sugWrap").innerHTML = sugBox();
    const r = await AI.ask("microlearning.objective", {
      course: COURSE.title, audience: COURSE.audience,
      lesson: { no: i + 1, title: l.title, objective: l.objective, content: l.content || "", assessment: l.assess, minutes: L.minutes(l) },
      verbs: L.VERB_KEYS.map((k) => ({ verb: k, level: L.VERBS[k].level, types: L.VERBS[k].types })),
    });
    if (my !== token || !sug || sug.i !== i) return; // 그 사이 다른 차시로 옮겼으면 버린다
    const n = r && L.normalizeRewrite(r.data);
    sug = n ? { i, data: n, mode: "ai", ms: r.ms } : { ...sug, waiting: false, reason: r ? "응답이 검사를 통과하지 못함" : (AI.status().reason || "") };
    if (st.sel === i && $("sugWrap")) $("sugWrap").innerHTML = sugBox();
  }

  $("lessons").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    st.sel = Number(b.dataset.i); sug = null; token++; save();
    renderList(); renderEditor();
    if (matchMedia("(max-width: 960px)").matches) $("editor").scrollIntoView({ block: "start" });
  });
  $("onlyIssue").addEventListener("change", (e) => { st.onlyIssue = e.target.checked; save(); renderList(); });

  /* ---------- 내보내기 ---------- */
  $("copyMd").addEventListener("click", async () => {
    const md = L.toMarkdown(COURSE, st.lessons);
    $("mdOut").textContent = md; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(md); toast("설계서를 마크다운 표로 복사했어요"); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("print").addEventListener("click", () => window.print());
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); sug = null; save(); renderAll();
    toast("샘플 설계서로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  renderAll();
  // 처음 화면: 고른 차시에 확인할 곳이 있으면 고친 제안을 바로 보여 준다
  AI.probe().then(() => { const c = L.checkLesson(st.lessons[st.sel]); if (!sug && !(c.measurable && c.pair)) rewrite(st.sel); });
})();
