/* 첫답 — 화면 (DOM 다루기만 한다. 분류·검사·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * 문의함의 모든 문의는 규칙으로 바로 분류해 둔다. 문의 하나를 열면
 *   1) 규칙 결과(분류·담당·초안)를 바로 보여 주고
 *   2) 가린 글(이름·연락처 없음)을 Claude 에게 보내 다시 분류한다. 돌아오면 덮어쓰고,
 *      형식이 틀리거나 초안에 약속 표현이 있으면 버린다.
 * 환불·보상, 안전·법률 문의는 어느 쪽이든 초안 없이 담당자에게 넘긴다.
 */
(function () {
  "use strict";
  const L = window.Cheotdap;
  const STORE_KEY = "ax-ticket-triage-v1";
  const BASE_NOW = L.toMin("10:30"); // 데모 기준 시각. 연 뒤로 실제 시간만큼 흐른다
  const opened = Date.now();
  const now = () => BASE_NOW + Math.floor((Date.now() - opened) / 60000);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 문의 (가상의 쇼핑몰 '솔담리빙') ---------- */
  const SAMPLE = [
    { id: "C-1041", at: "09:38", channel: "이메일", customer: "김민서", contact: "010-2345-6789", subject: "배송이 일주일째 안 와요", body: "주문번호 SD2610187로 접이식 식탁을 주문했는데 일주일째 출고 준비 중이에요. 이번 주말에 집들이가 있어서 급해요.", respondedAt: "10:05" },
    { id: "C-1042", at: "09:44", channel: "채팅", customer: "박지훈", contact: "010-5521-0934", subject: "환불 언제 되나요", body: "반품 수거는 지난주에 끝났는데 아직 환불이 안 들어왔어요. 카드 취소 내역도 없어요." },
    { id: "C-1043", at: "09:49", channel: "게시판", customer: "이수아", contact: "sua.lee@example.com", subject: "의자 색상이 사진이랑 달라요", body: "베이지로 주문했는데 회색에 가까운 색이 왔어요. 다른 색으로 교환하고 싶습니다.", respondedAt: "10:21" },
    { id: "C-1044", at: "09:53", channel: "채팅", customer: "최현우", contact: "010-8812-3047", subject: "비밀번호 재설정 문자가 안 와요", body: "로그인하려는데 인증번호 문자가 안 옵니다. 번호는 010-8812-3047 입니다." },
    { id: "C-1045", at: "09:58", channel: "이메일", customer: "정다은", contact: "daeun.j@example.com", subject: "조립하다가 손을 다쳤어요", body: "책장 조립하다가 선반 모서리에 손을 베여 상처가 났어요. 마감이 너무 날카로워요. 정다은 드림" },
    { id: "C-1046", at: "10:02", channel: "채팅", customer: "한도현", contact: "010-7340-1182", subject: "결제가 두 번 됐어요", body: "어제 쿠션 커버를 결제했는데 카드 승인 문자가 두 번 왔어요." },
    { id: "C-1047", at: "10:07", channel: "게시판", customer: "윤서진", contact: "seojin.y@example.com", subject: "러그 세탁 방법이 궁금해요", body: "거실 러그 소재가 뭔가요? 세탁기에 돌려도 되는지 궁금해요." },
    { id: "C-1048", at: "10:11", channel: "이메일", customer: "강예린", contact: "010-4410-2290", subject: "깨진 채로 왔어요, 보상 되나요", body: "유리 화병이 깨져서 도착했어요. 사진 첨부합니다. 보상 받을 수 있을까요?" },
    { id: "C-1049", at: "10:16", channel: "채팅", customer: "서준혁", contact: "010-2203-5567", subject: "송장번호가 안 보여요", body: "주문번호 SD2610233 송장번호가 안 보여요. 출고됐나요?" },
    { id: "C-1050", at: "10:20", channel: "게시판", customer: "문하린", contact: "harin.m@example.com", subject: "라탄 수납함 재입고", body: "라탄 수납함 큰 사이즈 재입고 예정이 있나요?" },
    { id: "C-1051", at: "10:24", channel: "채팅", customer: "오태윤", contact: "010-9087-6610", subject: "사이즈 교환 원해요", body: "침대 커버를 슈퍼싱글로 바꾸고 싶어요. 아직 포장 안 뜯었습니다." },
    { id: "C-1052", at: "10:27", channel: "이메일", customer: "임채원", contact: "chaewon.l@example.com", subject: "세 번째 문의입니다", body: "세 번째 문의인데 답이 없네요. 오늘까지 연락 없으면 소비자원에 신고하겠습니다." },
  ];

  /* ---------- 상태 ---------- */
  const seed = () => ({ tickets: SAMPLE.map((t) => ({ ...t })), overrides: {}, drafts: {}, sel: "C-1042", cat: "all", who: "all", seq: 1053 });
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.tickets) && v.tickets.length && typeof v.overrides === "object") return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  const aiCache = {}; // id → {n, ms} | {fail: 이유} (화면을 새로 열면 다시 묻는다)
  let pending = null;

  const ticket = (id) => st.tickets.find((t) => t.id === id);
  const namesOf = (t) => [t.customer].filter(Boolean);
  const masked = (t) => ({ subject: L.maskPii(t.subject, namesOf(t)), body: L.maskPii(t.body, namesOf(t)) });
  function resultOf(t) {
    const ov = st.overrides[t.id];
    const rule = L.triage(t, ov);
    const a = aiCache[t.id];
    return a && a.n ? L.applyAi(rule, a.n, t, ov) : rule;
  }
  const results = () => st.tickets.map(resultOf);

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  const catChip = (id) => `<span class="cat c-${id}">${esc(L.catOf(id).label)}</span>`;
  function slaChip(t) {
    const s = L.sla(t.at, now(), t.respondedAt);
    if (s.kind === "done") return `<span class="sla done">응답 ${s.min}분</span>`;
    return `<span class="sla ${s.kind}">${s.min}분 대기</span>`;
  }

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 위쪽 숫자 ---------- */
  function renderGoals(list) {
    const s = L.stats(list, st.tickets, st.overrides);
    $("gOpen").textContent = s.open;
    $("gTotal").textContent = `전체 ${s.total}건`;
    $("gHand").textContent = s.handoff;
    $("gFirst").textContent = s.avgFirst == null ? "—" : `${s.avgFirst}분`;
    $("gFirst").parentElement.classList.toggle("bad", s.avgFirst != null && s.avgFirst > L.TARGET_MIN);
    $("gFix").textContent = `${s.fixRate}%`;
    $("gFix").parentElement.classList.toggle("bad", s.fixRate > 3);
    $("clock").textContent = `기준 ${L.fmtMin(now())}`;
    return s;
  }

  /* ---------- 왼쪽: 문의함 ---------- */
  function renderFilters(s) {
    $("cats").innerHTML = `<button type="button" data-cat="all" aria-pressed="${st.cat === "all"}">전체 <i>${s.total}</i></button>` +
      `<button type="button" data-cat="hand" aria-pressed="${st.cat === "hand"}" class="f-hand">사람 확인 <i>${s.handoff}</i></button>` +
      s.byCat.filter((c) => c.n).map((c) => `<button type="button" data-cat="${c.id}" aria-pressed="${st.cat === c.id}">${esc(c.label)} <i>${c.n}</i></button>`).join("");
    const sel = $("who");
    sel.innerHTML = `<option value="all">모두</option>` + L.AGENTS.map((a) => `<option value="${a.id}">${esc(a.name)} · ${esc(a.role)}</option>`).join("");
    sel.value = st.who;
  }
  function renderList(list) {
    const shown = list.filter((r) => (st.cat === "all" || (st.cat === "hand" ? r.ho.handoff : r.cat === st.cat)) && (st.who === "all" || r.agent === st.who));
    if (!shown.some((r) => r.id === st.sel) && shown.length) st.sel = shown[0].id;
    $("list").innerHTML = shown.map((r) => {
      const t = ticket(r.id);
      const a = L.agentOf(r.agent);
      return `<li><button type="button" class="item${r.id === st.sel ? " on" : ""}${t.respondedAt ? " answered" : ""}" data-id="${r.id}" aria-current="${r.id === st.sel}">
        <span class="i-top"><span class="time">${t.at}</span><span class="ch">${esc(t.channel)}</span>${r.urgent ? `<span class="urg">급함</span>` : ""}${slaChip(t)}</span>
        <span class="subj">${esc(masked(t).subject)}</span>
        <span class="i-bot">${catChip(r.cat)}${r.ho.handoff ? `<span class="hand">사람 확인</span>` : ""}<span class="ag">${esc(a ? a.name : "")}</span>${r.mode === "ai" ? `<span class="by" title="Claude로 분류">C</span>` : ""}</span>
      </button></li>`;
    }).join("") || `<li class="none">조건에 맞는 문의가 없어요.</li>`;
  }

  /* ---------- 오른쪽: 문의 한 건 ---------- */
  function modeChip(id, r) {
    if (pending === id) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 읽는 중</span>`;
    const a = aiCache[id];
    if (r.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 분류 · ${(a.ms / 1000).toFixed(1)}초</span>`;
    const why = a && a.fail ? a.fail : AI.status().reason;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 분류 낱말로 나눴어요">규칙 기반${why ? ` · ${esc(why)}` : ""}</span>`;
  }
  function renderDetail(list) {
    const r = list.find((x) => x.id === st.sel);
    const t = r && ticket(r.id);
    if (!t) { $("detail").innerHTML = `<div class="empty-out"><div><b>문의를 골라 주세요</b>왼쪽 목록에서 문의를 누르면 분류와 초안이 보여요.</div></div>`; return; }
    const m = masked(t);
    const a = L.agentOf(r.agent);
    const draft = st.drafts[t.id] ?? r.draft;
    const warn = L.findPromises(draft);
    const s = L.sla(t.at, now(), t.respondedAt);
    $("detail").innerHTML = `
      <div class="pane-h"><h2 class="t">${esc(m.subject)}</h2>${modeChip(t.id, r)}</div>
      <p class="meta">${t.id} · ${t.at} · ${esc(t.channel)} · ${esc(L.maskName(t.customer))} 고객 ${slaChip(t)}</p>
      <blockquote class="msg${pending === t.id ? " waiting" : ""}">${esc(m.body).replace(/\[(이름|연락처|이메일|카드번호)\]/g, '<mark title="가린 개인정보">$&</mark>')}</blockquote>
      <p class="pii">이름·연락처는 가린 채로 보여 주고, Claude에도 가린 글만 보내요.</p>

      <div class="tri${pending === t.id ? " waiting" : ""}">
        <div class="tri-row"><span class="lab">분류</span>${catChip(r.cat)}<span class="conf" title="신뢰도"><i style="width:${Math.round(r.confidence * 100)}%"></i></span><span class="pct">${Math.round(r.confidence * 100)}%</span></div>
        <div class="tri-row"><span class="lab">근거</span><span class="why">${esc(r.reason)}</span></div>
        <div class="tri-row"><label class="lab" for="agent">담당</label>
          <select id="agent">${L.AGENTS.map((x) => `<option value="${x.id}"${x.id === r.agent ? " selected" : ""}>${esc(x.name)} · ${esc(x.role)}</option>`).join("")}</select>
          ${st.overrides[t.id] ? `<span class="fixed">직접 바꿈</span>` : ""}</div>
      </div>

      ${r.ho.handoff ? `
      <div class="handoff" role="note">
        <b>초안 없이 ${esc(a ? a.name : "담당자")}님에게 바로 넘겼어요</b>
        <p>${esc(r.ho.why)}</p>
        <p class="sub">${r.ho.kind === "safety" ? "다친 일·신고·소송처럼 안전과 법률이 걸린 문의는 AI가 판단하지 않아요. 매니저가 고객에게 직접 연락합니다." : "환불 여부·금액·보상 방법은 확정되기 전에 말하면 약속이 돼요. 담당자가 확인한 뒤 직접 답합니다."}</p>
        <button class="ghost-btn" id="memo" type="button">담당자 전달 메모 복사</button>
      </div>` : `
      <div class="draft">
        <label for="draftTx"><b>답변 초안</b> <span>${r.mode === "ai" ? "Claude 초안" : "템플릿"} · 보내기 전에 고쳐 쓰세요</span></label>
        <textarea id="draftTx" rows="6"${t.respondedAt ? " readonly" : ""}>${esc(draft)}</textarea>
        <p class="pwarn" id="pwarn" ${warn.length ? "" : "hidden"}>약속 표현이 있어요: <b>${esc(warn.join(", "))}</b> — 확정되지 않은 환불·보상·무료 처리는 쓰지 마세요.</p>
        <div class="d-row">
          <button class="ghost-btn" id="copy" type="button">초안 복사</button>
          ${t.respondedAt ? `<span class="sent">${t.respondedAt}에 답변 · 첫 응답 ${s.min}분</span>` : `<button class="primary sm" id="send" type="button">답변 보냄으로 표시</button>`}
        </div>
      </div>`}`;
  }

  function render() {
    const list = results();
    const s = renderGoals(list);
    renderFilters(s);
    renderList(list);
    renderDetail(list);
    save();
  }

  /* ---------- Claude 에게 묻기 (열린 문의 한 건) ---------- */
  async function askAi(id, force) {
    const t = ticket(id);
    if (!t || (aiCache[id] && !force) || AI.status().enabled === false) {
      if (t && AI.status().enabled === false && !aiCache[id]) aiCache[id] = { fail: AI.status().reason || "AI 꺼짐" };
      return;
    }
    pending = id; render();
    const m = masked(t);
    const r = await AI.ask("triage.classify", { subject: m.subject, body: m.body, channel: t.channel, categories: L.CATS.map((c) => c.label) });
    if (pending === id) pending = null;
    const rule = L.triage(t, st.overrides[id]);
    const n = r && L.normalizeTriage(r.data, rule);
    aiCache[id] = n ? { n, ms: r.ms } : { fail: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "AI 응답 없음") };
    render();
    if (n && n.promises.length) toast("Claude 초안에 약속 표현이 있어 버리고 담당자에게 넘겼어요");
  }

  /* ---------- 이벤트 ---------- */
  $("list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    st.sel = b.dataset.id; render();
    askAi(st.sel);
    if (matchMedia("(max-width: 880px)").matches) $("detail").scrollIntoView({ block: "start" });
  });
  $("cats").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cat]");
    if (!b) return;
    st.cat = b.dataset.cat; render();
  });
  $("who").addEventListener("change", (e) => { st.who = e.target.value; render(); });

  $("detail").addEventListener("change", (e) => {
    if (e.target.id !== "agent") return;
    const id = st.sel;
    const before = st.overrides[id];
    const auto = L.triage(ticket(id)).agent;
    if (e.target.value === auto && !aiCache[id]?.n) delete st.overrides[id];
    else st.overrides[id] = e.target.value;
    render();
    const a = L.agentOf(e.target.value);
    toast(`${a.name}님에게 배정했어요`, () => { if (before) st.overrides[id] = before; else delete st.overrides[id]; render(); });
  });
  $("detail").addEventListener("input", (e) => {
    if (e.target.id !== "draftTx") return;
    st.drafts[st.sel] = e.target.value;
    const w = L.findPromises(e.target.value);
    const p = $("pwarn");
    p.hidden = !w.length;
    if (w.length) p.innerHTML = `약속 표현이 있어요: <b>${esc(w.join(", "))}</b> — 확정되지 않은 환불·보상·무료 처리는 쓰지 마세요.`;
    save();
  });
  $("detail").addEventListener("click", async (e) => {
    const t = ticket(st.sel);
    if (!t) return;
    if (e.target.id === "send") {
      const tx = $("draftTx").value;
      const w = L.findPromises(tx);
      if (w.length) { toast(`약속 표현(‘${w[0]}’)을 고친 뒤 보내 주세요`); $("draftTx").focus(); return; }
      if (!tx.trim()) { toast("답변이 비어 있어요"); return; }
      t.respondedAt = L.fmtMin(now());
      render();
      toast(`답변을 보냄으로 표시했어요 · 첫 응답 ${L.sla(t.at, now(), t.respondedAt).min}분`, () => { delete t.respondedAt; render(); });
    }
    if (e.target.id === "copy" || e.target.id === "memo") {
      const r = resultOf(t);
      const m = masked(t);
      const text = e.target.id === "copy" ? $("draftTx").value
        : `[${t.id}] ${m.subject}\n분류: ${L.catOf(r.cat).label} · 넘긴 이유: ${r.ho.why}\n고객 글: ${m.body}\n(연락처는 문의함 원본에서 확인)`;
      try { await navigator.clipboard.writeText(text); toast(e.target.id === "copy" ? "초안을 복사했어요" : "전달 메모를 복사했어요 (개인정보는 빠져 있어요)"); }
      catch (err) { toast("복사하지 못했어요. 직접 선택해 복사해 주세요"); }
    }
  });

  $("run").addEventListener("click", () => {
    Object.keys(aiCache).forEach((k) => delete aiCache[k]);
    render();
    const list = results();
    toast(`문의 ${list.length}건 분류 · 사람 확인 ${list.filter((r) => r.ho.handoff).length}건`);
    askAi(st.sel, true);
  });

  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const subject = $("aSub").value.trim(), body = $("aBody").value.trim();
    if (!subject || !body) return;
    const t = { id: `C-${st.seq++}`, at: L.fmtMin(now()), channel: $("aCh").value, customer: "", contact: "", subject, body };
    st.tickets.push(t);
    st.sel = t.id; st.cat = "all"; st.who = "all";
    $("addForm").reset();
    render();
    const r = resultOf(t);
    toast(`${L.catOf(r.cat).label}로 분류 · ${L.agentOf(r.agent).name}님${r.ho.handoff ? " · 사람 확인" : ""}`, () => { st.tickets = st.tickets.filter((x) => x.id !== t.id); render(); });
    askAi(t.id);
  });

  $("csv").addEventListener("click", () => {
    const csv = L.toCsv(results(), st.tickets);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `첫답-배정표-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("배정표를 내려받았어요 (고객 이름·연락처·본문은 빠져 있어요)");
  });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed();
    Object.keys(aiCache).forEach((k) => delete aiCache[k]);
    render();
    askAi(st.sel);
    toast("샘플 문의함으로 되돌렸어요", () => { st = before; render(); });
  });

  /* ---------- 시작 ---------- */
  render();
  setInterval(() => { if (document.activeElement?.id !== "draftTx") { const list = results(); renderGoals(list); renderList(list); } }, 30000);
  AI.probe().then(() => askAi(st.sel));
})();
