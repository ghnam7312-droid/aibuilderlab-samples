/* 맞춤사례 — 화면
 * 진단·자료 검사·사례 틀은 logic.js(window.Matchum). 이 파일은 그리기와 버튼만 맡는다.
 * 저장: localStorage("startup-training-prep-v1") — 담당자에게 받은 자료는 이 브라우저에만 남는다.
 */
(function () {
  "use strict";
  const L = window.Matchum;
  const STORE_KEY = "startup-training-prep-v1";
  const TASK = "trainingprep.cases";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SRC = { public: "공개 정보", survey: "설문 요약", internal: "회사 내부 자료" };
  const VD = { ok: "사용", check: "확인 필요", block: "제외" };

  /* ---------- 예시 고객사 (모두 가상) ---------- */
  const COMPANIES = {
    logistics: {
      name: "한길로지스(가상)", industry: "logistics", size: "직원 약 900명", topic: "신임 팀장 피드백 리더십",
      picks: { senior: 13, time: 11, fear: 7, conflict: 5, goal: 4, newbie: 2 }, n: 22,
      quotes: ["교대 근무라 팀원 얼굴을 일주일에 한 번 볼까 말까 해요", "저보다 연차 많은 반장님께 지적하기가 제일 어려워요", "박정우 팀장님처럼 말 잘하는 법을 배우고 싶어요", "출고 늦어지면 옆 센터랑 서로 탓하는 분위기예요", "칭찬은 하는데 고쳐야 할 말은 계속 미루게 돼요"],
      mats: [
        ["public", "회사 소개 (홈페이지)", "전국 6개 물류센터에서 하루 약 8만 건을 출고하는 3자 물류 회사. 2026년부터 야간 교대조를 늘렸다."],
        ["survey", "사전 설문 요약", "신임 팀장 22명 응답. 59%가 연차 많은 팀원과의 대화를, 50%가 교대 근무로 대화 시간이 없음을 꼽음."],
        ["internal", "2026 상반기 센터별 실적", "센터별 매출 1,240억, 센터 이직률 18%. 경영회의 보고용."],
        ["public", "팀장 면담 메모", "박정우 팀장 — 팀원과 출고 일정 문제로 갈등, 면담 기록 있음"],
        ["public", "채용 공고 일부", "연 매출 3,100억 원 규모, 수도권 물류센터 현장 관리자 채용"],
      ],
    },
    it: {
      name: "모아클라우드(가상)", industry: "it", size: "직원 약 240명", topic: "신임 팀장 피드백 리더십",
      picks: { time: 10, goal: 9, fear: 8, newbie: 5, senior: 3, conflict: 3 }, n: 18,
      quotes: ["재택이 섞여서 피드백이 슬랙 한 줄로 끝나요", "‘알아서 잘’이라고 했다가 서로 기대가 달랐던 적이 많아요", "주니어가 금방 그만둘까 봐 쓴소리를 못 해요", "코드 리뷰 말고는 피드백할 자리가 없어요"],
      mats: [
        ["public", "회사 소개 (홈페이지)", "중소 쇼핑몰용 클라우드 호스팅 서비스. 주 2회 사무실 출근, 나머지는 원격 근무."],
        ["survey", "사전 설문 요약", "신임 리드 18명 응답. 56%가 원격 근무로 대화 시간 부족, 50%가 기대치를 말로 정하지 않음을 꼽음."],
        ["public", "블로그 글: 우리의 배포 문화", "작은 단위로 자주 배포하고, 장애 회고는 탓하지 않는 방식으로 쓴다."],
        ["internal", "조직 개편안 (사내 한정)", "‘프로젝트 북극성’ 조직 신설, 2개 스쿼드 통합 예정"],
        ["public", "투자 기사 요약", "누적 투자 120억 원 유치, 내년 인력 30% 확충 계획"],
      ],
    },
    maker: {
      name: "새솔정밀(가상)", industry: "maker", size: "직원 약 420명", topic: "신임 팀장 피드백 리더십",
      picks: { senior: 9, conflict: 8, fear: 6, newbie: 6, time: 3, goal: 2 }, n: 16,
      quotes: ["라인 반장님들이 다 저보다 15년 이상 선배예요", "품질 문제 생기면 생산이랑 품질팀이 서로 떠넘겨요", "신입이 3개월을 못 버티고 나가요"],
      mats: [
        ["public", "회사 소개 (홈페이지)", "자동차 부품 정밀 가공. 2개 공장, 주야간 2교대로 운영."],
        ["survey", "사전 설문 요약", "신임 팀장 16명 응답. 56%가 연차 많은 반장과의 대화, 50%가 부서 간 책임 떠넘기기를 꼽음."],
        ["public", "품질 담당 연락처", "품질팀 문의 quality.lead@example.com / 010-4821-0937"],
        ["internal", "2025 인사평가 결과", "라인별 평가 등급 분포와 퇴사 사유 정리"],
      ],
    },
  };
  function responsesOf(c) {
    // 고른 항목 수에 맞춰 응답자에게 차례로 나눠 준다 (한 사람이 여러 개 고를 수 있음)
    const rs = Array.from({ length: c.n }, (_, i) => ({ pains: [], text: c.quotes[i] || "" }));
    let k = 0;
    Object.entries(c.picks).forEach(([key, cnt]) => { for (let j = 0; j < cnt; j++) { rs[k % c.n].pains.push(key); k++; } });
    return rs;
  }
  const matsOf = (key) => COMPANIES[key].mats.map(([source, title, text], i) => ({ id: `${key}-${i}`, source, title, text }));

  /* ---------- 상태 ---------- */
  function seed() { return { co: "logistics", mats: Object.fromEntries(Object.keys(COMPANIES).map((k) => [k, matsOf(k)])), approved: {} }; }
  function load() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && COMPANIES[v.co] && v.mats && v.approved) return v; } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let plan = null, ai = { mode: "rule", reason: "" }, waiting = false, runToken = 0, fresh = false;
  const co = () => COMPANIES[st.co];
  const mats = () => st.mats[st.co] || [];
  const diag = () => L.diagnose(responsesOf(co()));

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg; $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 그리기 ---------- */
  function renderCos() {
    $("cos").innerHTML = Object.entries(COMPANIES).map(([k, c]) => `<button type="button" role="tab" class="co" data-co="${k}" aria-selected="${k === st.co}"><b>${esc(c.name)}</b><small>${esc(L.INDUSTRY[c.industry].name)} · ${esc(c.size)} · 설문 ${c.n}명</small></button>`).join("");
  }
  function renderDiag() {
    const d = diag();
    $("dgMeta").textContent = `${co().topic} · 응답 ${d.n}명`;
    const max = Math.max(1, ...d.ranked.map((x) => x.percent));
    $("diag").innerHTML = `<div class="pains">${d.ranked.map((p, i) => `<div class="pain${i < 3 ? " top" : ""}"><span>${esc(p.label)}</span><span class="t"><i style="width:${(p.percent / max) * 100}%"></i></span><span class="v">${p.percent}%</span></div>`).join("")}</div>
      <ul class="quotes" aria-label="자유 응답 (이름은 가림)">${co().quotes.slice(0, 3).map((q) => `<li>${esc(L.cleanQuote(q))}</li>`).join("")}</ul>`;
  }
  function renderMats() {
    const list = mats();
    const counts = { ok: 0, check: 0, block: 0 };
    $("mats").innerHTML = list.map((m) => {
      const c = L.checkMaterial(m);
      const ap = !!st.approved[m.id];
      counts[c.verdict === "check" && ap ? "ok" : c.verdict]++;
      return `<li class="mat ${c.verdict}"><span class="vd ${c.verdict}">${c.verdict === "check" && ap ? "확인함" : VD[c.verdict]}</span>
        <div><span class="nm">${esc(m.title)}</span><span class="src">${SRC[m.source] || ""}</span><div class="tx">${esc(m.text)}</div></div>
        <button type="button" class="x" data-del="${esc(m.id)}" aria-label="${esc(m.title)} 지우기">✕</button>
        ${c.reasons.length ? `<div class="why">${esc(c.reasons.join(" · "))}${c.verdict === "block" ? " → AI에 넣지 않아요" : ""}</div>` : ""}
        ${c.verdict === "check" ? `<label class="ap"><input type="checkbox" data-ap="${esc(m.id)}"${ap ? " checked" : ""}> 공개 출처를 확인했어요 (넣기)</label>` : ""}</li>`;
    }).join("") || `<li class="pv">자료가 없어요. 아래에서 추가하세요.</li>`;
    $("mtMeta").textContent = `사용 ${counts.ok} · 확인 대기 ${counts.check} · 제외 ${counts.block}`;
    $("sent").textContent = JSON.stringify(L.buildAiInput(co(), diag(), list, st.approved, responsesOf(co())), null, 2);
  }
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 사례를 쓰는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 작성 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 업종별 사례 틀로 만들었어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function renderPlan() {
    if (!plan) { $("plan").innerHTML = `<p class="pv">‘사례 초안 만들기’를 누르세요.</p>`; return; }
    const used = L.usable(mats(), st.approved).length;
    const label = (k) => (L.PAINS[k] ? L.PAINS[k].label : "기타");
    $("plan").innerHTML = `<div class="plan-wrap${waiting ? " waiting" : ""}">
      <div class="badges">${modeChip()}<span class="used">근거 자료 ${used}건만 사용</span>${plan.dropped ? `<span class="used drop">제외 자료가 섞인 사례 ${plan.dropped}건 버림</span>` : ""}</div>
      ${plan.diagnosis ? `<p class="dx">${esc(plan.diagnosis)}</p>` : ""}
      ${plan.opener ? `<div class="opener"><small>오프닝 질문 · 첫 5분</small>${esc(plan.opener)}</div>` : ""}
      <div class="cases">${plan.cases.map((c, i) => `<article class="case${fresh ? " new" : ""}" style="--i:${i}"><span class="tag">${esc(label(c.pain))}</span><h3>${esc(c.title)}</h3><p>${esc(c.situation)}</p><p class="q">${esc(c.question)}</p></article>`).join("")}</div></div>`;
    fresh = false;
  }
  const renderAll = () => { renderCos(); renderDiag(); renderMats(); renderPlan(); };

  /* ---------- 실행 ---------- */
  async function run(opts) {
    const my = ++runToken;
    const d = diag(), list = mats();
    plan = { ...L.ruleCases(co(), d), dropped: 0 };
    ai = { mode: "rule", reason: "" };
    const noAi = opts && opts.noAi;
    waiting = !noAi && AI.status().enabled !== false; fresh = true;
    renderPlan();
    if (noAi) return;
    const r = await AI.ask(TASK, L.buildAiInput(co(), d, list, st.approved, responsesOf(co())));
    if (my !== runToken) return; // 그 사이 고객사를 바꿨으면 버린다
    waiting = false;
    const n = r && L.normalizeCases(r.data, L.leakTokens(list, st.approved));
    if (n) { plan = { diagnosis: n.diagnosis || plan.diagnosis, opener: n.opener || plan.opener, cases: n.cases, dropped: n.dropped }; ai = { mode: "ai", ms: r.ms }; fresh = true; }
    else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderPlan();
    if (!(opts && opts.quiet)) toast(`${ai.mode === "ai" ? "Claude가" : "업종 사례 틀로"} 사례 ${plan.cases.length}개를 준비했어요`);
  }

  /* ---------- 버튼 ---------- */
  $("cos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-co]"); if (!b || b.dataset.co === st.co) return;
    st.co = b.dataset.co; save(); renderAll(); run({ quiet: true });
  });
  $("mats").addEventListener("change", (e) => {
    const id = e.target.dataset.ap; if (!id) return;
    if (e.target.checked) st.approved[id] = true; else delete st.approved[id];
    save(); renderMats();
    toast(e.target.checked ? "확인한 자료를 넣었어요. ‘사례 초안 만들기’로 다시 만드세요" : "자료를 다시 뺐어요");
  });
  $("mats").addEventListener("click", (e) => {
    const id = e.target.dataset.del; if (!id) return;
    const list = mats(); const i = list.findIndex((m) => m.id === id); if (i < 0) return;
    const [gone] = list.splice(i, 1); save(); renderMats();
    toast(`‘${gone.title}’을(를) 지웠어요`, () => { list.splice(i, 0, gone); save(); renderMats(); });
  });
  function previewNew() {
    const t = $("mText").value.trim();
    if (!t) { $("mPreview").textContent = ""; return; }
    const c = L.checkMaterial({ source: $("mSrc").value, title: $("mTitle").value, text: t });
    $("mPreview").innerHTML = `넣으면 <span class="vd ${c.verdict}">${VD[c.verdict]}</span>${c.reasons.length ? ` ${esc(c.reasons.join(" · "))}` : ""}`;
  }
  ["mText", "mTitle", "mSrc"].forEach((id) => $(id).addEventListener("input", previewNew));
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const m = { id: `u${Date.now().toString(36)}`, source: $("mSrc").value, title: $("mTitle").value.trim(), text: $("mText").value.trim() };
    if (!m.title || !m.text) return;
    mats().push(m); save();
    $("addForm").reset(); $("mPreview").textContent = ""; renderMats();
    const v = L.checkMaterial(m).verdict;
    toast(v === "block" ? "추가했지만 기준에 걸려 AI에는 넣지 않아요" : v === "check" ? "추가했어요. 공개 출처를 확인하면 넣을 수 있어요" : "추가했어요. 사례를 다시 만들면 반영돼요");
  });
  $("run").addEventListener("click", () => run());
  $("copy").addEventListener("click", async () => {
    if (!plan) return;
    const md = L.notesMd({ ...co() }, diag(), plan);
    $("mdOut").textContent = md; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(md); toast("강의 노트를 복사했어요 (마크다운)"); }
    catch (e) { $("mdBox").open = true; toast("복사 권한이 없어 아래에 펼쳐 두었어요"); }
  });
  $("print").addEventListener("click", () => window.print());
  $("reset").addEventListener("click", () => {
    const before = JSON.parse(JSON.stringify(st));
    st = seed(); save(); renderAll(); run({ quiet: true });
    toast("샘플 고객사와 자료로 되돌렸어요", () => { st = before; save(); renderAll(); run({ quiet: true }); });
  });

  /* ---------- 시작 ---------- */
  renderAll();
  run({ noAi: true });
  AI.probe().then(() => run({ quiet: true }));
})();
