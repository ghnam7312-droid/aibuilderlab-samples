/* 첫주노트 — 화면 (DOM 다루기만 한다. 최신본 고르기·질문 묶기·계획은 logic.js, AI 호출은 ai-client.js)
 *
 * '최신본으로 정리'를 누르면
 *   1) 자료 목록에서 같은 문서끼리 묶어 개정일이 가장 늦은 것만 남기고 (개정일 없는 문서는 '확인 필요')
 *   2) 신입 질문을 규칙(두 글자 조각 겹침)으로 묶어 공통 질문을 바로 보여 준 뒤
 *   3) 질문과 최신본 목록을 Claude 에게 보내 뜻으로 다시 묶는다. 빠진 질문은 따로 붙이고,
 *      최신본이 아닌 자료 연결은 지운다. 급여·계약 질문은 언제나 인사 담당자에게 넘긴다.
 * 아래 확산 계획은 부서 × 단계 칸을 눌러 바꾼다.
 */
(function () {
  "use strict";
  const L = window.Cheotju;
  const STORE_KEY = "ax-onboarding-kit-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플: 가상의 회사 온결물산 4개 부서 ---------- */
  const SAMPLE_DOCS = `부서,문서명,종류,개정일
영업팀,취업규칙,규정,2023-03-01
재무팀,취업규칙(개정),규정,2026-01-01
개발팀,취업규칙,규정,2024-07-01
영업팀,경비 처리 규정,규정,2022-05-10
재무팀,경비 처리 규정_최종,규정,2025-09-15
마케팅팀,경비 처리 규정,규정,2025-09-15
개발팀,사내 시스템 계정 신청 안내,안내,2025-11-03
마케팅팀,사내 시스템 계정 신청 안내,안내,2024-02-20
영업팀,법인카드 사용 안내,안내,2025-04-01
재무팀,법인카드 사용 안내 v2,안내,2026-02-10
개발팀,재택근무 운영 지침,규정,2025-06-01
마케팅팀,재택근무 운영 지침,규정,2023-09-01
영업팀,회의실 예약 방법,안내,2025-01-15
마케팅팀,복리후생 안내,안내,2026-03-02
개발팀,복리후생 안내,안내,2024-03-02
재무팀,보안 서약서 양식,양식,
개발팀,개발 환경 설정 가이드,안내,2026.4.10
영업팀,거래처 응대 매뉴얼,안내,
마케팅팀,출장 신청 절차,규정,2021-08-01
재무팀,출장 신청 절차,규정,2025-12-01
영업팀,연차 신청 절차,안내,2025-02-01
개발팀,연차 신청 절차,안내,`;
  const SAMPLE_QS = `부서,질문
영업팀,법인카드는 어디에 쓸 수 있나요?
영업팀,경비 처리는 언제까지 올려야 하나요?
영업팀,사내 시스템 계정은 누가 만들어 주나요?
영업팀,회의실 예약은 어떻게 하나요?
영업팀,연차 신청은 어디서 하나요?
영업팀,출장 신청은 며칠 전에 해야 하나요?
영업팀,수습 기간에도 급여가 100% 나오나요?
영업팀,거래처 미팅 때 식대도 법인카드로 되나요?
영업팀,재택근무는 언제부터 할 수 있나요?
영업팀,복리후생 포인트는 어디서 쓰나요?
재무팀,경비 처리 마감일이 언제예요?
재무팀,법인카드 사용처 제한이 있나요?
재무팀,사내 시스템 계정 신청은 어떻게 해요?
재무팀,연차 신청 어디서 하나요
재무팀,출장 신청은 며칠 전까지 해야 해요?
재무팀,복리후생 포인트 사용처가 궁금합니다
재무팀,근로계약서 사본은 어디서 받나요?
재무팀,보안 서약서는 언제 내나요?
개발팀,사내 시스템 계정은 누가 만들어주나요?
개발팀,개발 환경 설정 가이드 최신본이 어디 있나요?
개발팀,재택근무는 언제부터 가능한가요?
개발팀,연차 신청은 어디서 하나요?
개발팀,회의실 예약 방법 알려 주세요
개발팀,법인카드로 도서 구입 되나요?
개발팀,보안 서약서 제출 시기가 언제인가요?
개발팀,수습 기간 급여는 어떻게 되나요?
마케팅팀,복리후생 포인트는 어디서 쓸 수 있나요?
마케팅팀,경비 처리 언제까지 올려요?
마케팅팀,회의실 예약은 어디서 해요?
마케팅팀,재택근무 언제부터 할 수 있어요?
마케팅팀,출장 신청 며칠 전에 하나요?
마케팅팀,법인카드 어디에 쓸 수 있어요?
마케팅팀,사내 시스템 계정 신청 방법이 궁금해요
마케팅팀,명함 신청은 어디서 하나요?`;
  const SAMPLE_PLAN = { 영업팀: [2, 2, 1, 0], 재무팀: [2, 1, 0, 0], 개발팀: [1, 0, 0, 0], 마케팅팀: [0, 0, 0, 0] };
  const TIPS = {
    docs: "부서 공유 폴더의 자료 목록을 부서·문서명·종류·개정일 순서로 붙여 넣으세요. 이름 끝의 _최종, v2, (개정)은 같은 문서로 봅니다.",
    qs: "신입이 물어본 질문을 부서·질문 순서로 붙여 넣으세요. 표현이 달라도 비슷하면 한 질문으로 묶습니다.",
  };

  function seed() {
    return { docs: SAMPLE_DOCS, qs: SAMPLE_QS, tab: "docs", minDepts: 2, confirmed: {}, plan: JSON.parse(JSON.stringify(SAMPLE_PLAN)), showSolo: false };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.docs === "string" && typeof v.qs === "string" && v.plan && typeof v.plan === "object") return Object.assign(seed(), v);
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };

  let res = null;   // { parsed, lt:{kept,old,undated}, qs, groups, kept }
  let ai = { mode: "rule", reason: "" };
  let waiting = false;
  let token = 0;

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
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 원본 탭 ---------- */
  const src = $("src");
  function setTab(t) {
    st[st.tab] = src.value;
    st.tab = t; src.value = st[t];
    $("tabDocs").setAttribute("aria-selected", String(t === "docs"));
    $("tabQs").setAttribute("aria-selected", String(t === "qs"));
    $("tip").textContent = TIPS[t];
    counts(); save();
  }
  function counts() {
    const cur = { ...st, [st.tab]: src.value };
    $("nDocs").textContent = L.parseDocs(cur.docs).docs.length;
    $("nQs").textContent = L.parseQuestions(cur.qs).length;
  }

  /* ---------- 계산 ---------- */
  function syncPlan(depts) {
    depts.forEach((d) => { if (!st.plan[d]) st.plan[d] = L.STEPS.map(() => 0); });
  }
  function compute() {
    st[st.tab] = src.value;
    const parsed = L.parseDocs(st.docs);
    const lt = L.latestOnly(parsed.docs, st.confirmed);
    const qs = L.parseQuestions(st.qs);
    const groups = L.finish(L.cluster(qs), qs, lt.kept, st.minDepts);
    syncPlan([...new Set([...parsed.docs.map((d) => d.dept), ...qs.map((q) => q.dept)])]);
    res = { parsed, lt, qs, groups, kept: lt.kept };
  }
  async function run(quiet) {
    compute();
    const my = ++token;
    ai = { mode: "rule", reason: "" };
    waiting = res.qs.length > 0 && AI.status().enabled !== false;
    save(); renderAll();
    if (!res.qs.length) { waiting = false; renderQs(); return; }
    const r = await AI.ask("onboarding.faq", L.aiInput(res.qs, res.kept, st.minDepts));
    if (my !== token) return;
    waiting = false;
    const g = r && L.normalizeFaq(r.data, res.qs, res.kept);
    if (g) { res.groups = L.finish(g, res.qs, res.kept, st.minDepts); ai = { mode: "ai", ms: r.ms, missed: g.filter((x) => x.missed).length }; }
    else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderQs(); renderMeter();
    if (!quiet) toast(`최신본 ${res.kept.length}개 · 공통 질문 ${res.groups.filter((x) => x.common).length}개`);
  }

  /* ---------- 위: 진행 숫자 ---------- */
  function renderMeter() {
    if (!res) return;
    const p = L.progress(st.plan);
    const common = res.groups.filter((g) => g.common).length;
    $("meter").innerHTML = `
      <div><b>${res.kept.length}<small> / ${res.parsed.docs.length}</small></b>최신본 자료</div>
      <div class="on"><b>${common}<small> / 30</small></b>공통 질문</div>
      <div class="on"><b>${p.applied}<small> / ${p.total}</small></b>적용 부서</div>
      <div><b>${p.pct}<small>%</small></b>계획 진행</div>`;
  }

  /* ---------- ① 최신본 자료 ---------- */
  function renderDocs() {
    const { lt, parsed } = res;
    const byId = (id) => parsed.docs.find((d) => d.id === id) || lt.kept.find((d) => d.id === id);
    $("docsOut").innerHTML = `
      <div class="out-h"><h2><span class="step">1</span>최신본 자료 ${lt.kept.length}개</h2><p>구버전 ${lt.old.length}개 제외 · 확인 필요 ${lt.undated.length}개</p></div>
      <table class="docs">
        <thead><tr><th>문서</th><th>개정일</th><th>부서</th><th class="x">정리</th></tr></thead>
        <tbody>${lt.kept.map((d) => `<tr>
          <td class="t">${esc(d.title)}<span class="kind">${esc(d.kind)}</span>${d.confirmed ? `<span class="conf">개정일 미기재 · 담당자 인정</span>` : ""}</td>
          <td class="d">${d.date || "—"}</td>
          <td>${esc(d.dept)}${d.copies.length ? ` <span class="x">+ ${esc(d.copies.join(", "))} 사본</span>` : ""}</td>
          <td class="x">${d.replaced ? `구버전 ${d.replaced}개 제외` : "하나뿐"}</td></tr>`).join("") || `<tr><td colspan="4">남은 자료가 없어요.</td></tr>`}</tbody>
      </table>
      ${lt.undated.length ? `<div class="need"><b>개정일이 없어 자동으로 남기지 않았어요 (${lt.undated.length})</b>
        ${lt.undated.map((d) => `<div class="row"><span>${esc(d.title)} · ${esc(d.dept)}</span><button type="button" class="ghost-btn" data-confirm="${d.id}">최신본으로 인정</button></div>`).join("")}</div>` : ""}
      ${Object.keys(st.confirmed).length ? `<button type="button" class="link-btn" id="unconfirm">인정한 ${Object.keys(st.confirmed).length}개 되돌리기</button>` : ""}
      ${lt.old.length ? `<details class="old"><summary>제외한 구버전 ${lt.old.length}개 보기</summary><ul>
        ${lt.old.map((d) => `<li><s>${esc(d.title)}</s> ${d.date || "개정일 없음"} · ${esc(d.dept)} <i>— ${esc(d.why)}${byId(d.replacedBy) ? ` (${esc(byId(d.replacedBy).dept)})` : ""}</i></li>`).join("")}</ul></details>` : ""}
      ${parsed.errors.length ? `<p class="fine">읽지 못한 줄: ${parsed.errors.map((e) => `${e.line}줄(${esc(e.why)})`).join(", ")}</p>` : ""}`;
  }
  $("docsOut").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-confirm]");
    if (b) {
      const before = { ...st.confirmed };
      st.confirmed[b.dataset.confirm] = true;
      run(true);
      toast("최신본으로 인정했어요. 관련 질문에 연결됩니다", () => { st.confirmed = before; run(true); });
      return;
    }
    if (e.target.id === "unconfirm") {
      const before = { ...st.confirmed };
      st.confirmed = {}; run(true);
      toast("인정한 문서를 다시 '확인 필요'로 돌렸어요", () => { st.confirmed = before; run(true); });
    }
  });

  /* ---------- ② 공통 질문 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 묶는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(ai.ms / 1000).toFixed(1)}초${ai.missed ? ` · 빠진 질문 ${ai.missed}개 따로 붙임` : ""}</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 글자가 겹치는 정도로 묶었어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function answer(g) {
    if (g.sensitive) return `<div class="ans hr"><b>인사 담당자 답변</b><br>급여·계약 관련은 자료로 답하지 않고 담당자에게 넘겨요.</div>`;
    const d = res.kept.find((x) => x.id === g.docId);
    if (d) return `<div class="ans">${g.category ? `<span class="cat">${esc(g.category)}</span>` : ""}<b>${esc(d.title)}</b><br>${d.date || "개정일 미기재"} 최신본 · ${esc(d.dept)}</div>`;
    return `<div class="ans none"><b>연결할 최신본 없음</b><br>자료를 새로 만들거나 ‘확인 필요’ 문서를 인정하세요.</div>`;
  }
  function renderQs() {
    $("qMode").innerHTML = modeChip();
    const common = res.groups.filter((g) => g.common);
    const solo = res.groups.filter((g) => !g.common);
    const row = (g, cls) => `<li class="${cls}"><div><div class="qt">${esc(g.question)}</div>
        <div class="ds">${g.depts.map((d) => `<span class="dchip">${esc(d)}</span>`).join("")}<span class="dchip">질문 ${g.count}건</span></div></div>${answer(g)}</li>`;
    $("qOut").innerHTML = `<div class="${waiting ? "waiting" : ""}">
      <ol class="qs">${common.map((g) => row(g, "")).join("") || `<li><span></span><div>${st.minDepts}개 부서 이상에서 나온 질문이 아직 없어요.</div></li>`}
      ${st.showSolo ? solo.map((g) => row(g, "solo")).join("") : ""}</ol>
      <div class="qs-foot"><span>공통 ${common.length}개 · 한 부서에서만 나온 질문 ${solo.length}개 (지우지 않고 모아 둠) · 인사 담당자 답변 ${res.groups.filter((g) => g.sensitive).length}개</span>
        ${solo.length ? `<button type="button" class="ghost-btn" id="toggleSolo" aria-pressed="${st.showSolo}">${st.showSolo ? "공통 질문만 보기" : "한 부서 질문도 보기"}</button>` : ""}</div></div>`;
  }
  $("qOut").addEventListener("click", (e) => {
    if (e.target.id !== "toggleSolo") return;
    st.showSolo = !st.showSolo; save(); renderQs(); $("toggleSolo").focus();
  });

  /* ---------- ③ 확산 계획 ---------- */
  function renderPlan() {
    const depts = Object.keys(st.plan);
    $("plan").innerHTML = `<thead><tr><th class="dp">부서</th>${L.STEPS.map((s) => `<th>${esc(s)}</th>`).join("")}<th>적용</th></tr></thead><tbody>
      ${depts.map((d) => {
        const all = st.plan[d].every((s) => s === 2);
        return `<tr><td class="dp">${esc(d)}</td>${st.plan[d].map((s, i) => `<td><button type="button" data-dept="${esc(d)}" data-step="${i}" data-s="${s}" aria-label="${esc(d)} ${esc(L.STEPS[i])}: ${L.STATES[s]}">${L.STATES[s]}</button></td>`).join("")}
          <td class="res ${all ? "ok" : ""}">${all ? "적용" : "—"}</td></tr>`;
      }).join("")}</tbody>`;
  }
  $("plan").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-dept]"); if (!b) return;
    const before = st.plan;
    const dept = b.dataset.dept, step = Number(b.dataset.step);
    st.plan = L.cycle(st.plan, dept, step);
    save(); renderPlan(); renderMeter();
    $("plan").querySelector(`button[data-dept="${CSS.escape(dept)}"][data-step="${step}"]`).focus();
    if (st.plan[dept].every((s) => s === 2) && !before[dept].every((s) => s === 2)) toast(`${dept} 온보딩 적용 완료`, () => { st.plan = before; save(); renderPlan(); renderMeter(); });
  });
  $("copyKit").addEventListener("click", async () => {
    const md = L.toKitMd(res, res.qs, st.plan);
    $("kitOut").textContent = md; $("kitBox").hidden = false;
    try { await navigator.clipboard.writeText(md); toast("온보딩 키트를 복사했어요. 사내 위키에 붙여 넣으세요"); }
    catch (err) { $("kitBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });

  function renderAll() { renderMeter(); renderDocs(); renderQs(); renderPlan(); }

  /* ---------- 입력 · 설정 ---------- */
  $("tabDocs").addEventListener("click", () => setTab("docs"));
  $("tabQs").addEventListener("click", () => setTab("qs"));
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { setTab(st.tab === "docs" ? "qs" : "docs"); $(st.tab === "docs" ? "tabDocs" : "tabQs").focus(); }
  });
  src.addEventListener("input", () => { counts(); $("srcInfo").textContent = "고친 뒤 '정리'를 누르세요"; });
  src.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("run").addEventListener("click", () => { $("srcInfo").textContent = ""; run(); });
  $("minDepts").addEventListener("change", (e) => { st.minDepts = Number(e.target.value); run(true); });
  $("reset").addEventListener("click", () => {
    const before = JSON.parse(JSON.stringify({ ...st, [st.tab]: src.value }));
    st = seed(); src.value = st.docs; $("minDepts").value = String(st.minDepts); setTab("docs"); run(true);
    toast("샘플 자료로 되돌렸어요", () => { st = before; src.value = st[st.tab]; $("minDepts").value = String(st.minDepts); setTab(st.tab); run(true); });
  });

  /* ---------- 시작 ---------- */
  src.value = st[st.tab];
  $("minDepts").value = String(st.minDepts);
  $("tabDocs").setAttribute("aria-selected", String(st.tab === "docs"));
  $("tabQs").setAttribute("aria-selected", String(st.tab === "qs"));
  $("tip").textContent = TIPS[st.tab];
  counts();
  compute(); renderAll();
  AI.probe().then(() => run(true));
})();
