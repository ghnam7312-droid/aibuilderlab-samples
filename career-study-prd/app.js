/* 하루치 — 화면 (DOM 다루기만 한다. 계획·검사·다시 나누기는 logic.js, AI 호출은 ai-client.js)
 *
 * 프로토타입
 *  1) 목표·시험일·하루 시간·과목 → Claude 에게 7일 계획을 받는다 (기다리는 동안 빈 달력이 빛난다)
 *  2) 받은 계획은 검사를 통과해야만 쓴다. 걸리면 규칙 계획으로 바꾸고 이유를 보여 준다
 *  3) 체크하면 형광펜, 진행률 고리, 코치 한마디, 스터디 진행률이 바뀐다
 *  4) 지난 날 못 한 일은 '밀린 일 다시 나누기'로 가장 가벼운 날부터 옮긴다
 * 기획서 · 프롬프트 평가표 탭은 이 프로토타입이 나오기까지의 기록이다.
 */
(function () {
  "use strict";
  const H = window.Haruchi;
  const STORE_KEY = "haruchi-v3";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => H.iso(new Date());

  /* ---------- 상태 ---------- */
  function seed() {
    const t = today();
    const exam = H.addDays(t, 26);
    const subs = ["소프트웨어 설계", "소프트웨어 개발", "데이터베이스", "프로그래밍 언어", "정보시스템 구축"];
    // 샘플은 이틀 전에 시작한 계획: 첫날·둘째 날에 하나씩 못 해서 '밀림'이 보인다
    const plan = H.makePlan(H.addDays(t, -2), exam, 2, subs, H.addDays(t, -2));
    plan.days[0].items[0].done = true;
    plan.days[1].items[0].done = true;
    return { tab: "proto", goal: "정보처리기사 필기 합격", exam, hrs: 2, subs, plan, note: "", evalPick: 2, live: null };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.subs)) return v;
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 무시 */ } };
  let st = load();
  let arrived = new Set();
  let waiting = false;
  const snapshot = () => JSON.parse(JSON.stringify(st));

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

  /* ---------- 탭 ---------- */
  function showTab(t) {
    st.tab = t; save();
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === t)));
    document.querySelectorAll("[data-p]").forEach((s) => (s.hidden = s.dataset.p !== t));
  }
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) showTab(b.dataset.t); });

  /* ---------- 입력 ---------- */
  function renderForm() {
    $("goal").value = st.goal;
    $("exam").value = st.exam;
    $("hrs").innerHTML = H.HOURS.map((h) => `<button type="button" role="radio" aria-checked="${st.hrs === h}" data-h="${h}">${h}시간</button>`).join("");
    $("subs").innerHTML = st.subs.map((s, i) => `<span>${esc(s)}<button type="button" data-i="${i}" aria-label="${esc(s)} 빼기">×</button></span>`).join("");
  }
  $("hrs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-h]"); if (!b) return;
    st.hrs = Number(b.dataset.h); save(); renderForm();
    $("hrs").querySelector(`[data-h="${b.dataset.h}"]`).focus();
  });
  $("subs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    st.subs.splice(Number(b.dataset.i), 1); save(); renderForm(); $("subIn").focus();
  });
  $("subIn").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v) return;
    if (st.subs.includes(v)) { toast("이미 있는 과목이에요"); return; }
    if (st.subs.length >= 8) { toast("과목은 8개까지 넣을 수 있어요"); return; }
    st.subs.push(v); e.target.value = ""; save(); renderForm();
  });

  $("pf").addEventListener("submit", async (e) => {
    e.preventDefault();
    ["goal", "exam", "subIn"].forEach((id) => $(id).removeAttribute("aria-invalid"));
    $("err").hidden = true;
    const form = { goal: $("goal").value.trim(), exam: $("exam").value, hrs: st.hrs, subs: st.subs.slice(), start: today() };
    const bad = H.checkForm(form, today());
    if (bad) {
      $("err").textContent = bad.msg; $("err").hidden = false;
      const el = $(bad.field); if (el && el.focus) { el.setAttribute("aria-invalid", "true"); el.focus(); }
      return;
    }
    const before = snapshot();
    st.goal = form.goal; st.exam = form.exam;
    waiting = true;
    $("make").disabled = true; $("make").textContent = "Claude가 계획을 짜는 중…";
    renderProto();
    const r = await AI.ask("study.plan", H.planInput(form));
    let plan, note = "";
    if (r) {
      const c = H.checkPlan(r.data, form);
      if (c.ok) { plan = c.plan; plan.ms = r.ms; }
      else note = `Claude 계획이 검사에 걸려 규칙 계획으로 바꿨어요: ${c.reason}`;
    }
    if (!plan) plan = H.makePlan(form.start, form.exam, form.hrs, form.subs, form.start);
    waiting = false;
    $("make").disabled = false; $("make").textContent = "이번 주 계획 만들기";
    st.plan = plan; st.note = note;
    plan.days.forEach((d, di) => d.items.forEach((_, ii) => arrived.add(`${di}-${ii}`)));
    save(); renderProto();
    // 좁은 화면에서는 폼을 접고 계획을 보여 준다
    const card = document.querySelector(".goal-card");
    if (card.classList.contains("open")) $("editToggle").click();
    toast(plan.mode === "ai" ? "Claude가 이번 주 계획을 짰어요" : "이번 주 계획을 만들었어요", () => { st = before; save(); renderForm(); renderProto(); });
  });

  /* ---------- 계획 ---------- */
  function renderDday(s) {
    const left = H.daysLeft(st.exam, today());
    const C = 2 * Math.PI * 42;
    $("dday").innerHTML = `
      <div class="ring" role="img" aria-label="이번 주 ${s.pct}% 완료">
        <svg viewBox="0 0 104 104"><circle class="track" cx="52" cy="52" r="42"/><circle class="val" cx="52" cy="52" r="42" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - s.pct / 100)}"/></svg>
        <div class="in"><div><b>${s.pct}%</b><br><small>이번 주</small></div></div>
      </div>
      <div><p class="goal-t">${esc(st.goal || "목표를 정해 주세요")}</p><p class="left">시험까지 <b>${left > 0 ? left : 0}</b>일</p></div>`;
  }
  function renderCoach(s) {
    const parts = H.coachParts(st.plan, s, today()).map(([t, b]) => (b ? `<b>${esc(t)}</b>` : esc(t))).join("");
    const ai = st.plan && st.plan.mode === "ai" && st.plan.coach ? `<span class="ai-line"><span class="mode" data-mode="ai">Claude</span>${esc(st.plan.coach)}</span>` : "";
    $("coach").innerHTML = `<span class="face" aria-hidden="true">코치</span><p>${parts}${ai}<small>진행 상황 한마디는 체크할 때마다 규칙으로 바로 바뀌어요</small></p>`;
  }
  function renderMode() {
    const m = $("planMode");
    if (waiting) { m.dataset.mode = "wait"; m.innerHTML = "<i></i>Claude가 짜는 중"; return; }
    const p = st.plan;
    if (p && p.mode === "ai") { m.dataset.mode = "ai"; m.textContent = `Claude 계획 · 검사 통과${p.ms ? ` · ${(p.ms / 1000).toFixed(1)}초` : ""}`; }
    else { m.dataset.mode = "rule"; m.textContent = `규칙 계획${AI.status().enabled === false && AI.status().reason ? ` · ${AI.status().reason}` : ""}`; }
    $("planNote").hidden = !st.note;
    $("planNote").textContent = st.note || "";
  }
  function renderProto() {
    const t = today();
    const s = H.stats(st.plan, t);
    renderDday(s);
    $("phase").textContent = st.plan ? `${st.plan.phase} 단계 · 하루 ${st.hrs}시간 · 하루 2과목 이하, 7일째는 복습` : "";
    renderMode();
    renderCoach(s);
    const rp = $("replan");
    rp.textContent = s.missed ? `밀린 일 ${s.missed}개 다시 나누기` : "밀린 일 다시 나누기";
    rp.classList.toggle("warn", !!s.missed);

    const wk = $("week");
    if (waiting) {
      // 기다리는 동안만 보이는 빈 달력
      wk.className = "week skel";
      wk.innerHTML = Array.from({ length: 7 }, (_, i) => `<div class="day"><div class="day-h"><b>${H.weekday(H.addDays(t, i))} ${H.label(H.addDays(t, i))}</b></div><div class="items"><i></i><i></i>${i === 6 ? "" : "<i></i>"}</div></div>`).join("");
    } else if (!st.plan) {
      wk.className = "week empty-week";
      wk.innerHTML = `<b>아직 계획이 없어요</b>왼쪽에서 목표를 넣고 '이번 주 계획 만들기'를 눌러 주세요.`;
    } else {
      wk.className = "week";
      wk.innerHTML = st.plan.days.map((d, di) => {
        const past = d.date < t, isToday = d.date === t;
        const dn = d.items.filter((x) => x.done).length;
        return `<div class="day${isToday ? " today" : ""}${past ? " past" : ""}">
          <div class="day-h"><b>${H.weekday(d.date)} ${H.label(d.date)}</b><span class="${isToday ? "today-tag" : ""}">${isToday ? "오늘" : `${dn}/${d.items.length}`}</span></div>
          <div class="items">${d.items.map((x, ii) => {
            const key = `${di}-${ii}`;
            const cls = ["item", x.done ? "done" : "", past && !x.done ? "missed" : "", arrived.has(key) ? "arrived" : ""].join(" ");
            return `<label class="${cls}" style="--n:${di}"><input type="checkbox" data-d="${di}" data-i="${ii}" ${x.done ? "checked" : ""}>
              <span class="txt">${x.moved ? `<span class="moved">옮김</span>` : ""}<span class="mk">${esc(x.sub)}</span><em>${esc(x.act)} · ${H.fmtH(x.h)}</em></span></label>`;
          }).join("")}</div></div>`;
      }).join("");
    }
    arrived = new Set();
    renderCrew(s);
  }
  $("week").addEventListener("change", (e) => {
    const c = e.target; if (!c.dataset.d) return;
    st.plan.days[+c.dataset.d].items[+c.dataset.i].done = c.checked;
    save();
    // 전체를 다시 그리지 않고 이 줄만 바꿔서 형광펜이 그어지는 모습이 보이게 한다
    const t = today();
    const row = c.closest(".item");
    row.classList.toggle("done", c.checked);
    row.classList.toggle("missed", !c.checked && st.plan.days[+c.dataset.d].date < t);
    const s = H.stats(st.plan, t);
    renderDday(s); renderCoach(s);
    $("replan").textContent = s.missed ? `밀린 일 ${s.missed}개 다시 나누기` : "밀린 일 다시 나누기";
    $("replan").classList.toggle("warn", !!s.missed);
    const d = st.plan.days[+c.dataset.d];
    const span = c.closest(".day").querySelector(".day-h span");
    if (!span.classList.contains("today-tag")) span.textContent = `${d.items.filter((x) => x.done).length}/${d.items.length}`;
    renderCrew(s);
  });

  $("replan").addEventListener("click", () => {
    if (!st.plan) { toast("먼저 계획을 만들어 주세요"); return; }
    const r = H.replan(st.plan, today());
    if (r.reason === "none") { toast("밀린 일이 없어요. 잘하고 있어요"); return; }
    if (r.reason === "nofuture") { toast("남은 날이 없어요. 새 계획을 만들어 주세요"); return; }
    const before = snapshot();
    st.plan = r.plan;
    r.moved.forEach(([di, ii]) => arrived.add(`${di}-${ii}`));
    save(); renderProto();
    toast(`밀린 일 ${r.moved.length}개를 가벼운 날부터 나눴어요`, () => { st = before; save(); renderProto(); });
  });

  /* 스터디 진행률 (다른 스터디원은 샘플 값) */
  const CREW = [["하은", 72], ["지호", 58], ["수아", 41]];
  function renderCrew(s) {
    const rows = [...CREW.map(([n, p]) => ({ n, p })), { n: "나", p: s.pct, me: true }].sort((a, b) => b.p - a.p);
    $("crew").innerHTML = rows.map((r) => `<li class="${r.me ? "me" : ""}"><span>${r.n}</span><span class="bar"><i style="width:${r.p}%"></i></span><span class="pct">${r.p}%</span></li>`).join("");
  }

  $("reset").addEventListener("click", () => {
    const before = snapshot();
    const tab = st.tab;
    st = seed(); st.tab = tab;
    save(); renderForm(); renderProto(); renderEval();
    toast("샘플 계획으로 되돌렸어요", () => { st = before; save(); renderForm(); renderProto(); renderEval(); });
  });

  /* ---------- 기획서: 화면 흐름 (와이어프레임) ---------- */
  const SCREENS = [
    ["시작 · 목표 입력", "h i i i b"],
    ["주간 계획", "h g i i g i"],
    ["오늘 할 몫", "h g g i b"],
    ["밀린 일 다시 나누기", "h i i b"],
    ["스터디 진행률", "h g i g i"],
    ["코치 한마디", "h i i"],
    ["설정", "h i i i"],
  ];
  $("flow").innerHTML = SCREENS.map(([name, wf], i) =>
    `<li><div class="wf" aria-hidden="true">${wf.split(" ").map((c) => `<i class="${c}"></i>`).join("")}</div><b>S${i + 1}</b>${name}</li>`).join("");

  /* ---------- 프롬프트 평가표 ---------- */
  const CRIT = ["정확성", "구체성", "실행 가능성", "개인화", "말투"];
  // v3 = 지금 서비스(/api/demo/ai 의 study.plan)가 실제로 쓰는 지시문
  const V3_PROMPT = `시험 준비생의 이번 주 7일 공부 계획을 짠다. input.today부터 7일, 하루 총 학습 시간은 hoursPerDay를 넘기지 않는다. 하루 과목은 2개 이하, 7일째는 복습. phase는 남은 기간에 맞는 단계 이름(개념 정리, 기출 반복, 실전 모의 등). coach는 응원보다 구체적 조언 한 문장. 모든 문장은 한국어로, 짧고 구체적으로 쓴다. 반드시 JSON 하나만 출력하고 다른 말은 쓰지 않는다.
출력 형식: {"phase":"","days":[{"date":"YYYY-MM-DD","items":[{"subject":"","task":"","minutes":60}]}],"coach":""}`;
  const VERS = [
    {
      name: "v1 · 한 줄 요청", s: [3, 2, 2, 1, 3],
      why: "과목만 나열했고, 하루 시간과 시험일을 반영하지 못했어요.",
      prompt: "정보처리기사 공부 계획 짜 줘.",
      answer: "1. 소프트웨어 설계를 공부합니다.\n2. 소프트웨어 개발을 공부합니다.\n3. 데이터베이스를 공부합니다.\n…\n꾸준히 하면 합격할 수 있습니다!",
    },
    {
      name: "v2 · 조건 추가", s: [4, 4, 3, 3, 3],
      why: "시간 배분은 맞지만 하루에 4~5과목을 넣어 지키기 어려웠어요.",
      prompt: "시험 4주 전, 하루 2시간. 정보처리기사 필기 5과목으로 7일 계획을 표로 만들어 줘.",
      answer: "| 요일 | 할 일 |\n| 월 | 설계 30분, 개발 30분, DB 30분, 언어 30분 |\n| 화 | 구축 40분, 설계 40분, 개발 40분 |\n…",
    },
    {
      name: "v3 · 규칙·JSON·검사", s: [5, 5, 5, 4, 5],
      why: "하루 2과목·7일째 복습 규칙에 JSON 형식을 더해, 화면이 답을 검사할 수 있게 했어요. 지금 서비스가 쓰는 지시문이에요.",
      prompt: V3_PROMPT,
      answer: null, // 아래 '지금 실행해 보기'로 실제 답을 받는다
    },
  ];
  const dots = (n) => `<span class="dots" aria-label="${n}점">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
  const EVAL_INPUT = { goal: "정보처리기사 필기 합격", hrs: 2, subs: ["소프트웨어 설계", "소프트웨어 개발", "데이터베이스", "프로그래밍 언어", "정보시스템 구축"] };
  let evalBusy = false;
  function liveHtml() {
    const l = st.live;
    if (evalBusy) return `<div class="live skel-line"><i></i><i></i><i></i></div>`;
    if (!l) return `<p class="live-empty">아직 실행하지 않았어요. 오늘 날짜로 시험 4주 전 · 하루 2시간 · 5과목을 넣어 실행해요.</p>`;
    const head = l.mode === "ai"
      ? `<span class="mode" data-mode="ai">Claude 답 · 검사 ${l.ok ? "통과" : "실패"} · ${(l.ms / 1000).toFixed(1)}초</span>`
      : `<span class="mode" data-mode="rule">AI 연결 안 됨 · 규칙 계획으로 대신 보여 줘요</span>`;
    const lines = l.plan.days.map((d) => `${H.weekday(d.date)}  ${d.items.map((x) => `${x.sub} · ${x.act} (${Math.round(x.h * 60)}분)`).join("\n    ")}`).join("\n");
    return `<div class="live">${head}${l.reason ? `<p class="plan-note">${esc(l.reason)}</p>` : ""}<p class="answer">${esc(lines)}${l.coach ? `\n\n${esc(l.coach)}` : ""}</p></div>`;
  }
  function renderEval() {
    const p = st.evalPick ?? 2;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    $("scoreTable").innerHTML = `<table class="st">
      <thead><tr><th>기준 (5점)</th>${VERS.map((v, i) => `<th><button type="button" data-v="${i}" aria-pressed="${i === p}">${v.name.split(" · ")[0]}</button></th>`).join("")}</tr></thead>
      <tbody>${CRIT.map((c, ci) => `<tr><td class="crit">${c}</td>${VERS.map((v, i) => `<td class="${i === p ? "col-sel" : ""}">${dots(v.s[ci])}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td>합계 (25점)</td>${VERS.map((v, i) => `<td class="${i === p ? "col-sel" : ""}">${sum(v.s)}</td>`).join("")}</tr></tfoot>
    </table>`;
    const v = VERS[p];
    $("ver").innerHTML = `<h2>${v.name}${p === 2 ? `<span class="pick">채택 · 서비스에서 사용 중</span>` : ""}</h2><p class="why">${v.why}</p>
      <h3>${p === 2 ? "지시문 (서버 /api/demo/ai · study.plan)" : "프롬프트"}</h3><pre>${esc(v.prompt)}</pre>
      ${v.answer !== null ? `<h3>받은 답 (일부)</h3><p class="answer">${esc(v.answer)}</p>`
        : `<div class="run-h"><h3>지금 실행해 보기</h3><button type="button" class="ghost" id="runV3" ${evalBusy ? "disabled" : ""}>${st.live ? "다시 실행" : "v3로 실행"}</button></div>${liveHtml()}`}`;
  }
  $("scoreTable").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    st.evalPick = Number(b.dataset.v); save(); renderEval();
    $("scoreTable").querySelector(`[data-v="${b.dataset.v}"]`).focus();
  });
  $("ver").addEventListener("click", async (e) => {
    if (e.target.id !== "runV3" || evalBusy) return;
    const form = { ...EVAL_INPUT, start: today(), exam: H.addDays(today(), 28) };
    evalBusy = true; renderEval();
    const r = await AI.ask("study.plan", H.planInput(form));
    evalBusy = false;
    if (r) {
      const c = H.checkPlan(r.data, form);
      st.live = c.ok ? { mode: "ai", ok: true, ms: r.ms, plan: c.plan, coach: c.plan.coach }
        : { mode: "ai", ok: false, ms: r.ms, plan: H.makePlan(form.start, form.exam, form.hrs, form.subs), reason: `검사에서 걸린 이유: ${c.reason} → 서비스에서는 규칙 계획을 보여 줘요` };
    } else {
      st.live = { mode: "rule", plan: H.makePlan(form.start, form.exam, form.hrs, form.subs) };
    }
    save(); renderEval();
  });

  // 좁은 화면에서 입력 폼 펼치기·접기
  $("editToggle").addEventListener("click", (e) => {
    const card = e.currentTarget.closest(".goal-card");
    const open = card.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "접기" : "목표·과목 고치기";
    if (open) $("goal").focus();
  });

  /* ---------- 시작 ---------- */
  showTab(st.tab || "proto");
  renderForm();
  renderProto();
  renderEval();
  AI.probe().then(() => renderMode());
})();
