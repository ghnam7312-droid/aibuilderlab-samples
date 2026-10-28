/* 장비표 — 화면 (DOM 다루기만 한다. 겹침·검사·저장 규칙은 logic.js, AI 호출은 ai-client.js)
 *
 * '한 줄로 말하기'를 채우면
 *   1) 규칙으로 바로 예약 칸을 채우고 (기다리지 않게)
 *   2) Claude 에게 같은 문장을 보내 다시 읽는다. 돌아오면 칸을 덮어쓴다. 실패하면 1)을 그대로 둔다.
 * 예약은 늘 createStore(constraint:true)의 insert 를 거친다. 화면 확인을 통과해도 저장 순간 겹치면 거절된다.
 */
(function () {
  "use strict";
  const L = window.Jangbipyo;
  const STORE_KEY = "career-lab-booking-v1";
  const LABS = [
    { id: "a", name: "재료역학 실험실" },
    { id: "b", name: "열유체 실험실" },
    { id: "c", name: "정밀가공 실험실" },
  ];
  const EQ = [
    { id: "utm", name: "만능재료시험기", short: "UTM", alias: ["UTM", "인장시험기", "재료시험기"], lab: "a", training: false },
    { id: "sem", name: "주사전자현미경", short: "SEM", alias: ["SEM", "전자현미경", "현미경"], lab: "a", training: true },
    { id: "wind", name: "소형 풍동", short: "풍동", alias: ["풍동"], lab: "b", training: false },
    { id: "cam", name: "고속 카메라", short: "고속캠", alias: ["고속카메라", "카메라"], lab: "b", training: false },
    { id: "cnc", name: "CNC 밀링머신", short: "CNC", alias: ["CNC", "밀링"], lab: "c", training: true },
    { id: "print", name: "3D 프린터", short: "3D", alias: ["3D프린터", "3D 프린터", "프린터"], lab: "c", training: false },
  ];
  const eqOf = (id) => EQ.find((e) => e.id === id);
  const labOf = (id) => LABS.find((l) => l.id === id);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const week = () => Array.from({ length: 7 }, (_, i) => L.addDays(today(), i));

  /* ---------- 샘플 예약 (오늘 기준 날짜로 만든다) ---------- */
  function seed() {
    const t = today();
    const S = [
      [0, "utm", "10:00", "12:00", "박서윤", "강철 시편 인장 3회", "ok"], [0, "wind", "09:30", "11:30", "최민서", "익형 양력 측정", "ok"],
      [0, "cam", "14:00", "16:30", "한지호", "분무 촬영", "ok"], [0, "print", "10:00", "14:00", "오세아", "지그 출력", "ok"],
      [0, "cnc", "15:00", "18:00", "정우진", "알루미늄 브래킷 가공", "ok"], [0, "sem", "16:00", "18:00", "김하린", "파단면 관찰", "ok"],
      [1, "utm", "13:00", "15:00", "이도현", "복합재 굽힘", "ok"], [1, "sem", "10:00", "12:00", "김하린", "코팅 두께 측정", "pending"],
      [1, "cnc", "09:00", "11:00", "박서윤", "시편 홀더 가공", "pending"], [1, "wind", "15:00", "17:00", "최민서", "후류 측정", "ok"],
      [1, "print", "13:00", "17:00", "한지호", "노즐 시제품", "ok"], [2, "utm", "09:00", "11:00", "정우진", "용접부 인장", "ok"],
      [2, "cam", "10:00", "12:00", "오세아", "액적 충돌 촬영", "ok"], [2, "sem", "14:00", "17:00", "이도현", "분말 입도 확인", "pending"],
      [3, "wind", "10:00", "13:00", "한지호", "드론 프로펠러 시험", "ok"], [3, "print", "09:00", "12:00", "박서윤", "케이스 출력", "ok"],
      [4, "utm", "14:00", "17:00", "김하린", "피로 시험 준비", "ok"], [4, "cnc", "13:00", "15:30", "최민서", "치구 가공", "ok"],
      [5, "cam", "13:00", "15:00", "정우진", "연소 촬영", "ok"], [6, "print", "10:00", "13:00", "이도현", "교체 부품 출력", "ok"],
    ];
    const bookings = S.map(([d, eq, s, e, who, purpose, status], i) => ({ id: `s${i + 1}`, eq, date: L.addDays(t, d), start: L.toMin(s), end: L.toMin(e), who, purpose, status }));
    return { bookings, day: 0, lab: "all", race: "on", mine: [], who: "" };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.bookings)) { v.day = 0; return v; }
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  // 이름이 들어 있으므로 이 브라우저 안에만 둔다. 주소·로그로 내보내지 않는다
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let parseToken = 0;
  let parseMode = null; // {mode:'ai'|'rule'|'wait', ms, reason}

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  const range = (b) => `${L.hhmm(b.start)}~${L.hhmm(b.end)}`;
  const live = () => st.bookings.filter((b) => b.status !== "cancelled");

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 현황 ---------- */
  function renderStats() {
    const w = week();
    const inWeek = live().filter((b) => w.includes(b.date));
    const clashes = L.conflictPairs(st.bookings).length;
    const pend = live().filter((b) => b.status === "pending").length;
    $("stats").innerHTML = `
      <div class="stat"><b>${inWeek.length}건</b><span>7일 안의 예약</span></div>
      <div class="stat goal"><b>${clashes}건</b><span>예약 충돌 · 목표 월 9건 → 0건</span></div>
      <div class="stat${pend ? " warn" : ""}"><b>${pend}건</b><span>관리자 승인 대기</span></div>
      <div class="stat"><b>3곳</b><span>사용 연구실 · 장비 ${EQ.length}대</span></div>`;
  }

  /* ---------- 폼 ---------- */
  function fillSelects() {
    $("fEq").innerHTML = `<option value="">장비 고르기</option>` + LABS.map((l) => `<optgroup label="${esc(l.name)}">${EQ.filter((e) => e.lab === l.id).map((e) => `<option value="${e.id}">${esc(e.name)}${e.training ? " · 안전교육" : ""}</option>`).join("")}</optgroup>`).join("");
    $("fDate").innerHTML = week().map((d, i) => `<option value="${d}">${L.withDay(d)}${i === 0 ? " 오늘" : i === 1 ? " 내일" : ""}</option>`).join("");
    const opts = (from, to) => { let h = ""; for (let m = from; m <= to; m += L.STEP) h += `<option value="${m}">${L.hhmm(m)}</option>`; return h; };
    $("fStart").innerHTML = `<option value="-1">시작</option>` + opts(L.OPEN, L.CLOSE - L.STEP);
    $("fEnd").innerHTML = `<option value="-1">끝</option>` + opts(L.OPEN + L.STEP, L.CLOSE);
    $("fWho").value = st.who || "";
  }
  function formValue() {
    return { eq: $("fEq").value, date: $("fDate").value, start: +$("fStart").value, end: +$("fEnd").value, who: $("fWho").value.trim(), purpose: $("fWhy").value.trim() };
  }
  function setField(id, v) { const el = $(id); if ([...el.options].some((o) => o.value === String(v))) el.value = String(v); }
  function renderTrain() {
    const e = eqOf($("fEq").value);
    $("trainNote").hidden = !(e && e.training);
    if (e && e.training) $("trainNote").textContent = `${e.name}은(는) 안전교육 이수자만 쓸 수 있어요. 예약은 ‘승인 대기’로 들어가고, 실험실 관리자가 이수 여부를 확인한 뒤 확정해요.`;
  }
  function applyParsed(p) {
    document.querySelectorAll(".f.miss").forEach((x) => x.classList.remove("miss"));
    if (p.eq) setField("fEq", p.eq);
    const inWeek = p.date && week().includes(p.date);
    if (inWeek) setField("fDate", p.date);
    if (p.start >= 0) setField("fStart", p.start);
    if (p.end >= 0) setField("fEnd", p.end);
    if (p.purpose) $("fWhy").value = p.purpose;
    const miss = { 장비: "fEq", 날짜: "fDate", "시작 시간": "fStart", "끝 시간": "fEnd" };
    p.missing.forEach((m) => $(miss[m])?.parentElement.classList.add("miss"));
    if (p.date && !inWeek) $("fDate").parentElement.classList.add("miss");
    renderTrain();
    return { missing: p.missing.concat(p.date && !inWeek ? ["7일 안의 날짜"] : []) };
  }
  function renderParseMode(missing) {
    const m = parseMode;
    if (!m) { $("parseMode").innerHTML = ""; return; }
    let chip;
    if (m.mode === "wait") chip = `<span class="mode" data-mode="wait"><i></i>Claude가 다시 읽는 중</span>`;
    else if (m.mode === "ai") chip = `<span class="mode" data-mode="ai">Claude로 정리 · ${(m.ms / 1000).toFixed(1)}초</span>`;
    else chip = `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 정해진 표현(내일, 오후 2시, 3시간, 장비 이름)만 읽었어요">규칙 기반${m.reason ? ` · ${esc(m.reason)}` : ""}</span>`;
    const tail = missing && missing.length ? `직접 골라 주세요: ${missing.map(esc).join(", ")}` : m.mode === "wait" ? "" : "칸을 확인하고 ‘예약하기’를 누르세요";
    $("parseMode").innerHTML = chip + `<span>${tail}${m.note ? ` · ${esc(m.note)}` : ""}</span>`;
  }
  async function quickParse() {
    const text = $("quick").value.trim();
    if (!text) { toast("예약 문장을 먼저 써 주세요"); $("quick").focus(); return; }
    const my = ++parseToken;
    const t = today();
    const rule = L.parseRequest(text, t, EQ);
    let res = applyParsed(rule);
    parseMode = { mode: AI.status().enabled === false ? "rule" : "wait", reason: AI.status().reason || "" };
    renderParseMode(res.missing);
    const r = await AI.ask("labbooking.parse", { text: text.slice(0, 300), today: t, weekday: L.DAYS[L.d0(t).getDay()] + "요일", equipment: EQ.map((e) => ({ id: e.id, name: e.name, alias: e.alias })) });
    if (my !== parseToken) return; // 그 사이 다시 눌렀으면 버린다
    const n = r && L.normalizeParse(r.data, EQ);
    if (n) { res = applyParsed(n); parseMode = { mode: "ai", ms: r.ms, note: n.note }; }
    else parseMode = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderParseMode(res.missing);
  }
  $("parse").addEventListener("click", quickParse);
  $("quick").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quickParse(); } });
  document.querySelector(".samples").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-q]"); if (!b) return;
    $("quick").value = b.dataset.q; quickParse();
  });
  $("fEq").addEventListener("change", renderTrain);
  $("form").addEventListener("change", (e) => e.target.closest(".f")?.classList.remove("miss"));

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const b = formValue();
    const errs = L.validate(b, today(), nowMin());
    $("fWho").setAttribute("aria-invalid", String(!b.who));
    if (errs.length) { $("errs").innerHTML = errs.map((x) => `<li>${esc(x)}</li>`).join(""); return; }
    // 저장은 언제나 DB 제약을 거친다 (화면 확인을 통과해도 저장 순간 다시 본다)
    const store = L.createStore(st.bookings, { constraint: true });
    const status = L.statusFor(eqOf(b.eq));
    const r = store.insert({ ...b, id: `u${Date.now().toString(36)}`, status });
    if (!r.ok) {
      $("errs").innerHTML = `<li>${esc(eqOf(b.eq).name)} ${L.withDay(b.date)} ${range(r.conflict)}에 이미 예약이 있어요. 다른 시간을 골라 주세요.</li>`;
      return;
    }
    $("errs").innerHTML = "";
    const before = st.bookings.slice();
    st.bookings = store.rows();
    st.mine.push(r.row.id);
    st.who = b.who;
    st.day = Math.max(0, week().indexOf(b.date));
    if (st.lab !== "all" && eqOf(b.eq).lab !== st.lab) st.lab = "all";
    save(); renderAll();
    toast(status === "pending" ? `승인 대기로 넣었어요. 관리자가 안전교육 이수를 확인하면 확정돼요` : `${eqOf(b.eq).short} ${L.withDay(b.date)} ${range(b)} 예약했어요`,
      () => { st.bookings = before; st.mine = st.mine.filter((x) => x !== r.row.id); save(); renderAll(); });
  });

  /* ---------- 시간표 ---------- */
  function renderFilters() {
    $("labs").innerHTML = [{ id: "all", name: "전체" }, ...LABS].map((l) => `<button type="button" data-lab="${l.id}" aria-pressed="${st.lab === l.id}">${esc(l.name)}</button>`).join("");
    $("days").innerHTML = week().map((d, i) => {
      const n = live().filter((b) => b.date === d && (st.lab === "all" || eqOf(b.eq).lab === st.lab)).length;
      return `<button type="button" role="tab" data-day="${i}" aria-selected="${st.day === i}">${i === 0 ? "오늘" : L.withDay(d)}<small>${n}</small></button>`;
    }).join("");
  }
  function renderTable() {
    const date = week()[st.day];
    const span = L.CLOSE - L.OPEN;
    const pos = (m) => ((m - L.OPEN) / span) * 100;
    const isToday = st.day === 0, nm = nowMin();
    const clash = new Set(L.conflictPairs(st.bookings).flat());
    let h = `<div></div><div class="hd">${Array.from({ length: 13 }, (_, i) => `<span style="left:${(i / 12) * 100}%">${i === 0 || i === 12 ? "" : 9 + i}</span>`).join("")}</div>`;
    for (const e of EQ.filter((x) => st.lab === "all" || x.lab === st.lab)) {
      const slots = Array.from({ length: span / L.STEP }, (_, i) => {
        const m = L.OPEN + i * L.STEP, past = isToday && m + L.STEP <= nm;
        return `<button type="button" class="slot${past ? " past" : ""}" data-eq="${e.id}" data-m="${m}" ${past ? "disabled" : ""} aria-label="${esc(e.name)} ${L.hhmm(m)}부터 예약"></button>`;
      }).join("");
      const blocks = live().filter((b) => b.eq === e.id && b.date === date).map((b) =>
        `<button type="button" class="bk${b.status === "pending" ? " pending" : ""}${st.mine.includes(b.id) ? " mine" : ""}${clash.has(b.id) ? " clash" : ""}" data-id="${b.id}" style="left:${pos(b.start)}%;width:${pos(b.end) - pos(b.start)}%" aria-label="${esc(e.name)} ${range(b)} ${esc(b.who)} ${b.status === "pending" ? "승인 대기" : "확정"}">${esc(b.who)}<small>${range(b)}</small></button>`).join("");
      h += `<div class="eqn">${esc(e.name)}<small>${esc(labOf(e.lab).name)}</small>${e.training ? `<span class="tr">안전교육 필요</span>` : ""}</div><div class="lane">${slots}${blocks}</div>`;
    }
    $("tt").innerHTML = h;
  }
  $("labs").addEventListener("click", (e) => { const b = e.target.closest("button[data-lab]"); if (!b) return; st.lab = b.dataset.lab; save(); closePop(); renderFilters(); renderTable(); });
  $("days").addEventListener("click", (e) => { const b = e.target.closest("button[data-day]"); if (!b) return; st.day = +b.dataset.day; closePop(); renderFilters(); renderTable(); });
  $("days").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    st.day = (st.day + (e.key === "ArrowRight" ? 1 : 6)) % 7; renderFilters(); renderTable();
    $("days").querySelector(`[data-day="${st.day}"]`).focus();
  });
  $("tt").addEventListener("click", (e) => {
    const s = e.target.closest("button.slot");
    if (s) {
      closePop();
      setField("fEq", s.dataset.eq); setField("fDate", week()[st.day]);
      const m = +s.dataset.m; setField("fStart", m); setField("fEnd", Math.min(m + 120, L.CLOSE));
      document.querySelectorAll(".f.miss").forEach((x) => x.classList.remove("miss"));
      renderTrain(); $("errs").innerHTML = "";
      $("fWho").focus();
      toast(`${eqOf(s.dataset.eq).short} ${L.hhmm(m)}부터 2시간으로 채웠어요`);
      return;
    }
    const k = e.target.closest("button.bk");
    if (k) openPop(k.dataset.id, k);
  });

  /* ---------- 예약 자세히 ---------- */
  let popFrom = null;
  function openPop(id, from) {
    const b = st.bookings.find((x) => x.id === id); if (!b) return;
    const e = eqOf(b.eq);
    popFrom = from;
    $("pop").innerHTML = `<button type="button" class="x" data-act="close" aria-label="닫기">✕</button>
      <h3 id="popTitle">${esc(e.name)}</h3>
      <p>${L.withDay(b.date)} ${range(b)} · ${esc(labOf(e.lab).name)}</p>
      <p>예약자 ${esc(b.who)}${b.purpose ? ` · ${esc(b.purpose)}` : ""}</p>
      <p>${b.status === "pending" ? `<span class="chip">승인 대기</span> 안전교육 이수 확인 전이에요` : "확정"}</p>
      <div class="acts">${b.status === "pending" ? `<button type="button" class="ghost-btn" data-act="approve" data-id="${b.id}">관리자로 승인</button>` : ""}<button type="button" class="danger" data-act="cancel" data-id="${b.id}">예약 취소</button></div>`;
    $("pop").hidden = false;
    $("pop").querySelector(".x").focus();
  }
  function closePop() { if ($("pop").hidden) return; $("pop").hidden = true; popFrom?.focus?.(); popFrom = null; }
  function setStatus(id, status) {
    const b = st.bookings.find((x) => x.id === id); if (!b) return;
    const prev = b.status;
    b.status = status;
    save(); closePop(); renderAll();
    const what = `${eqOf(b.eq).short} ${L.withDay(b.date)} ${range(b)}`;
    toast(status === "cancelled" ? `${what} 예약을 취소했어요` : `${what} 승인했어요`, () => {
      if (prev !== "cancelled" && L.findConflict(st.bookings, { ...b, status: prev })) { toast("그 사이 같은 시간에 다른 예약이 들어와 되돌릴 수 없어요"); return; }
      b.status = prev; save(); renderAll();
    });
  }
  $("pop").addEventListener("click", (e) => {
    const a = e.target.closest("button[data-act]"); if (!a) return;
    if (a.dataset.act === "close") closePop();
    if (a.dataset.act === "cancel") setStatus(a.dataset.id, "cancelled");
    if (a.dataset.act === "approve") setStatus(a.dataset.id, "ok");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

  /* ---------- 승인 대기 ---------- */
  function renderQueue() {
    const list = live().filter((b) => b.status === "pending").sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    $("queue").innerHTML = list.map((b) => `<li><span class="chip">승인 대기</span><span class="what">${esc(eqOf(b.eq).name)} · ${L.withDay(b.date)} ${range(b)}<small>${esc(b.who)}${b.purpose ? ` · ${esc(b.purpose)}` : ""} · 안전교육 이수 확인 필요</small></span>
      <button type="button" class="ghost-btn" data-act="approve" data-id="${b.id}">이수 확인 · 승인</button><button type="button" class="danger" data-act="cancel" data-id="${b.id}">반려</button></li>`).join("")
      || `<li class="none">승인을 기다리는 예약이 없어요.</li>`;
  }
  $("queue").addEventListener("click", (e) => {
    const a = e.target.closest("button[data-act]"); if (!a) return;
    setStatus(a.dataset.id, a.dataset.act === "approve" ? "ok" : "cancelled");
  });

  /* ---------- 내보내기 ---------- */
  $("csv").addEventListener("click", () => {
    const csv = L.toCsv(st.bookings, EQ, LABS);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `장비표-예약-${today().replace(/-/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`예약 ${live().length}건을 내려받았어요. 예약자 이름은 김*준처럼 가렸어요`);
  });
  $("print").addEventListener("click", () => window.print());

  /* ---------- 동시 예약 재현 ---------- */
  function raceSlot() {
    // 내일 3D 프린터에서 처음 비는 1시간
    const date = week()[1];
    for (let m = 16 * 60; m + 60 <= L.CLOSE; m += 30) {
      const b = { eq: "print", date, start: m, end: m + 60 };
      if (!L.findConflict(st.bookings, b)) return b;
    }
    return { eq: "print", date, start: 20 * 60, end: 21 * 60 };
  }
  function renderRace() {
    document.querySelectorAll(".race .seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === st.race)));
    const s = raceSlot();
    $("raceSlot").innerHTML = `<b>${esc(eqOf(s.eq).name)}</b> · ${L.withDay(s.date)} ${range(s)} — 박서윤, 이도현이 0.004초 차이로 누릅니다. 실제 예약에는 남지 않아요.`;
  }
  $("raceGo").addEventListener("click", () => {
    const s = raceSlot();
    const store = L.createStore(st.bookings, { constraint: st.race === "on" });
    const r = L.simulateRace(store, { ...s, id: "ra", who: "박서윤", status: "ok" }, { ...s, id: "rb", who: "이도현", status: "ok" });
    const ts = ["10:00:00.120", "10:00:00.124", "10:00:00.131", "10:00:00.133"];
    const line = (x, i) => {
      const txt = x.step === "check" ? `‘비어 있음’ 확인 <b>${x.ok ? "통과" : "막힘"}</b>` : x.ok ? `저장 <b>성공</b>` : `저장 <b>거절</b> · ${x.code ? `${x.code} 겹치는 예약` : "이미 찼어요"} → “방금 다른 분이 예약했어요” 안내`;
      return `<li class="${x.ok ? "ok" : "no"}"><span class="t">${ts[i]}</span><span>${esc(x.who)} ${txt}</span></li>`;
    };
    const sum = r.conflicts
      ? `<li class="sum bad">둘 다 저장됨 → 같은 시간 충돌 ${r.conflicts}건. 단톡방·화면 확인만으로는 이렇게 겹쳤어요</li>`
      : `<li class="sum">한 사람만 저장 → 충돌 0건. 늦게 누른 사람은 다른 시간을 고르도록 안내받아요</li>`;
    $("raceLog").innerHTML = r.log.map(line).join("") + sum;
  });
  document.querySelector(".race .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]"); if (!b) return;
    st.race = b.dataset.c; save(); renderRace(); $("raceLog").innerHTML = "";
  });

  /* ---------- 시작 ---------- */
  function renderAll() { renderStats(); renderFilters(); renderTable(); renderQueue(); renderRace(); }
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save();
    fillSelects(); $("fWhy").value = ""; $("quick").value = ""; $("errs").innerHTML = ""; parseMode = null; renderParseMode();
    closePop(); renderAll(); $("raceLog").innerHTML = "";
    toast("샘플 예약으로 되돌렸어요", () => { st = before; save(); fillSelects(); renderAll(); });
  });
  fillSelects();
  renderAll();
  AI.probe().then(() => {
    // 처음 온 사람: 예시 문장 하나를 넣고 바로 채워 보여 준다
    if (!$("quick").value) { $("quick").value = "내일 오후 2시부터 3시간 SEM 용도: 파단면 관찰"; quickParse(); }
  });
})();
