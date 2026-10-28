/* 팀한장 — 화면 (DOM 다루기만 한다. 요금 계산·검사·제안 규칙은 logic.js, AI 호출은 ai-client.js)
 *
 * 요금 구간을 고치면 구간 검사(절벽·개인 구독보다 비싼 구간)와 곡선, 회사별 견적이 함께 바뀐다.
 * '초안 만들기'를 누르면
 *   1) 계산된 숫자로 규칙 제안 메일을 바로 채우고
 *   2) Claude 에게 계산이 끝난 숫자와 인터뷰 메모만 보낸다. 금액이 계산값과 다르면 버리고,
 *      계약 조건 문장은 빼서 사람이 확인하도록 남긴다.
 */
(function () {
  "use strict";
  const L = window.TeamHanjang;
  const STORE_KEY = "startup-news-b2b-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = L.won;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------- 상태 ---------- */
  const seed = () => ({ tiers: clone(L.TIERS), mode: "graduated", annual: false, companies: clone(L.COMPANIES), sel: "c4", drafts: {} });
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.tiers && Array.isArray(v.tiers.steps) && Array.isArray(v.companies) && v.companies.length) return { ...seed(), ...v };
    } catch (e) { /* 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;

  const co = () => st.companies.find((c) => c.id === st.sel) || st.companies[0];
  const q = (c) => L.quote(c, st.tiers, st.mode, st.annual);

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

  /* ---------- 요금 구간 ---------- */
  function renderTiers() {
    document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === st.mode)));
    $("modeHelp").textContent = st.mode === "graduated"
      ? "누적: 1~5명은 기본료, 6명부터는 구간마다 인당 요금을 더해요. 사람이 늘면 금액도 늘어나요."
      : "전체 적용: 인원이 속한 구간 요금을 전원에게 매겨요. 구간 경계에서 한 명 늘었는데 더 싸지는 곳이 생겨요.";
    const t = st.tiers;
    let from = t.baseSeats;
    $("tiers").innerHTML = `<thead><tr><th>인원</th><th>요금</th><th class="c-n">예: 구간 끝</th></tr></thead><tbody>
      <tr><td>1~${t.baseSeats}명</td><td><label class="sr" for="t-base">기본료</label><span class="money"><input id="t-base" data-k="base" inputmode="numeric" value="${t.base}">원 / 월 묶음</span></td><td class="c-n">${won(L.price(t.baseSeats, t, st.mode))}</td></tr>` +
      t.steps.map((s, i) => {
        const last = i === t.steps.length - 1;
        const row = `<tr><td>${from + 1}~${last ? `${s.upTo}` : `<label class="sr" for="t-up${i}">구간 끝 인원</label><input class="up" id="t-up${i}" data-k="up" data-i="${i}" inputmode="numeric" value="${s.upTo}">`}명</td>
          <td><label class="sr" for="t-per${i}">${from + 1}명부터 인당 요금</label><span class="money"><input id="t-per${i}" data-k="per" data-i="${i}" inputmode="numeric" value="${s.per}">원 / 인</span></td>
          <td class="c-n">${won(L.price(s.upTo, t, st.mode))}</td></tr>`;
        from = s.upTo;
        return row;
      }).join("") + `<tr class="over"><td colspan="3">${L.QUOTE_OVER}명 넘으면 따로 견적 · 개인 구독은 월 ${won(L.PERSONAL)}</td></tr></tbody>`;
  }
  function renderCheck() {
    const p = L.checkTiers(st.tiers, st.mode);
    $("tcheck").className = `tcheck ${p.length ? "no" : "ok"}`;
    $("tcheck").innerHTML = p.length ? `<b>구간 점검 ${p.length}건</b><ul>${p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<b>구간 점검 통과</b> 인원이 늘면 금액도 늘고, 모든 구간이 개인 구독보다 싸요.`;
  }
  function renderChart() {
    const W = 520, H = 220, pl = 52, pr = 12, pt = 12, pb = 26, N = L.QUOTE_OVER;
    const t = st.tiers;
    const ymax = Math.max(L.PERSONAL * 70, L.price(N, t, st.mode)) * 1.05;
    const x = (n) => pl + ((n - 1) / (N - 1)) * (W - pl - pr);
    const y = (v) => pt + (1 - Math.min(v, ymax) / ymax) * (H - pt - pb);
    const seq = Array.from({ length: N }, (_, i) => i + 1);
    const line = (f) => seq.filter((n) => f(n) <= ymax).map((n) => `${x(n).toFixed(1)},${y(f(n)).toFixed(1)}`).join(" ");
    const cliffs = L.findCliffs(t, st.mode);
    const ticks = [0, 100000, 200000, 300000, 400000].filter((v) => v < ymax);
    const dots = st.companies.map((c) => {
      const n = Math.min(c.seats, N);
      return `<circle cx="${x(n)}" cy="${y(L.price(n, t, st.mode))}" r="${c.id === st.sel ? 6 : 4.5}" class="co${c.id === st.sel ? " sel" : ""}"><title>${esc(c.name)} ${c.seats}명</title></circle>`;
    }).join("");
    $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}">
      ${ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 6}" y="${y(v) + 4}" class="ax l">${v / 10000}만</text>`).join("")}
      ${[1, 20, 50, 100].map((n) => `<text x="${x(n)}" y="${H - 8}" class="ax">${n}명</text>`).join("")}
      <polyline points="${line((n) => n * L.PERSONAL)}" class="ln-p"/>
      <polyline points="${line(() => L.UNLIMITED)}" class="ln-u"/>
      <polyline points="${line((n) => L.price(n, t, st.mode))}" class="ln-t"/>
      ${cliffs.map((n) => `<circle cx="${x(n)}" cy="${y(L.price(n, t, st.mode))}" r="7" class="cliff"/>`).join("")}
      ${dots}</svg>`;
    $("chart").setAttribute("aria-label", `100명까지 월 요금 곡선. 100명 ${won(L.price(N, t, st.mode))}${cliffs.length ? `, ${cliffs.join("·")}명에서 요금이 내려감` : ""}`);
  }

  /* ---------- 회사 ---------- */
  function renderCos() {
    $("cos").innerHTML = st.companies.map((c) => {
      const x = q(c);
      return `<li class="co-i${c.id === st.sel ? " sel" : ""}" data-id="${c.id}">
        <div class="co-h"><button type="button" class="co-name" data-pick aria-pressed="${c.id === st.sel}">${esc(c.name)}</button><span class="kind">${esc(c.kind)}</span>
          <label class="sr" for="s-${c.id}">${esc(c.name)} 단계</label><select id="s-${c.id}" data-k="status" class="st st-${esc(c.status)}">${L.STATUSES.map((s) => `<option${s === c.status ? " selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="co-b">
          <label class="seats"><span>인원</span><input type="number" min="1" max="500" data-k="seats" value="${c.seats}" aria-label="${esc(c.name)} 인원">명</label>
          <div class="pr"><b>${x.overQuote ? "따로 견적" : `월 ${won(x.monthly)}`}</b><span>인당 ${won(x.perSeat)}</span></div>
          <div class="cmp"><span>개인 구독보다 <b>${won(x.saving)}</b> 저렴</span><span class="${x.unlimitedGap > 0 ? "gap" : ""}">무제한 대비 ${x.unlimitedGap >= 0 ? "+" : "−"}${won(Math.abs(x.unlimitedGap))}</span></div>
        </div></li>`;
    }).join("");
    const mrr = L.contractMrr(st.companies, st.tiers, st.mode);
    const n = st.companies.filter((c) => c.status === "계약").length;
    $("mrr").textContent = won(mrr);
    $("mrr").nextElementSibling.textContent = `계약 ${n}곳 월 매출`;
    $("vsUnl").textContent = `월 ${won(Math.max(0, mrr - n * L.UNLIMITED))} 덜 받음`;
  }

  /* ---------- 제안 메일 ---------- */
  function draftFor(c) {
    const d = st.drafts[c.id];
    // 아직 손대지 않은 규칙 초안은 견적이 바뀌면 다시 쓴다
    if (!d || (d.mode === "rule" && !d.edited)) st.drafts[c.id] = { ...L.ruleProposal(c, q(c), st.annual), mode: "rule", reason: d ? d.reason : "", removed: [] };
    return st.drafts[c.id];
  }
  function renderProp() {
    const c = co(), x = q(c), d = draftFor(c);
    $("quote").innerHTML = `<div class="q-h"><b>${esc(c.name)}</b><span>${esc(c.kind)} · ${esc(c.contact)}</span></div>
      <blockquote>“${esc(c.quote)}”</blockquote>
      <dl><dt>인원</dt><dd>${c.seats}명</dd><dt>월 요금</dt><dd><b>${won(x.monthly)}</b></dd><dt>인당</dt><dd>${won(x.perSeat)}</dd>
      <dt>${st.annual ? "연 결제" : "1년 합계"}</dt><dd>${won(x.yearly)}</dd><dt>개인 구독 합계</dt><dd>${won(x.personalTotal)}</dd><dt>계산 방식</dt><dd>${st.mode === "graduated" ? "누적" : "전체 적용"}</dd></dl>
      ${x.overQuote ? `<p class="warn">${L.QUOTE_OVER}명을 넘어 따로 견적이 필요해요.</p>` : ""}`;
    $("subj").value = d.subject;
    $("body").value = d.body + (d.questions && d.questions.length ? `\n\n확인 부탁드릴 점\n${d.questions.map((s) => `- ${s}`).join("\n")}` : "");
    let chip;
    if (waiting) chip = `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    else if (d.mode === "ai") chip = `<span class="mode" data-mode="ai">Claude로 작성 · ${(d.ms / 1000).toFixed(1)}초</span>`;
    else chip = `<span class="mode" data-mode="rule" title="계산된 숫자로 쓴 정해진 문장이에요">규칙 기반${d.reason ? ` · ${esc(d.reason)}` : " · 초안 만들기를 누르면 Claude가 다시 써요"}</span>`;
    // 초안을 만든 뒤 인원·요금이 바뀌었는지
    const allowed = new Set([x.monthly, x.perSeat, L.PERSONAL, x.yearly, c.seats]);
    const stale = L.moneyIn(d.subject + " " + d.body).some((n) => !allowed.has(n));
    $("modeChip").innerHTML = chip + (stale ? ` <span class="stale">견적이 바뀌었어요 · 초안을 다시 만드세요</span>` : "");
    $("removed").hidden = !d.removed.length;
    $("removed").innerHTML = d.removed.length ? `<b>사람 확인 필요</b> 계약 조건이 들어 있어 뺀 문장 ${d.removed.length}개: ${d.removed.map((s) => `“${esc(s)}”`).join(" ")}` : "";
    $("body").classList.toggle("waiting", waiting);
  }

  function renderAll() { renderTiers(); renderCheck(); renderChart(); renderCos(); renderProp(); $("annual").checked = st.annual; }
  function renderPrices() { renderCheck(); renderChart(); renderCos(); renderProp(); }

  /* ---------- 초안 만들기 ---------- */
  async function run() {
    const c = co(), x = q(c);
    const my = ++runToken;
    const prev = st.drafts[c.id];
    st.drafts[c.id] = { ...L.ruleProposal(c, x, st.annual), mode: "rule", reason: "", removed: [] };
    waiting = AI.status().enabled !== false;
    renderProp();
    const inp = L.aiInput(c, x, st.annual);
    const r = await AI.ask("newsb2b.proposal", inp);
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeProposal(r.data, inp);
    if (n) st.drafts[c.id] = { ...n, mode: "ai", ms: r.ms };
    else st.drafts[c.id].reason = r ? "금액이 계산과 다르거나 형식이 맞지 않음" : (AI.status().reason || "AI 꺼짐");
    save(); renderProp();
    toast(`${c.name} 제안 메일을 ${n ? "Claude가" : "규칙으로"} 썼어요`, prev ? () => { runToken++; st.drafts[c.id] = prev; save(); renderProp(); } : null);
  }

  /* ---------- 이벤트 ---------- */
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.mode; save(); renderAll(); }));
  $("tiers").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-k]"); if (!inp) return;
    const v = Number(String(inp.value).replace(/[^\d]/g, ""));
    if (!Number.isFinite(v) || v <= 0) { inp.setAttribute("aria-invalid", "true"); toast("0보다 큰 숫자를 넣어 주세요"); return; }
    const before = clone(st.tiers);
    if (inp.dataset.k === "base") st.tiers.base = v;
    else st.tiers.steps[Number(inp.dataset.i)][inp.dataset.k === "up" ? "upTo" : "per"] = v;
    save(); renderTiers(); renderPrices();
    document.getElementById(inp.id)?.focus();
    toast("요금 구간을 바꿨어요", () => { st.tiers = before; save(); renderAll(); });
  });
  $("cos").addEventListener("change", (e) => {
    const li = e.target.closest("li.co-i"); if (!li) return;
    const c = st.companies.find((x) => x.id === li.dataset.id);
    if (e.target.dataset.k === "seats") {
      const v = Math.floor(Number(e.target.value));
      if (!(v >= 1 && v <= 500)) { e.target.value = c.seats; toast("인원은 1~500명으로 넣어 주세요"); return; }
      c.seats = v;
    } else if (e.target.dataset.k === "status") c.status = e.target.value;
    save(); renderPrices();
    document.querySelector(`li.co-i[data-id="${c.id}"] [data-k="${e.target.dataset.k}"]`)?.focus();
  });
  $("cos").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pick]"); if (!b) return;
    st.sel = b.closest("li.co-i").dataset.id; save(); renderChart(); renderCos(); renderProp();
    document.querySelector(`li.co-i[data-id="${st.sel}"] button[data-pick]`)?.focus();
  });
  $("annual").addEventListener("change", (e) => { st.annual = e.target.checked; save(); renderPrices(); });
  // 사람이 고친 메일은 그대로 둔다
  $("subj").addEventListener("input", (e) => { const d = draftFor(co()); d.subject = e.target.value; d.edited = true; save(); });
  $("body").addEventListener("input", (e) => { const d = draftFor(co()); d.body = e.target.value; d.questions = []; d.edited = true; save(); });
  $("run").addEventListener("click", run);
  $("copy").addEventListener("click", async () => {
    const txt = `${$("subj").value}\n\n${$("body").value}`;
    try { await navigator.clipboard.writeText(txt); toast("메일을 복사했어요"); }
    catch (e) { $("body").select(); toast("본문을 선택해 두었어요. 직접 복사해 주세요"); }
  });
  $("print").addEventListener("click", () => window.print());
  $("csv").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + L.toCsv(st.companies, st.tiers, st.mode, st.annual)], { type: "text/csv;charset=utf-8" }));
    a.download = `팀한장-견적-${st.mode === "graduated" ? "누적" : "전체적용"}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${st.companies.length}곳 견적을 CSV로 내려받았어요`);
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    runToken++; waiting = false;
    st = seed(); save(); renderAll();
    toast("샘플 요금과 회사로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  renderAll();
  AI.probe().then(() => renderProp());
})();
