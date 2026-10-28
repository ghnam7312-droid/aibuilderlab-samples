/* 값매김 — 화면 (DOM 다루기만 한다. 계산·추천 규칙·검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 숫자를 고치면 바로 다시 계산한다: 1인당 남는 돈 → 손익분기 인원 → 사전 신청 테스트 → 규칙 추천.
 * '추천 다시 받기'(그리고 처음 열 때)만 Claude 에게 같은 숫자를 보내 추천 이유를 받는다.
 * Claude 답은 구성 id 와 숫자(입력에 있던 숫자만)를 검사하고, 그 뒤 숫자를 고치면 규칙 추천으로 돌아간다.
 */
(function () {
  "use strict";
  const L = window.Gapmaegim;
  const STORE_KEY = "startup-class-pricing-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const SEG = { "플랫폼 수수료": "#E0605A", "결제 수수료": "#F09A6B", "재료 키트": "#C9A227", "배송": "#D9C07A", "작가 시간": "#8E95A8" };

  /* ---------- 상태 ---------- */
  const seed = () => ({ costs: clone(L.COSTS), plans: clone(L.PLANS), pre: clone(L.PRESIGN), legacy: false, decided: null, ai: { mode: "rule", reason: "", ms: 0, key: "", data: null } });
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.costs && Array.isArray(v.plans) && v.plans.length === 3 && v.pre && v.ai) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let waiting = false;
  let runToken = 0;
  const rows = () => L.presignRows(st.plans, st.costs, st.pre);
  const keyOf = () => JSON.stringify([st.costs, st.plans, st.pre]);

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

  /* ---------- 1기 돌아보기 ---------- */
  function renderLook() {
    const n = L.COHORT1_STUDENTS;
    const was = L.cohort(L.COHORT1, st.costs, n, { legacy: true });
    const now = L.cohort(L.COHORT1, st.costs, n);
    const d = st.decided && st.plans.find((p) => p.id === st.decided);
    const dr = d && rows().find((r) => r.id === d.id);
    const sign = (v) => (v < 0 ? `−${L.won(-v)}` : L.won(v));
    $("look").innerHTML = `
      <div class="lk was"><span>1기 · 그때 계산 <em>수수료 빠짐</em></span><b>${L.won(was.net)}</b><p>1인당 남는 돈 · ${n}명이면 <strong>${sign(was.profit)}</strong></p></div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="lk now"><span>1기 · 다시 계산 <em>수수료·재료비 포함</em></span><b class="${now.net < was.net ? "down" : ""}">${L.won(now.net)}</b><p>${n}명이면 <strong class="${now.profit < 0 ? "neg" : ""}">${sign(now.profit)}</strong> · 손익분기 ${Number.isFinite(now.breakEven) ? `${now.breakEven}명` : "불가"}</p></div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="lk next">${d ? `<span>2기 · 정한 구성 <em>${esc(d.id)} ${esc(d.name)}</em></span><b>${L.won(d.price)}</b><p>객단가 ${L.man(L.COHORT1.price)} → ${L.man(d.price)} · 예상 ${dr.students}명 <strong class="${dr.profit < 0 ? "neg" : ""}">${sign(dr.profit)}</strong></p>` : `<span>2기 · 아직 정하지 않음</span><b>—</b><p>아래 추천에서 ‘이 구성으로 정하기’를 누르세요.</p>`}</div>`;
  }

  /* ---------- 비용 ---------- */
  const FIELDS = [
    ["platformRate", "플랫폼 수수료", "%", 0.5, true],
    ["payRate", "결제 수수료", "%", 0.1, true],
    ["kitCost", "재료 키트 원가", "원", 500],
    ["shipCost", "키트 배송비", "원", 500],
    ["hourValue", "작가 시간 1시간 값", "원", 1000],
    ["fixed", "기수 고정비 (광고)", "원", 10000],
    ["visitors", "2기 모집 페이지 방문자", "명", 10],
  ];
  function renderFields() {
    $("fields").innerHTML = FIELDS.map(([k, label, unit, step, rate]) => {
      const v = rate ? Math.round(st.costs[k] * 1000) / 10 : st.costs[k];
      return `<label class="fld"><span>${label}</span><span class="in"><input type="number" inputmode="decimal" min="0" step="${step}" data-c="${k}" value="${v}"><i>${unit}</i></span></label>`;
    }).join("");
  }
  function renderWarn() {
    const w = L.missingCosts(st.costs, st.plans);
    $("warn").innerHTML = w.map((s) => `<li>${esc(s)}</li>`).join("") || `<li class="ok">빠진 비용이 없어요. 수수료 2개 · 재료 · 배송 · 작가 시간을 모두 뺐어요.</li>`;
  }

  /* ---------- 구성 카드 ---------- */
  function renderPlans() {
    const pick = (st.ai.mode === "ai" && st.ai.data ? st.ai.data.pick : L.reviewRule(rows(), st.costs).pick);
    $("plans").innerHTML = st.plans.map((p, i) => {
      const u = L.unit(p, st.costs, { legacy: st.legacy });
      const be = L.breakEven(u.net, st.costs.fixed);
      const w = (v) => (u.price ? Math.max(0, (v / u.price) * 100) : 0);
      const segs = u.rows.filter(([, v]) => v > 0).map(([k, v]) => `<s style="width:${w(v)}%;background:${SEG[k]}" title="${k} ${L.won(v)}"></s>`).join("");
      return `<article class="plan${pick === p.id ? " pick" : ""}${st.decided === p.id ? " decided" : ""}" data-i="${i}">
        <div class="p-h"><span class="pid">${p.id}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div>${st.decided === p.id ? `<span class="badge">2기 구성</span>` : pick === p.id ? `<span class="badge soft">추천</span>` : ""}</div>
        <div class="p-in">
          <label>가격 <span class="in"><input type="number" min="0" step="1000" data-p="price" value="${p.price}"><i>원</i></span></label>
          <label>작가 시간 <span class="in"><input type="number" min="0" step="10" data-p="minutes" value="${p.minutes}"><i>분</i></span></label>
          <label class="chk"><input type="checkbox" data-p="kit" ${p.kit ? "checked" : ""}> 재료 키트</label>
        </div>
        <div class="fall" role="img" aria-label="가격 ${L.won(u.price)} 중 비용 ${L.won(u.price - u.net)}, 남는 돈 ${L.won(u.net)}">${segs}<s class="net" style="width:${w(u.net)}%"></s></div>
        <ul class="lines">${u.rows.map(([k, v]) => `<li class="${st.legacy && (k === "플랫폼 수수료" || k === "결제 수수료") ? "miss" : ""}"><i style="background:${SEG[k]}"></i>${k}<b>${st.legacy && (k === "플랫폼 수수료" || k === "결제 수수료") ? "빠짐" : v ? `−${L.won(v)}` : "없음"}</b></li>`).join("")}</ul>
        <div class="net-row"><span>1인당 남는 돈</span><b class="${u.net <= 0 ? "neg" : ""}">${L.won(u.net)}</b></div>
        <p class="sub">남는 비율 ${L.pct(u.margin)} · 고정비를 메우려면 ${Number.isFinite(be) ? `<b>${be}명</b>` : "<b>팔수록 손해</b>"}</p>
      </article>`;
    }).join("");
  }

  /* ---------- 사전 신청 테스트 + 추천 ---------- */
  function renderTable() {
    const rs = rows();
    $("tbl").innerHTML = `<thead><tr><th>구성</th><th class="n">방문</th><th class="n">신청</th><th class="n">신청률</th><th class="n">1인당 남는 돈</th><th class="n">방문자당</th><th class="n">예상 수강생</th><th class="n">예상 이익</th></tr></thead>
      <tbody>${rs.map((r) => `<tr>
        <th scope="row"><span class="pid sm">${r.id}</span> ${L.man(r.price)}</th>
        <td class="n"><label class="sr" for="v${r.id}">${r.id} 방문</label><input id="v${r.id}" type="number" min="0" data-pre="${r.id}" data-k="visits" value="${r.visits}"></td>
        <td class="n"><label class="sr" for="s${r.id}">${r.id} 신청</label><input id="s${r.id}" type="number" min="0" data-pre="${r.id}" data-k="signups" value="${r.signups}"></td>
        <td class="n">${L.pct(r.conv)}</td><td class="n">${L.won(r.net)}</td><td class="n strong">${L.won(r.perVisitor)}</td><td class="n">${r.students}명</td><td class="n ${r.profit < 0 ? "neg" : ""}">${L.won(r.profit)}</td>
      </tr>`).join("")}</tbody>
      <tfoot><tr><th>합계</th><td class="n">${rs.reduce((a, r) => a + r.visits, 0)}</td><td class="n"><b>${L.totalSignups(st.pre)}명</b></td><td colspan="5"></td></tr></tfoot>`;
  }
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 숫자를 보는 중</span>`;
    if (st.ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(st.ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule">규칙 기반${st.ai.reason ? ` · ${esc(st.ai.reason)}` : ""}</span>`;
  }
  function renderRec() {
    const rv = st.ai.mode === "ai" && st.ai.data ? st.ai.data : L.reviewRule(rows(), st.costs);
    const p = st.plans.find((x) => x.id === rv.pick);
    $("rec").innerHTML = `
      <div class="r-h"><h3>추천</h3>${modeChip()}</div>
      ${p ? `<p class="r-pick"><span class="pid">${p.id}</span><b>${esc(p.name)}</b> · ${L.won(p.price)}</p>` : ""}
      <ul class="r-why">${rv.reasons.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      ${rv.risks.length ? `<h4>조심할 점</h4><ul class="r-risk">${rv.risks.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${p ? `<button class="primary wide" id="decide" type="button" ${st.decided === p.id ? "disabled" : ""}>${st.decided === p.id ? "2기 구성으로 정했어요" : "이 구성으로 정하기"}</button>` : ""}
      <p class="fine">추천은 판단을 돕는 계산이에요. 가격은 수강생과 시장을 아는 운영자가 정해요.</p>`;
  }
  function renderAll() { renderLook(); renderWarn(); renderPlans(); renderTable(); renderRec(); $("legacy").checked = st.legacy; }

  async function askAi() {
    const my = ++runToken;
    const rs = rows(), key = keyOf();
    st.ai = { mode: "rule", reason: "", ms: 0, key: "", data: null };
    waiting = AI.status().enabled !== false;
    renderRec(); renderPlans();
    const r = await AI.ask("classpricing.review", {
      plans: rs.map((x) => ({ id: x.id, name: x.name, price: x.price, net: x.net, marginPct: Math.round(x.margin * 1000) / 10, visits: x.visits, signups: x.signups, convPct: Math.round(x.conv * 1000) / 10, perVisitor: x.perVisitor, students: x.students, profit: x.profit })),
      fixed: st.costs.fixed, visitors: st.costs.visitors,
    });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeReview(r.data, rows(), st.costs);
    if (n && key === keyOf()) st.ai = { mode: "ai", reason: "", ms: r.ms, key, data: n };
    else st.ai.reason = n ? "숫자가 바뀌어 규칙으로 다시 계산" : r ? "입력에 없는 숫자·형식 오류라 버림" : (AI.status().reason || "");
    save(); renderRec(); renderPlans();
  }
  function changed() {
    if (st.ai.mode === "ai" && st.ai.key !== keyOf()) st.ai = { mode: "rule", reason: "숫자가 바뀌어 규칙으로 다시 계산", ms: 0, key: "", data: null };
    if (waiting) { runToken++; waiting = false; st.ai.reason = "숫자가 바뀌어 규칙으로 다시 계산"; }
    save(); renderLook(); renderWarn(); renderPlans(); renderTable(); renderRec();
  }
  const keepFocus = (sel) => { const el = document.querySelector(sel); if (el) el.focus(); };

  /* ---------- 이벤트 ---------- */
  $("fields").addEventListener("change", (e) => {
    const k = e.target.dataset.c; if (!k) return;
    const f = FIELDS.find((x) => x[0] === k);
    const v = Math.max(0, Number(e.target.value) || 0);
    st.costs[k] = f[4] ? Math.min(100, v) / 100 : Math.round(v);
    changed();
  });
  $("plans").addEventListener("change", (e) => {
    const k = e.target.dataset.p; if (!k) return;
    const i = Number(e.target.closest(".plan").dataset.i), p = st.plans[i];
    if (k === "kit") p.kit = e.target.checked;
    else p[k] = Math.max(0, Math.round(Number(e.target.value) || 0));
    changed();
    keepFocus(`.plan[data-i="${i}"] [data-p="${k}"]`);
  });
  $("tbl").addEventListener("change", (e) => {
    const id = e.target.dataset.pre; if (!id) return;
    const k = e.target.dataset.k;
    st.pre[id][k] = Math.max(0, Math.round(Number(e.target.value) || 0));
    if (st.pre[id].signups > st.pre[id].visits) { st.pre[id].signups = st.pre[id].visits; toast("신청은 방문보다 많을 수 없어요"); }
    changed();
    keepFocus(`#${k === "visits" ? "v" : "s"}${id}`);
  });
  $("legacy").addEventListener("change", (e) => {
    st.legacy = e.target.checked; save(); renderPlans();
    toast(st.legacy ? "1기처럼 수수료 2개를 빼먹고 계산한 숫자예요" : "수수료까지 모두 뺀 숫자로 돌아왔어요");
  });
  $("rec").addEventListener("click", (e) => {
    if (!e.target.closest("#decide")) return;
    const before = st.decided;
    const rv = st.ai.mode === "ai" && st.ai.data ? st.ai.data : L.reviewRule(rows(), st.costs);
    st.decided = rv.pick; save(); renderAll();
    const p = st.plans.find((x) => x.id === st.decided);
    toast(`2기는 ${p.id} 구성 · ${L.won(p.price)}으로 정했어요`, () => { st.decided = before; save(); renderAll(); });
  });
  $("ask").addEventListener("click", askAi);
  $("csv").addEventListener("click", () => {
    const blob = new Blob([L.exportCsv(st.plans, st.costs, st.pre)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "class-pricing.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("구성 3가지 계산표를 내보냈어요");
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    runToken++; waiting = false;
    st = seed(); save(); renderFields(); renderAll(); askAi();
    toast("샘플 숫자로 되돌렸어요", () => { runToken++; waiting = false; st = before; save(); renderFields(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  renderFields(); renderAll();
  AI.probe().then(() => { if (st.ai.mode !== "ai") askAi(); });
})();
