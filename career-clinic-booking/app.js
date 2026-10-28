/* 천천예약 — 화면 (DOM 다루기만 한다. 시간표·검사·배치 계산·정리 규칙은 logic.js, AI 호출은 ai-client.js)
 *
 * 왼쪽: 휴대폰 폭(320/375/430)·글자 크기·시안(v1/v2)을 바꿔 가며 실제로 눌러 보는 예약 시제품.
 *       아래 '배치 점검'이 그 조합에서 버튼이 겹치는지 계산해 보여 준다.
 * 오른쪽: 50~60대 5명 사용성 테스트 기록 → 완료율·단계별 이탈 → 메모 정리.
 *   '메모 정리하기'는 1) 규칙으로 바로 묶어 보여 주고 2) Claude(clinicbooking.issues) 결과가 오면 덮어쓴다.
 */
(function () {
  "use strict";
  const L = window.Cheoncheon;
  const STORE_KEY = "career-clinic-booking-v1";
  const DEPTS = [
    { id: "int", name: "내과 진료", sub: "한도윤 원장 · 감기, 혈압·당뇨 관리" },
    { id: "fam", name: "가정의학과 진료", sub: "서은재 원장 · 일반 진료, 상담" },
    { id: "vac", name: "예방접종", sub: "독감 등 접종 예약" },
    { id: "chk", name: "건강검진", sub: "검진 상담 · 검사 예약" },
  ];
  const PEOPLE = [["P1", "50대 후반"], ["P2", "60대 초반"], ["P3", "50대 중반"], ["P4", "60대 중반"], ["P5", "50대 후반"]];
  const STEP_NAME = Object.fromEntries(L.STEPS);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  /* ---------- 샘플 테스트 기록: 처음 시안 13회 중 7회, 고친 시안 14회 중 12회 완료 ---------- */
  function sampleTrials() {
    const T = (pid, version, done, quit, memo) => ({ pid, version, done, quit: done ? "" : quit, memo });
    const raw = [
      T("P1", "v1", false, "time", "시간 버튼이 다닥다닥 붙어 10:00 누르려다 10:30이 눌림"),
      T("P1", "v1", true, "", "오래 걸렸지만 완료, 두 번 되돌아감"),
      T("P1", "v1", true, "", ""),
      T("P2", "v1", false, "time", "아래 버튼이 겹쳐 보여서 '다음'이 어디인지 못 찾음"),
      T("P2", "v1", false, "info", "본인 인증 문자 기다리다 시간 초과"),
      T("P2", "v1", true, "", "딸에게 물어보고 끝냄"),
      T("P3", "v1", true, "", ""),
      T("P3", "v1", true, "", "글자가 작다고 함"),
      T("P4", "v1", false, "dept", "진료과 이름이 무슨 말인지 모르겠다고 함"),
      T("P4", "v1", false, "time", "글씨가 작아 돋보기 꺼냄, 날짜 칸을 못 찾음"),
      T("P4", "v1", true, "", ""),
      T("P5", "v1", false, "info", "번호 입력 때 문자 자판이 떠서 헤맴"),
      T("P5", "v1", true, "", ""),
      T("P1", "v2", true, "", "다음 버튼이 바로 보여서 좋다고 함"),
      T("P1", "v2", true, "", ""),
      T("P1", "v2", true, "", ""),
      T("P2", "v2", true, "", "글자가 커서 안경 없이 봄"),
      T("P2", "v2", false, "info", "휴대폰 번호 입력에서 앞자리를 두 번 씀"),
      T("P2", "v2", true, "", ""),
      T("P3", "v2", true, "", ""),
      T("P3", "v2", true, "", "전화로 예약 버튼이 있어 안심된다고 함"),
      T("P4", "v2", true, "", "모르는 과는 전화 안내로 넘어감"),
      T("P4", "v2", false, "time", "토요일 오후를 찾다가 휴진인 줄 모르고 멈춤"),
      T("P4", "v2", true, "", ""),
      T("P5", "v2", true, "", ""),
      T("P5", "v2", true, "", "숫자 자판이 바로 떠서 편하다고 함"),
      T("P5", "v2", true, "", ""),
    ];
    return raw.map((t, i) => ({ id: `s${i + 1}`, ...t }));
  }
  function seed() {
    const t = today();
    // 이미 찬 시간 몇 개 (예약 마감 칸이 보이게)
    const firstOpen = L.days(t, 7).find((d) => !d.closed && d.date !== t) || L.days(t, 7)[1];
    const booked = ["09:30", "10:00", "11:30"].map((time) => ({ id: `seed-${time}`, dept: "int", date: firstOpen.date, time, who: "예*", phone: "", phoneKey: "", code: "" }));
    return {
      ver: "v2", w: 375, s: 1, filter: "all", sumVer: "v1",
      flow: { step: 1, dept: "int", date: firstOpen.date, time: "10:30", name: "김영숙", phone: "010-2345-6789", help: false, done: null, err: {} },
      bookings: booked, trials: sampleTrials(), issues: null, ai: { mode: "rule", reason: "" },
    };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.flow && Array.isArray(v.trials) && Array.isArray(v.bookings)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  // 저장할 때 입력 중인 이름·번호는 빼고 저장한다
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...st, flow: { ...st.flow, name: "", phone: "" } })); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }

  // 브라우저가 주는 영어 오류는 한국어로 바꿔 보여 준다
  const why = (r) => (/fetch|network|load failed/i.test(r || "") ? "서버에 연결할 수 없음" : r || "");
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${why(s.reason) || "AI 꺼짐"}`;
  });

  /* ---------- 시제품 화면 ---------- */
  function renderTools() {
    document.querySelectorAll("[data-ver]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ver === st.ver)));
    document.querySelectorAll("[data-w]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.w === st.w)));
    document.querySelectorAll("[data-s]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.s === st.s)));
  }
  function screenHtml() {
    const f = st.flow;
    if (f.done) {
      const d = DEPTS.find((x) => x.id === f.done.dept);
      return `<div class="done-box"><div class="big"><svg width="38" height="38" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <h3>예약됐어요</h3><p>예약 번호</p><p class="code">${esc(f.done.code)}</p>
        <dl class="summary"><div><dt>진료</dt><dd>${esc(d ? d.name : "")}</dd></div><div><dt>날짜</dt><dd>${esc(L.dayLabel(f.done.date))} ${esc(f.done.time)}</dd></div><div><dt>예약한 분</dt><dd>${esc(f.done.who)} · ${esc(f.done.phone)}</dd></div></dl>
        <p class="callout">하루 전에 문자로 다시 알려 드려요. (시제품이라 실제 문자는 가지 않아요)</p></div>`;
    }
    if (f.step === 0) {
      return `<h3>어떤 진료를 예약할까요?</h3>
        <div class="opts">${DEPTS.map((d) => `<button type="button" class="opt" data-dept="${d.id}" aria-pressed="${f.dept === d.id}"><b>${esc(d.name)}</b><span>${esc(d.sub)}</span></button>`).join("")}</div>
        <button type="button" class="help" id="helpBtn" aria-expanded="${f.help}">어느 쪽인지 잘 모르겠어요</button>
        ${f.help ? `<p class="callout">접수처에 전화하시면 간호사가 맞는 진료를 안내해 드려요.<br><b>02-000-0000</b> (시제품용 번호)</p>` : ""}
        <p class="urgent">숨이 차거나 가슴이 아프면 예약하지 말고 바로 119에 연락하세요.</p>`;
    }
    if (f.step === 1) {
      const lay = L.slotLayout(st.w, st.ver, st.s);
      const list = L.days(today(), 7);
      const sl = L.slots(f.date, f.dept, st.bookings, { date: today(), time: nowHm() });
      return `<h3>언제 오실 건가요?</h3>
        <div class="days" role="group" aria-label="날짜">${list.map((d) => `<button type="button" class="day" data-date="${d.date}" aria-pressed="${f.date === d.date}" ${d.closed ? "disabled" : ""}>${esc(d.label)}${d.closed ? " 휴진" : ""}</button>`).join("")}</div>
        ${sl.length ? `<div class="slots" role="group" aria-label="시간" style="--cols:${lay.cols};--h:${lay.h}px;--px:${lay.px}px">${sl.map((x) => `<button type="button" class="slot" data-time="${x.time}" aria-pressed="${f.time === x.time}" ${x.open ? "" : "disabled"} aria-label="${x.time}${x.taken ? " 예약 마감" : x.open ? "" : " 지난 시간"}">${x.time}${x.taken ? "<small>마감</small>" : ""}</button>`).join("")}</div>`
          : `<p class="empty-day">이날은 진료하지 않아요. 다른 날짜를 골라 주세요.</p>`}`;
    }
    if (f.step === 2) {
      const e = f.err || {};
      return `<h3>예약하시는 분을 알려 주세요</h3>
        <label class="field">이름<input id="pName" autocomplete="name" value="${esc(f.name)}" ${e.name ? `aria-invalid="true" aria-describedby="eName"` : ""}>${e.name ? `<span class="err" id="eName">${esc(e.name)}</span>` : ""}</label>
        <label class="field">휴대폰 번호<input id="pPhone" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" value="${esc(f.phone)}" ${e.phone ? `aria-invalid="true" aria-describedby="ePhone"` : ""}>${e.phone ? `<span class="err" id="ePhone">${esc(e.phone)}</span>` : ""}</label>
        <p class="callout">본인 인증 없이 이름과 번호만 받아요. 병원에 오시면 접수처에서 확인해요.</p>`;
    }
    const d = DEPTS.find((x) => x.id === f.dept);
    return `<h3>이대로 예약할까요?</h3>
      <dl class="summary"><div><dt>진료</dt><dd>${esc(d.name)}</dd></div><div><dt>날짜</dt><dd>${esc(L.dayLabel(f.date))}</dd></div><div><dt>시간</dt><dd>${esc(f.time)}</dd></div><div><dt>예약하는 분</dt><dd>${esc(L.maskName(f.name))} · ${esc(L.maskPhone(f.phone))}</dd></div></dl>
      ${f.err && f.err.book ? `<p class="urgent" role="alert">${esc(f.err.book)}</p>` : ""}`;
  }
  function canNext() {
    const f = st.flow;
    if (f.step === 0) return !!f.dept;
    if (f.step === 1) return !!f.time;
    return true;
  }
  function navHtml() {
    const f = st.flow;
    if (f.done) return `<button type="button" class="go" data-nav="again">처음으로</button><button type="button" data-nav="cancel">예약 취소</button><button type="button" data-nav="call">전화로 예약</button>`;
    // 처음 시안은 데스크톱 시안의 긴 문구 그대로 (그래서 휴대폰에서 겹쳤다)
    const [lp, lc, ln] = st.ver === "v1" ? L.V1_BAR : L.V2_BAR;
    const next = f.step === 3 ? (st.ver === "v1" ? "예약 신청 완료하기" : "예약하기") : ln;
    return `<button type="button" class="go" data-nav="next" ${canNext() ? "" : "disabled"}>${next}</button><button type="button" data-nav="prev" ${f.step === 0 ? "disabled" : ""}>${lp}</button><button type="button" data-nav="call">${lc}</button>`;
  }
  function renderPhone() {
    const ph = $("phone");
    ph.className = `phone ${st.ver}`;
    ph.style.width = `${st.w + 16}px`; // 테두리 8px × 2를 더해 안쪽 폭을 맞춘다
    ph.style.setProperty("--s", st.s);
    const f = st.flow;
    // 저장해 둔 날짜가 지났으면 가장 가까운 진료일로
    if (!f.date || f.date < today()) f.date = (L.days(today(), 7).find((d) => !d.closed) || { date: today() }).date;
    const step = f.done ? 4 : f.step;
    $("phStep").textContent = f.done ? "예약 완료" : `${f.step + 1} / 4 · ${L.STEPS[f.step][1]}`;
    $("phBar").style.width = `${(Math.min(step + 1, 4) / 4) * 100}%`;
    $("screen").innerHTML = screenHtml();
    const bar = L.barLayout(st.w, st.ver, st.s);
    $("phNav").className = `ph-bar${st.ver === "v2" && bar.rows === 1 ? " wide" : ""}`;
    $("phNav").innerHTML = navHtml();
    renderCheck();
  }
  function renderCheck() {
    const issues = L.layoutIssues(st.w, st.ver, st.s);
    const lay = L.slotLayout(st.w, st.ver, st.s);
    const box = $("check");
    box.className = `check ${issues.length ? "bad" : "ok"}`;
    box.innerHTML = `<h3>배치 점검 · ${issues.length ? `문제 ${issues.length}곳` : "겹침 0"} <span class="meta">${st.w}px · 글자 ${st.s === 1 ? "보통" : "크게"} · 시간 칸 ${lay.cols}칸 ${lay.w}×${lay.h}px</span></h3>
      ${issues.length ? `<ul>${issues.map((i) => `<li><b>${esc(i.where)}</b> — ${esc(i.msg)}</li>`).join("")}</ul>` : `<ul><li>버튼끼리 겹치지 않고, 누르는 영역이 모두 44px 이상이에요.</li></ul>`}`;
  }

  $("screen").addEventListener("click", (e) => {
    const f = st.flow;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.dept) { f.dept = b.dataset.dept; f.time = ""; }
    else if (b.id === "helpBtn") f.help = !f.help;
    else if (b.dataset.date) { f.date = b.dataset.date; f.time = ""; }
    else if (b.dataset.time) f.time = b.dataset.time;
    else return;
    save(); renderPhone();
    const again = b.dataset.dept ? `[data-dept="${b.dataset.dept}"]` : b.dataset.date ? `[data-date="${b.dataset.date}"]` : b.dataset.time ? `[data-time="${b.dataset.time}"]` : "#helpBtn";
    document.querySelector(`#screen ${again}`)?.focus();
  });
  $("screen").addEventListener("input", (e) => {
    if (e.target.id === "pName") st.flow.name = e.target.value;
    if (e.target.id === "pPhone") st.flow.phone = e.target.value;
  });
  $("phNav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-nav]");
    if (!b) return;
    const f = st.flow;
    const act = b.dataset.nav;
    if (act === "call") { toast("시제품에서는 전화가 걸리지 않아요. 실제 화면은 접수처로 연결돼요"); return; }
    if (act === "prev") { f.step = Math.max(0, f.step - 1); f.err = {}; }
    if (act === "again") { f.done = null; f.step = 0; f.time = ""; }
    if (act === "cancel") {
      const gone = f.done;
      const before = st.bookings.slice();
      st.bookings = st.bookings.filter((x) => x.id !== gone.id);
      f.done = null; f.step = 1; f.time = "";
      toast("예약을 취소했어요", () => { st.bookings = before; f.done = gone; save(); renderPhone(); });
    }
    if (act === "next") {
      if (f.step === 2) {
        f.err = L.checkPatient(f);
        if (Object.keys(f.err).length) { renderPhone(); document.querySelector("#screen [aria-invalid]")?.focus(); return; }
        f.phone = L.fmtPhone(f.phone);
      }
      if (f.step === 3) {
        const r = L.book(st.bookings, f);
        if (!r.ok) { f.err = { book: r.error }; renderPhone(); return; }
        st.bookings = r.bookings; f.done = r.booking; f.err = {};
        toast(`예약 번호 ${r.booking.code} — 시제품 안에서만 저장돼요`);
      } else f.step++;
    }
    save(); renderPhone();
    $("phNav").querySelector(".go")?.focus();
  });
  document.querySelector(".tools").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.ver) st.ver = b.dataset.ver;
    if (b.dataset.w) st.w = +b.dataset.w;
    if (b.dataset.s) st.s = +b.dataset.s;
    save(); renderTools(); renderPhone();
  });

  /* ---------- 사용성 테스트 ---------- */
  function renderStats() {
    const a = L.completion(st.trials, "v1"), b = L.completion(st.trials, "v2");
    const card = (k, label, c) => `<div class="stat ${k}"><div class="k">${label}</div><div class="pct">${c.pct}%</div><div class="meta">${c.total}회 중 ${c.done}회 끝까지 예약</div><div class="meter"><i style="width:${c.pct}%"></i></div></div>`;
    $("stats").innerHTML = card("v1", "처음 시안 완료율", a) + card("v2", "고친 시안 완료율", b);
    const f1 = L.funnel(st.trials, "v1"), f2 = L.funnel(st.trials, "v2");
    $("funnel").innerHTML = `<caption>단계별로 몇 번 도달했나 (빨간 숫자 = 그 단계에서 멈춤)</caption>
      <thead><tr><th>단계</th><th>처음 시안</th><th>고친 시안</th></tr></thead>
      <tbody>${f1.map((x, i) => `<tr><td>${i + 1}. ${esc(x.label)}</td><td>${x.reached}${x.quit ? `<span class="q">−${x.quit}</span>` : ""}</td><td>${f2[i].reached}${f2[i].quit ? `<span class="q">−${f2[i].quit}</span>` : ""}</td></tr>`).join("")}</tbody>`;
  }
  function renderTrials() {
    document.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === st.filter)));
    const list = st.trials.filter((t) => st.filter === "all" || t.version === st.filter);
    $("trialN").textContent = list.length;
    $("trials").innerHTML = list.slice().reverse().map((t) => `<li><span class="pid">${esc(t.pid)}</span><span class="ver">${t.version === "v1" ? "처음" : "고친"}</span>
      <span class="res ${t.done ? "ok" : "quit"}">${t.done ? "완료" : `${esc(STEP_NAME[t.quit])}에서 멈춤`}</span>
      <span class="memo" title="${esc(t.memo)}">${esc(t.memo || "—")}</span>
      <button type="button" class="del" data-del="${esc(t.id)}" aria-label="${esc(t.pid)} 기록 지우기">✕</button></li>`).join("") || `<li><span class="none">기록이 없어요</span></li>`;
  }
  function renderIssues() {
    const box = $("issues");
    box.classList.toggle("waiting", waiting);
    if (!st.issues) { box.innerHTML = `<p class="fine">‘메모 정리하기’를 누르면 멈춘 기록의 메모를 단계·문제별로 묶어 드려요.</p>`; return; }
    const chip = waiting ? `<span class="mode" data-mode="wait"><i></i>Claude가 읽는 중</span>`
      : st.ai.mode === "ai" ? `<span class="mode" data-mode="ai">Claude로 정리 · ${(st.ai.ms / 1000).toFixed(1)}초</span>`
      : `<span class="mode" data-mode="rule">규칙 기반${st.ai.reason ? ` · ${esc(st.ai.reason)}` : ""}</span>`;
    box.innerHTML = `<div class="top"><span>${st.issues.ver === "v1" ? "처음" : "고친"} 시안 · 문제 ${st.issues.list.length}개${st.issues.summary ? ` — ${esc(st.issues.summary)}` : ""}</span>${chip}</div>
      <ol>${st.issues.list.map((i) => `<li class="issue"><div class="h"><span class="step">${esc(i.step)}</span>${esc(i.problem)}<span class="cnt">${i.count}회</span></div>
        ${i.evidence ? `<p>${esc(i.evidence)}</p>` : ""}<p class="fix">→ ${esc(i.fix)}</p></li>`).join("") || `<li class="issue"><p>메모가 있는 기록이 없어요.</p></li>`}</ol>`;
  }
  function renderForm() {
    $("fPid").innerHTML = PEOPLE.map(([p, age]) => `<option value="${p}">${p} · ${age}</option>`).join("");
    $("fRes").innerHTML = `<option value="done">끝까지 예약</option>` + L.STEPS.map(([k, n]) => `<option value="${k}">${n}에서 멈춤</option>`).join("");
  }

  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const res = $("fRes").value;
    const r = L.addTrial(st.trials, { pid: $("fPid").value, version: $("fVer").value, done: res === "done", quit: res === "done" ? "" : res, memo: $("fMemo").value });
    if (!r.ok) { toast(r.error); return; }
    const before = st.trials;
    st.trials = r.trials;
    $("fMemo").value = "";
    save(); renderStats(); renderTrials();
    toast(`${r.trial.pid} 기록을 더했어요`, () => { st.trials = before; save(); renderStats(); renderTrials(); });
  });
  $("trials").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-del]");
    if (!b) return;
    const idx = st.trials.findIndex((t) => t.id === b.dataset.del);
    const [gone] = st.trials.splice(idx, 1);
    save(); renderStats(); renderTrials();
    toast(`${gone.pid} 기록을 지웠어요`, () => { st.trials.splice(idx, 0, gone); save(); renderStats(); renderTrials(); });
  });
  document.querySelector(".list-h .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    st.filter = b.dataset.f; save(); renderTrials();
  });
  $("sumVer").addEventListener("change", () => { st.sumVer = $("sumVer").value; save(); });

  async function summarize() {
    const my = ++runToken;
    const ver = $("sumVer").value;
    st.sumVer = ver;
    st.issues = { ver, list: L.ruleIssues(st.trials, ver), summary: "" };
    st.ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderIssues();
    // 보내는 것은 참가자 코드·결과·메모뿐이다
    const input = { version: ver, trials: st.trials.filter((t) => t.version === ver).map((t) => ({ pid: t.pid, result: t.done ? "완료" : `${STEP_NAME[t.quit]}에서 멈춤`, memo: t.memo })), steps: L.STEPS.map((s) => s[1]) };
    const r = await AI.ask("clinicbooking.issues", input);
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeIssues(r.data);
    if (n) { st.issues = { ver, list: n.issues, summary: n.summary }; st.ai = { mode: "ai", ms: r.ms }; }
    else st.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : why(AI.status().reason) };
    save(); renderIssues();
  }
  $("runSum").addEventListener("click", () => { summarize().then(() => toast(`${st.ai.mode === "ai" ? "Claude가" : "규칙으로"} 문제 ${st.issues.list.length}개로 묶었어요`)); });
  $("csv").addEventListener("click", () => {
    const csv = L.trialsCsv(st.trials);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `천천예약-사용성테스트-${today().replace(/-/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`테스트 기록 ${st.trials.length}건을 CSV로 내려받았어요 (참가자 코드만)`);
  });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed();
    $("sumVer").value = st.sumVer;
    renderAll();
    summarize();
    toast("샘플로 되돌렸어요", () => { st = before; save(); $("sumVer").value = st.sumVer; renderAll(); });
  });

  function renderAll() { renderTools(); renderPhone(); renderStats(); renderTrials(); renderIssues(); }

  /* ---------- 시작 ---------- */
  renderForm();
  $("sumVer").value = st.sumVer || "v1";
  renderAll();
  AI.probe().then(() => { if (!st.issues) summarize(); });
})();
