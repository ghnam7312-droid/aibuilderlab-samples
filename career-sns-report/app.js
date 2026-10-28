/* 곁눈 — 화면 (DOM 다루기만 한다. 날짜·집계·요약 검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 시트 표를 읽으면 날짜를 한 형식으로 맞추고(못 읽은 칸은 '확인 필요'로 남겨 직접 고친다),
 * 보고 주의 게시물만 모아 브랜드별로 집계한다. 요약은 규칙으로 바로 쓰고, Claude 결과가 오면
 * 원문 게시물 id가 있는 문장만 남겨 바꾼다. 요약 문장마다 원문 링크가 붙는다.
 */
(function () {
  "use strict";
  const L = window.Gyeotnun;
  const STORE_KEY = "career-sns-report-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const BRAND_COLORS = ["#0E8A7E", "#C2571A", "#5B57C9", "#B23A6B", "#2F6FB0", "#7A7F2A"];

  /* ---------- 상태 ---------- */
  function seedIssues() {
    const last = L.addDays(L.weekStart(today()), -7);
    let iss = [];
    for (let i = 8; i >= 1; i--) iss = L.publish(iss, L.addDays(last, -7 * i), L.addDays(last, -7 * i + 7));
    return iss;
  }
  function seed() {
    return { raw: L.sampleSheet(today()), week: L.addDays(L.weekStart(today()), -7), fix: {}, issues: seedIssues(), tab: "dates", brand: "all", naive: false, sum: null };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.week) && Array.isArray(v.issues)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let posts = [], report = null, byId = {};
  let sumToken = 0;

  function compute() {
    posts = L.parseSheet(st.raw, today()).map((p) => (st.fix[p.row] ? { ...p, date: st.fix[p.row], kind: "직접 고침" } : p));
    byId = Object.fromEntries(posts.map((p) => [p.id, p]));
    report = L.buildReport(posts, st.week);
  }
  const brandColor = (name) => BRAND_COLORS[Math.max(0, [...new Set(posts.map((p) => p.brand))].indexOf(name)) % BRAND_COLORS.length];

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

  /* ---------- 단계 표시 ---------- */
  function renderFlow() {
    const kinds = new Set(posts.filter((p) => p.date && p.kind !== "직접 고침").map((p) => p.kind));
    const steps = [
      ["붙여넣기", `${posts.length}행 · 브랜드 ${new Set(posts.map((p) => p.brand)).size}곳`],
      ["날짜 맞추기", `형식 ${kinds.size}종 → 한 형식${report.unknown.length ? ` · 확인 필요 ${report.unknown.length}` : ""}`, report.unknown.length ? "warn" : ""],
      ["주 거르기", `${L.md(report.start)}–${L.md(report.end)} · ${report.posts.length}건`],
      ["요약 + 원문 링크", st.sum && st.sum.week === st.week ? `${st.sum.lines.length}문장` : "—"],
    ];
    $("flow").innerHTML = steps.map(([t, d, cls], i) => `<li class="${cls || ""}"><span class="no">${i + 1}</span><div><b>${t}</b><span>${esc(d)}</span></div></li>`).join("") +
      `<li class="goal"><div><b>1기 목표치</b><span>주간 정리 3시간 → 25분</span></div></li>`;
  }

  /* ---------- 왼쪽: 날짜 맞추기 ---------- */
  function renderSrc() {
    $("tabDates").setAttribute("aria-pressed", String(st.tab === "dates"));
    $("tabRaw").setAttribute("aria-pressed", String(st.tab === "raw"));
    $("datesBox").hidden = st.tab !== "dates";
    $("rawBox").hidden = st.tab !== "raw";
    if ($("raw").value !== st.raw && document.activeElement !== $("raw")) $("raw").value = st.raw;
    const unk = report.unknown.length;
    $("srcTip").innerHTML = st.tab === "dates"
      ? `시트마다 날짜 형식이 달라 그대로 정렬하면 순서가 틀려요. 모두 <code>YYYY-MM-DD</code>로 맞췄어요.${unk ? ` <b class="warn-t">읽지 못한 ${unk}건은 직접 넣어 주세요.</b>` : ""}`
      : "구글 시트에서 범위를 복사해 그대로 붙여 넣으세요. 첫 줄이 머리글이면 건너뛰어요.";
    $("dates").innerHTML = `<thead><tr><th>행</th><th>브랜드</th><th>원문 날짜</th><th>맞춘 날짜</th></tr></thead><tbody>` +
      posts.map((p) => `<tr class="${p.date ? (p.date >= report.start && p.date <= report.end ? "in" : "out") : "bad"}">
        <td class="n">${p.row}</td><td><i class="dot" style="background:${brandColor(p.brand)}"></i>${esc(p.brand)}</td>
        <td><span class="rawd">${esc(p.rawDate || "(빈 칸)")}</span> <span class="kind">${esc(p.kind)}</span></td>
        <td>${p.date && p.kind !== "직접 고침" ? `<b>${p.date}</b>` : `<label class="sr" for="fx${p.row}">${p.row}행 날짜</label><input id="fx${p.row}" data-row="${p.row}" placeholder="2026-10-21" value="${esc(st.fix[p.row] || "")}" ${p.date ? "" : 'aria-invalid="true"'}>`}</td></tr>`).join("") + "</tbody>";
  }
  $("dates").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-row]");
    if (!inp) return;
    const v = inp.value.trim();
    const d = v ? L.normDate(v, today()).date : "";
    if (v && !d) { inp.setAttribute("aria-invalid", "true"); toast("날짜를 읽지 못했어요. 2026-10-21처럼 써 주세요"); return; }
    if (d) st.fix[inp.dataset.row] = d; else delete st.fix[inp.dataset.row];
    save(); refresh(true);
    toast(d ? `${inp.dataset.row}행 날짜를 ${d}로 넣었어요` : "직접 넣은 날짜를 지웠어요");
  });
  $("tabDates").addEventListener("click", () => { st.tab = "dates"; save(); renderSrc(); });
  $("tabRaw").addEventListener("click", () => { st.tab = "raw"; save(); renderSrc(); $("raw").focus(); });
  $("reread").addEventListener("click", () => {
    const before = { raw: st.raw, fix: st.fix };
    st.raw = $("raw").value; st.fix = {}; st.tab = "dates";
    save(); refresh(true);
    toast(`${posts.length}행을 다시 읽었어요`, () => { st.raw = before.raw; st.fix = before.fix; $("raw").value = st.raw; save(); refresh(true); });
  });

  /* ---------- 오른쪽: 리포트 ---------- */
  function issueOf(week) { return st.issues.find((x) => x.week === week); }
  function modeChip(s) {
    if (!s) return "";
    if (s.mode === "wait") return `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    if (s.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(s.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule">규칙 기반${s.reason ? ` · ${esc(s.reason)}` : ""}</span>`;
  }
  function refLinks(refs) {
    return refs.map((id, i) => { const p = byId[id]; if (!p) return ""; const label = `원문${i + 1}`;
      return p.link ? `<a class="ref" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" data-id="${id}" title="${esc(p.brand)} · ${esc(p.text)}">${label}</a>` : `<button type="button" class="ref" data-id="${id}">${label}</button>`; }).join("");
  }
  function renderReport() {
    const iss = issueOf(st.week);
    const nextNo = st.issues.reduce((m, x) => Math.max(m, x.no), 0) + 1;
    $("repTitle").innerHTML = `${iss ? `#${iss.no}` : `<span class="draft">초안 #${nextNo}</span>`} ${L.withDay(report.start)} – ${L.withDay(report.end)}`;
    $("nextWk").disabled = st.week >= L.weekStart(today());
    $("publish").disabled = !!iss || !report.posts.length;
    $("publish").textContent = iss ? "발행함" : "발행";
    const s = st.sum && st.sum.week === st.week ? st.sum : null;
    $("sumMode").innerHTML = modeChip(s);
    $("sum").innerHTML = s && s.lines.length ? s.lines.map((l) => `<li><span>${esc(l.text)}</span><span class="refs">${refLinks(l.refs)}</span></li>`).join("")
      : `<li class="none">이 주에는 게시물이 없어요.</li>`;
    $("sum").classList.toggle("waiting", !!(s && s.mode === "wait"));
    $("watch").hidden = !(s && s.watch);
    $("watch").textContent = s && s.watch ? `확인: ${s.watch}` : "";
    const maxT = Math.max(1, ...report.brands.map((b) => b.total));
    $("brands").innerHTML = `<thead><tr><th>브랜드</th><th class="r">게시물</th><th>반응 합계 (좋아요+댓글)</th><th>대표 게시물</th></tr></thead><tbody>` +
      report.brands.map((b) => `<tr><td><i class="dot" style="background:${brandColor(b.name)}"></i><b>${esc(b.name)}</b></td><td class="r">${b.count}</td>
        <td><div class="bar-c"><i style="width:${Math.round((b.total / maxT) * 70)}%;background:${brandColor(b.name)}"></i><span>${b.total.toLocaleString()}</span></div></td>
        <td class="top">${b.top ? `${b.top.link ? `<a href="${esc(b.top.link)}" target="_blank" rel="noopener noreferrer">${esc(b.top.text)}</a>` : esc(b.top.text)}` : `<span class="mute">게시물 없음</span>`}</td></tr>`).join("") + "</tbody>";
    renderTimeline();
  }
  function renderTimeline() {
    const names = [...new Set(posts.map((p) => p.brand))];
    if (st.brand !== "all" && !names.includes(st.brand)) st.brand = "all";
    $("chips").innerHTML = `<button type="button" data-b="all" aria-pressed="${st.brand === "all"}">전체</button>` +
      names.map((n) => `<button type="button" data-b="${esc(n)}" aria-pressed="${st.brand === n}"><i class="dot" style="background:${brandColor(n)}"></i>${esc(n)}</button>`).join("");
    $("naive").checked = st.naive;
    let list = st.naive ? L.naiveSort(report.posts) : report.posts;
    if (st.brand !== "all") list = list.filter((p) => p.brand === st.brand);
    $("tlCount").textContent = `${list.length}건`;
    $("tl").classList.toggle("naive-on", st.naive);
    $("tl").innerHTML = list.map((p) => `<li id="post-${p.id}"><span class="d">${st.naive ? esc(p.rawDate) : L.withDay(p.date)}</span>
      <div><div class="who"><i class="dot" style="background:${brandColor(p.brand)}"></i><b>${esc(p.brand)}</b><span class="ch">${esc(p.channel)}</span></div>
      <p>${esc(p.text)}</p><span class="eng">좋아요 ${p.likes.toLocaleString()} · 댓글 ${p.comments.toLocaleString()}</span></div>
      ${p.link ? `<a class="open" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(p.brand)} 원문 열기">원문 ↗</a>` : ""}</li>`).join("")
      || `<li class="none">이 조건의 게시물이 없어요.</li>`;
  }
  $("chips").addEventListener("click", (e) => { const b = e.target.closest("button[data-b]"); if (!b) return; st.brand = b.dataset.b; save(); renderTimeline(); });
  $("naive").addEventListener("change", (e) => {
    st.naive = e.target.checked; save(); renderTimeline();
    if (st.naive) toast("원문 글자 그대로 정렬하면 숫자 형식이 맨 위로 가는 등 순서가 틀려요");
  });
  // 요약의 원문 버튼: 링크가 없는 게시물은 아래 목록으로 이동
  $("sum").addEventListener("click", (e) => {
    const b = e.target.closest("button.ref"); if (!b) return;
    const li = $(`post-${b.dataset.id}`); if (!li) return;
    li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
    li.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  /* ---------- 요약: 규칙 즉시 → Claude ---------- */
  async function summarize() {
    const my = ++sumToken;
    const rule = L.ruleSummary(report);
    st.sum = { week: st.week, ...rule, mode: report.posts.length && AI.status().enabled !== false ? "wait" : "rule", reason: "" };
    renderReport(); renderFlow();
    if (!report.posts.length) { save(); return; }
    const r = await AI.ask("snsreport.summary", {
      week: { start: report.start, end: report.end },
      brands: report.brands.map((b) => ({ name: b.name, posts: b.count, engagement: b.total })),
      posts: report.posts.map((p) => ({ id: p.id, brand: p.brand, date: p.date, channel: p.channel, text: p.text, likes: p.likes, comments: p.comments })),
    });
    if (my !== sumToken) return; // 그 사이 주를 바꿨으면 버린다
    const n = r && L.normalizeSummary(r.data, report);
    if (n) Object.assign(st.sum, { lines: n.lines, watch: n.watch || rule.watch, mode: "ai", ms: r.ms, dropped: n.dropped });
    else Object.assign(st.sum, { mode: "rule", reason: r ? "원문 링크 없는 응답" : (AI.status().reason || "") });
    save(); renderReport(); renderFlow();
  }
  $("again").addEventListener("click", summarize);

  /* ---------- 주 이동 · 발행 · 내보내기 ---------- */
  function goWeek(n) { st.week = L.addDays(st.week, 7 * n); st.brand = "all"; save(); refresh(true); }
  $("prevWk").addEventListener("click", () => goWeek(-1));
  $("nextWk").addEventListener("click", () => goWeek(1));
  $("publish").addEventListener("click", () => {
    const before = st.issues;
    st.issues = L.publish(st.issues, st.week, today());
    save(); renderReport(); renderIssues();
    toast(`리포트 #${issueOf(st.week).no}을 발행했어요 · ${L.streak(st.issues)}주 연속`, () => { st.issues = before; save(); renderReport(); renderIssues(); });
  });
  $("copyMd").addEventListener("click", async () => {
    const s = st.sum && st.sum.week === st.week ? st.sum : L.ruleSummary(report);
    const out = L.toMarkdown(report, s, (issueOf(st.week) || {}).no, byId);
    $("mdOut").textContent = out; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(out); toast("복사했어요. 노션·메신저에 붙여 넣으세요"); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("print").addEventListener("click", () => window.print());

  /* ---------- 발행 기록 ---------- */
  function renderIssues() {
    const list = st.issues.slice().sort((a, b) => a.week.localeCompare(b.week)).slice(-10);
    $("streak").textContent = `${L.streak(st.issues)}주 연속 발행`;
    $("iss").innerHTML = list.map((x) => `<li><button type="button" data-w="${x.week}" aria-current="${x.week === st.week}"><b>#${x.no}</b><span>${L.md(x.week)}–${L.md(L.addDays(x.week, 6))}</span></button></li>`).join("");
  }
  $("iss").addEventListener("click", (e) => { const b = e.target.closest("button[data-w]"); if (!b) return; st.week = b.dataset.w; save(); refresh(true); });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); $("raw").value = st.raw;
    save(); refresh(true);
    toast("샘플 시트로 되돌렸어요", () => { st = before; $("raw").value = st.raw; save(); refresh(true); });
  });

  function refresh(resum) {
    compute(); renderSrc(); renderReport(); renderIssues(); renderFlow();
    if (resum) summarize();
  }
  $("raw").value = st.raw;
  refresh(false);
  AI.probe().then(() => summarize());
})();
