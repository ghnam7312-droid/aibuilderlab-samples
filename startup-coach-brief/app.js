/* 미리봄 — 화면 (DOM 다루기만 한다. 경력·진단·권한·리포트는 logic.js, AI 호출은 ai-client.js)
 *
 * '사전 진단 만들기'를 누르면
 *   1) 규칙으로 바로 진단해 보여 주고 (기다리지 않게)
 *   2) 이름·연락처를 가린 설문과 이력서를 Claude에게 보내 문장을 다듬는다.
 *      돌아온 형식이 틀리면 버리고 1)을 그대로 둔다. 주의 신호는 어느 쪽이든 규칙 것을 쓴다.
 * 상담 메모는 고객용 요약 리포트로 바뀌고, 이력서 파일은 본인·담당 코치만 연다.
 */
(function () {
  "use strict";
  const L = window.Miribom;
  const STORE_KEY = "startup-coach-brief-v1";
  const COACH = "coachA";
  const VIEWERS = [
    { key: "coachA", role: "coach", id: "coachA", label: "담당 코치", note: "이직나침반" },
    { key: "self", role: "client", id: null, label: "고객 본인", note: "로그인한 본인" },
    { key: "coachB", role: "coach", id: "coachB", label: "다른 코치", note: "같은 플랫폼" },
    { key: "guest", role: "guest", id: "anon", label: "로그인 안 한 방문자", note: "주소만 아는 사람" },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dayLabel = (n, h) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]}) ${h}`; };

  /* ---------- 샘플 고객 3명 (모두 가상) ---------- */
  function seedClients() {
    return [
      { id: "c1", name: "한지우", file: "f8k2q", when: dayLabel(1, "10:00"), target: "hr",
        worry: "대학 행정 일만 10년 가까이 했는데 이 경력이 HR에서 인정될까요? 연봉이 조금 줄어도 괜찮지만 3년 뒤가 걱정돼요.",
        resume: `한지우 / 010-2841-5530 / jiwoo.han@example.com
경력
2018.03 - 현재  가람대학교 학사지원팀 · 행정 주임
 - 교직원 채용 공고·서류 접수 운영 (연 4회, 지원자 600명 규모)
 - 학사 규정 개정안 정리, 교내 설명회 12회 진행
 - 엑셀로 장학금 대상자 선정 자동화
2016.01 - 2018.02  누리교육재단 · 사무 계약직
 - 강사 계약서 관리, 교육 일정 운영
자격·교육
 - 사회조사분석사 2급
 - HR 기초 온라인 과정 수료 (2025)`,
        memo: `- 채용 운영 600명 규모 경험을 'HR 채용 실무'로 바꿔 말해 보기로 함
- 연봉 하한선은 지금의 90%로 정리
# 3년 뒤 걱정을 여러 번 말함. 다음 상담에서 다시 다루기
→ 이력서 첫 문단을 HR 직무 기준으로 다시 쓰기
→ HR 담당자 2명에게 커피챗 요청하기` },
      { id: "c2", name: "오세린", file: "p3m9d", when: dayLabel(2, "19:30"), target: "pm",
        worry: "매장 매니저 5년 차인데 서비스 기획으로 가고 싶어요. 요즘 잠을 잘 못 자고 불안해서 결정을 못 하겠어요.",
        resume: `오세린 / 010-7713-2094 / serin.oh@example.com
경력
2021.02 - 현재  바람결리빙 성수점 · 매장 매니저
 - 고객 불만 유형을 정리해 응대 매뉴얼 개선, 재방문 문의 30% 감소
 - 주간 매출 지표 보고, 진열 실험 3회 진행
 - 직원 6명 근무표·교육 담당
2019.07 - 2021.01  바람결리빙 · 판매 사원
 - 신규 회원 가입 안내`,
        memo: "" },
      { id: "c3", name: "마도현", file: "z1x7t", when: dayLabel(3, "20:00"), target: "da",
        worry: "QA로 4년 일했는데 지난달 권고사직 통보를 받았어요. 위로금 조건이 맞는지도 모르겠고, 데이터 분석으로 바로 가도 될까요?",
        resume: `마도현 / 010-5520-8841 / dohyun.ma@example.com
경력
2022.04 - 2026.09  스텝온소프트 · QA 엔지니어
 - 테스트 결과를 SQL로 뽑아 주간 결함 대시보드 운영
 - 반복 테스트 파이썬 스크립트로 자동화 (주 6시간 절약)
 - 출시 전 품질 지표 보고
