/* 안내한장 — 화면 (DOM 다루기만 한다. 대상 고르기·초안 틀·고시 대조는 logic.js, AI 호출은 ai-client.js)
 *
 * 개정 항목과 고객사를 고르면
 *   1) 틀 초안을 바로 보여 주고 (기다리지 않게)
 *   2) Claude 에게 같은 정보를 보내 그 고객사 말투에 맞게 다시 쓰게 한다. 형식이 틀리면 1)을 둔다.
 *   3) 어떤 초안이든 고시 시행일·금액·링크와 대조(checkDraft)하고, 사람이 대조 확인을 눌러야 발송 대기에 넣는다.
 * 개정 내용·금액·시행일·링크는 모두 샘플 값이다.
 */
(function () {
  "use strict";
  const L = window.Annaehanjang;
  const STORE_KEY = "startup-labor-notice-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());

  /* ---------- 샘플 (가상의 고객사, 샘플 값의 개정 항목) ---------- */
  const AMENDS = [
    { id: "a1", title: "최저임금 고시 (샘플)", area: "임금", effective: "2027-01-01", unit: "시급", before: 11000, after: 11500, summary: "시간당 금액 변경 (샘플 값)", target: "hourly", link: "https://gazette.example/notice/wage-sample" },
    { id: "a2", title: "연장근로 기록 서식 변경 (샘플)", area: "근로시간", effective: "2027-03-01", summary: "연장 근무 기록 서식의 항목이 바뀜 (샘플)", target: "overtime", link: "https://gazette.example/notice/hours-sample" },
    { id: "a3", title: "육아휴직 신청 서식 개정 (샘플)", area: "휴가·휴직", effective: "2027-02-01", summary: "신청 서식의 기재 항목 정리 (샘플)", target: "all", link: "https://gazette.example/notice/leave-sample" },
  ];
  const CLIENTS = [
    { id: "c1", name: "달빛베이커리", industry: "제과점", staff: 7, hourly: 4, shift: false, overtime: true, contactName: "김도원", contactRole: "실장" },
    { id: "c2", name: "온새미 분식", industry: "음식점", staff: 5, hourly: 3, shift: false, overtime: false, contactName: "박유나", contactRole: "대표" },
    { id: "c3", name: "바른정밀", industry: "제조", staff: 18, hourly: 0, shift: true, overtime: true, contactName: "이준혁", contactRole: "과장" },
    { id: "c4", name: "솔내 요양센터", industry: "돌봄", staff: 14, hourly: 6, shift: true, overtime: true, contactName: "최은서", contactRole: "팀장" },
    { id: "c5", name: "그린라인 디자인", industry: "사무", staff: 6, hourly: 0, shift: false, overtime: false, contactName: "정민호", contactRole: "대표" },
    { id: "c6", name: "새벽물류", industry: "물류", staff: 22, hourly: 9, shift: true, overtime: true, contactName: "한지수", contactRole: "주임" },
  ];
  function seed() {
    const amends = AMENDS.map((a) => ({ ...a }));
    const drafts = {};
    const queue = [];
    // 이미 대조를 마친 안내문 하나
    const ok = L.ruleDraft(amends[0], CLIENTS[0]);
    queue.push(item(amends[0], CLIENTS[0], ok));
    // 예전에 문제가 됐던 AI 초안: 시행일이 틀렸다 (2026년으로 적음)
    const bad = L.ruleDraft(amends[0], CLIENTS[1]);
    drafts["a1:c2"] = { subject: bad.subject, body: bad.body.replace(L.korDate("2027-01-01"), "2026년 1월 1일(목)"), by: "ai", ms: 2300, confirmed: false, note: "이전 AI 초안" };
    return { amends, drafts, queue, cur: { a: "a1", c: "c2" }, only: true };
  }
  function item(a, c, d) {
    return { amend: a.id, clientId: c.id, client: c.name, contactName: c.contactName, contactRole: c.contactRole, subject: d.subject, body: d.body, effective: a.effective, link: a.link, title: a.title };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.amends) && v.drafts && Array.isArray(v.queue) && v.cur) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false, runToken = 0;
  const amend = () => st.amends.find((a) => a.id === st.cur.a);
  const client = () => CLIENTS.find((c) => c.id === st.cur.c);
  const key = () => `${st.cur.a}:${st.cur.c}`;
  const queued = (a, c) => st.queue.some((q) => q.amend === a && q.clientId === c);

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

  /* ---------- 왼쪽: 개정 항목 · 고시 정보 ---------- */
  function renderAmends() {
    const t = today();
    $("amends").innerHTML = st.amends.map((a) => {
      const p = L.progress(a, CLIENTS, st.drafts, st.queue);
      const n = L.daysUntil(a.effective, t);
      return `<button type="button" data-id="${a.id}" aria-pressed="${a.id === st.cur.a}">
        <b>${esc(a.title)}</b>
        <small><span class="dday">${n > 0 ? `D-${n}` : n === 0 ? "오늘 시행" : "시행됨"}</span>${esc(a.area)} · 대상 ${p.targets}곳 · 대기 ${p.queued}곳</small>
      </button>`;
    }).join("");
    const a = amend(), li = L.linkInfo(a.link);
    const lk = { gov: "정부 도메인(.go.kr)", sample: "샘플 링크 · 실제 발송 땐 공식 주소로", other: "정부 도메인이 아니에요 · 공식 고시인지 확인", bad: "https 주소를 넣어 주세요" }[li.kind];
    $("gazette").innerHTML = `<h3>공식 고시 정보 (대조 기준)</h3>
      <label>시행일<input type="date" id="gEff" value="${esc(a.effective)}"></label>
      ${a.before ? `<label>변경 금액 (${esc(a.unit)}, 샘플 값)<input id="gAmt" value="${a.before.toLocaleString("ko-KR")} → ${a.after.toLocaleString("ko-KR")}원" readonly></label>` : `<label>변경 내용<input value="${esc(a.summary)}" readonly></label>`}
      <label>고시 링크<input id="gLink" value="${esc(a.link)}" inputmode="url" autocomplete="off"></label>
      <span class="lk" data-k="${li.kind}">${esc(lk)}</span>`;
  }
  $("amends").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]"); if (!b) return;
    st.cur.a = b.dataset.id;
    const a = amend();
    if (!L.affected(a, client()).yes) { const first = CLIENTS.find((c) => L.affected(a, c).yes && !queued(a.id, c.id)) || CLIENTS.find((c) => L.affected(a, c).yes); if (first) st.cur.c = first.id; }
    select();
  });
  $("gazette").addEventListener("change", (e) => {
    const a = amend();
    if (e.target.id === "gEff" && L.isIso(e.target.value)) { const before = a.effective; a.effective = e.target.value; toast(`시행일을 ${a.effective}로 바꿨어요. 초안을 다시 대조해요`, () => { a.effective = before; save(); renderAll(); }); }
    if (e.target.id === "gLink") a.link = e.target.value.trim();
    save(); renderAll();
  });

  /* ---------- 가운데: 고객사 ---------- */
  function status(aId, cId) {
    if (queued(aId, cId)) return ["queued", "발송 대기"];
    if (st.drafts[`${aId}:${cId}`]) return ["draft", "검토 중"];
    return ["todo", "작성 전"];
  }
  function renderClients() {
    const a = amend(), p = L.progress(a, CLIENTS, st.drafts, st.queue);
    $("prog").textContent = `안내 대상 ${p.targets}곳 중 발송 대기 ${p.queued}곳 · 검토 중 ${p.drafted}곳`;
    $("onlyTarget").checked = st.only;
    $("clients").innerHTML = CLIENTS.map((c) => {
      const af = L.affected(a, c);
      if (st.only && !af.yes) return "";
      const [k, label] = af.yes ? status(a.id, c.id) : ["none", "대상 아님"];
      return `<button type="button" data-id="${c.id}" aria-pressed="${c.id === st.cur.c}" class="${af.yes ? "" : "off"}">
        <span class="nm">${esc(c.name)}<span class="st ${k}">${label}</span></span>
        <small>${esc(c.industry)} · 직원 ${c.staff}명 · ${esc(af.why)}</small></button>`;
    }).join("");
  }
  $("clients").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (!b) return; st.cur.c = b.dataset.id; select(); });
  $("onlyTarget").addEventListener("change", (e) => { st.only = e.target.checked; save(); renderClients(); });

  /* ---------- 오른쪽: 초안 ---------- */
  function draft() { return st.drafts[key()]; }
  function modeChip(d) {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    if (d.by === "ai") return `<span class="mode" data-mode="ai">${d.note ? esc(d.note) : "Claude로 작성"} · ${(d.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없거나 틀 초안을 골랐어요">틀 초안 (규칙 기반)${d.reason ? ` · ${esc(d.reason)}` : ""}</span>`;
  }
  function renderChecks() {
    const a = amend(), d = draft();
    const r = L.checkDraft(d, a, d.confirmed);
    const lab = { error: "막음", warn: "확인", need: "필요", info: "참고" };
    const passed = [];
    if (!r.issues.some((x) => x.code === "date" || x.code === "nodate")) passed.push(`시행일 ${a.effective} 일치`);
    if (!r.issues.some((x) => x.code === "amount")) passed.push(a.before ? "금액 일치" : "고시에 없는 금액 없음");
    if (!r.issues.some((x) => x.code === "nolink" || x.code === "badlink")) passed.push("근거 링크 붙음");
    $("checks").innerHTML = r.issues.filter((x) => x.level !== "need").map((x) => `<div class="c ${x.level}"><b>${lab[x.level]}</b><span>${esc(x.msg)}</span></div>`).join("") +
      (passed.length ? `<div class="c pass"><b>통과</b><span>${passed.join(" · ")}</span></div>` : "");
    const q = queued(a.id, st.cur.c);
    $("enqueue").disabled = !r.canSend || waiting;
    $("enqueue").textContent = !L.affected(a, client()).yes ? "안내 대상이 아니에요" : r.canSend ? (q ? "발송 대기 내용 바꾸기" : "발송 대기에 넣기") : r.issues.some((x) => x.level === "error") ? "대조에서 막힌 곳을 고쳐 주세요" : "대조 확인을 눌러 주세요";
    if (!L.affected(a, client()).yes) $("enqueue").disabled = true;
  }
  function renderDraft() {
    const a = amend(), c = client(), d = draft();
    $("to").innerHTML = `받는 곳 <b>${esc(c.name)}</b> · ${esc(L.maskName(c.contactName))} ${esc(c.contactRole)} · ${esc(L.affected(a, c).why)}`;
    $("modeChip").innerHTML = modeChip(d);
    if ($("subject").value !== d.subject) $("subject").value = d.subject;
    if ($("draft").value !== d.body) $("draft").value = d.body;
    $("confirm").checked = !!d.confirmed;
    $("openLink").href = L.linkInfo(a.link).ok ? a.link : "#";
    renderChecks();
  }
  $("subject").addEventListener("input", (e) => { draft().subject = e.target.value; save(); renderChecks(); });
  $("draft").addEventListener("input", (e) => { draft().body = e.target.value; save(); renderChecks(); });
  $("confirm").addEventListener("change", (e) => { draft().confirmed = e.target.checked; save(); renderChecks(); });
  $("openLink").addEventListener("click", (e) => { if ($("openLink").getAttribute("href") === "#") { e.preventDefault(); toast("고시 링크가 올바르지 않아요"); } });

  /** 고른 개정×고객사로 이동. 초안이 없으면 틀 초안을 만들고 Claude 에게 맡긴다 */
  function select() {
    runToken++; waiting = false;
    const fresh = !draft();
    if (fresh) st.drafts[key()] = { ...L.ruleDraft(amend(), client()), by: "rule", confirmed: false };
    save(); renderAll();
    if (fresh && AI.status().enabled === true) aiDraft();
  }
  async function aiDraft() {
    const a = amend(), c = client(), k = key(), my = ++runToken;
    const before = { ...draft() };
    waiting = AI.status().enabled !== false;
    renderDraft();
    // 담당자 이름은 보내지 않는다. 직함만 보낸다
    const r = await AI.ask("labornotice.draft", {
      amendment: { title: a.title, area: a.area, effective: a.effective, unit: a.unit || "", before: a.before || 0, after: a.after || 0, summary: a.summary },
      client: { name: c.name, industry: c.industry, staff: c.staff, hourly: c.hourly, shift: c.shift, overtime: c.overtime, contactRole: c.contactRole },
      link: a.link, office: "노무한눈 노무사 사무소",
    });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeDraft(r.data);
    if (n) st.drafts[k] = { subject: n.subject, body: L.ensureLink(n.body, a.link), by: "ai", ms: r.ms, confirmed: false };
    else st.drafts[k] = { ...before, reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    save(); renderAll();
    if (n) {
      const chk = L.checkDraft(st.drafts[k], a, false);
      const errs = chk.issues.filter((x) => x.level === "error").length;
      toast(errs ? `Claude 초안에서 대조 오류 ${errs}건을 찾았어요` : "Claude 초안이 고시 정보와 맞아요. 원문 대조 후 넣어 주세요", () => { st.drafts[k] = before; save(); renderAll(); });
    } else toast("Claude를 쓸 수 없어 틀 초안을 그대로 둬요");
  }
  $("aiDraft").addEventListener("click", aiDraft);
  $("ruleDraft").addEventListener("click", () => {
    const k = key(), before = { ...draft() };
    st.drafts[k] = { ...L.ruleDraft(amend(), client()), by: "rule", confirmed: false };
    runToken++; waiting = false;
    save(); renderAll();
    toast("틀 초안으로 바꿨어요", () => { st.drafts[k] = before; save(); renderAll(); });
  });
  $("enqueue").addEventListener("click", () => {
    const a = amend(), c = client(), d = draft();
    if (!L.checkDraft(d, a, d.confirmed).canSend) return;
    const before = st.queue.slice();
    st.queue = st.queue.filter((q) => !(q.amend === a.id && q.clientId === c.id)).concat(item(a, c, d));
    // 다음으로 안내할 고객사로 넘어간다
    const next = CLIENTS.find((x) => L.affected(a, x).yes && !queued(a.id, x.id));
    save();
    toast(`${c.name} 안내문을 발송 대기에 넣었어요`, () => { st.queue = before; st.cur.c = c.id; save(); renderAll(); });
    if (next) { st.cur.c = next.id; select(); } else renderAll();
  });

  /* ---------- 발송 대기 ---------- */
  function renderQueue() {
    $("qN").textContent = st.queue.length;
    $("queue").innerHTML = st.queue.length ? `<table class="qt"><thead><tr><th>고객사</th><th>개정 항목</th><th>시행일 대조</th><th><span hidden>지우기</span></th></tr></thead><tbody>
      ${st.queue.map((q, i) => `<tr><td><b>${esc(q.client)}</b></td><td>${esc(q.title)}</td><td>${esc(q.effective)} 확인 · 근거 링크</td><td><button type="button" data-del="${i}" aria-label="${esc(q.client)} 대기에서 빼기">빼기</button></td></tr>`).join("")}
      </tbody></table>` : `<div class="q-empty">대조를 마친 안내문이 여기에 모여요.</div>`;
  }
  $("queue").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-del]"); if (!b) return;
    const before = st.queue.slice();
    const [gone] = st.queue.splice(+b.dataset.del, 1);
    save(); renderAll();
    toast(`${gone.client} 안내문을 대기에서 뺐어요`, () => { st.queue = before; save(); renderAll(); });
  });
  $("export").addEventListener("click", () => {
    if (!st.queue.length) { toast("발송 대기가 비어 있어요"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.exportQueue(st.queue)], { type: "text/plain;charset=utf-8" }));
    a.download = `안내한장-발송대기-${today().replace(/-/g, "")}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${st.queue.length}건을 내려받았어요 (담당자 이름은 가림)`);
  });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); runToken++; waiting = false;
    save(); renderAll();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  function renderAll() {
    if (!draft()) st.drafts[key()] = { ...L.ruleDraft(amend(), client()), by: "rule", confirmed: false };
    renderAmends(); renderClients(); renderDraft(); renderQueue();
  }
  renderAll();
  AI.probe();
})();
