/* 작은집 — 화면 (DOM 다루기만 한다. 단가 고르기·원가·마진·문구 검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 단가 기준(작년/최신) · 목표 마진 · 관리비 · 판매가 · 인건비 일수 · 단가표를 바꾸면
 * 세 패키지의 원가·이익·마진이 그 자리에서 다시 계산된다.
 * '소개 문구 쓰기'는 규칙 문구를 바로 보여 주고 Claude(smallpkg.pitch)의 문구가 오면 바꾼다.
 * 금액은 늘 logic.calcPackage 가 계산한다. AI 문구에 금액·과장 표현이 있으면 버린다.
 */
(function () {
  "use strict";
  const L = window.JageunJip;
  const STORE_KEY = "startup-small-package-v1";
  const LAST_YEAR_ON = "2025-12-31"; // 처음 기획할 때 계산하던 기준
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  /* ---------- 상태 ---------- */
  function seed() {
    return { basis: "now", target: 20, oh: 10, prices: L.SAMPLE_PRICES.map((p) => ({ ...p })), pkgs: L.PACKAGES.map((p) => ({ ...p, parts: p.parts.map((x) => x.slice()) })), sel: "one", pitches: {} };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.prices) && Array.isArray(v.pkgs) && v.pkgs.length === 3) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;
  const snapshot = () => JSON.parse(JSON.stringify(st));

  const on = (b) => ((b || st.basis) === "last" ? LAST_YEAR_ON : today());
  const calc = (p, b) => L.calcPackage(p, st.prices, on(b), st.oh / 100);
  const pkg = () => st.pkgs.find((p) => p.id === st.sel) || st.pkgs[0];
  const allItems = () => Object.keys(L.ITEMS);

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
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 단가 기준 띠 ---------- */
  function renderBasis() {
    document.querySelectorAll("[data-basis]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.basis === st.basis)));
    $("targetOut").textContent = `${st.target}%`; $("target").value = st.target;
    $("ohOut").textContent = `${st.oh}%`; $("oh").value = st.oh;
    const avg = (b) => st.pkgs.reduce((s, p) => s + calc(p, b).margin, 0) / st.pkgs.length;
    const stale = L.staleItems(st.prices, allItems(), on(), today(), 365);
    $("basisMsg").innerHTML = st.basis === "last"
      ? `<b>작년 단가</b>로 계산 중이에요. ${stale.length}개 항목에 더 최신 단가가 있어 마진이 높게 보여요 (평균 ${L.pct(avg("last"))}, 최신 기준 ${L.pct(avg("now"))}).`
      : stale.length
        ? `<b>${stale.length}개 항목</b>의 단가가 1년 넘었어요. 단가표에서 최신 값으로 고쳐 주세요.`
        : `<b>최신 단가</b>로 다시 계산했어요. 작년 단가 기준 평균 마진 ${L.pct(avg("last"))} → 지금 <b>${L.pct(avg("now"))}</b>.`;
    document.querySelector(".basis").classList.toggle("old", st.basis === "last" || stale.length > 0);
  }

  /* ---------- 패키지 카드 ---------- */
  function renderPkgs() {
    const t = st.target / 100;
    const scale = (x) => `${Math.max(0, Math.min(1, x / 0.4)) * 100}%`;
    $("pkgs").innerHTML = st.pkgs.map((p) => {
      const c = calc(p);
      const other = calc(p, st.basis === "now" ? "last" : "now");
      const s = L.status(c, t);
      const label = { ok: "목표 이상", low: "목표 미달", loss: "손해" }[s];
      const need = L.minPrice(c.cost, t);
      return `<article class="pk" data-id="${p.id}" data-st="${s}" aria-current="${p.id === st.sel}" tabindex="0" aria-label="${esc(p.name)} 패키지">
        <div class="pk-h"><b>${esc(p.name)}</b><small>${p.area}㎡ (${L.toPy(p.area)}평)</small></div>
        <div class="price"><label class="sr" for="pr-${p.id}">${esc(p.name)} 판매가 (만 원)</label><input id="pr-${p.id}" data-price="${p.id}" inputmode="numeric" value="${Math.round(p.price / 10000)}"><span>만 원 · 부가세 별도</span></div>
        <dl class="nums"><dt>원가</dt><dd>${L.manwon(c.cost)}</dd><dt>이익</dt><dd>${L.manwon(c.profit)}</dd></dl>
        <div class="bar-m" aria-hidden="true"><i style="width:${scale(c.margin)}"></i><b style="left:${scale(t)}" title="목표 ${st.target}%"></b></div>
        <div class="verdict"><span class="m">${L.pct(c.margin)}</span><span class="chip ${s}">${label}</span>
          ${s !== "ok" ? `<button type="button" class="fix" data-fix="${p.id}" data-v="${need}">최소 ${L.manwon(need)} 적용</button>` : ""}</div>
        <p class="was">${st.basis === "now" ? "작년 단가였다면" : "최신 단가면"} 마진 ${L.pct(other.margin)}</p>
      </article>`;
    }).join("");
  }

  /* ---------- 구성 표 ---------- */
  function renderDetail() {
    const p = pkg();
    const c = calc(p);
    const latest = (item) => L.latestDate(st.prices, item);
    const dcell = (item, asOf) => `<td class="d c-date${asOf < latest(item) ? " old" : ""}">${asOf ? asOf.slice(0, 7) : "없음"}</td>`;
    $("detail").innerHTML = `<table class="dt">
      <thead><tr><th>${esc(p.name)} · ${p.area}㎡</th><th class="n">수량</th><th class="n c-price">샘플 단가</th><th class="c-date">기준</th><th class="n">금액</th></tr></thead>
      <tbody>${c.lines.map((l) => `<tr><td>${esc(l.name)}${l.est ? `<span class="est">추정</span>` : ""}</td><td class="n">${l.qty}${l.unit}</td><td class="n c-price">${L.won(l.price)}</td>${dcell(l.item, l.asOf)}<td class="n">${L.won(l.amount)}</td></tr>`).join("")}
        <tr><td>${L.ITEMS.labor.name}</td><td class="n"><label class="sr" for="days">인건비 일수</label><input id="days" inputmode="numeric" value="${p.laborDays}">인·일</td><td class="n c-price">${L.won(c.laborRate)}</td>${dcell("labor", c.laborAsOf)}<td class="n">${L.won(c.labor)}</td></tr></tbody>
      <tfoot>
        <tr><td colspan="4">현장 관리비 (${st.oh}%)</td><td class="n">${L.won(c.overhead)}</td></tr>
        <tr class="sum"><td colspan="4">원가</td><td class="n">${L.won(c.cost)}</td></tr>
        <tr><td colspan="4">판매가</td><td class="n">${L.won(c.price)}</td></tr>
        <tr><td colspan="4">이익 (마진 ${L.pct(c.margin)})</td><td class="n">${L.won(c.profit)}</td></tr>
      </tfoot></table>`;
  }

  /* ---------- 소개 문구 ---------- */
  function curPitch() { return st.pitches[st.sel] || { pitch: L.rulePitch(pkg()), mode: { kind: "rule", reason: "" } }; }
  function renderPitch() {
    const { pitch, mode } = curPitch();
    const p = pkg(), c = calc(p);
    $("modeChip").innerHTML = waiting ? `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`
      : mode.kind === "ai" ? `<span class="mode" data-mode="ai">Claude로 정리 · ${(mode.ms / 1000).toFixed(1)}초</span>`
      : `<span class="mode" data-mode="rule" title="패키지 구성으로 만든 기본 문구">규칙 기반${mode.reason ? ` · ${esc(mode.reason)}` : ""}</span>`;
    $("pitch").classList.toggle("waiting", waiting);
    $("pitch").innerHTML = `<div class="flyer">
      <h3>${esc(pitch.name)}</h3><p class="tl">${esc(pitch.tagline)}</p>
      <p class="pr">${L.manwon(c.price)} <small>부가세 별도 · ${p.area}㎡(${L.toPy(p.area)}평) 기준</small></p>
      <ul>${pitch.includes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${pitch.excludes.length ? `<p class="ex">포함하지 않음: ${pitch.excludes.map(esc).join(", ")}</p>` : ""}
      <dl>${pitch.faq.map((f) => `<dt>Q. ${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join("")}</dl></div>`;
  }
  async function writePitch() {
    const p = pkg();
    const id = p.id;
    const my = ++runToken;
    st.pitches[id] = { pitch: L.rulePitch(p), mode: { kind: "rule", reason: "" } };
    waiting = AI.status().enabled !== false;
    renderPitch();
    const r = await AI.ask("smallpkg.pitch", {
      name: p.name, area: `${p.area}㎡ (${L.toPy(p.area)}평)`,
      includes: p.parts.map(([item]) => L.ITEMS[item].name),
      notIncluded: ["샷시·창호 교체", "구조 변경·확장", "가구·가전", "욕실 전체 교체", "주방 전체 교체"],
    });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizePitch(r.data, p);
    st.pitches[id] = n ? { pitch: n, mode: { kind: "ai", ms: r.ms } } : { pitch: L.rulePitch(p), mode: { kind: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") } };
    save();
    if (st.sel === id) renderPitch();
  }

  /* ---------- 단가표 ---------- */
  function renderPrices() {
    $("priceTable").innerHTML = `<thead><tr><th>항목</th><th>단위</th><th class="n">작년 단가</th><th class="n">최신 단가</th><th>기준일</th><th class="n">상승</th></tr></thead><tbody>` +
      allItems().map((item) => {
        const recs = st.prices.filter((p) => p.item === item).sort((a, b) => a.asOf.localeCompare(b.asOf));
        const old = recs.find((p) => p.asOf <= LAST_YEAR_ON);
        const cur = recs[recs.length - 1];
        const up = old && cur && old !== cur ? (cur.price - old.price) / old.price : 0;
        return `<tr><td>${L.ITEMS[item].name}</td><td>${L.ITEMS[item].unit}</td><td class="n old">${old ? L.won(old.price) : "-"}</td>
          <td class="n"><label class="sr" for="np-${item}">${L.ITEMS[item].name} 최신 단가</label><input id="np-${item}" data-item="${item}" inputmode="numeric" value="${cur ? cur.price : ""}"></td>
          <td>${cur ? cur.asOf : "-"}</td><td class="n up">${up ? `+${L.pct(up)}` : ""}</td></tr>`;
      }).join("") + "</tbody>";
  }

  function renderAll() { renderBasis(); renderPkgs(); renderDetail(); renderPitch(); renderPrices(); }
  const recalc = () => { save(); renderBasis(); renderPkgs(); renderDetail(); renderPitch(); };

  /* ---------- 이벤트 ---------- */
  document.querySelector(".basis .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-basis]"); if (!b || b.dataset.basis === st.basis) return;
    st.basis = b.dataset.basis; recalc();
    toast(st.basis === "now" ? "최신 단가로 다시 계산했어요" : "작년 단가로 계산하면 이렇게 보였어요");
  });
  $("target").addEventListener("input", (e) => { st.target = Number(e.target.value); recalc(); });
  $("oh").addEventListener("input", (e) => { st.oh = Number(e.target.value); recalc(); });
  $("pkgs").addEventListener("click", (e) => {
    const fix = e.target.closest("button[data-fix]");
    if (fix) {
      const p = st.pkgs.find((x) => x.id === fix.dataset.fix);
      const before = p.price;
      p.price = Number(fix.dataset.v); recalc();
      toast(`${p.name} 판매가를 ${L.manwon(p.price)}으로 바꿨어요`, () => { p.price = before; recalc(); });
      return;
    }
    if (e.target.closest("input")) return;
    const card = e.target.closest(".pk"); if (!card || card.dataset.id === st.sel) return;
    st.sel = card.dataset.id; save(); renderPkgs(); renderDetail(); renderPitch();
  });
  $("pkgs").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("pk")) { e.preventDefault(); e.target.click(); }
  });
  $("pkgs").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-price]"); if (!inp) return;
    const v = Number(inp.value.replace(/[^\d]/g, ""));
    if (!v) { toast("판매가는 만 원 단위 숫자로 넣어 주세요"); renderPkgs(); return; }
    const p = st.pkgs.find((x) => x.id === inp.dataset.price);
    if (p.price === v * 10000) return;
    p.price = v * 10000; recalc();
  });
  $("detail").addEventListener("change", (e) => {
    if (e.target.id !== "days") return;
    const v = Number(e.target.value);
    if (!(v > 0 && v <= 60)) { toast("인건비 일수는 1~60 사이로 넣어 주세요"); renderDetail(); return; }
    if (v === pkg().laborDays) return; // 다시 그리면서 생기는 change 는 무시
    pkg().laborDays = v; recalc();
  });
  $("priceTable").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-item]"); if (!inp) return;
    const v = Number(inp.value.replace(/[^\d]/g, ""));
    if (!v) { toast("단가는 숫자로 넣어 주세요"); renderPrices(); return; }
    const before = snapshot();
    if (L.pickPrice(st.prices, inp.dataset.item, "9999-12-31")?.price === v) return;
    const recs = st.prices.filter((p) => p.item === inp.dataset.item).sort((a, b) => b.asOf.localeCompare(a.asOf));
    // 최신 단가가 작년 기준 기록이면 새 기록을 더하고, 아니면 그 기록을 오늘 날짜로 고친다
    if (!recs.length || recs[0].asOf <= LAST_YEAR_ON) st.prices.push({ item: inp.dataset.item, price: v, asOf: today() });
    else Object.assign(recs[0], { price: v, asOf: today() });
    recalc(); renderPrices();
    toast(`${L.ITEMS[inp.dataset.item].name} 단가를 고쳐 세 패키지를 다시 계산했어요`, () => { st = before; save(); renderAll(); });
  });
  $("write").addEventListener("click", writePitch);
  $("copy").addEventListener("click", async () => {
    const txt = L.pitchText(curPitch().pitch, pkg(), calc(pkg()));
    try { await navigator.clipboard.writeText(txt); toast("소개 문구를 복사했어요"); } catch (e) { toast("복사할 수 없는 환경이에요. 문구를 직접 선택해 주세요"); }
  });
  $("csv").addEventListener("click", () => {
    const csv = L.toCsv(st.pkgs, st.pkgs.map((p) => calc(p)), on());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `jageunjip-packages-${today().replace(/-/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("패키지 3종 비교표를 내려받았어요");
  });
  $("reset").addEventListener("click", () => {
    const before = snapshot();
    st = seed(); save(); renderAll(); writePitch();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  renderAll();
  AI.probe().then(() => { if (!st.pitches[st.sel]) writePitch(); });
})();