교육
 - 데이터 분석 부트캠프 수강 중 (2026.08~)`,
        memo: "" },
    ];
  }
  function seed() {
    return { cur: "c1", clients: seedClients(), diag: {}, ai: {}, checked: {}, viewer: "coachA", log: [], link: null };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.clients) && v.clients.length === 3 && v.diag) return { ...v, link: null };
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  // 열람 주소(link)는 저장하지 않는다
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...st, link: null })); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;
  const client = () => st.clients.find((c) => c.id === st.cur);

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

  /* ---------- 고객 고르기 ---------- */
  function renderClients() {
    $("clients").innerHTML = st.clients.map((c) => {
      const flagged = L.safetyFlags(c.worry + "\n" + c.memo).length > 0;
      return `<button type="button" data-c="${c.id}" aria-pressed="${c.id === st.cur}"><span class="av" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>
        <span><b>${esc(c.name)} · ${esc(L.TARGETS[c.target].label)}</b><small>${esc(c.when)} 상담${flagged ? " · 확인할 신호 있음" : ""}</small></span>${flagged ? `<i class="dot" aria-hidden="true"></i>` : ""}</button>`;
    }).join("");
  }
  $("clients").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]");
    if (!b || b.dataset.c === st.cur) return;
    st.cur = b.dataset.c; st.link = null;
    $("aclRes").className = "acl-res"; $("aclRes").innerHTML = "";
    fillForm(); renderAll();
    if (!st.diag[st.cur]) run();
    save();
  });

  /* ---------- 왼쪽: 설문·이력서 ---------- */
  $("target").innerHTML = Object.entries(L.TARGETS).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("");
  function fillForm() {
    const c = client();
    $("target").value = c.target; $("worry").value = c.worry; $("resume").value = c.resume; $("memo").value = c.memo;
    inInfo();
  }
  function inInfo() {
    const c = L.parseCareer($("resume").value, todayIso());
    $("inInfo").textContent = `경력 ${c.jobs.length}곳 · 총 ${L.yearsLabel(c.months)}`;
  }
  ["target", "worry", "resume"].forEach((id) => $(id).addEventListener("input", () => {
    const c = client(); c.target = $("target").value; c.worry = $("worry").value; c.resume = $("resume").value;
    inInfo(); save();
  }));
  $("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });

  /* ---------- 오른쪽: 진단 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다듬는 중</span>`;
    const a = st.ai[st.cur] || {};
    if (a.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(a.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 핵심어 점검표로 진단했어요">규칙 기반${a.reason ? ` · ${esc(a.reason)}` : ""}</span>`;
  }
  function renderOut() {
    const d = st.diag[st.cur];
    if (!d) { $("out").innerHTML = `<div class="empty-out"><div><b>아직 진단 전이에요</b><br>'사전 진단 만들기'를 누르세요.</div></div>`; return; }
    const span = Math.max(1, ...d.career.jobs.map((j) => j.to - j.from + 1));
    const fmt = (m) => `${Math.floor(m / 12)}.${pad((m % 12) + 1)}`; // 2018.03
    const checked = st.checked[st.cur] || [];
    $("out").innerHTML = `
      <div class="pane-h"><h2 class="t">사전 진단 · ${esc(client().name)}</h2>${modeChip()}</div>
      <div class="res${waiting ? " waiting" : ""}">
      <p class="summary">${esc(d.summary)}</p>
      ${d.flags.length ? `<div class="flags" role="note" aria-label="사람이 확인할 신호">${d.flags.map((f) => `<div class="flag"><b>${esc(f.label)} · 코치가 직접 확인</b> 고민에 <span class="hit">${esc(f.hit)}</span> 표현이 있어요.<p>${esc(f.action)}</p></div>`).join("")}</div>` : ""}
      <div class="blk"><h3>경력 ${esc(L.yearsLabel(d.career.months))}</h3>
        <ul class="timeline">${d.career.jobs.map((j) => `<li><span class="when">${fmt(j.from)} – ${fmt(j.to)}</span><span>${esc(j.org)}${j.role ? ` · ${esc(j.role)}` : ""}<div class="bar-y" style="width:${Math.round(((j.to - j.from + 1) / span) * 100)}%"></div></span></li>`).join("") || `<li>경력 줄을 찾지 못했어요</li>`}</ul></div>
      <div class="blk"><h3>옮겨 갈 강점</h3><ul class="ul">${d.strengths.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>핵심어가 겹치는 업무 줄이 없어요</li>"}</ul></div>
      <div class="blk"><h3>${esc(d.target)} 핵심어</h3><div class="chips">${d.hit.map((k) => `<span class="chip hit">${esc(k)}</span>`).join("")}${d.gaps.map((k) => `<span class="chip gap">채울 부분 · ${esc(k)}</span>`).join("")}</div></div>
      <div class="blk"><h3>상담에서 물어볼 질문</h3><ul class="qs">${d.questions.map((q, i) => `<li><label><input type="checkbox" data-q="${i}" ${checked.includes(i) ? "checked" : ""}><span>${esc(q)}</span></label></li>`).join("")}</ul></div>
      </div>`;
  }
  $("out").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-q]"); if (!cb) return;
    const i = Number(cb.dataset.q);
    const list = new Set(st.checked[st.cur] || []);
    cb.checked ? list.add(i) : list.delete(i);
    st.checked[st.cur] = [...list]; save();
  });

  async function run() {
    const c = client();
    if (!c.resume.trim()) { toast("이력서를 먼저 붙여 넣어 주세요"); $("resume").focus(); return; }
    const my = ++runToken;
    const id = c.id;
    const t = todayIso();
    const rule = L.ruleDiagnose(c, t);
    st.diag[id] = rule; st.ai[id] = { mode: "rule", reason: "" }; st.checked[id] = [];
    waiting = AI.status().enabled !== false;
    renderOut(); renderReport(); renderClients();
    const r = await AI.ask("coachbrief.diagnose", L.aiInput(c));
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 버린다
    waiting = false;
    const n = r && L.normalizeDiagnose(r.data);
    if (n) { st.diag[id] = L.mergeDiagnose(rule, n); st.ai[id] = { mode: "ai", ms: r.ms }; }
    else st.ai[id] = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    save(); renderOut(); renderReport();
    toast(`${st.ai[id].mode === "ai" ? "Claude가" : "규칙으로"} 질문 ${st.diag[id].questions.length}개를 준비했어요${rule.flags.length ? ` · 확인할 신호 ${rule.flags.length}건` : ""}`);
  }

  /* ---------- 상담 메모 → 리포트 ---------- */
  function renderReport() {
    const c = client();
    $("report").textContent = L.buildReport(c, st.diag[c.id], c.memo, c.when.split(" ")[0]);
  }
  $("memo").addEventListener("input", () => { client().memo = $("memo").value; renderReport(); renderClients(); save(); });
  $("copy").addEventListener("click", async () => {
    const text = $("report").textContent;
    try { await navigator.clipboard.writeText(text); toast("리포트를 복사했어요. 연락처와 코치 전용 줄은 빠져 있어요"); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($("report")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("선택해 두었어요. 직접 복사해 주세요"); }
  });
  $("print").addEventListener("click", () => window.print());

  /* ---------- 이력서 파일 권한 ---------- */
  const fileOf = (c) => ({ id: c.file, owner: c.id, coach: COACH });
  const viewerOf = (key) => { const v = VIEWERS.find((x) => x.key === key); return { role: v.role, id: v.id || st.cur, label: v.label }; };
  function renderViewers() {
    $("viewers").innerHTML = `<legend class="fld">누구로 열어 볼까요</legend>` + VIEWERS.map((v) =>
      `<label><input type="radio" name="viewer" value="${v.key}" ${v.key === st.viewer ? "checked" : ""}>${esc(v.label)}<small>${esc(v.note)}</small></label>`).join("");
  }
  $("viewers").addEventListener("change", (e) => { if (e.target.name === "viewer") { st.viewer = e.target.value; save(); } });
  function logAccess(who, ok, why) {
    st.log.unshift({ t: hm(Date.now()), who, ok, why });
    st.log = st.log.slice(0, 12); save(); renderLog();
  }
  function renderLog() {
    $("aclLog").innerHTML = st.log.map((l) => `<li><span>${esc(l.t)}</span><span>${esc(l.who)}</span><span class="${l.ok ? "r-ok" : "r-no"}">${l.ok ? "열림" : `막힘 · ${esc(l.why)}`}</span></li>`).join("");
  }
  function showRes(ok, title, body) {
    $("aclRes").className = `acl-res ${ok ? "ok" : "no"}`;
    $("aclRes").innerHTML = `<b>${esc(title)}</b>${body}`;
  }
  $("open").addEventListener("click", () => {
    const c = client(), v = viewerOf(st.viewer), now = Date.now();
    const link = L.issueLink(fileOf(c), v, now);
    if (!link) {
      st.link = null;
      showRes(false, "열 수 없어요", `이 이력서는 고객 본인과 담당 코치만 열 수 있어요. 주소를 알아도 열리지 않아요.`);
      logAccess(v.label, false, "권한 없음");
      return;
    }
    st.link = { ...link, key: st.viewer };
    showRes(true, `열림 · ${hm(link.exp)}까지 쓸 수 있는 주소`, `<code>${esc(link.url)}</code><br>주소에는 이름이 들어가지 않아요.`);
    logAccess(v.label, true, "");
  });
  $("later").addEventListener("click", () => {
    if (!st.link) { toast("먼저 '이력서 파일 열기'로 주소를 받아 주세요"); return; }
    const c = client(), v = viewerOf(st.viewer);
    const r = L.verifyLink(st.link, fileOf(c), v, Date.now() + 11 * 60 * 1000);
    if (r.ok) { showRes(true, "열림", ""); logAccess(v.label, true, ""); return; }
    showRes(false, `열 수 없어요 · ${r.reason}`, r.reason === "만료됨" ? "10분이 지난 주소는 다시 열리지 않아요. 새로 열면 새 주소를 받아요." : "주소는 받은 사람만 쓸 수 있어요.");
    logAccess(v.label, false, r.reason);
  });

  /* ---------- 되돌리기 ---------- */
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); fillForm(); renderAll(); run();
    toast("샘플로 되돌렸어요", () => { st = before; save(); fillForm(); renderAll(); });
  });

  function renderAll() { renderClients(); renderOut(); renderReport(); renderViewers(); renderLog(); }

  /* ---------- 시작 ---------- */
  fillForm(); renderAll();
  AI.probe().then(() => { if (!st.diag[st.cur] || !st.ai[st.cur] || st.ai[st.cur].mode !== "ai") run(); });
})();
