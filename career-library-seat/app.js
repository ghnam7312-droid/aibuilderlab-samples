/* 빈자리 — 화면 (DOM 다루기만 한다. 평균·혼잡 찾기·보고서 검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 기간이나 결측 처리 방식을 바꾸면
 *   1) 기록을 다시 평균 내 열지도 · 혼잡 시간대 · 규칙 보고서를 바로 그리고
 *   2) Claude(libseat.report)에게 같은 숫자를 보내 보고서 문장을 다시 쓰게 한다.
 *      입력에 없는 숫자가 나오거나 형식이 틀리면 버리고 규칙 보고서를 둔다.
 * 보고서는 '이 데이터로는 모르는 것'을 결론보다 먼저 보여 준다.
 */
(function () {
  "use strict";
  const L = window.Binjari;
  const STORE_KEY = "career-library-seat-v1";
  const LOGS = { exam: L.sampleLog("exam"), normal: L.sampleLog("normal") };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const zoneOf = (id) => L.ZONES.find((z) => z.id === id);

  /* ---------- 상태 ---------- */
  function seed() { return { period: "exam", zero: false, sel: { zone: "B", hour: 10 } }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && L.PERIODS[v.period] && v.sel && zoneOf(v.sel.zone) && L.HOURS.includes(v.sel.hour)) return { ...seed(), ...v };
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let mx = null;
  let rep = { data: null, mode: "rule", reason: "", ms: 0 };
  let repKey = "";
  let waiting = false;
  let token = 0;

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  /** 이용률 → 색 (크림 → 녹슨 주황 → 진한 갈색) */
  function heat(r) {
    if (r == null) return "#EEE9E4";
    const stops = [[0, [250, 244, 236]], [0.5, [244, 190, 140]], [0.8, [221, 120, 70]], [1, [140, 45, 18]]];
    let i = 0;
    while (i < stops.length - 2 && r > stops[i + 1][0]) i++;
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    const t = Math.min(1, Math.max(0, (r - a) / (b - a)));
    return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(",")})`;
  }

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 요약 숫자 ---------- */
  function renderKpis() {
    const s = L.summary(mx);
    const peaks = L.findPeaks(mx);
    const p = L.PERIODS[st.period];
    $("kpis").innerHTML = `
      <div class="kpi"><span>분석 기간</span><b>${p.days.length}<small>일</small></b><em>${esc(p.label)} · ${esc(p.range)}</em></div>
      <div class="kpi"><span>전체 평균 이용률</span><b>${s.overallPct ?? "—"}<small>%</small></b><em>좌석 ${s.seatTotal}석 · 8–24시</em></div>
      <div class="kpi"><span>가장 붐빈 칸</span><b>${s.top ? s.top.pct : "—"}<small>%</small></b><em>${s.top ? `${esc(s.top.zoneName)} · ${s.top.hour}시` : ""}</em></div>
      <div class="kpi ${st.zero ? "bad" : ""}"><span>기록이 빠진 시간</span><b>${mx.missingHours}<small>시간</small></b><em>${st.zero ? "지금 0으로 계산 중 (이전 방식)" : "평균에서 빼고 계산"}</em></div>
      <div class="kpi hot"><span>혼잡 시간대 (90% 이상)</span><b>${peaks.length}<small>개</small></b><em>목표치 3개 도출</em></div>`;
  }

  /* ---------- 열지도 ---------- */
  function renderHeatmap() {
    const head = `<div class="hm-row hm-head" role="row"><span class="hm-z" role="columnheader">구역</span>${L.HOURS.map((h) => `<span role="columnheader">${h}</span>`).join("")}</div>`;
    const rows = L.ZONES.map((z) => `<div class="hm-row" role="row"><span class="hm-z" role="rowheader">${esc(z.name)}<small>${z.seats}석</small></span>${L.HOURS.map((h) => {
      const c = mx.cells[z.id][h];
      const p = L.pct(c.rate);
      const on = st.sel.zone === z.id && st.sel.hour === h;
      const cls = [c.rate != null && c.rate >= L.PEAK ? "pk" : "", c.missing ? "ms" : "", on ? "on" : "", c.rate != null && c.rate >= 0.62 ? "dk" : ""].join(" ").trim();
      return `<button type="button" role="gridcell" class="${cls}" data-z="${z.id}" data-h="${h}" style="background-color:${heat(c.rate)}" aria-label="${esc(z.name)} ${h}시 평균 ${p ?? "기록 없음"}%${c.missing ? `, 기록 빠진 날 ${c.missing}일` : ""}" aria-pressed="${on}">${p ?? ""}</button>`;
    }).join("")}</div>`).join("");
    $("hm").innerHTML = head + rows;
  }
  function renderCell() {
    const z = zoneOf(st.sel.zone), h = st.sel.hour;
    const c = mx.cells[z.id][h];
    const recs = LOGS[st.period].filter((x) => x.zone === z.id && x.hour === h);
    $("cell").innerHTML = `<div class="cell-h"><b>${esc(z.name)} · ${h}–${h + 1}시</b>
      <span>평균 <strong>${L.pct(c.rate) ?? "—"}%</strong> · ${c.n}일 평균${c.missing ? ` · <em>${c.missing}일 기록 없음 → ${st.zero ? "0으로 넣음" : "빼고 계산"}</em>` : ""}</span></div>
      <ul class="days">${recs.map((x) => {
        const r = x.used == null ? null : x.used / z.seats;
        return `<li title="${esc(x.day)}"><span class="d-bar">${r == null ? `<i class="miss"></i>` : `<i style="height:${Math.max(4, r * 100)}%;background:${heat(r)}"></i>`}</span><span class="d-v">${r == null ? "없음" : L.pct(r)}</span><span class="d-d">${esc(x.day.slice(3))}일</span></li>`;
      }).join("")}</ul>`;
  }

  /* ---------- 혼잡 시간대 ---------- */
  function renderPeaks() {
    const peaks = L.findPeaks(mx);
    $("pkN").textContent = `${peaks.length}개`;
    $("peaks").innerHTML = peaks.length ? peaks.map((p, i) => `<li><button type="button" data-z="${p.zone}" data-h="${p.from}">
      <span class="rk">${i + 1}</span><span class="pk-w"><b>${esc(p.zoneName)}</b><span>${p.from}시 – ${p.to}시 · ${p.hours}시간 연속</span></span><span class="pk-v">${p.avgPct}%</span></button></li>`).join("")
      : `<li class="none">이용률 90%를 넘는 시간대가 없어요. ${st.period === "normal" ? "평소에는 좌석이 모자라지 않아요." : ""}</li>`;
  }

  /* ---------- 보고서 (규칙 → Claude) ---------- */
  function modeBadge() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 쓰는 중</span>`;
    if (rep.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 작성 · ${(rep.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 정해진 문장 틀로 썼어요">규칙 기반${rep.reason ? ` · ${esc(rep.reason)}` : ""}</span>`;
  }
  function renderReport() {
    $("mode").innerHTML = modeBadge();
    const r = rep.data;
    if (!r) return;
    const p = L.PERIODS[st.period];
    $("report").className = waiting ? "waiting" : "";
    $("report").innerHTML = `
      <p class="meta">가상의 ○○대학교 중앙도서관 · ${esc(p.label)} ${esc(p.range)} · 좌석 시스템 기록 · ${st.zero ? "결측 0 처리(이전 방식)" : "결측 제외 평균"}</p>
      <h3 class="headline">${esc(r.headline)}</h3>
      <section class="rp unknown"><h4><span>1</span>이 데이터로는 모르는 것</h4><ul>${r.unknowns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <section class="rp"><h4><span>2</span>결론 · 혼잡 시간대</h4><ul>${r.findings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <section class="rp prop"><h4><span>3</span>재배치 제안</h4><p>${esc(r.proposal)}</p></section>
      <p class="fine">보고서 속 숫자는 모두 위 집계와 대조해요. 맞지 않는 숫자가 있으면 Claude 문장을 버려요. 결정은 도서관 담당자가 현장 확인 뒤에 해요.</p>`;
  }
  async function runReport() {
    const key = `${st.period}|${st.zero}`;
    if (key === repKey) { renderReport(); return; }
    repKey = key;
    const my = ++token;
    const input = L.aiInput(st.period, mx, { zeroForMissing: st.zero });
    rep = { data: L.ruleReport(input), mode: "rule", reason: "", ms: 0 };
    if (AI.status().enabled === null) { waiting = true; repKey = ""; renderReport(); return; } // 연결 확인이 끝나면 다시 부른다
    waiting = AI.status().enabled !== false;
    if (!waiting) rep.reason = AI.status().reason || "";
    renderReport();
    if (!waiting) return;
    const r = await AI.ask("libseat.report", input);
    if (my !== token) return; // 그 사이 조건이 바뀌었으면 버린다
    waiting = false;
    if (r) {
      const n = L.normalizeReport(r.data, input);
      if (n.ok) rep = { data: n.report, mode: "ai", reason: "", ms: r.ms };
      else rep.reason = n.reason;
    } else rep.reason = AI.status().reason || "AI 응답 없음";
    renderReport();
  }

  /* ---------- 전체 그리기 ---------- */
  function render() {
    mx = L.matrix(LOGS[st.period], { zeroForMissing: st.zero });
    document.querySelectorAll("[data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === st.period)));
    $("zeroMode").setAttribute("aria-checked", String(st.zero));
    renderKpis(); renderHeatmap(); renderCell(); renderPeaks();
    save();
    runReport();
  }
  function select(zone, hour, focus) {
    st.sel = { zone, hour };
    renderHeatmap(); renderCell(); save();
    if (focus) { const b = $("hm").querySelector(`[data-z="${zone}"][data-h="${hour}"]`); if (b) b.focus(); }
  }

  /* ---------- 이벤트 ---------- */
  document.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", () => {
    if (st.period === b.dataset.period) return;
    st.period = b.dataset.period;
    render();
    toast(`${L.PERIODS[st.period].label} 기록으로 바꿨어요 · 혼잡 시간대 ${L.findPeaks(mx).length}개`);
  }));
  $("zeroMode").addEventListener("click", () => {
    const before = L.findPeaks(mx).length;
    st.zero = !st.zero;
    render();
    const after = L.findPeaks(mx).length;
    toast(st.zero ? `결측 ${mx.missingHours}시간을 0으로 넣었어요 · 혼잡 시간대 ${before}개 → ${after}개` : "결측은 빼고 다시 평균을 냈어요");
  });
  $("hm").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-z]");
    if (b) select(b.dataset.z, +b.dataset.h, true);
  });
  $("hm").addEventListener("keydown", (e) => {
    const b = e.target.closest("button[data-z]");
    if (!b) return;
    const zi = L.ZONES.findIndex((z) => z.id === b.dataset.z), hi = L.HOURS.indexOf(+b.dataset.h);
    const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!mv) return;
    e.preventDefault();
    const nz = L.ZONES[Math.min(L.ZONES.length - 1, Math.max(0, zi + mv[0]))], nh = L.HOURS[Math.min(L.HOURS.length - 1, Math.max(0, hi + mv[1]))];
    select(nz.id, nh, true);
  });
  $("peaks").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-z]");
    if (!b) return;
    select(b.dataset.z, +b.dataset.h, true);
    $("cell").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  });
  $("csv").addEventListener("click", () => {
    const blob = new Blob([L.toCsv(st.period, mx)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `좌석이용률_${L.PERIODS[st.period].label.replace(/\s/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("구역 × 시각 이용률 표를 CSV로 내보냈어요");
  });
  $("print").addEventListener("click", () => window.print());
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); repKey = "";
    render();
    toast("샘플 조건으로 되돌렸어요", () => { st = before; repKey = ""; render(); });
  });

  /* ---------- 시작 ---------- */
  render();
  AI.probe().then(() => { repKey = ""; runReport(); });
})();
