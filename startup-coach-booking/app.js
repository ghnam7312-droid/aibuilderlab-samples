/* 한자리 — 화면 (DOM 다루기만 한다. 예약·결제·메일 판단은 logic.js, AI 호출은 ai-client.js)
 *
 * 예약 폼 → 결제 대기 → (모의 결제) → 결제 완료. 시계가 움직일 때마다
 *   1) 12시간 넘게 결제 안 된 예약은 자리를 풀고
 *   2) 보낼 시각이 된 안내 메일을, 그 순간의 예약 상태를 다시 확인한 뒤 보내거나 보류한다.
 * 예약 확정 메일은 규칙 문장이 바로 들어가고, Claude 문장이 검사를 통과하면 바꾼다.
 */
(function () {
  "use strict";
  const L = window.Hanjari;
  const STORE_KEY = "startup-coach-booking-v1";
  const COACH = "이직나침반 코치";
  const TIMES = ["10:00", "14:00", "19:30"];
  const H = L.H;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clockLabel = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  /* ---------- 샘플 (모두 가상 인물) ---------- */
  function seed() {
    const now = Math.floor(Date.now() / 60000) * 60000;
    const fut = L.buildSlots(now, 8, TIMES).flatMap((d) => d.slots).filter((s) => L.slotMs(s) - now >= 30 * H);
    const past = (days, hm) => { const d = new Date(now); d.setDate(d.getDate() - days); const [h, m] = hm.split(":"); d.setHours(+h, +m, 0, 0); if (d.getDay() === 0) d.setDate(d.getDate() - 1); return L.slotOf(d.getTime()); };
    const bk = (id, name, email, product, slot, status, createdAgo, paidAgo, cancelledAgo, note) => ({
      id, name, email, product, slot, status, note: note || "",
      createdAt: now - createdAgo * H, paidAt: paidAgo == null ? null : now - paidAgo * H, cancelledAt: cancelledAgo == null ? null : now - cancelledAgo * H,
    });
    const bookings = [
      bk("s1", "김하린", "harin.kim@example.com", "single", fut[0], "paid", 30, 29, null, "마케팅에서 HR로 옮길 수 있을지"),
      bk("s2", "정소윤", "soyun.j@example.com", "pack4", fut[1], "cancelled", 26, 25, 3),
      bk("s3", "윤재석", "jaeseok.yoon@example.com", "pack4", fut[3], "pending", 2, null, null, "개발 QA에서 PM으로"),
      bk("s4", "배유나", "yuna.bae@example.com", "single", fut[5], "paid", 5, 4, null),
      bk("s5", "서민규", "mingyu.seo@example.com", "single", past(2, "19:30"), "done", 80, 79, null),
      bk("s6", "남궁별", "byeol.ng@example.com", "pack4", past(3, "10:00"), "done", 100, 99, null),
      bk("s7", "차우진", "woojin.cha@example.com", "single", past(4, "14:00"), "noshow", 120, 118, null),
      bk("s8", "유하늘", "haneul.yu@example.com", "single", past(5, "19:30"), "done", 150, 149, null),
    ];
    const outbox = bookings.filter((b) => !["done", "noshow"].includes(b.status)).flatMap((b) => L.replay(b, now)).sort((a, b) => a.at - b.at);
    return { now, bookings, outbox, filter: "all", open: null, form: { product: "single", slot: "" } };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.bookings) && Array.isArray(v.outbox) && typeof v.now === "number") return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  const byId = (id) => st.bookings.find((b) => b.id === id);

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 시계가 움직이면: 만료 → 메일 ---------- */
  function tick() {
    const before = st.bookings.filter((b) => b.status === "pending").length;
    st.bookings = L.expire(st.bookings, st.now);
    const expired = before - st.bookings.filter((b) => b.status === "pending").length;
    const fresh = L.runScheduler(st.bookings, st.outbox, st.now);
    st.outbox = st.outbox.concat(fresh);
    fresh.filter((o) => o.sent && o.type === "confirm").forEach(writeConfirm);
    return { fresh, expired };
  }
  /** 확정 메일: 규칙 문장이 먼저, Claude 문장이 검사를 통과하면 교체 */
  async function writeConfirm(entry) {
    const b = byId(entry.booking);
    entry.mode = "wait";
    const r = await AI.ask("coachbooking.mail", { product: L.PRODUCTS[b.product].label, price: L.won(L.PRODUCTS[b.product].price), when: L.slotLabel(b.slot), firstName: b.name.slice(1) || b.name, note: b.note, coach: COACH, refundRule: "상담 24시간 전까지 전액, 그 뒤 50% 환불" });
    const n = r && L.normalizeMail(r.data, b);
    if (n) { entry.custom = n; entry.mode = "ai"; entry.ms = r.ms; }
    else { entry.mode = "rule"; entry.reason = r ? "응답 형식이 맞지 않음" : (AI.status().reason || ""); }
    save(); renderOutbox(); renderMail();
  }

  /* ---------- 폼 ---------- */
  function renderProds() {
    $("prods").innerHTML = `<legend class="fld">상품</legend>` + Object.entries(L.PRODUCTS).map(([k, p]) =>
      `<label><input type="radio" name="prod" value="${k}" ${st.form.product === k ? "checked" : ""}><span><b>${esc(p.label)}</b><small>${L.won(p.price)}</small></span></label>`).join("");
  }
  function renderSlots() {
    const busy = L.taken(st.bookings);
    if (st.form.slot && (busy.has(st.form.slot) || L.slotMs(st.form.slot) - st.now < 2 * H)) st.form.slot = "";
    $("slots").innerHTML = L.buildSlots(st.now, 7, TIMES).map((d) => `<div class="day"><span class="dl">${esc(d.label)}</span>${d.slots.map((s) => {
      const off = busy.has(s) || L.slotMs(s) - st.now < 2 * H;
      return `<button type="button" data-slot="${s}" ${off ? "disabled" : ""} aria-pressed="${st.form.slot === s}" aria-label="${esc(L.slotLabel(s))}${busy.has(s) ? " 예약됨" : ""}">${s.slice(11)}</button>`;
    }).join("")}</div>`).join("");
  }
  $("prods").addEventListener("change", (e) => { st.form.product = e.target.value; save(); });
  $("slots").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-slot]"); if (!b) return;
    st.form.slot = b.dataset.slot; renderSlots(); $("err").textContent = ""; save();
  });
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = L.createBooking(st.bookings, { name: $("name").value, email: $("email").value, product: st.form.product, slot: st.form.slot, note: $("note").value }, st.now);
    if (!r.ok) { $("err").textContent = r.error; return; }
    $("err").textContent = "";
    st.bookings.push(r.booking);
    st.form.slot = ""; $("name").value = ""; $("email").value = ""; $("note").value = "";
    st.open = r.booking.id;
    tick(); save(); renderAll();
    toast(`${L.slotLabel(r.booking.slot)} 자리를 잡았어요. 결제 요청 메일이 나갔어요`);
  });

  /* ---------- 예약 현황 ---------- */
  const FILTERS = [["all", "전체"], ["pending", "결제 대기"], ["paid", "결제 완료"], ["off", "취소·만료"], ["closed", "지난 상담"]];
  const inFilter = (b) => st.filter === "all" || (st.filter === "off" ? ["cancelled", "expired"].includes(b.status) : st.filter === "closed" ? ["done", "noshow"].includes(b.status) : b.status === st.filter);
  function renderList() {
    $("filters").innerHTML = FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${st.filter === k}">${l}</button>`).join("");
    const s = L.stats(st.bookings);
    $("stats").innerHTML = `<span><b>${s.pending}</b>결제 대기</span><span><b>${s.paid}</b>확정</span><span><b>${L.won(s.revenue)}</b>결제 금액</span><span title="상담 완료·노쇼로 기록한 ${s.closed}건 기준"><b>${s.noshowRate}%</b>노쇼 (기록 ${s.closed}건)</span>`;
    const list = st.bookings.filter(inFilter).sort((a, b) => { const past = (x) => (["done", "noshow"].includes(x.status) ? 1 : 0); return past(a) - past(b) || (past(a) ? L.slotMs(b.slot) - L.slotMs(a.slot) : L.slotMs(a.slot) - L.slotMs(b.slot)); }); // 다가오는 예약 먼저, 지난 상담은 아래
    $("bookings").innerHTML = list.map((b) => {
      const p = L.PRODUCTS[b.product];
      const left = b.status === "pending" ? Math.max(0, Math.ceil((b.createdAt + L.HOLD_H * H - st.now) / H)) : 0;
      const passed = st.now >= L.slotMs(b.slot);
      const acts = b.status === "pending" ? `<button type="button" class="pri-s" data-act="pay">결제 링크 열기</button><button type="button" class="ghost-s" data-act="cancel">취소</button>`
        : b.status === "paid" && !passed ? `<button type="button" class="ghost-s" data-act="cancel">취소 · 환불 ${L.won(L.refundOf(b, st.now))}</button>`
        : b.status === "paid" ? `<button type="button" class="pri-s" data-act="done">상담 완료</button><button type="button" class="ghost-s" data-act="noshow">노쇼</button>` : "";
      return `<li class="bk s-${b.status}${st.open === b.id ? " open" : ""}" data-id="${b.id}">
        <div class="bk-h"><span class="when">${esc(L.slotLabel(b.slot))}</span><span class="badge">${L.STATUS[b.status]}${left ? ` · ${left}시간 남음` : ""}</span></div>
        <div class="bk-b"><b>${esc(b.name)}</b> · ${esc(p.label)} <span class="mute">${esc(L.maskEmail(b.email))}</span></div>
        ${b.note ? `<div class="bk-n">“${esc(b.note)}”</div>` : ""}
        ${acts ? `<div class="bk-a">${acts}</div>` : ""}</li>`;
    }).join("") || `<li class="none">이 상태의 예약이 없어요</li>`;
  }
  $("filters").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (!b) return; st.filter = b.dataset.f; save(); renderList(); });
  let payId = null;
  $("bookings").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const id = btn.closest("li").dataset.id, b = byId(id), act = btn.dataset.act;
    if (act === "pay") {
      payId = id;
      const p = L.PRODUCTS[b.product];
      $("payBody").innerHTML = `<dl><dt>상품</dt><dd>${esc(p.label)}</dd><dt>일시</dt><dd>${esc(L.slotLabel(b.slot))}</dd><dt>금액</dt><dd><b>${L.won(p.price)}</b></dd></dl>`;
      $("payDlg").showModal();
      return;
    }
    const before = JSON.parse(JSON.stringify({ bookings: st.bookings, outbox: st.outbox }));
    const r = act === "cancel" ? L.cancel(b, st.now) : L.close(b, st.now, act === "done");
    if (!r.ok) { toast(r.error); return; }
    st.bookings = st.bookings.map((x) => (x.id === id ? r.booking : x));
    tick(); save(); renderAll();
    const undo = () => { st.bookings = before.bookings; st.outbox = before.outbox; save(); renderAll(); };
    toast(act === "cancel" ? `예약을 취소했어요${r.refund ? ` · 환불 ${L.won(r.refund)}` : ""}. 남은 안내 메일은 가지 않아요` : act === "done" ? "상담 완료로 기록했어요" : "노쇼로 기록했어요", undo);
  });
  $("payDlg").addEventListener("close", () => {
    const v = $("payDlg").returnValue;
    if (!payId || v === "close" || !v) { payId = null; return; }
    const r = L.pay(byId(payId), st.now, v === "ok");
    if (!r.ok) { toast(r.error); payId = null; return; }
    st.bookings = st.bookings.map((x) => (x.id === payId ? r.booking : x));
    st.open = payId; payId = null;
    tick(); save(); renderAll();
    toast("결제 완료 · 예약 확정 메일을 보냈어요");
  });

  /* ---------- 메일함 ---------- */
  function renderOutbox() {
    const list = st.outbox.slice().sort((a, b) => b.at - a.at).slice(0, 14);
    $("outbox").innerHTML = list.map((o) => {
      const b = byId(o.booking);
      const key = `${o.booking}:${o.type}`;
      return `<li><button type="button" data-k="${key}" class="${o.sent ? "sent" : "held"}" aria-pressed="${st.mailKey === key}">
        <span class="t">${clockLabel(o.at)}</span><span class="w">${esc(b ? b.name : "")} · ${L.MAILS[o.type].label}</span>
        <span class="r">${o.sent ? (o.mode === "ai" ? "보냄 · Claude" : "보냄") : `보류 · ${esc(o.reason)}`}</span></button></li>`;
    }).join("") || `<li class="none">아직 보낸 메일이 없어요</li>`;
  }
  function renderMail() {
    const o = st.outbox.find((x) => `${x.booking}:${x.type}` === st.mailKey) || st.outbox.filter((x) => x.sent).slice(-1)[0];
    const chip = $("mailMode");
    if (!o) { $("mail").innerHTML = ""; return; }
    const b = byId(o.booking);
    const m = o.custom || L.ruleMail(o.type, b, COACH);
    if (o.mode === "wait") { chip.dataset.mode = "wait"; chip.innerHTML = "<i></i>Claude가 쓰는 중"; }
    else if (o.mode === "ai") { chip.dataset.mode = "ai"; chip.textContent = `Claude로 작성 · ${(o.ms / 1000).toFixed(1)}초`; }
    else { chip.dataset.mode = "rule"; chip.textContent = `규칙 기반${o.reason ? ` · ${o.reason}` : ""}`; }
    $("mail").innerHTML = `<div class="m-h"><span>받는 사람 ${esc(L.maskEmail(b.email))}</span>${o.sent ? "" : `<b class="held-b">보내지 않음 · ${esc(o.reason)}</b>`}</div>
      <h3>${esc(m.subject)}</h3><p>${esc(m.body).replace(/\n/g, "<br>")}</p>`;
  }
  $("outbox").addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; st.mailKey = b.dataset.k; save(); renderOutbox(); renderMail(); });

  /* ---------- 시계 ---------- */
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    st.now += Number(b.dataset.step) * H;
    const { fresh, expired } = tick(); save(); renderAll();
    const sent = fresh.filter((o) => o.sent).length, held = fresh.length - sent;
    toast(`${b.textContent} → 메일 ${sent}통 보냄${held ? ` · ${held}통 보류` : ""}${expired ? ` · 결제 기한 지나 ${expired}자리 풀림` : ""}`);
  }));
  $("realNow").addEventListener("click", () => {
    if (Date.now() < st.now) { toast("시계는 앞으로만 돌릴 수 있어요. 처음으로 가려면 '샘플로 되돌리기'"); return; }
    st.now = Date.now(); tick(); save(); renderAll();
  });
  $("reset").addEventListener("click", () => {
    const before = st; st = seed(); tick(); save(); renderAll();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  function renderAll() { $("now").textContent = clockLabel(st.now); renderProds(); renderSlots(); renderList(); renderOutbox(); renderMail(); }

  /* ---------- 시작 ---------- */
  // 저장된 확정 메일이 Claude를 기다리던 중이었다면 규칙 문장으로 둔다
  st.outbox.forEach((o) => { if (o.mode === "wait") o.mode = "rule"; });
  tick(); renderAll();
  AI.probe().then(() => renderMail());
})();
