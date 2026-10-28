/* 답해둠 — 화면 (DOM 다루기만 한다. 분류·환불 계산·검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 문의를 고르면
 *   1) logic.route() 로 갈래를 정한다: FAQ 초안 / 환불 규정 / 운영자가 직접
 *   2) FAQ 갈래만 Claude 에게 다시 쓰게 한다. 이름은 보내지 않고, 전화번호·이메일은 가린 뒤 보낸다.
 *      돈 얘기가 섞이거나 형식이 틀리면 버리고 FAQ 초안을 둔다.
 *   환불 갈래는 AI를 부르지 않는다. 주문 정보를 고치면 규정대로 다시 계산한다.
 */
(function () {
  "use strict";
  const L = window.Dapaedum;
  const STORE_KEY = "startup-class-faq-v1";
  const FAQ = L.SAMPLE_FAQ;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());

  /* ---------- 샘플 문의 (가상의 수강생, 화면에는 이름을 가려서 보인다) ---------- */
  function samples() {
    const t = today();
    const O = (paid, ends, watched, kit, back) => ({ paidAt: L.addDays(t, -paid), endsAt: L.addDays(t, ends), price: 99000, total: 24, watched, kitShipped: kit, kitReturned: !!back });
    const Q = (id, ch, name, at, text, order) => ({ id, ch, name, at, text, order: order || null, status: "open" });
    return [
      Q("Q01", "카톡 채널", "박서윤", "09:12", "안녕하세요 재료는 따로 뭘 사야 하나요? 집에 색연필만 있어요"),
      Q("Q02", "DM", "이도현", "09:40", "키트 언제 와요? 주문한 지 이틀 됐어요"),
      Q("Q03", "메일", "최하은", "10:05", "환불하고 싶어요. 결제한 지 3일 됐고 영상은 1강만 봤어요. 키트는 아직 안 받았어요.", O(3, 87, 1, false)),
      Q("Q04", "카톡 채널", "정우진", "10:22", "수강 기간이 몇 달인가요? 천천히 듣고 싶어서요"),
      Q("Q05", "카톡 채널", "한지아", "10:48", "영상이 계속 끊겨요 ㅠㅠ 소리만 나오고 화면은 검은 화면이에요"),
      Q("Q06", "DM", "오민재", "11:10", "중간에 그만두면 환불 되나요? 지금 10강까지 들었어요. 키트는 받았어요", O(20, 70, 10, true)),
      Q("Q07", "메일", "윤채원", "11:35", "다음 달에 이사라 바빠서요, 기간 연장 가능한가요? 연락은 010-2345-6789로 주세요"),
      Q("Q08", "카톡 채널", "서지호", "12:02", "영상 다운로드해서 비행기에서 보고 싶은데 가능할까요?"),
      Q("Q09", "카톡 채널", "강예린", "13:15", "어제 환불 요청했는데 답이 없네요. 계속 이러면 소비자원에 신고할게요", O(5, 85, 3, true)),
      Q("Q10", "DM", "임수아", "13:40", "그림 완전 처음인데 따라갈 수 있을까요? 왕초보예요"),
      Q("Q11", "메일", "조현우", "14:05", "갑자기 입원하게 돼서 수업을 못 듣게 됐어요. 수업을 미루거나 할 수 있을까요?"),
      Q("Q12", "카톡 채널", "백소율", "14:30", "과제 올렸는데 피드백은 언제쯤 받을 수 있나요?"),
      Q("Q13", "카톡 채널", "노은서", "15:02", "수채 종이 말고 집에 있는 스케치북 써도 되나요?"),
      Q("Q14", "DM", "문태민", "15:20", "수강 끝난 지 일주일 됐는데 지금 환불 신청해도 되나요?", O(97, -7, 24, true)),
      Q("Q15", "카톡 채널", "유하린", "15:41", "수업 끝나고 작품 전시 같은 것도 하나요?"),
    ];
  }
  function routeAll(list) {
    list.forEach((q) => { if (!q.route) { q.route = L.route(q, FAQ, today()); q.reply = q.route.reply; q.mode = "rule"; q.reason = ""; } });
    return list;
  }

  /* ---------- 상태 ---------- */
  const seed = () => ({ inq: routeAll(samples()), sel: "Q03", filter: "all", n: 15 });
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.inq) && v.inq.every((q) => q.route)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  const cur = () => st.inq.find((q) => q.id === st.sel) || null;
  let runToken = 0;
  let waiting = false;

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

  /* ---------- 위: 현황 ---------- */
  function renderStats() {
    const all = st.inq;
    const auto = all.filter((q) => q.route.kind !== "human").length;
    const human = all.length - auto;
    const done = all.filter((q) => q.status === "done").length;
    const t = L.timeSaved(auto);
    const tile = (k, v, sub, cls) => `<div class="tile ${cls || ""}"><span>${k}</span><b>${v}</b><em>${sub}</em></div>`;
    $("stats").innerHTML = tile("오늘 문의", `${all.length}건`, `답변 완료 ${done}건`)
      + tile("초안 자동", `${auto}건`, "FAQ · 환불 규정", "ok")
      + tile("직접 답변", `${human}건`, "분쟁·예외·새 질문", human ? "warn" : "")
      + tile("반복 문의 응대", `${t.after}분`, `손으로 하면 ${t.before}분`, "ok");
  }

  /* ---------- 왼쪽: 문의함 ---------- */
  const KIND = { faq: ["FAQ 초안", "faq"], policy: ["환불 규정", "policy"], human: ["직접 답변", "human"] };
  function renderFilters() {
    const counts = {};
    st.inq.forEach((q) => { counts[q.route.cat] = (counts[q.route.cat] || 0) + 1; });
    const opts = [["all", "전체", st.inq.length], ...L.CATS.map((c) => [c.id, c.label, counts[c.id] || 0]), ["human", "직접 답변", st.inq.filter((q) => q.route.kind === "human").length]];
    $("filters").innerHTML = opts.map(([id, label, n]) => `<button type="button" data-f="${id}" aria-pressed="${st.filter === id}">${label} <span>${n}</span></button>`).join("");
  }
  function visible() {
    return st.inq.filter((q) => st.filter === "all" || (st.filter === "human" ? q.route.kind === "human" : q.route.cat === st.filter));
  }
  function renderList() {
    $("list").innerHTML = visible().map((q) => {
      const [k, cls] = KIND[q.route.kind];
      return `<li><button type="button" data-id="${q.id}" aria-current="${q.id === st.sel}" class="${q.status === "done" ? "done" : ""}">
        <span class="l-top"><b>${esc(L.maskName(q.name))}</b><span class="ch">${esc(q.ch)} · ${q.at}</span></span>
        <span class="l-t">${esc(L.maskText(q.text))}</span>
        <span class="l-tags"><span class="cat c-${q.route.cat}">${L.catLabel(q.route.cat)}</span><span class="kind k-${cls}">${k}</span>${q.mode === "ai" ? `<span class="kind k-ai">Claude</span>` : ""}${q.status === "done" ? `<span class="kind k-done">답변 완료</span>` : ""}</span>
      </button></li>`;
    }).join("") || `<li class="none">이 분류의 문의가 없어요.</li>`;
  }

  /* ---------- 오른쪽: 문의 한 건 ---------- */
  function modeChip(q) {
    if (q.route.kind === "policy") return `<span class="mode" data-mode="policy">규정 문서로 답변 · AI 사용 안 함</span>`;
    if (q.route.kind === "human" && q.mode !== "ai") return `<span class="mode" data-mode="human">운영자가 직접 답변</span>`;
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 FAQ를 보는 중</span>`;
    if (q.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 초안 · ${(q.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule">규칙 기반${q.reason ? ` · ${esc(q.reason)}` : ""}</span>`;
  }
  function orderForm(q) {
    const o = q.order;
    if (!o) return `<div class="order none">주문 정보가 연결되지 않은 문의예요. 규정 5항에 따라 직접 확인해 주세요.</div>`;
    const c = q.route.calc;
    return `<div class="order">
      <h3>주문 정보 <span>고치면 규정대로 다시 계산해요</span></h3>
      <div class="o-grid">
        <label>결제한 지 <input type="number" min="0" max="400" data-o="paid" value="${L.daysBetween(o.paidAt, today())}"> 일</label>
        <label>시청 <input type="number" min="0" max="${o.total}" data-o="watched" value="${o.watched}"> / ${o.total}강</label>
        <label>수강 종료까지 <input type="number" min="-400" max="400" data-o="ends" value="${L.daysBetween(today(), o.endsAt)}"> 일</label>
        <label class="chk"><input type="checkbox" data-o="kit" ${o.kitShipped ? "checked" : ""}> 키트 발송됨</label>
        <label class="chk"><input type="checkbox" data-o="back" ${o.kitReturned ? "checked" : ""} ${o.kitShipped ? "" : "disabled"}> 뜯지 않고 반송</label>
      </div>
      ${c && c.ok ? `<p class="calc"><b>${c.amount > 0 ? L.won(c.amount) : "환불 없음"}</b> · 결제 ${L.won(o.price)} · ${c.steps.map(esc).join(" / ")}</p>
      <ul class="cl">${c.clauses.map((n) => `<li><b>${n}항</b> ${esc(L.clause(n).text)}</li>`).join("")}</ul>` : ""}
    </div>`;
  }
  function renderDetail() {
    const q = cur();
    if (!q) { $("detail").innerHTML = `<div class="empty"><b>문의를 골라 주세요</b>왼쪽 목록에서 하나를 고르면 초안이 나와요.</div>`; return; }
    const r = q.route;
    const humanNote = r.kind === "human" && q.mode !== "ai";
    $("detail").innerHTML = `
      <div class="d-h"><div><h1>${esc(L.maskName(q.name))} <span>${esc(q.ch)} · ${q.at}</span></h1></div>${modeChip(q)}</div>
      <blockquote class="msg">${esc(L.maskText(q.text))}</blockquote>
      <p class="route"><span class="cat c-${r.cat}">${L.catLabel(r.cat)}</span> ${esc(r.reason)}</p>
      ${r.cat === "refund" ? orderForm(q) : ""}
      ${humanNote ? `<div class="hand"><b>운영자가 직접 답해 주세요</b>${r.escalated ? "분쟁·신고·규정에 없는 사정은 AI도 규칙도 답하지 않아요. 아래 칸에 직접 쓰면 답변 완료로 넘길 수 있어요." : "맞는 FAQ가 없어요. 직접 답하고, 자주 오면 FAQ에 추가하세요."}</div>` : ""}
      <label class="rl" for="reply">답변 ${humanNote ? "(직접 작성)" : "초안 · 고쳐서 보내세요"}</label>
      <textarea id="reply" rows="8" class="${waiting && L.aiAllowed(r) ? "waiting" : ""}" placeholder="${humanNote ? "운영자가 직접 답변을 써 주세요" : ""}">${esc(q.reply)}</textarea>
      <div class="d-act">
        <button class="ghost-btn" id="copy" type="button">답변 복사</button>
        <button class="primary" id="done" type="button">${q.status === "done" ? "다시 열기" : "답변 완료"}</button>
      </div>
      <p class="fine">이름은 화면에서 가리고 AI에 보내지 않아요. 문의 속 전화번호·이메일도 가린 뒤 보내요.</p>`;
  }

  /* ---------- 초안: 규칙 먼저, FAQ 갈래만 Claude ---------- */
  async function draft(q) {
    const my = ++runToken;
    if (!L.aiAllowed(q.route)) { waiting = false; renderDetail(); return; }
    waiting = AI.status().enabled !== false;
    renderDetail();
    const faqIds = FAQ.map((f) => f.id);
    const r = await AI.ask("classfaq.reply", {
      question: L.maskText(q.text), category: L.catLabel(q.route.cat),
      faq: FAQ.map((f) => ({ id: f.id, q: f.q, a: f.a })),
    });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeReply(r.data, faqIds);
    if (n && !q.touched) { q.reply = n.reply; q.mode = "ai"; q.ms = r.ms; if (n.faqId) q.route.faqId = n.faqId; }
    else q.reason = n ? "직접 고친 답변 유지" : r ? "돈 얘기·형식 오류라 버림" : (AI.status().reason || "");
    save(); renderDetail(); renderList(); renderFaq();
  }
  function select(id) {
    st.sel = id; save();
    renderList();
    const q = cur();
    if (q && q.status !== "done" && q.mode !== "ai" && !q.touched) draft(q); else { runToken++; waiting = false; renderDetail(); }
  }

  /* ---------- 아래: FAQ · 규정 ---------- */
  function renderFaq() {
    const s = L.faqStats(st.inq, FAQ);
    const max = Math.max(1, ...s.top.map((f) => f.n));
    $("faq").innerHTML = s.top.map((f) => `<li><span class="f-q"><code>${f.id}</code> ${esc(f.q)}</span><span class="bar-n"><i style="width:${(f.n / max) * 100}%"></i></span><b>${f.n}</b></li>`).join("");
  }
  function renderPolicy() { $("policy").innerHTML = L.POLICY.map((p) => `<li>${esc(p.text)}</li>`).join(""); }
  const renderAll = () => { renderStats(); renderFilters(); renderList(); renderDetail(); renderFaq(); };

  /* ---------- 이벤트 ---------- */
  $("list").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) select(b.dataset.id); });
  $("filters").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (!b) return; st.filter = b.dataset.f; save(); renderFilters(); renderList(); });
  $("detail").addEventListener("input", (e) => {
    const q = cur(); if (!q) return;
    if (e.target.id === "reply") { q.reply = e.target.value; q.touched = true; save(); }
  });
  $("detail").addEventListener("change", (e) => {
    const q = cur(); const k = e.target.dataset.o;
    if (!q || !k || !q.order) return;
    const o = q.order, v = e.target.type === "checkbox" ? e.target.checked : Math.round(Number(e.target.value) || 0);
    if (k === "paid") o.paidAt = L.addDays(today(), -Math.max(0, v));
    if (k === "watched") o.watched = Math.max(0, Math.min(o.total, v));
    if (k === "ends") o.endsAt = L.addDays(today(), v);
    if (k === "kit") { o.kitShipped = v; if (!v) o.kitReturned = false; }
    if (k === "back") o.kitReturned = v;
    q.route = L.route(q, FAQ, today()); q.reply = q.route.reply; q.touched = false;
    save(); renderDetail(); renderStats();
    const again = document.querySelector(`[data-o="${k}"]`); if (again) again.focus();
  });
  $("detail").addEventListener("click", async (e) => {
    const q = cur(); if (!q) return;
    if (e.target.closest("#copy")) {
      if (!q.reply.trim()) { toast("답변이 비어 있어요"); return; }
      try { await navigator.clipboard.writeText(q.reply); toast("답변을 복사했어요"); } catch (err) { toast("복사 권한이 없어 칸을 선택해 두었어요"); $("reply").select(); }
    }
    if (e.target.closest("#done")) {
      if (q.status !== "done" && !q.reply.trim()) { toast("답변을 쓴 뒤 완료할 수 있어요"); $("reply").focus(); return; }
      const before = q.status;
      q.status = q.status === "done" ? "open" : "done";
      save(); renderAll();
      if (q.status === "done") {
        const next = visible().find((x) => x.status !== "done");
        toast(`${L.maskName(q.name)}님 문의를 답변 완료로 옮겼어요`, () => { q.status = before; st.sel = q.id; save(); renderAll(); });
        if (next) select(next.id);
      }
    }
  });
  $("newForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("newText").value.trim();
    if (!text) return;
    st.n = (st.n || 15) + 1;
    const now = new Date();
    const q = { id: `Q${String(st.n).padStart(2, "0")}`, ch: $("newCh").value, name: "새 문의", at: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, text, order: null, status: "open" };
    routeAll([q]);
    st.inq.push(q);
    st.filter = "all";
    $("newText").value = "";
    save(); renderStats(); renderFilters(); renderFaq();
    select(q.id);
    toast(`${L.catLabel(q.route.cat)} 문의 · ${KIND[q.route.kind][0]}로 분류했어요`);
  });
  $("copyFaq").addEventListener("click", async () => {
    const md = L.faqMarkdown(L.faqStats(st.inq, FAQ));
    $("mdOut").textContent = md; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(md); toast("많이 걸린 순서로 FAQ를 복사했어요"); } catch (err) { $("mdBox").open = true; toast("복사 권한이 없어 아래에 펼쳐 두었어요"); }
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    runToken++; waiting = false;
    st = seed(); save(); renderAll(); select(st.sel);
    toast("샘플 문의로 되돌렸어요", () => { runToken++; waiting = false; st = before; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  renderPolicy(); renderAll();
  AI.probe().then(() => { const q = cur(); if (q) select(q.id); });
})();
