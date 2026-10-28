/* 적어줌 — 화면 (DOM 다루기만 한다. 금액·날짜 읽기·검사·CSV는 logic.js, AI 호출은 ai-client.js)
 *
 * 'CRM 칸 채우기'를 누르면
 *   1) 규칙으로 바로 칸을 채우고 (기다리지 않게)
 *   2) Claude 에게 같은 메모를 보내 다시 채운다. 돌아오면 칸을 덮어쓰되, 원문에 없는 숫자는 빨갛게 표시한다.
 * 어느 쪽이든 금액·날짜 칸은 사람이 '원문과 맞음'을 눌러야 저장 버튼이 열린다.
 */
(function () {
  "use strict";
  const L = window.Jeogeojum;
  const STORE_KEY = "ax-meeting-crm-v1";
  const TEAM = ["이서윤", "김도현", "박지훈", "최유나", "한민재"];
  const CUSTOMERS = ["가람식품", "하늘물류", "청솔제지", "바른교육", "한빛전자부품", "도담건설", "누리팜"];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 예시 메모 (오늘 기준 날짜로 만든다) ---------- */
  function sample(i) {
    const t = today(), A = (n) => L.addDays(t, n);
    return [
      `가람식품 미팅 ${L.withDay(t)} 본사 3층
참석: 오세진 팀장(구매), 나
- 쓰던 발주 시스템이 느려서 바꾸려고 함. 공장 2곳 동시 사용 필요
- 처음엔 예산 2,800만 정도라 했는데, 공장 추가해서 최종 견적은 3,200만 원으로 맞춤
- 오 팀장 연락처 010-1234-5678
- 다음 주 화요일까지 수정 견적서 보내기로 함
- 경쟁사 한 곳도 견적 받는 중이라 회신 빠를수록 좋음`,
      `하늘물류 방문 ${L.withDay(A(-1))}
고객사: 하늘물류
- 물류센터 3곳 재고 관리 통합 건. 윤재호 부장, 실무 정하은 대리 동석
- 전체 규모는 1억 2천만 원 정도로 보고, 1차로 센터 1곳만 하면 4,500만
- 제안서 요청 받음. ${L.md(A(8))} 재미팅에서 제안 발표
- 정 대리 메일 haeun.jung@haneul.example 로 회의 자료 공유하기로 함`,
      `청솔제지 미팅 ${L.withDay(t)} (화상)
- 배규리 실장과 최종 조건 확인. 연 사용료 6,600만 원으로 확정
- 계약서 초안 ${L.md(A(3))}까지 회신 주기로 함
- 도입 시작은 다음 달 1일 희망. 교육 일정은 따로 잡기`,
    ][i];
  }
  function seedRecords() {
    const t = today(), A = (n) => L.addDays(t, n);
    const r = (o, company, contact, stage, amount, m, n, nextAction, summary) => ({ id: `s${company}`, savedAt: A(m), owner: o, company, contact, stage, amount, meetingDate: A(m), nextDate: n === null ? "" : A(n), nextAction, summary });
    return [
      r("김도현", "한빛전자부품", "서지안 과장", "협상", 87000000, -1, 2, "할인 조건 2안 정리해 회신", "3년 계약 시 할인 요청. 단가 조정 폭 내부 검토 중"),
      r("최유나", "바른교육", "이하린 대리", "첫 미팅", null, -2, 12, "내년 예산 확정 여부 확인 전화", "첫 인사. 내년 예산 잡히면 다시 보자고 함"),
      r("이서윤", "도담건설", "문태오 차장", "제안", 54000000, -4, -1, "현장 3곳 시연 일정 잡기", "현장 출입 기록 관리 제안. 시연 보고 결정"),
      r("박지훈", "누리팜", "강보람 팀장", "계약", 31000000, -6, 5, "계약서 날인본 받기", "연간 계약 확정. 다음 달부터 사용"),
      r("한민재", "가람식품", "오세진 팀장", "요구 파악", 28000000, -9, null, "", "발주 시스템 교체 검토 시작. 공장 1곳 기준"),
      r("이서윤", "한빛전자부품", "서지안 과장", "보류", 12000000, -15, null, "", "부속 모듈 건은 내년으로 미룸"),
    ];
  }

  /* ---------- 상태 ---------- */
  function seed() {
    const memo = sample(0);
    return { memo, sample: 0, owner: TEAM[0], records: seedRecords(), filter: { stage: "all", owner: "all", q: "" } };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.memo === "string" && Array.isArray(v.records) && v.filter) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let draft = null;         // {fields, src, cand, notInSource, mode}
  let confirmed = {};       // 숫자 칸 확인 여부
  let edited = {};          // 사람이 직접 고친 칸
  let ai = { mode: "rule", reason: "" };
  let waiting = false, runToken = 0, lastSaved = "";

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
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 읽는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 금액·날짜·단계 낱말만 읽었어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }

  /* ---------- 왼쪽: 메모 ---------- */
  const memo = $("memo");
  function renderSamples() {
    document.querySelectorAll("[data-sample]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.sample === st.sample && memo.value === sample(st.sample))));
  }
  function renderFound() {
    const v = memo.value, t = today();
    const nums = L.findAmounts(v).map((a) => a.text).concat(L.findDates(v, t).map((d) => d.text));
    $("found").innerHTML = nums.length ? `<span>메모 속 숫자</span>${nums.map((x) => `<button type="button" data-find="${esc(x)}">${esc(x)}</button>`).join("")}` : `<span>메모에서 금액·날짜를 찾지 못했어요</span>`;
    $("memoInfo").textContent = `${v.split(/\n/).filter((l) => l.trim()).length}줄 · ${v.length}자`;
  }
  /** 메모에서 그 글자를 골라 보여 준다 (원문 대조용) */
  function findInMemo(text) {
    const i = memo.value.indexOf(text);
    if (i < 0) { toast("메모에서 같은 글자를 찾지 못했어요"); return; }
    memo.focus({ preventScroll: true });
    memo.setSelectionRange(i, i + text.length);
    const before = memo.value.slice(0, i).split("\n").length - 1;
    memo.scrollTop = Math.max(0, before * 24 - 40);
    memo.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "nearest" });
  }

  /* ---------- 오른쪽: 검토 화면 ---------- */
  function numBlock(k) {
    const f = draft.fields, v = f[k];
    const empty = v === null || v === "";
    const bad = !edited[k] && (draft.notInSource || []).includes(k);
    const ok = !empty && confirmed[k];
    const cls = empty ? "" : ok ? " ok" : bad ? " bad" : "";
    const tag = empty ? "비어 있음" : ok ? (edited[k] ? "직접 고침" : "확인함") : bad ? "원문에 없음" : "확인 필요";
    const input = k === "amount"
      ? `<input id="f-${k}" data-k="${k}" inputmode="numeric" value="${esc(L.fmtWon(v))}" placeholder="예: 3,200만" autocomplete="off">`
      : `<input id="f-${k}" data-k="${k}" type="date" value="${esc(v || "")}">`;
    const src = draft.src[k];
    const alts = k === "amount" ? (draft.cand.amount || []).filter((a) => a.value !== v) : (draft.cand.dates || []).filter((d) => d.iso !== v && d.iso >= L.addDays(today(), -30));
    const altHtml = alts.slice(0, 3).map((a) => k === "amount"
      ? `<button type="button" class="alt" data-alt="${a.value}" data-k="${k}">${esc(a.text)}</button>`
      : `<button type="button" class="alt" data-alt="${a.iso}" data-k="${k}">${esc(a.text)}</button>`).join("");
    return `<div class="fld num${cls}" data-f="${k}">
      <label for="f-${k}">${L.LABEL[k]} <span class="tag">${tag}</span></label>
      <div class="num-row">${input}${empty ? "" : `<button type="button" class="chk" data-chk="${k}" aria-pressed="${!!confirmed[k]}" ${bad ? 'disabled title="원문에 없는 숫자예요. 고친 뒤 확인하세요"' : ""}>${confirmed[k] ? "확인함 ✓" : "원문과 맞음"}</button>`}</div>
      <div class="why-src">${bad ? `<b class="bad">메모에 이 숫자가 없어요</b>` : src ? `원문 <button type="button" data-find="${esc(src)}">“${esc(src)}”</button>` : empty ? "메모에 없음" : "원문 표현 없음"}${altHtml ? ` · 다른 후보 ${altHtml}` : ""}</div>
    </div>`;
  }
  function renderForm() {
    $("modeChip").innerHTML = modeChip();
    if (!draft) { $("form").innerHTML = `<p class="fld wide">메모를 넣고 'CRM 칸 채우기'를 누르세요.</p>`; renderWhy(); return; }
    const f = draft.fields;
    $("form").classList.toggle("waiting", waiting);
    $("form").innerHTML = `
      <div class="fld"><label for="f-company">고객사</label><input id="f-company" data-k="company" list="custList" value="${esc(f.company)}" autocomplete="off"><datalist id="custList">${CUSTOMERS.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
      <div class="fld"><label for="f-contact">고객 담당자</label><input id="f-contact" data-k="contact" value="${esc(f.contact)}" autocomplete="off"></div>
      <div class="fld"><label for="f-stage">단계</label><select id="f-stage" data-k="stage">${L.STAGES.map((s) => `<option${s === f.stage ? " selected" : ""}>${s}</option>`).join("")}${L.STAGES.includes(f.stage) ? "" : `<option value="" selected>고르세요</option>`}</select></div>
      ${numBlock("amount")}
      ${numBlock("meetingDate")}
      ${numBlock("nextDate")}
      <div class="fld wide"><label for="f-nextAction">다음 할 일</label><textarea id="f-nextAction" data-k="nextAction" rows="2">${esc(f.nextAction)}</textarea></div>
      <div class="fld wide"><label for="f-summary">요약 <span class="sub">(전화·메일은 자동으로 가려요)</span></label><textarea id="f-summary" data-k="summary" rows="2">${esc(f.summary)}</textarea></div>`;
    $("form").querySelectorAll("input,select,textarea,button").forEach((x) => { x.disabled = x.disabled || waiting; });
    renderWhy();
  }
  function renderWhy() {
    const btn = $("save"), why = $("why");
    if (!draft || waiting) { btn.disabled = true; why.className = "why"; why.textContent = waiting ? "Claude 결과를 기다리는 중이에요" : ""; return; }
    const c = L.canSave(draft.fields, confirmed);
    btn.disabled = !c.ok;
    why.className = c.ok ? "why ok" : "why";
    why.textContent = c.ok ? `${st.owner} 이름으로 저장할 수 있어요` : [c.problems.length ? `${c.problems.join("·")}을(를) 채워 주세요` : "", c.need.length ? `${c.need.map((k) => L.LABEL[k]).join("·")} 확인이 남았어요` : ""].filter(Boolean).join(" · ");
  }

  $("form").addEventListener("change", (e) => {
    const el = e.target.closest("[data-k]");
    if (!el || !draft || el.tagName === "BUTTON") return;
    const k = el.dataset.k;
    if (k === "amount") {
      const v = el.value.trim() ? L.parseWonInput(el.value) : null;
      if (el.value.trim() && v === null) { el.setAttribute("aria-invalid", "true"); toast("금액은 3,200만 · 1.2억 · 32,000,000처럼 써 주세요"); return; }
      draft.fields.amount = v; edited.amount = true; confirmed.amount = v !== null;
    } else if (k === "meetingDate" || k === "nextDate") {
      draft.fields[k] = L.isIso(el.value) ? el.value : ""; edited[k] = true; confirmed[k] = !!draft.fields[k];
    } else {
      draft.fields[k] = k === "summary" || k === "nextAction" ? L.maskPII(el.value.trim()) : el.value.trim();
      if (k !== "stage") { renderWhy(); return; }
    }
    renderForm();
    document.getElementById(`f-${k}`)?.focus();
  });
  $("form").addEventListener("click", (e) => {
    const chk = e.target.closest("[data-chk]");
    if (chk) {
      const k = chk.dataset.chk;
      confirmed[k] = !confirmed[k];
      renderForm();
      document.querySelector(`[data-chk="${k}"]`)?.focus();
      return;
    }
    const alt = e.target.closest("[data-alt]");
    if (alt) {
      const k = alt.dataset.k;
      draft.fields[k] = k === "amount" ? Number(alt.dataset.alt) : alt.dataset.alt;
      draft.src[k] = alt.textContent;
      draft.notInSource = (draft.notInSource || []).filter((x) => x !== k);
      confirmed[k] = true; edited[k] = false;
      renderForm();
      toast(`${L.LABEL[k]}을(를) ‘${alt.textContent}’(으)로 바꾸고 확인했어요`);
      return;
    }
    const f = e.target.closest("[data-find]");
    if (f) findInMemo(f.dataset.find);
  });
  $("found").addEventListener("click", (e) => { const f = e.target.closest("[data-find]"); if (f) findInMemo(f.dataset.find); });

  /* ---------- 채우기 ---------- */
  async function run() {
    const v = memo.value.trim();
    if (!v) { memo.focus(); toast("미팅 메모를 먼저 붙여 넣어 주세요"); return; }
    const my = ++runToken;
    st.memo = memo.value; save();
    const t = today();
    const rule = L.extractRule(memo.value, t, CUSTOMERS);
    draft = rule; confirmed = {}; edited = {}; ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderForm();
    const masked = L.maskPII(memo.value).slice(0, 6000); // 연락처는 AI에도 보내지 않는다
    const r = await AI.ask("meetingcrm.extract", { memo: masked, today: t, weekday: L.DAYS[L.d0(t).getDay()] + "요일", customers: CUSTOMERS, stages: L.STAGES });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 버린다
    waiting = false;
    const n = r && L.normalizeAi(r.data, memo.value, t);
    if (n) { draft = L.mergeAi(rule, n); ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderForm();
    const need = L.canSave(draft.fields, confirmed).need.length;
    toast(`${ai.mode === "ai" ? "Claude가" : "규칙으로"} 칸을 채웠어요 · 숫자 ${need}칸 확인이 남았어요`);
  }
  $("run").addEventListener("click", run);
  memo.addEventListener("input", () => { renderFound(); renderSamples(); });
  memo.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  document.querySelector(".samples").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sample]");
    if (!b) return;
    st.sample = +b.dataset.sample;
    memo.value = sample(st.sample);
    renderFound(); renderSamples(); run();
  });
  $("owner").addEventListener("change", (e) => { st.owner = e.target.value; save(); renderWhy(); });

  /* ---------- 저장 ---------- */
  $("save").addEventListener("click", () => {
    if (!draft) return;
    const c = L.canSave(draft.fields, confirmed);
    if (!c.ok) {
      c.need.forEach((k) => { const el = document.querySelector(`[data-f="${k}"]`); if (el) { el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); } });
      return;
    }
    const f = draft.fields;
    const rec = { id: `r${Date.now().toString(36)}`, savedAt: today(), owner: st.owner, company: f.company.trim(), contact: f.contact, stage: f.stage, amount: f.amount, meetingDate: f.meetingDate, nextDate: f.nextDate, nextAction: L.maskPII(f.nextAction), summary: L.maskPII(f.summary) };
    const before = st.records.slice();
    const r = L.upsert(st.records, rec);
    st.records = r.list;
    lastSaved = (r.list.find((x) => x.company === rec.company && x.meetingDate === rec.meetingDate) || rec).id;
    st.filter = { stage: "all", owner: "all", q: "" };
    save(); renderFilters(); renderCrm();
    toast(r.replaced ? `${rec.company} · 같은 날 미팅 기록을 고쳤어요` : `${rec.company}을(를) CRM에 저장했어요`, () => { st.records = before; save(); renderCrm(); });
    lastSaved = "";
    if (window.innerWidth < 900) $("crmTitle").scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
  });

  /* ---------- CRM 목록 ---------- */
  function renderFilters() {
    $("owner").innerHTML = TEAM.map((n, i) => `<option value="${n}"${n === st.owner ? " selected" : ""}>${n}${i === 0 ? " (나)" : ""}</option>`).join("");
    $("fStage").innerHTML = `<option value="all">모든 단계</option>` + L.STAGES.map((s) => `<option${s === st.filter.stage ? " selected" : ""}>${s}</option>`).join("");
    $("fOwner").innerHTML = `<option value="all">팀 전체 (${TEAM.length}명)</option>` + TEAM.map((n) => `<option${n === st.filter.owner ? " selected" : ""}>${n}</option>`).join("");
    $("fQ").value = st.filter.q;
  }
  function renderCrm() {
    const t = today();
    const list = L.filterRecords(st.records, st.filter);
    const weekAgo = L.addDays(t, -6);
    const sum = list.filter((r) => r.stage !== "보류" && r.amount).reduce((a, r) => a + r.amount, 0);
    $("crmInfo").textContent = `${list.length}건${list.length !== st.records.length ? ` / 전체 ${st.records.length}건` : ""} · 최근 7일 저장 ${st.records.filter((r) => r.savedAt >= weekAgo).length}건 · 예상 금액 합계 ${L.fmtWon(sum) || "0원"} (보류 제외)`;
    $("crmBody").innerHTML = list.length ? list.map((r) => {
      const late = r.nextDate && r.nextDate < t;
      return `<tr data-id="${esc(r.id)}"${r.id === lastSaved ? ' class="new"' : ""}>
        <td class="co"><b>${esc(r.company)}</b><span>${esc(r.contact || "담당자 미상")}</span></td>
        <td data-c="stage"><span class="st" data-s="${esc(r.stage)}">${esc(r.stage)}</span></td>
        <td class="r">${r.amount ? esc(L.fmtWon(r.amount)) : "—"}</td>
        <td data-c="date">${esc(L.withDay(r.meetingDate))}</td>
        <td data-c="nextDate">${r.nextDate ? `<span class="${late ? "late" : ""}">${esc(L.withDay(r.nextDate))}${late ? " 지남" : ""}</span>` : "—"}</td>
        <td class="next">${esc(r.nextAction || r.summary)}</td>
        <td data-c="owner">${esc(r.owner)}</td>
        <td data-c="del"><button type="button" class="del" data-del="${esc(r.id)}" aria-label="${esc(r.company)} 기록 지우기">×</button></td>
      </tr>`;
    }).join("") : `<tr class="empty"><td colspan="8">조건에 맞는 고객 기록이 없어요.</td></tr>`;
  }
  $("crmBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const before = st.records.slice();
    const gone = st.records.find((r) => r.id === b.dataset.del);
    st.records = st.records.filter((r) => r.id !== b.dataset.del);
    save(); renderCrm();
    toast(`${gone ? gone.company : "기록"}을(를) 지웠어요`, () => { st.records = before; save(); renderCrm(); });
  });
  $("fStage").addEventListener("change", (e) => { st.filter.stage = e.target.value; save(); renderCrm(); });
  $("fOwner").addEventListener("change", (e) => { st.filter.owner = e.target.value; save(); renderCrm(); });
  $("fQ").addEventListener("input", (e) => { st.filter.q = e.target.value; save(); renderCrm(); });
  $("csv").addEventListener("click", () => {
    const list = L.filterRecords(st.records, st.filter);
    if (!list.length) { toast("내보낼 기록이 없어요"); return; }
    const blob = new Blob([L.toCsv(list)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `crm-customers-${today().replace(/-/g, "")}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => a.remove(), 0);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${list.length}건을 CSV로 내보냈어요 (연락처 제외)`);
  });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save();
    memo.value = st.memo;
    renderFilters(); renderFound(); renderSamples(); renderCrm(); run();
    toast("샘플 메모와 고객 목록으로 되돌렸어요", () => { st = before; save(); memo.value = st.memo; renderFilters(); renderFound(); renderSamples(); renderCrm(); run(); });
  });

  /* ---------- 시작 ---------- */
  memo.value = st.memo;
  renderFilters(); renderFound(); renderSamples(); renderCrm();
  draft = L.extractRule(memo.value, today(), CUSTOMERS);
  renderForm();
  // 처음엔 규칙 결과를 바로 보여 주고, AI 상태를 확인한 뒤 다시 채운다
  AI.probe().then(() => run());
})();
