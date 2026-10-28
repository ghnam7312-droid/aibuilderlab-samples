/* 효과먼저 — 화면 (DOM만 다룬다. 점검·가격·제안서 구성은 logic.js, AI 호출은 ai-client.js)
 *
 * '기관 효과 중심으로 다시 쓰기'를 누르면
 *   1) 기관 인터뷰와 패키지로 규칙 제안서를 바로 보여 주고 (기다리지 않게)
 *   2) Claude에게 인터뷰·패키지·처음 쓴 제안서를 보내 문장을 다시 쓰게 한다. 돌아오면 검사해
 *      (과장 문장 제거, 비용·지표 숫자 고정, 강사 소개는 맨 뒤) 덮어쓴다. 실패하면 1)을 그대로 둔다.
 */
(function () {
  "use strict";
  const L = window.Hyogwa;
  const STORE_KEY = "startup-parent-proposal-v1";
  const INSTRUCTOR = "유아교육 전공 · 부모 교육 강사 ‘놀이처방전’. 복지관·어린이집 부모 교육과 월령별 놀이 코칭을 합니다.";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 (기관·인물·숫자는 모두 가상) ---------- */
  const DRAFT = `안녕하세요. 저는 유아교육을 전공하고 10년 동안 부모 교육 강의를 해 온 강사 놀이처방전입니다.
그동안 복지관과 어린이집 50여 곳에 출강했고, 부모 교육 관련 자격을 갖고 있습니다.
제 강의는 현장 경험을 바탕으로 한 최고의 강의로, 반드시 부모님들의 만족을 보장합니다.
강의 주제는 놀이, 대화법, 미디어 사용입니다. 회당 강의료는 30만 원입니다.`;
  const O = (id, name, type, contact, status, quotes, attendNow, prepHours, budget, pkg) => ({ id, name, type, contact, status, quotes, attendNow, satisfactionNow: "조사 없음", prepHours, budget, pkg });
  const P = (sessions, perSession, discount, attendTarget) => ({ sessions, perSession, discount, attendTarget, satTarget: 4.5, startMonth: 3 });
  function seed() {
    return {
      sel: "o1", draft: DRAFT,
      orgs: [
        O("o1", "해오름종합사회복지관", "복지관", "부모교육 담당 사회복지사", "협의 중", ["부모 교육을 열면 신청은 20명인데 당일엔 8명 와요.", "구청에 실적 보고할 때 만족도 숫자가 필요해요.", "매번 강사 섭외하고 홍보물 만드는 게 일이에요."], 40, 3, 2400000, P(8, 300000, 10, 70)),
        O("o2", "꿈나무어린이집", "어린이집", "원장", "연간 계약", ["맞벌이 부모님이 많아 평일 낮 강의엔 못 오세요.", "평가 때 부모 참여 기록을 보여 줘야 해요."], 25, 2, 1200000, P(4, 300000, 5, 60)),
        O("o3", "별빛유치원", "유치원", "교무 담당 교사", "연간 계약", ["졸업반 부모님들이 입학 준비를 제일 궁금해해요.", "강의 뒤 가정에서 이어 할 거리가 있으면 좋겠어요."], 55, 2, 1800000, P(6, 300000, 10, 75)),
        O("o4", "한빛가족센터", "복지관", "가족 프로그램 담당", "제안함", ["아빠들이 오는 프로그램이 거의 없어요.", "주말 프로그램 예산은 따로 있어요."], 35, 4, 2000000, P(6, 320000, 10, 65)),
        O("o5", "다솜어린이집", "어린이집", "원장", "보류", ["올해는 예산이 이미 다 잡혀 있어요."], 30, 2, 0, P(4, 300000, 0, 60)),
        O("o6", "숲속작은도서관", "복지관", "관장", "제안함", ["그림책 읽어 주기 모임은 있는데 부모 교육은 처음이에요."], 0, 3, 600000, P(4, 250000, 10, 60)),
        O("o7", "늘봄지역아동센터", "복지관", "센터장", "제안함", ["보호자분들이 저녁에만 시간이 돼요.", "조부모님이 키우는 아이가 많아요."], 20, 3, 900000, P(4, 280000, 10, 55)),
      ],
    };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.orgs) && v.orgs.length && typeof v.draft === "string") return v;
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let result = null; // {prop, mode, reason, ms, removed}
  let waiting = false;
  let runToken = 0;
  const org = () => st.orgs.find((o) => o.id === st.sel) || st.orgs[0];

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

  /* ---------- 기관 제안 현황 ---------- */
  function renderPipe() {
    const p = L.pipeline(st.orgs);
    $("pipeSum").innerHTML = `제안 <b>${p.proposed}곳</b> · 연간 계약 <b>${p.contracts}곳</b> (${p.rate}%) <span class="goal">1기 목표치: 기관 7곳 제안, 연간 계약 2곳</span>`;
    $("orgs").innerHTML = st.orgs.map((o) => `<button type="button" class="org" data-o="${o.id}" aria-pressed="${o.id === st.sel}">
      <b>${esc(o.name)}</b><span class="pill" data-st="${esc(o.status)}">${esc(o.status)}</span></button>`).join("");
  }
  $("orgs").addEventListener("click", (e) => { const b = e.target.closest("[data-o]"); if (!b || b.dataset.o === st.sel) return; st.sel = b.dataset.o; save(); renderAll(); rewrite(); });

  /* ---------- 왼쪽 ---------- */
  function renderLeft() {
    const o = org(), k = o.pkg;
    $("orgName").textContent = o.name;
    $("orgMeta").textContent = `${o.type} · 인터뷰: ${o.contact}`;
    $("status").innerHTML = L.STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("");
    $("quotes").innerHTML = o.quotes.map((q) => `<li>“${esc(q)}”</li>`).join("");
    $("attendNow").value = o.attendNow || "";
    $("budget").value = o.budget ? o.budget / 10000 : "";
    $("sessions").innerHTML = [4, 6, 8, 10].map((n) => `<button type="button" data-n="${n}" aria-pressed="${k.sessions === n}">${n}회</button>`).join("");
    $("per").value = k.perSession / 10000;
    $("disc").value = k.discount;
    $("attendTarget").value = k.attendTarget;
    $("atOut").textContent = `${k.attendTarget}%`;
    renderPrice();
  }
  function renderPrice() {
    const o = org(), p = L.price(o.pkg), f = L.budgetFit(p.total, o.budget);
    $("price").innerHTML = `연 <b>${L.man(p.total)}</b> · 회당 ${L.man(p.perAfter)} <span class="sub">(회당 판매 합계 ${L.man(p.list)}에서 ${L.man(p.saved)} 할인)</span> ` +
      (f.kind === "fit" ? `<span class="fit ok">예산 안 · ${L.man(f.gap)} 여유</span>` : f.kind === "over" ? `<span class="fit over">예산 ${L.man(f.gap)} 초과 — 회차를 줄여 보세요</span>` : `<span class="fit">예산 모름</span>`);
  }
  function edit(fn) { fn(org()); save(); renderPrice(); renderPipe(); rewrite(); }
  $("status").addEventListener("change", (e) => {
    const o = org(), before = o.status;
    o.status = e.target.value; save(); renderPipe();
    toast(`${o.name}: ${before} → ${o.status}`, () => { o.status = before; save(); renderPipe(); renderLeft(); });
  });
  $("attendNow").addEventListener("change", (e) => edit((o) => { o.attendNow = Math.max(0, Math.min(100, Math.round(+e.target.value || 0))); }));
  $("budget").addEventListener("change", (e) => edit((o) => { o.budget = Math.max(0, Math.round(+e.target.value || 0)) * 10000; }));
  $("per").addEventListener("change", (e) => edit((o) => { o.pkg.perSession = Math.max(0, Math.round((+e.target.value || 0) * 10)) * 1000; }));
  $("disc").addEventListener("change", (e) => edit((o) => { o.pkg.discount = Math.max(0, Math.min(40, Math.round(+e.target.value || 0))); e.target.value = o.pkg.discount; }));
  $("attendTarget").addEventListener("input", (e) => { org().pkg.attendTarget = +e.target.value; $("atOut").textContent = `${e.target.value}%`; save(); });
  $("attendTarget").addEventListener("change", () => rewrite());
  $("sessions").addEventListener("click", (e) => { const b = e.target.closest("[data-n]"); if (!b) return; edit((o) => { o.pkg.sessions = +b.dataset.n; }); renderLeft(); });

  /* ---------- 점검 ---------- */
  const KIND = { org: "기관 효과", me: "강사 중심", etc: "기타" };
  function meter(r) { return `<div class="meter" role="img" aria-label="기관 효과 ${r.ratio.org}%, 강사 중심 ${r.ratio.me}%"><i class="o" style="width:${r.ratio.org}%"></i><i class="m" style="width:${r.ratio.me}%"></i></div>`; }
  function renderLint() {
    const r = L.lint(st.draft);
    $("lint").innerHTML = `<div class="lint-h"><span>기관 효과 <b>${r.ratio.org}%</b> · 강사 중심 <b>${r.ratio.me}%</b></span>${r.ok ? `<span class="fit ok">통과</span>` : `<span class="fit over">고칠 곳 ${r.problems.length}</span>`}</div>${meter(r)}
      <ul class="probs">${r.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <ol class="sents">${r.list.map((s) => `<li class="${s.kind}"><span class="k">${KIND[s.kind]}</span><span>${s.hype.reduce((t, h) => t.split(esc(h)).join(`<mark>${esc(h)}</mark>`), esc(s.text))}</span></li>`).join("")}</ol>`;
  }
  $("draft").addEventListener("input", (e) => { st.draft = e.target.value; save(); renderLint(); });

  /* ---------- 오른쪽: 다시 쓴 제안서 ---------- */
  function badge() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 문장을 다듬는 중</span>`;
    if (result.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 다시 씀 · ${(result.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 인터뷰·패키지로 템플릿을 채웠어요">규칙 기반${result.reason ? ` · ${esc(result.reason)}` : ""}</span>`;
  }
  function renderOut() {
    const o = org(), prop = result.prop;
    const before = L.lint(st.draft), after = L.lint(L.toText(prop, o.name));
    $("out").innerHTML = `<div class="out-h"><h2>다시 쓴 제안서</h2>${badge()}</div>
      <div class="cmp"><span>기관 효과 이야기 <b>${before.ratio.org}%</b> → <b class="up">${after.ratio.org}%</b></span><span>과장 문구 <b>${before.hype}</b> → <b class="up">${after.hype}</b></span>${result.removed ? `<span>Claude 문장 중 과장 ${result.removed}개 삭제</span>` : ""}</div>
      <article class="doc ${waiting ? "waiting" : ""}" id="doc">
        <p class="to">${esc(o.name)} 귀중 · 부모 교육 연간 패키지 제안</p>
        <h3 class="hl">${esc(prop.headline)}</h3>
        ${prop.sections.map((s, i) => `<section class="sec ${/강사|소개/.test(s.title) ? "me" : ""}"><h4><span>${i + 1}</span>${esc(s.title)}</h4><p>${esc(s.body).replace(/\n/g, "<br>")}</p></section>`).join("")}
        <table class="mt"><caption>측정 지표</caption><thead><tr><th>지표</th><th>지금</th><th>목표</th><th>어떻게 재나</th></tr></thead>
        <tbody>${prop.metrics.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.now)}</td><td><b>${esc(m.target)}</b></td><td>${esc(m.how)}</td></tr>`).join("")}</tbody></table>
        <p class="fine">목표 수치는 측정·보고 기준이며, 결과를 약속하는 숫자가 아닙니다.</p>
      </article>
      <div class="out-tools"><button type="button" class="ghost-btn" id="print">인쇄 · PDF</button><button type="button" class="dark" id="copy">글로 복사</button></div>
      <details class="md" id="mdBox" hidden><summary>복사한 내용 보기</summary><pre id="mdOut"></pre></details>`;
  }
  $("out").addEventListener("click", async (e) => {
    if (e.target.id === "print") { window.print(); return; }
    if (e.target.id === "copy") {
      const text = L.toText(result.prop, org().name);
      try { await navigator.clipboard.writeText(text); toast("복사했어요. 한글·워드에 붙여 넣으세요"); } catch (err) { toast("복사 권한이 없어 아래에 펼쳐 두었어요"); }
      $("mdBox").hidden = false; $("mdBox").open = true; $("mdOut").textContent = text;
    }
  });

  async function rewrite() {
    const my = ++runToken;
    const o = org();
    const rule = L.buildProposal(o, o.pkg, INSTRUCTOR);
    result = { prop: rule, mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderOut();
    const p = L.price(o.pkg);
    const r = await AI.ask("parentproposal.rewrite", {
      org: { name: o.name, type: o.type, contact: o.contact, quotes: o.quotes, attendNow: o.attendNow, satisfactionNow: o.satisfactionNow, prepHours: o.prepHours },
      package: { sessions: p.sessions, attendTarget: o.pkg.attendTarget, satTarget: o.pkg.satTarget, plan: L.plan(o.type, p.sessions, o.pkg.startMonth) },
      draft: st.draft.slice(0, 3000), instructor: INSTRUCTOR,
    });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeRewrite(r.data, rule);
    if (n) result = { prop: n, mode: "ai", ms: r.ms, removed: n.removed };
    else result.reason = r ? "응답 형식이 맞지 않음" : (AI.status().reason || "AI 응답 없음");
    renderOut();
  }
  $("run").addEventListener("click", () => { rewrite(); if (matchMedia("(max-width: 960px)").matches) $("out").scrollIntoView({ block: "start" }); });

  function renderAll() { renderPipe(); renderLeft(); renderLint(); }
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); $("draft").value = st.draft; renderAll(); rewrite();
    toast("샘플로 되돌렸어요", () => { st = before; save(); $("draft").value = st.draft; renderAll(); rewrite(); });
  });

  /* ---------- 시작 ---------- */
  $("draft").value = st.draft;
  renderAll();
  result = { prop: L.buildProposal(org(), org().pkg, INSTRUCTOR), mode: "rule", reason: "" };
  renderOut();
  AI.probe().then(() => rewrite());
})();
