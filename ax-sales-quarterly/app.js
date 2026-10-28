/* 분기판 — 화면 (DOM 다루기만 한다. 분기 계산·점검·검산은 logic.js, AI 호출은 ai-client.js)
 *
 * 팀·분기를 고르면
 *   1) 거래 목록을 양식 점검하고(문제 행은 빨갛게, 계산에서 뺌)
 *   2) 같은 양식의 리포트(숫자 6칸 · 요약 · 담당별 · 큰 수주)를 바로 그린다. 요약은 규칙 문장.
 *   3) Claude 에게 계산한 숫자만 보내 요약을 다시 쓰게 한다. 문장 속 숫자가 계산과 다르면 버린다.
 * 거래를 고치면 리포트가 즉시 다시 계산되고, Claude 요약은 숫자가 바뀌었으니 규칙 요약으로 돌아간다.
 */
(function () {
  "use strict";
  const L = window.Bungipan;
  const STORE_KEY = "ax-sales-quarterly-v1";
  const CUSTOMERS = ["가람식품", "하늘물류", "청솔제지", "바른교육", "도담건설", "누리팜", "한빛전자부품", "새솔유통", "마루정밀"];
  const TEAMS = [
    { id: "t1", name: "영업1팀", seed: 11, owners: ["강민서", "오준혁", "윤하늘", "서다인"], target: 300000000 },
    { id: "t2", name: "영업2팀", seed: 23, owners: ["문가온", "신우진", "장미래"], target: 550000000 },
    { id: "t3", name: "영업3팀", seed: 37, owners: ["홍채린", "백승호", "류지안", "임도윤"], target: 480000000 },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const lastQ = () => L.shiftQuarter(L.quarterOf(today()), -1);

  /* ---------- 상태 ---------- */
  function seed() {
    const K = lastQ();
    const teams = {};
    TEAMS.forEach((t) => {
      const rows = L.sampleDeals(t.seed, t.owners, CUSTOMERS, K);
      teams[t.id] = { rows, target: t.target };
    });
    // 1팀에는 금액을 안 적은 행이 하나 있다 (양식 점검이 잡는 모습)
    const mid = L.quarterRange(K).start.slice(0, 8) + "20";
    const d = L.d0(mid); d.setMonth(d.getMonth() + 1);
    teams.t1.rows.push({ id: "t1-blank", q: K, owner: "윤하늘", customer: "바른교육", stage: "수주", amount: null, date: L.iso(d) });
    return { team: "t1", quarter: K, teams };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.teams && TEAMS.every((t) => v.teams[t.id] && Array.isArray(v.teams[t.id].rows)) && /^\d{4}-Q[1-4]$/.test(v.quarter)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let ai = { mode: "rule", reason: "" }, aiLines = null, waiting = false, runToken = 0;

  const team = () => TEAMS.find((t) => t.id === st.team);
  const data = () => st.teams[st.team];
  function reportOf(teamId, key) {
    const d = st.teams[teamId];
    const v = L.validate(L.rowsOf(d.rows, key), key);
    const pk = L.shiftQuarter(key, -1);
    const prev = L.validate(L.rowsOf(d.rows, pk), pk).ok;
    return { v, r: L.compute(v.ok, prev, d.target) };
  }

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
    return `<span class="mode" data-mode="rule" title="정해진 양식 문장에 계산한 숫자를 넣었어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }

  /* ---------- 위: 팀 · 분기 · 목표 ---------- */
  function renderControls() {
    // 버튼은 한 번만 만들고 글자만 바꾼다 (목표 칸을 고친 뒤 바로 팀을 눌러도 클릭이 사라지지 않게)
    if (!$("teams").children.length) $("teams").innerHTML = TEAMS.map((t) => `<button type="button" data-team="${t.id}"><b>${t.name}</b><small></small></button>`).join("");
    TEAMS.forEach((t) => {
      const b = $("teams").querySelector(`[data-team="${t.id}"]`);
      b.setAttribute("aria-pressed", String(t.id === st.team));
      b.lastElementChild.textContent = `달성 ${reportOf(t.id, st.quarter).r.achieve}% · ${t.owners.length}명`;
    });
    const opts = [lastQ(), L.shiftQuarter(lastQ(), -1)];
    $("quarter").innerHTML = opts.map((k) => `<option value="${k}"${k === st.quarter ? " selected" : ""}>${L.qLabel(k)}</option>`).join("");
    $("target").value = L.fmtWon(data().target);
    $("target").removeAttribute("aria-invalid");
  }

  /* ---------- 리포트 ---------- */
  function renderReport() {
    const t = team(), K = st.quarter;
    const { v, r } = reportOf(t.id, K);
    $("repKicker").textContent = `영업본부 · 분기 영업 리포트 (공통 양식 v1)`;
    $("repTitle").textContent = `${t.name} ${L.qLabel(K)}`;
    const qo = r.prevWon ? `<small class="${r.qoq >= 0 ? "up" : "down"}">${r.qoq >= 0 ? "▲" : "▼"} ${Math.abs(r.qoq)}%</small>` : `<small>비교 없음</small>`;
    $("kpis").innerHTML = [
      ["수주액", esc(L.fmtWon(r.won)), qo + `<small> 지난 분기 대비</small>`],
      ["목표 대비", `${r.achieve}%`, `<div class="bar-g" aria-hidden="true"><i style="width:${Math.min(100, r.achieve)}%"></i></div><small>목표 ${esc(L.fmtWon(r.target))}</small>`],
      ["승률", `${r.winRate}%`, `<small>수주 ${r.wonCount} · 실주 ${r.lostCount}</small>`],
      ["평균 수주 금액", esc(L.fmtWon(r.avgDeal)), `<small>수주 ${r.wonCount}건 기준</small>`],
      ["진행 중", esc(L.fmtWon(r.pipeline)), `<small>${r.pipelineCount}건 · 다음 분기 후보</small>`],
      ["지난 분기 수주액", esc(L.fmtWon(r.prevWon)), `<small>${L.qLabel(L.shiftQuarter(K, -1))}</small>`],
    ].map(([k, b, s]) => `<div class="kpi"><span>${k}</span><b>${b}</b>${s}</div>`).join("");
    const lines = aiLines || L.ruleSummary(r, t.name, K);
    $("sumLines").innerHTML = lines.map((l) => `<li>${esc(l)}</li>`).join("");
    $("modeChip").innerHTML = modeChip();
    document.querySelector(".sum").classList.toggle("waiting", waiting);
    const chk = L.checkNumbers(lines, r, K, [t.name]);
    const n = lines.reduce((a, l) => a + L.numbersIn(l.split(t.name).join(" ")).length, 0);
    $("numCheck").className = `check ${chk.ok ? "ok" : "bad"}`;
    $("numCheck").textContent = chk.ok ? `숫자 검산 통과 · ${n}개 숫자가 계산과 같아요` : `계산과 다른 숫자: ${chk.bad.join(", ")}`;
    $("rewrite").disabled = waiting;
    $("owners").innerHTML = `<thead><tr><th>담당</th><th class="r">수주액</th><th class="r">건수</th><th class="r">승률</th></tr></thead><tbody>${r.byOwner.map((o) => `<tr><td>${esc(o.owner)}</td><td class="r">${esc(L.fmtWon(o.won))}</td><td class="r">${o.count}</td><td class="r">${o.winRate}%</td></tr>`).join("") || `<tr><td colspan="4">거래 없음</td></tr>`}</tbody>`;
    $("top").innerHTML = r.top.map((x) => `<li><b>${esc(x.customer)}</b> ${esc(L.fmtWon(x.amount))} <span>· ${esc(x.owner)} · ${esc(x.date.slice(5).replace("-", "/"))}</span></li>`).join("") || "<li>수주 없음</li>";
    $("repFoot").textContent = `거래 ${v.ok.length}건으로 계산${v.issues.length ? ` · 양식 점검에 걸린 ${v.issues.length}건은 뺐어요` : ""} · 만든 날 ${today()} · 영업본부 3개 팀 공통 양식`;
    return { v, r, lines };
  }

  /* ---------- 거래 목록 ---------- */
  function renderDeals(flashId) {
    const K = st.quarter, rows = L.rowsOf(data().rows, K);
    const { issues } = L.validate(rows, K);
    const bad = new Map(issues.map((i) => [i.id, i.msg]));
    $("issues").className = `issues ${issues.length ? "bad" : "ok"}`;
    $("issues").innerHTML = issues.length
      ? `<b>양식 점검 ${issues.length}건 — 리포트에서 빠졌어요</b><ul>${issues.map((i) => { const r = rows.find((x) => x.id === i.id); return `<li>${esc(r.customer || "(고객사 없음)")}: ${esc(i.msg)}<button type="button" data-goto="${esc(i.id)}">고치기</button></li>`; }).join("")}</ul>`
      : `양식 점검 통과 · ${rows.length}건 모두 리포트에 들어가요`;
    const owners = team().owners;
    const sorted = rows.slice().sort((a, b) => (bad.has(b.id) - bad.has(a.id)) || String(a.date).localeCompare(String(b.date)));
    $("dealBody").innerHTML = sorted.map((r) => `<tr data-id="${esc(r.id)}" class="${bad.has(r.id) ? "bad" : ""}${r.id === flashId ? " flash" : ""}" ${bad.has(r.id) ? `title="${esc(bad.get(r.id))}"` : ""}>
      <td><select data-k="owner" aria-label="담당"><option value=""${r.owner ? "" : " selected"}>—</option>${owners.map((o) => `<option${o === r.owner ? " selected" : ""}>${o}</option>`).join("")}</select></td>
      <td><input data-k="customer" aria-label="고객사" value="${esc(r.customer)}" list="custs"></td>
      <td><select data-k="stage" aria-label="단계"><option value=""${r.stage ? "" : " selected"}>—</option>${L.STAGES.map((s) => `<option${s === r.stage ? " selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><input class="amt" data-k="amount" aria-label="금액" value="${r.amount ? esc(L.fmtWon(r.amount).replace(" 원", "")) : ""}" placeholder="금액"></td>
      <td><input type="date" data-k="date" aria-label="날짜" value="${esc(r.date || "")}"></td>
      <td><button type="button" class="del" data-del="${esc(r.id)}" aria-label="${esc(r.customer || "빈")} 행 지우기">×</button></td>
    </tr>`).join("") + `<datalist id="custs">${CUSTOMERS.map((c) => `<option value="${c}">`).join("")}</datalist>`;
  }
  /** 숫자가 바뀌면 Claude 요약은 낡은 것 → 규칙 요약으로 돌아간다 */
  function changed(msg, flashId) {
    if (aiLines) { aiLines = null; ai = { mode: "rule", reason: "숫자가 바뀌어 다시 계산" }; }
    runToken++; waiting = false;
    save(); renderControls(); renderReport(); renderDeals(flashId);
    if (msg) toast(msg);
  }
  $("dealBody").addEventListener("change", (e) => {
    const el = e.target.closest("[data-k]");
    if (!el) return;
    const id = el.closest("tr").dataset.id, row = data().rows.find((r) => r.id === id), k = el.dataset.k;
    if (k === "amount") {
      const v = el.value.trim() ? L.parseWon(el.value) : null;
      if (el.value.trim() && v === null) { toast("금액은 3,200만 · 1.2억 · 32000000처럼 써 주세요"); el.focus(); return; }
      row.amount = v;
    } else row[k] = el.value.trim();
    changed("", id);
    document.querySelector(`#dealBody tr[data-id="${CSS.escape(id)}"] [data-k="${k}"]`)?.focus();
  });
  $("dealBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const d = data(), before = d.rows.slice();
    d.rows = d.rows.filter((r) => r.id !== b.dataset.del);
    changed();
    toast("거래 한 줄을 지웠어요", () => { d.rows = before; changed(); });
  });
  $("issues").addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (!b) return;
    const tr = document.querySelector(`#dealBody tr[data-id="${CSS.escape(b.dataset.goto)}"]`);
    tr?.scrollIntoView({ block: "center", behavior: "smooth" });
    const firstEmpty = tr && [...tr.querySelectorAll("[data-k]")].find((x) => !x.value);
    (firstEmpty || tr?.querySelector("[data-k]"))?.focus();
  });
  $("addRow").addEventListener("click", () => {
    const id = `n${Date.now().toString(36)}`;
    data().rows.push({ id, q: st.quarter, owner: "", customer: "", stage: "수주", amount: null, date: "" });
    changed("빈 행을 넣었어요. 칸을 채우면 리포트에 들어가요", id);
    document.querySelector(`#dealBody tr[data-id="${id}"] [data-k="owner"]`)?.focus();
  });

  /* ---------- 요약: Claude ---------- */
  async function rewrite() {
    const my = ++runToken;
    const t = team(), K = st.quarter, { r } = reportOf(t.id, K);
    aiLines = null; ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderReport();
    // 계산한 숫자만 보낸다 (거래처 이름·행 데이터는 보내지 않는다)
    const input = {
      team: t.name, quarter: L.qLabel(K), prevQuarter: L.qLabel(L.shiftQuarter(K, -1)),
      won: L.fmtWon(r.won), target: L.fmtWon(r.target), achievePct: r.achieve, prevWon: r.prevWon ? L.fmtWon(r.prevWon) : "기록 없음", qoqPct: r.qoq,
      wonCount: r.wonCount, lostCount: r.lostCount, winRatePct: r.winRate, avgDeal: L.fmtWon(r.avgDeal),
      pipeline: L.fmtWon(r.pipeline), pipelineCount: r.pipelineCount,
      byOwner: r.byOwner.map((o) => ({ owner: o.owner, won: L.fmtWon(o.won), count: o.count, winRatePct: o.winRate })),
    };
    const res = await AI.ask("salesq.summary", input);
    if (my !== runToken) return;
    waiting = false;
    const n = res && L.normalizeSummary(res.data);
    const chk = n && L.checkNumbers(n.lines, r, K, [t.name]);
    if (n && chk.ok) { aiLines = n.lines; ai = { mode: "ai", ms: res.ms }; }
    else ai = { mode: "rule", reason: n ? `계산과 다른 숫자(${chk.bad.slice(0, 2).join(", ")})` : res ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderReport();
  }
  $("rewrite").addEventListener("click", rewrite);

  /* ---------- 위쪽 조작 ---------- */
  $("teams").addEventListener("click", (e) => {
    const b = e.target.closest("[data-team]");
    if (!b || b.dataset.team === st.team) return;
    st.team = b.dataset.team; aiLines = null; save();
    renderControls(); renderDeals(); rewrite();
    $("teams").querySelector(`[data-team="${st.team}"]`)?.focus();
  });
  $("quarter").addEventListener("change", (e) => { st.quarter = e.target.value; aiLines = null; save(); renderControls(); renderDeals(); rewrite(); });
  $("target").addEventListener("change", (e) => {
    const v = L.parseWon(e.target.value);
    if (!v) { e.target.setAttribute("aria-invalid", "true"); toast("목표는 3억 · 2억 6천만처럼 써 주세요"); return; }
    data().target = v;
    changed(`${team().name} 목표를 ${L.fmtWon(v)}으로 바꿨어요`);
  });

  /* ---------- 공유 ---------- */
  $("copyMd").addEventListener("click", async () => {
    const t = team(), { r } = reportOf(t.id, st.quarter);
    const md = L.toMarkdown(r, t.name, st.quarter, aiLines || L.ruleSummary(r, t.name, st.quarter));
    try { await navigator.clipboard.writeText(md); }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = md; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e2) { /* 복사 못 해도 계속 */ }
      ta.remove();
    }
    toast("리포트를 마크다운으로 복사했어요. 메신저·위키에 붙여 넣으세요");
  });
  function printAs(cls) {
    document.body.classList.add(cls);
    const off = () => { document.body.classList.remove(cls); window.removeEventListener("afterprint", off); };
    window.addEventListener("afterprint", off);
    window.print();
    setTimeout(off, 1000);
  }
  $("printRep").addEventListener("click", () => printAs("print-report"));
  $("printGuide").addEventListener("click", () => printAs("print-guide"));

  /* ---------- 1장 가이드 (화면을 줄여 그린 캡처) ---------- */
  const R = "#C23B52", G = "#E6E0E0", P = "#fff";
  const STEPS = [
    ["팀과 분기를 고른다", "위 버튼에서 우리 팀, 오른쪽에서 분기를 고르고 목표 금액을 확인해요.",
      `<rect x="10" y="12" width="56" height="22" rx="6" fill="#FBE9EC" stroke="${R}" stroke-width="2"/><rect x="72" y="12" width="56" height="22" rx="6" fill="${P}" stroke="${G}"/><rect x="134" y="12" width="56" height="22" rx="6" fill="${P}" stroke="${G}"/><rect x="200" y="14" width="44" height="18" rx="4" fill="${P}" stroke="${G}"/><circle cx="38" cy="23" r="15" fill="none" stroke="${R}" stroke-width="2" stroke-dasharray="4 3"/><rect x="10" y="48" width="140" height="80" rx="8" fill="${P}" stroke="${G}"/><rect x="160" y="48" width="84" height="80" rx="8" fill="${P}" stroke="${G}"/>`],
    ["빨간 줄을 고친다", "거래 목록 위 ‘양식 점검’에 걸린 줄을 ‘고치기’로 찾아 빈칸을 채워요.",
      `<rect x="10" y="12" width="234" height="20" rx="5" fill="#FDE8E6"/><rect x="18" y="19" width="120" height="6" rx="3" fill="#C2362E"/><rect x="200" y="17" width="36" height="10" rx="3" fill="${P}"/>${[0, 1, 2, 3].map((i) => `<rect x="10" y="${42 + i * 22}" width="234" height="18" rx="3" fill="${i === 1 ? "#FDE8E6" : P}" stroke="${G}"/>`).join("")}<rect x="170" y="67" width="60" height="12" rx="3" fill="${P}" stroke="${R}" stroke-width="2"/>`],
    ["요약의 초록 표시를 확인한다", "‘숫자 검산 통과’가 보이면 요약 문장 속 숫자가 계산과 같다는 뜻이에요.",
      `<rect x="10" y="12" width="234" height="44" rx="8" fill="${P}" stroke="${G}"/>${[0, 1, 2].map((i) => `<rect x="22" y="${20 + i * 11}" width="${170 - i * 30}" height="6" rx="3" fill="#D8CFD1"/>`).join("")}<rect x="10" y="66" width="234" height="62" rx="8" fill="#FBF8F7"/>${[0, 1, 2, 3].map((i) => `<rect x="22" y="${76 + i * 9}" width="${190 - i * 20}" height="5" rx="2" fill="#B9AEB0"/>`).join("")}<rect x="22" y="114" width="96" height="10" rx="3" fill="#E0F4EA" stroke="#138A5B" stroke-width="2"/>`],
    ["복사하거나 인쇄해 공유한다", "‘마크다운 복사’로 메신저·위키에, ‘리포트 인쇄’로 PDF 한 장을 만들어요.",
      `<rect x="40" y="10" width="120" height="118" rx="6" fill="${P}" stroke="${G}"/><rect x="40" y="10" width="120" height="6" rx="3" fill="${R}"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="52" y="${28 + i * 16}" width="${92 - (i % 2) * 24}" height="7" rx="3" fill="#D8CFD1"/>`).join("")}<rect x="172" y="40" width="70" height="20" rx="6" fill="${P}" stroke="${R}" stroke-width="2"/><rect x="172" y="68" width="70" height="20" rx="6" fill="#221A1C"/>`],
  ];
  $("steps").innerHTML = STEPS.map(([b, p, svg]) => `<li><svg viewBox="0 0 254 140" role="img" aria-label="${esc(b)} 화면 예시">${svg}</svg><b>${esc(b)}</b><p>${esc(p)}</p></li>`).join("");

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save();
    aiLines = null;
    renderControls(); renderDeals(); rewrite();
    toast("샘플 거래와 목표로 되돌렸어요", () => { st = before; save(); aiLines = null; renderControls(); renderDeals(); rewrite(); });
  });

  /* ---------- 시작 ---------- */
  renderControls(); renderReport(); renderDeals();
  AI.probe().then(() => rewrite());
})();
