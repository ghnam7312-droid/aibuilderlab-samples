/* 챙김 — 화면 (DOM 다루기만 한다. 분류·약속·섞임 검사·캘린더는 logic.js, AI 호출은 ai-client.js)
 *
 * 미팅을 고르면
 *   1) 메모를 줄마다 '고객 공유 / 내부 전용'으로 나누고 (사람이 눌러 바꿀 수 있다)
 *   2) 고객 공유 줄로만 규칙 초안을 바로 쓰고, 같은 줄만 Claude 에게 보내 다시 쓴다.
 *   3) 초안에 내부 메모가 섞였는지 매번 검사한다. 걸리면 복사를 막는다. Claude 초안이 걸리면 버린다.
 * 보내기로 한 자료는 '후속 알림'에 올려 기한을 챙기고, .ics 캘린더로 내보낸다.
 */
(function () {
  "use strict";
  const L = window.Chaenggim;
  const STORE_KEY = "ax-followup-mail-v1";
  const SENDER = { company: "온결솔루션", name: "이서윤" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());

  /* ---------- 예시 미팅 (오늘 기준 날짜로 만든다) ---------- */
  function meetings() {
    const t = today(), A = (n) => L.addDays(t, n);
    return [
      { id: "m1", customer: "가람식품", contact: "오세진 팀장", date: t, note: `- 발주 시스템 교체, 공장 2곳에서 동시에 쓰는 것을 원하심
- 공장별로 사용자 권한을 따로 나눌 수 있는지 질문하심
- 도입 사례 자료 내일까지 보내드리기로 함
- 수정 견적서 다음 주 화요일까지 전달하기로
- (내부) 할인은 최대 8%, 마지노선 2,950만
- 경쟁사 단가가 우리보다 10% 낮다고 들음 → 팀장님께 보고
- 1월 초 도입을 희망하심` },
      { id: "m2", customer: "하늘물류", contact: "정하은 대리", date: A(-3), note: `- 물류센터 3곳 재고 통합 건, 1차는 센터 1곳으로 시작하는 안을 검토하심
- 제안서 초안 ${L.md(A(-1))}까지 공유하기로 함
- 센터별 재고 화면 예시를 함께 보내드리기로 (${L.md(A(1))}까지)
- 우리끼리: 1차 4,500만이면 이번 분기 목표 채움
- IT팀 일정은 정 대리님이 확인 후 회신 주시기로` },
      { id: "m3", customer: "청솔제지", contact: "배규리 실장", date: A(-6), note: `- 연 사용료 조건 확정, 다음 달 1일 시작을 희망하심
- 계약서 초안 ${L.md(A(-4))}까지 보내드리기로 함
- 사용자 교육 일정표 ${L.md(t)}까지 전달하기로
- (내부) 본부장님께 계약 조건 보고 완료` },
    ];
  }
  function seedReminders() {
    let list = [];
    meetings().slice(1).forEach((m) => { list = L.addPromises(list, m.id, L.findPromises(L.classify(m.note), m.date)).list; });
    const t = today();
    list.forEach((p) => { p.sent = p.due < t; }); // 지난 약속은 이미 보낸 것으로 시작
    return list;
  }

  /* ---------- 상태 ---------- */
  const MEET = meetings();
  function seed() { return { cur: "m1", overrides: {}, reminders: seedReminders(), onlyOpen: false }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.reminders) && v.overrides && MEET.some((m) => m.id === v.cur)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let draft = { subject: "", body: "" };
  let ai = { mode: "rule", reason: "" };
  let waiting = false, runToken = 0, freshIds = [];

  const meet = () => MEET.find((m) => m.id === st.cur);
  const linesOf = (m) => L.applyOverrides(L.classify(m.note), st.overrides[m.id]);
  const promisesOf = (m) => L.findPromises(linesOf(m), m.date);

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
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 쓰는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 작성 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 고객 공유 줄을 정해진 양식에 넣었어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }

  /* ---------- 왼쪽: 메모 ---------- */
  function renderTabs() {
    $("tabs").innerHTML = MEET.map((m) => `<button type="button" data-m="${m.id}" aria-pressed="${m.id === st.cur}">${esc(m.customer)}<small>${esc(L.withDay(m.date))}</small></button>`).join("");
  }
  function renderLines(hits) {
    const m = meet(), lines = linesOf(m), proms = promisesOf(m);
    const hitLines = new Set((hits || []).map((h) => h.line));
    $("meetMeta").textContent = `${m.customer} · ${m.contact} · ${L.withDay(m.date)} 미팅`;
    $("lines").innerHTML = lines.map((l) => {
      const p = proms.find((x) => x.line === l.i);
      return `<li class="${l.kind}${hitLines.has(l.i) ? " hit" : ""}" data-line="${l.i}">
        <button type="button" class="kbtn ${l.kind}" data-flip="${l.i}" aria-label="${l.i + 1}번째 줄: ${l.kind === "int" ? "내부 전용" : "고객 공유"}. 눌러서 바꾸기">${l.kind === "int" ? "내부 전용" : "고객 공유"}</button>
        <span>${esc(l.text)}${l.kind === "int" && l.why ? `<span class="why">${esc(l.why)}</span>` : ""}${p ? `<span class="prom">약속 · ${esc(L.withDay(p.due))}${p.auto ? " (기한 없음→2영업일)" : ""}</span>` : ""}</span>
      </li>`;
    }).join("");
    const ni = lines.filter((l) => l.kind === "int").length;
    $("lineInfo").textContent = `고객 공유 ${lines.length - ni}줄 · 내부 ${ni}줄은 메일·AI에 넣지 않아요`;
  }
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b || b.dataset.m === st.cur) return;
    st.cur = b.dataset.m; save();
    renderTabs(); run();
  });
  $("lines").addEventListener("click", (e) => {
    const b = e.target.closest("[data-flip]");
    if (!b) return;
    const m = meet(), i = +b.dataset.flip;
    const base = L.classify(m.note)[i].kind;
    const now = linesOf(m)[i].kind;
    const next = now === "int" ? "ext" : "int";
    const ov = (st.overrides[m.id] = st.overrides[m.id] || {});
    if (next === base) delete ov[i]; else ov[i] = next;
    save();
    run();
    document.querySelector(`[data-flip="${i}"]`)?.focus();
    toast(next === "ext" ? "이 줄을 고객 공유로 바꿨어요. 초안에 들어가요" : "이 줄을 내부 전용으로 바꿨어요. 초안에서 빠져요");
  });

  /* ---------- 오른쪽: 초안 ---------- */
  function intLines() { return linesOf(meet()).filter((l) => l.kind === "int"); }
  function renderLeak() {
    const text = `${$("subject").value}\n${$("body").value}`;
    const hits = L.leakCheck(text, intLines());
    const el = $("leak");
    if (!hits.length) {
      el.className = "leak ok";
      el.textContent = `내부 메모 검사 통과 · 내부 ${intLines().length}줄이 초안에 없어요`;
    } else {
      el.className = "leak bad";
      el.innerHTML = `<b>내부 메모가 섞였어요 — 고친 뒤 복사할 수 있어요</b><ul>${hits.map((h) => `<li>${esc(h.why)}${h.line >= 0 ? `<button type="button" data-show="${h.line}">${h.line + 1}줄 보기</button>` : ""}</li>`).join("")}</ul>`;
    }
    $("copy").disabled = !!hits.length || waiting;
    renderLines(hits);
    return hits;
  }
  function renderDraft() {
    const m = meet(), proms = promisesOf(m);
    $("modeChip").innerHTML = modeChip();
    $("to").innerHTML = `받는 분 <b>${esc(m.contact)}님</b> · ${esc(m.customer)} <span class="sr">(메일 주소는 표시하지 않음)</span>`;
    $("subject").value = draft.subject;
    $("body").value = draft.body;
    $("subject").disabled = $("body").disabled = waiting;
    document.querySelector(".out-pane").classList.toggle("waiting", waiting);
    const already = proms.filter((p) => st.reminders.some((r) => r.meetingId === m.id && r.item.replace(/\s/g, "") === p.item.replace(/\s/g, ""))).length;
    const left = proms.length - already;
    $("push").disabled = !left;
    $("push").textContent = !proms.length ? "약속 없음" : left ? `약속 ${left}건 알림에 올리기` : "약속 모두 알림에 있어요";
    renderLeak();
  }
  $("subject").addEventListener("input", renderLeak);
  $("body").addEventListener("input", renderLeak);
  $("leak").addEventListener("click", (e) => {
    const b = e.target.closest("[data-show]");
    if (!b) return;
    const li = document.querySelector(`#lines li[data-line="${b.dataset.show}"]`);
    li?.scrollIntoView({ behavior: "smooth", block: "center" });
    li?.querySelector("button")?.focus();
  });

  async function run() {
    const my = ++runToken;
    const m = meet(), lines = linesOf(m), proms = L.findPromises(lines, m.date);
    draft = L.buildDraft({ ...m, sender: SENDER }, lines, proms);
    ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderDraft();
    // 고객 공유 줄만 보낸다. 내부 줄은 AI에도 가지 않는다
    const points = lines.filter((l) => l.kind === "ext").map((l) => l.text);
    const r = await AI.ask("followup.draft", { customer: m.customer, contact: m.contact, sender: SENDER, meetingDate: m.date, today: today(), points, promises: proms.map((p) => ({ item: p.item, due: p.due })) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeDraft(r.data);
    if (n && !L.leakCheck(`${n.subject}\n${n.body}`, lines.filter((l) => l.kind === "int")).length) { draft = n; ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: n ? "AI 초안에 내부 메모가 섞여 버림" : r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderDraft();
  }
  $("run").addEventListener("click", run);

  $("copy").addEventListener("click", async () => {
    if (renderLeak().length) return;
    const text = `${$("subject").value}\n\n${$("body").value}`;
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e2) { /* 복사 못 해도 화면은 계속 */ }
      ta.remove();
    }
    toast("제목과 본문을 복사했어요. 메일 쓰기 창에 붙여 넣으세요");
  });
  $("push").addEventListener("click", () => {
    const m = meet();
    const before = st.reminders.slice();
    const r = L.addPromises(st.reminders, m.id, promisesOf(m));
    st.reminders = r.list;
    freshIds = r.list.slice(before.length).map((p) => p.id);
    save(); renderDraft(); renderRem();
    freshIds = [];
    toast(`약속 ${r.added}건을 후속 알림에 올렸어요`, () => { st.reminders = before; save(); renderDraft(); renderRem(); });
  });

  /* ---------- 후속 알림 ---------- */
  const LABEL = { late: (n) => `${-n}일 지남`, today: () => "오늘까지", soon: (n) => `D-${n}`, later: (n) => `D-${n}`, sent: () => "보냄" };
  function renderRem() {
    const t = today();
    const s = L.monthStats(st.reminders, t);
    $("sTotal").textContent = s.total; $("sSent").textContent = s.sent; $("sMissed").textContent = s.missed;
    $("sMissed").parentElement.classList.toggle("has", s.missed > 0);
    $("onlyOpen").checked = !!st.onlyOpen;
    const list = st.reminders.filter((p) => !st.onlyOpen || !p.sent).slice().sort((a, b) => (a.sent - b.sent) || a.due.localeCompare(b.due));
    $("remList").innerHTML = list.length ? list.map((p) => {
      const m = MEET.find((x) => x.id === p.meetingId);
      const ds = L.dueStatus(p.due, t, p.sent);
      return `<li class="${p.sent ? "sent" : ""}${freshIds.includes(p.id) ? " new" : ""}">
        <span class="chip ${ds.kind}">${LABEL[ds.kind](ds.n)}</span>
        <span class="cust">${esc(m ? m.customer : "")}</span>
        <span class="item">${esc(p.item)}</span>
        <span class="when">${esc(L.withDay(p.due))}까지</span>
        <button type="button" class="sentbtn" data-sent="${esc(p.id)}" aria-pressed="${!!p.sent}">${p.sent ? "보냈어요 ✓" : "보냈어요"}</button>
      </li>`;
    }).join("") : `<li><span class="empty">${st.onlyOpen ? "안 보낸 약속이 없어요" : "알림에 올린 약속이 없어요"}</span></li>`;
  }
  $("remList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sent]");
    if (!b) return;
    const p = st.reminders.find((x) => x.id === b.dataset.sent);
    p.sent = !p.sent;
    save(); renderRem();
    document.querySelector(`[data-sent="${CSS.escape(p.id)}"]`)?.focus();
    toast(p.sent ? `‘${p.item}’ 보냄으로 표시했어요` : "다시 ‘안 보냄’으로 돌렸어요", () => { p.sent = !p.sent; save(); renderRem(); });
  });
  $("onlyOpen").addEventListener("change", (e) => { st.onlyOpen = e.target.checked; save(); renderRem(); });
  $("ics").addEventListener("click", () => {
    const open = st.reminders.filter((p) => !p.sent);
    if (!open.length) { toast("안 보낸 약속이 없어요"); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const ics = L.buildIcs(open, (p) => (MEET.find((m) => m.id === p.meetingId) || {}).customer || "", stamp);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    a.download = `followup-${today().replace(/-/g, "")}.ics`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`안 보낸 약속 ${open.length}건을 캘린더 파일로 내보냈어요`);
  });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save();
    renderTabs(); renderRem(); run();
    toast("샘플 미팅과 알림으로 되돌렸어요", () => { st = before; save(); renderTabs(); renderRem(); run(); });
  });

  /* ---------- 시작 ---------- */
  renderTabs(); renderRem();
  const m0 = meet();
  draft = L.buildDraft({ ...m0, sender: SENDER }, linesOf(m0), promisesOf(m0));
  renderDraft();
  AI.probe().then(() => run());
})();
