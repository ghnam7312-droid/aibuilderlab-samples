/* 자리판 — 화면 (DOM 다루기만 한다. 집계·검산·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * 업종·구를 바꾸면
 *   1) 원본 행을 바로 다시 집계해 표·숫자·비교를 그리고 규칙 요약을 즉시 보여 준다.
 *   2) Claude(district.brief)에게 집계 숫자를 보내 요약을 다시 쓰게 한다. 문장 속 숫자가
 *      입력에 없는 숫자면 버리고 규칙 요약을 그대로 둔다.
 * 이름이 안 맞아 빠진 행은 위에 경고로 띄우고, 그 자리에서 대응표에 이어 붙일 수 있다.
 */
(function () {
  "use strict";
  const L = window.Jaripan;
  const STORE_KEY = "career-district-dash-v1";
  const ROWS = L.sampleRows();
  const FULL_MAP = { ...L.RENAMES, ...L.MISSING_IN_TABLE }; // 검산은 '알려진 모든 옛 이름'으로 센다
  const CMP_COLORS = ["#0B7F6E", "#D9731A", "#5B5BD6"];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = L.fmt;
  const sign = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

  /* ---------- 상태 ---------- */
  function seed() {
    return { biz: "커피전문점", gus: [...L.GUS], useMap: true, extra: {}, sort: "score", pick: ["햇살동", "학당동"], verifySeed: 1 };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && L.BIZ_NAMES.includes(v.biz) && Array.isArray(v.gus) && Array.isArray(v.pick) && v.extra && typeof v.extra === "object") return { ...seed(), ...v };
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let agg = null;
  let brief = { data: null, mode: "rule", reason: "", ms: 0 };
  let briefKey = "";
  let waiting = false;
  let token = 0;
  let checks = null;

  const mapNow = () => (st.useMap ? { ...L.RENAMES, ...st.extra } : {});

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

  /* ---------- 조건 ---------- */
  $("biz").innerHTML = L.BIZ_NAMES.map((b) => `<option>${esc(b)}</option>`).join("");
  $("rowCount").textContent = fmt(ROWS.length);
  function renderControls() {
    $("biz").value = st.biz;
    $("gus").innerHTML = L.GUS.map((g) => `<button type="button" data-gu="${esc(g)}" aria-pressed="${st.gus.includes(g)}">${esc(g)}</button>`).join("");
    $("useMap").setAttribute("aria-checked", String(st.useMap));
  }

  /* ---------- 경고: 이름이 안 맞아 빠진 행 ---------- */
  function renderWarn() {
    const box = $("warn");
    const um = agg.unmatched;
    if (!um.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    const rowsLost = um.reduce((s, u) => s + u.rows, 0);
    const opts = L.DONGS.filter((d) => st.gus.includes(d.gu)).map((d) => `<option value="${esc(d.dong)}">${esc(d.dong)} (${esc(d.gu)})</option>`).join("");
    box.innerHTML = `<div class="warn-h"><b>${um.length}개 이름 · ${fmt(rowsLost)}행이 집계에서 빠졌어요</b>
      <span>${st.useMap ? "대응표에 없는 옛 이름이에요. 지금 이름을 골라 이어 붙이세요." : "대응표를 꺼서 1분기의 옛 이름 행이 빠졌어요. 증감이 부풀려 보입니다."}</span></div>
      ${st.useMap ? `<ul>${um.map((u, i) => `<li><span class="old">${esc(u.name)}</span> <span class="rows">${u.rows}행</span>
        <label class="sr" for="fix${i}">${esc(u.name)}의 지금 이름</label>
        <select id="fix${i}" data-old="${esc(u.name)}"><option value="">지금 이름 고르기</option>${opts}</select>
        <button class="dark sm" type="button" data-fix="${i}">대응표에 추가</button></li>`).join("")}</ul>`
        : `<button class="dark sm" type="button" id="mapOn">대응표 다시 켜기</button>`}`;
  }

  /* ---------- 요약 숫자 ---------- */
  function renderKpis() {
    const d = agg.dongs;
    const s2 = d.reduce((s, x) => s + x.Q2.stores, 0), s1 = d.reduce((s, x) => s + x.Q1.stores, 0);
    const cl = d.reduce((s, x) => s + x.Q2.closed, 0);
    const lost = agg.unmatched.reduce((s, u) => s + u.rows, 0);
    const pct = s1 ? Math.round((s2 - s1) / s1 * 1000) / 10 : 0;
    $("kpis").innerHTML = `
      <div class="kpi"><span>비교한 동</span><b>${d.length}<small>곳</small></b><em>${esc(st.gus.join("·"))}</em></div>
      <div class="kpi"><span>${esc(st.biz)} 점포 (2분기)</span><b>${fmt(s2)}<small>곳</small></b><em class="${s2 - s1 >= 0 ? "up" : "down"}">1분기 대비 ${sign(s2 - s1)}곳 (${pct > 0 ? "+" : ""}${pct}%)</em></div>
      <div class="kpi"><span>평균 폐업률</span><b>${s2 ? Math.round(cl / s2 * 1000) / 10 : 0}<small>%</small></b><em>2분기 폐업 ${fmt(cl)}곳</em></div>
      <div class="kpi ${lost ? "bad" : "good"}"><span>이름이 안 맞아 빠진 행</span><b>${fmt(lost)}<small>행</small></b><em>${lost ? "위 경고에서 이어 붙이세요" : "모든 행이 집계에 들어갔어요"}</em></div>`;
  }

  /* ---------- 요약 (규칙 → Claude) ---------- */
  function modeBadge() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 쓰는 중</span>`;
    if (brief.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(brief.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 정해진 문장 틀로 썼어요">규칙 기반${brief.reason ? ` · ${esc(brief.reason)}` : ""}</span>`;
  }
  function renderBrief() {
    $("mode").innerHTML = modeBadge();
    const b = brief.data;
    if (!b) { $("brief").innerHTML = ""; return; }
    $("brief").className = waiting ? "waiting" : "";
    $("brief").innerHTML = `<p class="headline">${esc(b.headline)}</p>
      <ol class="lines">${b.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
      ${b.caution ? `<p class="caution"><b>주의</b> ${esc(b.caution)}</p>` : ""}
      <p class="fine">요약 속 숫자는 모두 위 집계표에 있는 숫자와 대조해요. 맞지 않는 숫자가 있으면 Claude 요약을 버려요.</p>`;
  }
  async function runBrief() {
    const key = JSON.stringify([st.biz, st.gus, st.useMap, st.extra]);
    if (key === briefKey) { renderBrief(); return; }
    briefKey = key;
    const my = ++token;
    brief = { data: L.ruleBrief(agg), mode: "rule", reason: "", ms: 0 };
    if (AI.status().enabled === null) { waiting = true; briefKey = ""; renderBrief(); return; } // 연결 확인이 끝나면 다시 부른다
    waiting = AI.status().enabled !== false && agg.dongs.length > 0;
    renderBrief();
    if (!waiting) { brief.reason = AI.status().reason || ""; renderBrief(); return; }
    const input = L.aiInput(agg);
    const r = await AI.ask("district.brief", input);
    if (my !== token) return; // 그 사이 조건을 바꿨으면 버린다
    waiting = false;
    if (r) {
      const n = L.normalizeBrief(r.data, input);
      if (n.ok) brief = { data: n.brief, mode: "ai", reason: "", ms: r.ms };
      else brief.reason = n.reason;
    } else brief.reason = AI.status().reason || "AI 응답 없음";
    renderBrief();
  }

  /* ---------- 순위 표 ---------- */
  const COLS = [
    ["dong", "행정동", null], ["stores", "점포", "stores"], ["change", "증감", "change"], ["density", "1만 명당", "density"],
    ["closeRate", "폐업률", "closeRate"], ["sales", "월매출", "sales"], ["score", "참고 점수", "score"],
  ];
  function renderTable() {
    const list = L.sortDongs(agg.dongs, st.sort);
    const head = `<thead><tr><th class="c-pick"><span class="sr">비교에 담기</span></th><th class="c-no">#</th>${COLS.map(([k, label, sk]) => {
      if (!sk) return `<th scope="col">${label}</th>`;
      const on = st.sort === sk;
      return `<th scope="col" class="num" aria-sort="${on ? (sk === "density" || sk === "closeRate" ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${sk}" class="${on ? "on" : ""}">${label}${on ? " ▾" : ""}</button></th>`;
    }).join("")}</tr></thead>`;
    const body = list.map((d, i) => {
      const picked = st.pick.includes(d.dong);
      const ci = st.pick.indexOf(d.dong);
      return `<tr class="${picked ? "picked" : ""}">
        <td class="c-pick"><input type="checkbox" data-pick="${esc(d.dong)}" ${picked ? "checked" : ""} aria-label="${esc(d.dong)} 비교에 담기" ${!picked && st.pick.length >= 3 ? "disabled" : ""}>${picked ? `<i class="dot" style="background:${CMP_COLORS[ci]}"></i>` : ""}</td>
        <td class="c-no">${i + 1}</td>
        <td class="c-dong"><b>${esc(d.dong)}</b><span>${esc(d.gu)}</span></td>
        <td class="num">${fmt(d.Q2.stores)}</td>
        <td class="num ${d.change > 0 ? "up" : d.change < 0 ? "down" : ""}">${sign(d.change)}</td>
        <td class="num">${d.density}</td>
        <td class="num">${d.closeRate}%</td>
        <td class="num">${fmt(d.Q2.sales)}만</td>
        <td class="c-score"><span class="sbar"><i style="width:${d.score}%"></i></span><b>${d.score}</b></td>
      </tr>`;
    }).join("");
    $("rank").innerHTML = head + `<tbody>${body || `<tr><td colspan="9" class="none">구를 하나 이상 고르세요.</td></tr>`}</tbody>`;
  }

  /* ---------- 동 비교 ---------- */
  function renderCmp() {
    const sel = st.pick.map((n) => agg.dongs.find((d) => d.dong === n)).filter(Boolean);
    if (!sel.length) { $("cmp").innerHTML = `<p class="empty">표에서 동을 골라 담으면 여기서 나란히 비교해요.</p>`; return; }
    const metrics = [
      ["점포 수", (d) => d.Q2.stores, (v) => `${fmt(v)}곳`, false],
      ["1만 명당 점포 (적을수록 덜 붐빔)", (d) => d.density, (v) => `${v}곳`, true],
      ["폐업률", (d) => d.closeRate, (v) => `${v}%`, true],
      ["점포당 월매출", (d) => d.Q2.sales, (v) => `${fmt(v)}만 원`, false],
      ["참고 점수", (d) => d.score, (v) => `${v}점`, false],
    ];
    $("cmp").innerHTML = `<div class="legend">${sel.map((d) => `<span><i style="background:${CMP_COLORS[st.pick.indexOf(d.dong)]}"></i>${esc(d.dong)}</span>`).join("")}</div>` +
      metrics.map(([label, get, show, lowGood]) => {
        const vals = sel.map(get);
        const max = Math.max(...vals, 0.0001);
        const best = lowGood ? Math.min(...vals) : Math.max(...vals);
        return `<div class="m"><div class="m-l">${label}</div>${sel.map((d, i) => `<div class="m-r"><span class="m-bar"><i style="width:${Math.max(3, vals[i] / max * 100)}%;background:${CMP_COLORS[st.pick.indexOf(d.dong)]}"></i></span><span class="m-v ${vals[i] === best && sel.length > 1 ? "best" : ""}">${show(vals[i])}</span></div>`).join("")}</div>`;
      }).join("");
  }

  /* ---------- 검산 ---------- */
  function renderChecks() {
    if (!checks) { $("chk").innerHTML = `<p class="empty">‘10건 다시 세기’를 누르면 결과가 여기 나와요.</p>`; return; }
    const ok = checks.filter((c) => c.ok).length;
    $("chk").innerHTML = `<p class="chk-sum ${ok === checks.length ? "good" : "bad"}">${checks.length}건 중 ${ok}건 일치${ok < checks.length ? " · 불일치한 동은 옛 이름 행이 빠졌을 수 있어요" : ""}</p>
      <ul class="chk">${checks.map((c) => `<li class="${c.ok ? "" : "x"}"><b>${esc(c.dong)}</b>
        <span>1분기 ${c.got[0]}${c.ok ? "" : ` / 원본 ${c.expected[0]}`} · 2분기 ${c.got[1]}${c.got[1] === c.expected[1] ? "" : ` / 원본 ${c.expected[1]}`}</span>
        <em aria-label="${c.ok ? "일치" : "불일치"}">${c.ok ? "✓" : "✕"}</em></li>`).join("")}</ul>`;
  }

  /* ---------- 대응표 ---------- */
  function renderMapList() {
    const m = { ...L.RENAMES, ...st.extra };
    $("mapN").textContent = `${Object.keys(m).length}개`;
    $("maplist").innerHTML = Object.entries(m).map(([o, n]) => `<li><span class="old">${esc(o)}</span><span class="arr" aria-hidden="true">→</span><b>${esc(n)}</b>${st.extra[o] ? `<button class="link-btn" type="button" data-unmap="${esc(o)}" aria-label="${esc(o)} 대응 지우기">지우기</button>` : `<span class="tag">기본</span>`}</li>`).join("") +
      Object.keys(L.MISSING_IN_TABLE).filter((o) => !st.extra[o]).map((o) => `<li class="miss"><span class="old">${esc(o)}</span><span class="arr" aria-hidden="true">→</span><b>?</b><span class="tag">대응표에 없음</span></li>`).join("");
  }

  /* ---------- 전체 그리기 ---------- */
  function render(opts) {
    agg = L.aggregate(ROWS, { biz: st.biz, gus: st.gus, map: mapNow() });
    if (checks && opts && opts.data) checks = L.verifySample(ROWS, agg, FULL_MAP, 10, st.verifySeed);
    renderControls(); renderWarn(); renderKpis(); renderTable(); renderCmp(); renderChecks(); renderMapList();
    save();
    runBrief();
  }

  /* ---------- 이벤트 ---------- */
  $("biz").addEventListener("change", (e) => { st.biz = e.target.value; render({ data: true }); });
  $("gus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-gu]");
    if (!b) return;
    const g = b.dataset.gu;
    if (st.gus.includes(g)) {
      if (st.gus.length === 1) { toast("구는 하나 이상 골라야 해요"); return; }
      st.gus = st.gus.filter((x) => x !== g);
    } else st.gus = L.GUS.filter((x) => x === g || st.gus.includes(x));
    render({ data: true });
    $("gus").querySelector(`[data-gu="${g}"]`).focus();
  });
  $("useMap").addEventListener("click", () => {
    st.useMap = !st.useMap;
    render({ data: true });
    toast(st.useMap ? "대응표를 켰어요. 옛 이름 행이 다시 들어갔어요" : "대응표를 껐어요. 이름이 바뀐 동의 1분기 행이 빠집니다");
  });
  $("warn").addEventListener("click", (e) => {
    if (e.target.id === "mapOn") { st.useMap = true; render({ data: true }); return; }
    const b = e.target.closest("[data-fix]");
    if (!b) return;
    const sel = $(`fix${b.dataset.fix}`);
    if (!sel.value) { sel.focus(); toast("이어 붙일 지금 이름을 먼저 고르세요"); return; }
    const old = sel.dataset.old;
    const lost = agg.unmatched.find((u) => u.name === old);
    st.extra = { ...st.extra, [old]: sel.value };
    render({ data: true });
    toast(`${old} → ${sel.value} 이어 붙임 · ${lost ? lost.rows : 0}행 복구`, () => { const x = { ...st.extra }; delete x[old]; st.extra = x; render({ data: true }); });
  });
  $("maplist").addEventListener("click", (e) => {
    const b = e.target.closest("[data-unmap]");
    if (!b) return;
    const old = b.dataset.unmap, was = st.extra[old];
    const x = { ...st.extra }; delete x[old]; st.extra = x;
    render({ data: true });
    toast(`${old} 대응을 지웠어요`, () => { st.extra = { ...st.extra, [old]: was }; render({ data: true }); });
  });
  $("rank").addEventListener("click", (e) => {
    const s = e.target.closest("[data-sort]");
    if (s) { st.sort = s.dataset.sort; render(); $("rank").querySelector(`[data-sort="${st.sort}"]`).focus(); }
  });
  $("rank").addEventListener("change", (e) => {
    const c = e.target.closest("[data-pick]");
    if (!c) return;
    const n = c.dataset.pick;
    st.pick = c.checked ? [...st.pick, n].slice(0, 3) : st.pick.filter((x) => x !== n);
    render();
    const again = $("rank").querySelector(`[data-pick="${n}"]`);
    if (again) again.focus();
  });
  $("cmpClear").addEventListener("click", () => {
    const before = st.pick;
    st.pick = []; render();
    toast("비교를 비웠어요", () => { st.pick = before; render(); });
  });
  $("verify").addEventListener("click", () => {
    st.verifySeed = (st.verifySeed % 9973) + 1;
    checks = L.verifySample(ROWS, agg, FULL_MAP, 10, st.verifySeed);
    renderChecks(); save();
    const ok = checks.filter((c) => c.ok).length;
    toast(`표본 ${checks.length}건 중 ${ok}건이 원본과 일치해요`);
  });
  $("csv").addEventListener("click", () => {
    const blob = new Blob([L.toCsv(agg, st.sort)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `상권_${st.biz.replace(/[^가-힣A-Za-z0-9]/g, "")}_2026Q2.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${agg.dongs.length}개 동을 CSV로 내보냈어요`);
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); checks = null; briefKey = "";
    render();
    toast("샘플 조건으로 되돌렸어요", () => { st = before; briefKey = ""; render(); });
  });

  /* ---------- 시작 ---------- */
  render();
  AI.probe().then(() => { briefKey = ""; runBrief(); });
})();
