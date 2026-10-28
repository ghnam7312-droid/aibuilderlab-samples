/* 광고한장 — 화면 (DOM 다루기만 한다. 계산·검사·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * 숫자를 고치거나 전환 기준을 바꾸면 리포트 숫자는 그 자리에서 다시 계산된다.
 * 요약 문장은
 *   1) 규칙으로 바로 쓰고 (기다리지 않게)
 *   2) Claude(adweekly.summary)에게 같은 숫자를 보내 다시 쓴다. 문장 속 숫자가 리포트에 없는 숫자면 버린다.
 * 숫자가 바뀌면 Claude 요약은 낡은 것이 되므로 규칙 요약으로 돌아가고, '요약 다시 쓰기'로 다시 맡긴다.
 */
(function () {
  "use strict";
  const L = window.Gwanggo;
  const STORE_KEY = "ax-ad-weekly-v1";
  const THIS_MONDAY = "2026-10-26"; // 이 리포트를 발행하는 월요일 (샘플 기준)
  const THIS_WEEK = "W44";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = L.sample();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- 상태 ---------- */
  function seed() {
    return { cur: clone(S.cur), std: L.DEFAULT_STD.slice(), log: clone(S.log), sel: "search" };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.cur && Array.isArray(v.std) && Array.isArray(v.log)) {
        L.CHANNELS.forEach((c) => { if (!v.cur[c.id]) throw new Error("채널 없음"); });
        return v;
      }
    } catch (e) { /* 저장소를 못 쓰거나 형식이 다르면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let rep = null;
  let summary = null;
  let ai = { mode: "rule", reason: "" };
  let waiting = false;
  let runToken = 0;
  let justPublished = false;

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
  const fmtNum = (n) => (Number.isFinite(n) ? L.comma(n) : "–");
  function delta(n, unit, invert) {
    if (!Number.isFinite(n)) return `<em class="flat">지난주 없음</em>`;
    const r = Math.round(n * 10) / 10;
    if (r === 0) return `<em class="flat">지난주와 같음</em>`;
    const good = invert ? r < 0 : r > 0;
    return `<em class="${good ? "up" : "down"}">${r > 0 ? "▲" : "▼"} ${L.pct1(Math.abs(r))}${unit}</em>`;
  }

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 왼쪽: 채널 원본 ---------- */
  function renderTabs() {
    $("chTabs").innerHTML = L.CHANNELS.map((c) => {
      const bad = L.validateRow(st.cur[c.id], c).length > 0;
      return `<button type="button" role="tab" id="tab-${c.id}" data-ch="${c.id}" aria-selected="${c.id === st.sel}" aria-controls="rawPanel" tabindex="${c.id === st.sel ? 0 : -1}" class="${bad ? "bad" : ""}"${bad ? ' title="고칠 숫자가 있어요"' : ""}>${esc(c.short)}</button>`;
    }).join("");
    $("rawPanel").setAttribute("aria-labelledby", `tab-${st.sel}`);
  }
  function renderRaw() {
    const ch = L.CHANNELS.find((c) => c.id === st.sel);
    const row = st.cur[ch.id], prev = S.prev[ch.id];
    const fields = ["imp", "click", "cost", ...ch.reports, "revenue"];
    const errs = L.validateRow(row, ch);
    $("raw").innerHTML = `<caption class="cap">${esc(ch.name)} · 이 채널은 ‘전환’에 ${ch.reports.map((k) => esc(L.label(k))).join("+")}을 셉니다</caption>
      <thead><tr><th scope="col">항목</th><th scope="col" style="text-align:right">이번 주</th><th scope="col" style="text-align:right">지난주</th></tr></thead>
      <tbody>${fields.map((k) => {
        const inStd = !L.EVENTS.some((e) => e.id === k) || st.std.includes(k);
        const bad = errs.some((m) => m.includes(L.label(k)));
        return `<tr><th scope="row"><label for="f-${k}">${esc(L.label(k))}</label>${inStd ? "" : "<em>기준 밖</em>"}</th>
          <td><input id="f-${k}" data-k="${k}" type="number" inputmode="numeric" min="0" step="1" value="${Number.isFinite(row[k]) ? row[k] : ""}" aria-invalid="${bad}"></td>
          <td class="prev">${fmtNum(prev[k])}</td></tr>`;
      }).join("")}</tbody>`;
    $("rawErr").hidden = !errs.length;
    $("rawErr").textContent = errs.length ? `${ch.name}: ${errs.join(" · ")}` : "";
  }
  $("chTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ch]");
    if (!b) return;
    st.sel = b.dataset.ch; save(); renderTabs(); renderRaw();
  });
  $("chTabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const ids = L.CHANNELS.map((c) => c.id);
    const i = (ids.indexOf(st.sel) + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length;
    st.sel = ids[i]; save(); renderTabs(); renderRaw();
    $(`tab-${st.sel}`).focus();
  });
  $("raw").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const v = e.target.value.trim();
    st.cur[st.sel][k] = v === "" ? NaN : Number(v);
    save();
    numbersChanged();
    // 입력 중인 칸은 다시 그리지 않고 오류 표시만 바꾼다
    const ch = L.CHANNELS.find((c) => c.id === st.sel);
    const errs = L.validateRow(st.cur[st.sel], ch);
    document.querySelectorAll("#raw input").forEach((inp) => inp.setAttribute("aria-invalid", String(errs.some((m) => m.includes(L.label(inp.dataset.k))))));
    $("rawErr").hidden = !errs.length;
    $("rawErr").textContent = errs.length ? `${ch.name}: ${errs.join(" · ")}` : "";
    renderTabs();
  });

  /* ---------- 왼쪽: 전환 기준표 ---------- */
  const CELL = { both: "셈", extra: "뺌", missing: "없음", none: "–" };
  function renderStd() {
    const t = L.standardTable(st.std);
    $("std").innerHTML = `<thead><tr><th scope="col"><span style="font-size:11.5px;color:var(--mute)">리포트 기준 →</span></th>${L.EVENTS.map((e) =>
      `<th scope="col"><label title="${esc(e.hint)}"><input type="checkbox" data-ev="${e.id}" ${st.std.includes(e.id) ? "checked" : ""}>${esc(e.label)}</label></th>`).join("")}</tr></thead>
      <tbody>${t.map((r) => `<tr><th scope="row">${esc(L.CHANNELS.find((c) => c.id === r.id).short)}</th>${r.cells.map((c) =>
        `<td class="${c.state}" aria-label="${esc(L.label(c.event))}: ${c.state === "both" ? "기준대로 셈" : c.state === "extra" ? "채널만 셈, 합산에서 뺌" : c.state === "missing" ? "자료 없음" : "해당 없음"}">${CELL[c.state]}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }
  $("std").addEventListener("change", (e) => {
    const ev = e.target.dataset.ev;
    if (!ev) return;
    const before = st.std.slice();
    const next = e.target.checked ? [...st.std, ev] : st.std.filter((x) => x !== ev);
    if (!next.length) { e.target.checked = true; toast("기준은 하나 이상 있어야 해요"); return; }
    st.std = L.EVENTS.map((x) => x.id).filter((id) => next.includes(id));
    save(); renderStd(); renderRaw(); numbersChanged();
    toast(`리포트 기준: ${st.std.map(L.label).join(" + ")}`, () => { st.std = before; save(); renderStd(); renderRaw(); numbersChanged(); });
  });

  /* ---------- 오른쪽: 리포트 ---------- */
  function compute() { rep = L.buildReport(st.cur, S.prev, st.std, S); }
  function renderReport() {
    const t = rep.total, d = rep.delta;
    $("repSub").textContent = `${rep.week} · 지난주 ${rep.prevWeek}과 비교 · 기준: ${rep.std.map(L.label).join(" + ")}`;
    $("kpis").innerHTML = [
      ["광고비", L.comma(t.cost / 10000), "만 원", delta(d.cost, "%", true)],
      ["기준 전환", fmtNum(t.conv), "건", delta(d.conv, "%")],
      ["전환당 비용(CPA)", fmtNum(t.cpa), "원", delta(d.cpa, "%", true)],
      ["광고비 대비 매출(ROAS)", L.pct1(t.roas), "%", delta(d.roas, "%p")],
    ].map(([k, v, u, dd]) => `<div class="kpi"><span>${k}</span><b>${v}<small>${u}</small></b>${dd}</div>`).join("");

    const g = $("gap");
    g.className = `gap${t.gap > 0 ? "" : " same"}`;
    g.innerHTML = t.gap > 0
      ? `<div class="nums"><s aria-label="채널 보고 합계">${fmtNum(t.reported)}</s><span aria-hidden="true">→</span><b>${fmtNum(t.conv)}건</b></div>
         <p>채널 보고서의 ‘전환’을 그대로 더하면 <b>${fmtNum(t.reported)}건</b>. 채널마다 세는 기준이 달라 <b>${fmtNum(t.gap)}건</b>을 기준표대로 뺐습니다.</p>`
      : `<div class="nums"><b>${fmtNum(t.conv)}건</b></div><p>모든 채널을 같은 기준으로 셌습니다. 보고 합계와 기준 합계가 같습니다.</p>`;

    const maxCost = Math.max(...rep.rows.map((r) => r.cost || 0), 1);
    const tag = (r) => (rep.bestCpa && r.id === rep.bestCpa.id ? `<span class="tag best">최저</span>` : rep.worstCpa && r.id === rep.worstCpa.id ? `<span class="tag worst">최고</span>` : "");
    $("chTable").innerHTML = `<thead><tr><th scope="col">채널</th><th scope="col">광고비</th><th scope="col" class="c-click">클릭</th><th scope="col">채널 보고</th><th scope="col">기준 전환</th><th scope="col">CPA</th><th scope="col">ROAS</th></tr></thead>
      <tbody>${rep.rows.map((r) => `<tr>
        <td>${esc(r.name)}</td>
        <td><span class="bar-in c-roas-bar" style="width:${Math.round((r.cost / maxCost) * 40)}px"></span>${fmtNum(r.cost)}</td>
        <td class="c-click">${fmtNum(r.click)}</td>
        <td class="rep${r.reported === r.conv ? " same" : ""}">${fmtNum(r.reported)}</td>
        <td class="conv"><b>${fmtNum(r.conv)}</b></td>
        <td>${fmtNum(r.cpa)}${tag(r)}</td>
        <td>${L.pct1(r.roas)}%</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>합계</td><td>${fmtNum(t.cost)}</td><td class="c-click">${fmtNum(t.click)}</td><td class="rep${t.gap ? "" : " same"}">${fmtNum(t.reported)}</td><td class="conv"><b>${fmtNum(t.conv)}</b></td><td>${fmtNum(t.cpa)}</td><td>${L.pct1(t.roas)}%</td></tr></tfoot>`;

    const w = [...rep.errors.map((x) => `${x.channel}: ${x.msg}`), ...rep.warnings];
    $("warn").hidden = !w.length;
    $("warn").innerHTML = w.map((x) => `<li>${esc(x)}</li>`).join("");
    $("publish").disabled = rep.errors.length > 0;
    $("publish").title = rep.errors.length ? "원본 숫자 오류를 먼저 고쳐 주세요" : "";
  }
  function renderSummary() {
    const m = $("mode");
    if (waiting) m.outerHTML = `<span id="mode" class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    else if (ai.mode === "ai") m.outerHTML = `<span id="mode" class="mode" data-mode="ai">Claude로 정리 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    else m.outerHTML = `<span id="mode" class="mode" data-mode="rule" title="정해진 문장 틀에 숫자를 넣어 썼어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
    $("sum").classList.toggle("waiting", waiting);
    $("sum").innerHTML = summary.lines.map((l) => `<li>${esc(l)}</li>`).join("");
    $("action").textContent = summary.action;
  }

  /** 숫자·기준이 바뀌면: 리포트를 다시 계산하고, 요약은 규칙으로 다시 쓴다 (Claude 요약은 낡은 숫자) */
  function numbersChanged() {
    runToken++; waiting = false;
    compute();
    summary = L.ruleSummary(rep);
    ai = { mode: "rule", reason: "숫자 바뀜 · ‘요약 다시 쓰기’로 Claude에 맡기기" };
    renderReport(); renderSummary();
  }

  async function writeSummary() {
    const my = ++runToken;
    compute();
    summary = L.ruleSummary(rep);
    ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderReport(); renderSummary();
    if (rep.errors.length) { waiting = false; ai.reason = "원본 숫자 오류"; renderSummary(); return; }
    const r = await AI.ask("adweekly.summary", L.aiInput(rep));
    if (my !== runToken) return; // 그 사이 숫자가 바뀌었으면 버린다
    waiting = false;
    const n = r && L.normalizeSummary(r.data, rep);
    if (n) { summary = n; ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답에 데이터 밖 숫자 · 형식 오류" : (AI.status().reason || "") };
    renderSummary();
  }
  $("rewrite").addEventListener("click", writeSummary);

  /* ---------- 내보내기 ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 아래로 */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  $("copy").addEventListener("click", async () => {
    const text = L.toMailText(rep, summary);
    const ok = await copyText(text);
    $("mdOut").textContent = text; $("mdBox").hidden = false;
    toast(ok ? "메일 본문을 복사했어요" : "복사가 막혀 있어요. 아래 본문을 직접 복사해 주세요");
  });
  $("csv").addEventListener("click", () => {
    const blob = new Blob([L.toCsv(rep)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `ad-weekly-${THIS_WEEK}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("채널별 표를 CSV로 내려받았어요");
  });

  /* ---------- 발행 ---------- */
  function renderLog() {
    const n = L.streak(st.log);
    $("streak").innerHTML = `<b>${n}주 연속</b> 발행 · 목표 8주 연속 자동 발행`;
    const dates = new Set(st.log.map((x) => x.date));
    const mondays = []; for (let i = 7; i >= 0; i--) { const d = new Date(Date.parse(THIS_MONDAY) - i * 7 * 86400000); mondays.push(d.toISOString().slice(0, 10)); }
    $("weeks").innerHTML = mondays.map((d, i) => `<li class="${dates.has(d) ? "on" : ""}${justPublished && i === 7 ? " new" : ""}"><i aria-hidden="true"></i>${Number(d.slice(5, 7))}/${Number(d.slice(8))}<span class="sr">${dates.has(d) ? " 발행" : " 안 함"}</span></li>`).join("");
    $("log").innerHTML = st.log.slice(0, 4).map((x) => `<li><b>${esc(x.week)}</b><span>${esc(x.date)} ${esc(x.at)} · ${esc(x.by)} 발행</span></li>`).join("");
    const done = st.log.some((x) => x.date === THIS_MONDAY);
    $("publish").textContent = done ? "이번 주 발행됨" : "이번 주 발행";
    justPublished = false;
  }
  $("publish").addEventListener("click", () => {
    if (rep.errors.length) { toast("원본 숫자 오류를 먼저 고쳐 주세요"); return; }
    const before = clone(st.log);
    const now = new Date();
    const r = L.publish(st.log, { date: THIS_MONDAY, week: THIS_WEEK, at: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, by: "수동" });
    if (!r.added) { toast("이번 주 리포트는 이미 발행했어요 (같은 주는 한 번만)"); return; }
    st.log = r.log; justPublished = true; save(); renderLog();
    toast(`발행했어요 · ${L.streak(st.log)}주 연속`, () => { st.log = before; save(); renderLog(); });
  });

  $("reset").addEventListener("click", () => {
    const before = clone(st);
    st = seed(); save();
    renderTabs(); renderRaw(); renderStd(); renderLog(); writeSummary();
    toast("샘플 데이터로 되돌렸어요", () => { st = before; save(); renderTabs(); renderRaw(); renderStd(); renderLog(); numbersChanged(); });
  });

  /* ---------- 시작 ---------- */
  compute();
  summary = L.ruleSummary(rep);
  renderTabs(); renderRaw(); renderStd(); renderReport(); renderSummary(); renderLog();
  AI.probe().then(() => writeSummary());
})();
