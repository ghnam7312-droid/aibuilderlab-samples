/* 한장 · app.js — 화면만 다룬다. 계산은 logic.js(HJ).
 *
 * 흐름: 부서 파일 10개(한 번에 끌어다 놓기 가능) → 열 이름 맞추기 → 취합 → 검산 테이프
 *  - 검산의 핵심은 "부서가 보고한 합계"와 "행을 더한 합계"를 맞춰 보는 것
 *  - 중복 행은 제외, 오타("1,59O,000")는 고칠 값을 제안 → 차이 0이면 '검산 통과' 도장
 *  - 누가 무엇을 고쳤는지 모두 '검산 기록'에 남고 엑셀 시트로 내보낸다
 *  - 지난주와 부서별로 비교해 ±15% 넘게 움직인 부서는 원인 품목을 규칙으로 설명한다
 * 이 서비스는 AI를 쓰지 않는다. 숫자는 틀리면 안 되기 때문에 정해 둔 규칙으로만 계산한다.
 */
(() => {
  "use strict";

  const STORE_KEY = "hanjang:v3";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { toNum, won, signed, COLS } = HJ;
  const COL_NAMES = { date: "일자", owner: "담당", client: "거래처", item: "품목", qty: "수량", amount: "금액" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let seq = 0;
  const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
  const nowHM = () => { const k = new Date(Date.now() + 9 * 3600000); return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`; };
  const nowFull = () => { const k = new Date(Date.now() + 9 * 3600000); return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${nowHM()}`; };

  /* ───────── 상태 + 저장 ───────── */
  const fresh = () => ({
    files: HJ.sampleWeek("now", uid), last: HJ.sampleWeek("last", uid),
    excluded: [], merged: false, current: 0, audit: [], mappings: {}, who: "엑셀탈출 (경영지원팀)",
  });
  let state = load() || fresh();
  let view = "src";        // src | led | wow | log
  let filter = "all";      // all | issue
  function load() { try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 저장 못 해도 화면은 동작 */ } }
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const analyze = () => HJ.analyze(state.files, state.excluded);

  /** 검산 기록 한 줄: 언제 · 누가 · 무엇을 · 어디를 · 전 → 후 */
  function log(act, where, before = "", after = "") {
    state.audit.unshift({ t: nowFull(), who: state.who, act, where, before: String(before), after: String(after) });
    if (state.audit.length > 300) state.audit.length = 300;
  }

  /* ───────── 받은 파일 ───────── */
  const XL_ICON = `<svg class="xl" viewBox="0 0 22 26" aria-hidden="true"><rect x="1" y="1" width="20" height="24" rx="3" fill="#E2EEE7" stroke="#1F5C45" stroke-width="1.2"/><path d="M6 9h10M6 13h10M6 17h6" stroke="#1F5C45" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  function renderFiles(a) {
    $("#file-count").textContent = state.files.length;
    const ul = $("#files");
    if (!state.files.length) { ul.innerHTML = `<li class="hint" style="padding:8px 4px">받은 파일이 없어요. 아래에 부서 파일을 한꺼번에 끌어다 놓으세요.</li>`; return; }
    ul.innerHTML = state.files.map((f, i) => {
      const pf = a.perFile[f.id];
      const late = f.at > "09:00";
      const mark = state.merged ? (pf.diff === 0 ? `<span class="okm">✓ 맞음</span>` : `<span class="late">${signed(pf.diff)}</span>`) : "";
      return `<li class="file${state.merged ? " merged" : ""}" aria-current="${i === state.current && view === "src"}" data-i="${i}">
        <button class="open" type="button" data-open="${i}" aria-label="${esc(f.dept)} 파일 보기">
          ${XL_ICON}
          <span class="fn">${esc(f.dept)}${f.mapped ? `<em class="mapped" title="열 이름을 맞춰 읽은 파일">열 맞춤</em>` : ""}</span>
          <span class="fa">${mark || `${f.rows.length}행`}<br><span class="${late ? "late" : ""}">${esc(f.at)}${late ? " 늦음" : ""}</span></span>
          <span class="fs">보고 ${won(f.declared)}원</span>
        </button>
        <button class="del" type="button" data-del="${i}" aria-label="${esc(f.dept)} 파일 빼기">✕</button>
      </li>`;
    }).join("");
  }

  /* ───────── 원본 시트 ───────── */
  function renderSrc() {
    const f = state.files[state.current];
    const t = $("#src");
    if (!f) { t.innerHTML = `<tbody><tr><td style="padding:40px;text-align:center;color:var(--ink-3)">파일을 고르면 원본이 여기에 보여요.</td></tr></tbody>`; $("#sheet-meta").textContent = ""; return; }
    const letters = ["", "A", "B", "C", "D", "E", "F"];
    t.innerHTML =
      `<thead><tr class="letters">${letters.map((l) => `<th${l ? "" : ' class="rn"'}>${l}</th>`).join("")}</tr>` +
      `<tr class="cols"><th class="rn">1</th>${COLS.map((c) => `<th class="${c === "qty" || c === "amount" ? "n" : ""}">${COL_NAMES[c]}</th>`).join("")}</tr></thead><tbody>` +
      f.rows.map((r, i) => `<tr><td class="rn">${i + 2}</td>${COLS.map((c) => {
        const isNum = c === "qty" || c === "amount";
        const v = isNum && Number.isFinite(toNum(r[c])) ? won(toNum(r[c])) : r[c];
        return `<td class="${isNum ? "n" : ""}${isNum && Number.isNaN(toNum(r[c])) ? " bad" : ""}">${esc(v)}</td>`;
      }).join("")}</tr>`).join("") +
      `<tr><td class="rn">${f.rows.length + 2}</td><td colspan="5" style="font-weight:700">합계 (부서 보고)</td><td class="n" style="font-weight:700">${won(f.declared)}</td></tr></tbody>`;
    $("#sheet-meta").textContent = `${f.name} · ${f.rows.length}행`;
  }

  /* ───────── 통합 장부 ───────── */
  function renderLedger(a) {
    const issues = a.dupLeft.length + a.bad.size;
    $("#issue-n").textContent = issues;
    const dupSet = new Set(a.dupLeft);
    let rn = 1;
    let html = `<thead><tr class="cols"><th class="rn">#</th>${COLS.map((c) => `<th class="${c === "qty" || c === "amount" ? "n" : ""}">${COL_NAMES[c]}</th>`).join("")}<th class="st">상태</th></tr></thead><tbody>`;
    for (const f of state.files) {
      const rows = f.rows.filter((r) => filter === "all" || dupSet.has(r.id) || a.bad.has(r.id));
      if (!rows.length) continue;
      const pf = a.perFile[f.id];
      html += `<tr class="grp"><td class="rn"></td><td colspan="7">${esc(f.dept)} <span style="font-weight:500;color:var(--ink-3)">· ${esc(f.name)}</span></td></tr>`;
      for (const r of rows) {
        const isDup = a.dup.has(r.id), isBad = a.bad.has(r.id), isOff = a.ex.has(r.id);
        const cls = isOff ? "off" : isDup ? "dup" : "";
        let st = `<span class="pill ok">정상</span>`;
        if (isOff) st = `<span class="pill off">제외</span><button class="row-act" type="button" data-restore="${r.id}">되살리기</button>`;
        else if (isDup) st = `<span class="pill dup">중복 의심</span><button class="row-act" type="button" data-exclude="${r.id}">제외</button>`;
        else if (isBad) {
          const fx = HJ.fixTypo(r.amount) ?? HJ.fixTypo(r.qty);
          st = `<span class="pill bad">형식 오류</span>${fx != null ? `<button class="row-act" type="button" data-typo="${r.id}">${won(fx)}로 고치기</button>` : ""}`;
        }
        html += `<tr class="${cls}" data-row="${r.id}"><td class="rn">${rn++}</td>` +
          COLS.map((c) => {
            const isNum = c === "qty" || c === "amount";
            const n = toNum(r[c]);
            const badCell = isNum && Number.isNaN(n);
            const shown = isNum && !badCell ? won(n) : r[c];
            return `<td class="${isNum ? "n" : ""}${c === "amount" ? " amt" : ""}${badCell ? " bad" : ""}"${isNum ? ` contenteditable="true" spellcheck="false" data-edit="${r.id}" data-col="${c}" aria-label="${esc(f.dept)} ${COL_NAMES[c]}" ` : ""}${badCell ? ` title="숫자가 아닌 글자가 있어요. 눌러서 고치세요."` : ""}>${esc(shown)}</td>`;
          }).join("") + `<td class="st">${st}</td></tr>`;
      }
      if (filter === "all") {
        html += `<tr class="sub"><td class="rn"></td><td colspan="5">${esc(f.dept)} 소계 <span style="font-weight:500;color:var(--ink-3)">· 보고 ${won(f.declared)}</span></td><td class="n">${won(pf.sum)}</td><td class="st">${pf.diff === 0 ? `<span class="pill ok">일치</span>` : `<span class="pill bad">${signed(pf.diff)}</span>`}</td></tr>`;
      }
    }
    if (filter === "issue" && !issues) html += `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--green);font-weight:600">확인할 행이 없어요. 모두 맞습니다.</td></tr>`;
    if (filter === "all") html += `<tr class="total"><td class="rn"></td><td colspan="5">취합 합계 · ${a.valid.length}행</td><td class="n">${won(a.rowSum)}</td><td></td></tr>`;
    $("#ledger").innerHTML = html + "</tbody>";
    $("#sheet-meta").textContent = `통합 장부 · ${state.files.length}개 부서 · ${a.used.length}행`;
  }

  /* ───────── 지난주 비교 (규칙 기반 이상치 설명) ───────── */
  function renderWow(a) {
    const cmp = HJ.compareWeeks(state.files, state.last, state.excluded);
    const lastBy = Object.fromEntries(state.last.map((f) => [f.dept, f]));
    const maxAbs = Math.max(1, ...cmp.map((c) => Math.abs(c.rate || 0)));
    const flagged = cmp.filter((c) => c.flag);
    const tNow = cmp.reduce((s, c) => s + c.now, 0), tLast = cmp.reduce((s, c) => s + (c.last || 0), 0);
    const tRate = tLast ? ((tNow - tLast) / tLast) * 100 : 0;
    $("#wow").innerHTML = `
      <div class="wow-head">
        <div class="wow-kpi"><small>이번 주 (10/12–10/16)</small><b>${won(tNow)}</b></div>
        <div class="wow-kpi"><small>지난주 (10/5–10/10)</small><b>${won(tLast)}</b></div>
        <div class="wow-kpi"><small>증감</small><b class="${tRate >= 0 ? "up" : "down"}">${tRate >= 0 ? "+" : ""}${tRate.toFixed(1)}%</b></div>
        <div class="wow-kpi flag"><small>살펴볼 부서 (±${HJ.FLAG_RATE}% 넘게)</small><b>${flagged.length}곳</b></div>
      </div>
      <p class="wow-note">이상치 설명은 <b>규칙</b>으로 씁니다 — 부서 합계의 증감을 품목별로 쪼개 가장 크게 움직인 품목과 거래처를 찾습니다. AI를 쓰지 않아요.${a.bad.size || a.dupLeft.length ? ` <span class="warn">검산이 끝나지 않은 행이 있어 숫자가 바뀔 수 있어요.</span>` : ""}</p>
      <div class="wow-list">${cmp.map((c, i) => {
        const w = c.rate == null ? 0 : (Math.abs(c.rate) / maxAbs) * 50;
        const ex = c.flag ? HJ.explainChange(state.files[i], lastBy[c.dept], state.excluded) : null;
        return `<div class="wow-row${c.flag ? " flag" : ""}">
          <span class="d">${esc(c.dept)}</span>
          <span class="nums"><span>${c.last == null ? "—" : won(c.last)}</span><span class="ar">→</span><b>${won(c.now)}</b></span>
          <span class="dv" aria-hidden="true"><i class="${(c.rate || 0) >= 0 ? "pos" : "neg"}" style="${(c.rate || 0) >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`}"></i></span>
          <span class="rt ${(c.rate || 0) >= 0 ? "up" : "down"}">${c.rate == null ? "새 부서" : `${c.rate >= 0 ? "+" : ""}${c.rate.toFixed(1)}%`}</span>
          ${ex ? `<div class="why"><span class="rtag">이상치 설명 · 규칙</span>${ex.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join("")}</div>` : ""}
        </div>`;
      }).join("")}</div>`;
    $("#sheet-meta").textContent = `지난주 비교 · 부서 ${cmp.length}곳`;
  }

  /* ───────── 검산 기록 ───────── */
  const CHANGE_ACTS = new Set(["오타 고침", "칸 수정", "행 제외", "파일 교체"]); // 전 값에 취소선을 긋는 일
  function renderLog() {
    $("#who").value = state.who;
    $("#audit").innerHTML = state.audit.length
      ? `<thead><tr><th>시각</th><th>확인자</th><th>한 일</th><th>위치</th><th>전</th><th>후</th></tr></thead><tbody>${state.audit.map((l) => `<tr><td class="t">${esc(l.t)}</td><td>${esc(l.who)}</td><td><span class="act a-${esc(l.act)}">${esc(l.act)}</span></td><td>${esc(l.where)}</td><td class="${CHANGE_ACTS.has(l.act) ? "b4" : "info"}" title="${esc(l.before)}">${esc(l.before)}</td><td class="af" title="${esc(l.after)}">${esc(l.after)}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="empty">아직 기록이 없어요. 취합하고, 행을 제외하거나 칸을 고치면 여기에 남아요.</td></tr></tbody>`;
    $("#sheet-meta").textContent = `검산 기록 · ${state.audit.length}건`;
  }

  /* ───────── 검산 테이프 ───────── */
  function renderTape(a, printing = false) {
    const tape = $("#tape");
    if (!state.merged) {
      tape.classList.remove("printing");
      tape.innerHTML = `<div class="tape-empty"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="6" width="28" height="36" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16h16M16 22h16M16 28h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><p>취합하면 이 종이에<br>검산 결과가 찍힙니다</p></div>`;
      return;
    }
    const ln = (k, v, cls = "", extra = "") => `<div class="ln ${cls}"><span class="k">${k}</span><span class="dots"></span><span class="v">${v}</span>${extra}</div>`;
    const dupSet = new Set(a.dupLeft);
    const firstDup = a.all.find((x) => dupSet.has(x.r.id));
    const firstBad = a.all.find((x) => a.bad.has(x.r.id));
    const dupAmt = a.all.filter((x) => dupSet.has(x.r.id)).reduce((s, x) => s + (toNum(x.r.amount) || 0), 0);
    const fix = firstBad ? (HJ.fixTypo(firstBad.r.amount) ?? HJ.fixTypo(firstBad.r.qty)) : null;
    let h = `<div class="hd">다온오피스 실적 검산</div><div class="sub">${esc(nowFull())} · 10월 3주 · ${esc(state.who)}</div>`;
    h += ln("받은 파일", `${state.files.length}개`);
    h += ln("원본 행", `${a.all.length}행`);
    h += ln("부서 보고 합계", won(a.declared));
    h += `<hr class="cut">`;
    h += ln("중복 의심", a.dupLeft.length ? `${a.dupLeft.length}행` : "없음", a.dupLeft.length ? "minus" : "", a.dupLeft.length ? `<button type="button" data-fix="dup">제외</button>` : "");
    if (firstDup) h += `<div class="ln note">${esc(firstDup.f.dept)} · ${esc(firstDup.r.owner)} · ${esc(firstDup.r.item)} ${signed(dupAmt)}</div>`;
    h += ln("형식 오류", a.bad.size ? `${a.bad.size}칸` : "없음", a.bad.size ? "minus" : "", a.bad.size ? `<button type="button" data-fix="bad">${fix != null ? "고치기" : "찾기"}</button>` : "");
    if (firstBad) h += `<div class="ln note">${esc(firstBad.f.dept)} ${firstBad.idx + 2}행 금액 “${esc(firstBad.r.amount)}”${fix != null ? ` → ${won(fix)} 제안` : ""}</div>`;
    if (state.excluded.length) h += ln("제외한 행", `${state.excluded.length}행 · ${won(a.exSum)}`);
    h += `<hr class="cut">`;
    h += ln("취합 행", `${a.valid.length}행`);
    h += ln("행 합계", won(a.rowSum), "sum");
    h += ln("차이", a.diff === 0 ? "0" : signed(a.diff), a.diff === 0 ? "" : "minus");
    h += a.pass
      ? `<div class="stamp pass">검산 통과<small>보고 합계 = 행 합계</small></div>`
      : `<div class="stamp fail">확인 필요<small>${a.dupLeft.length + a.bad.size}건 남음</small></div>`;
    tape.innerHTML = h;
    tape.classList.toggle("printing", printing && !reduceMotion);
    if (printing && !reduceMotion) $$(".ln, .cut, .stamp", tape).forEach((el, i) => { el.style.animationDelay = `${i * 70}ms`; });
  }

  /* ───────── 전체 다시 그리기 ───────── */
  const VIEWS = ["src", "led", "wow", "log"];
  function render(opts = {}) {
    const a = analyze();
    renderFiles(a);
    VIEWS.forEach((v) => {
      const tab = $(`#tab-${v}`), panel = $(`#sheet-${v}`);
      tab.setAttribute("aria-selected", String(view === v));
      tab.disabled = (v === "led" || v === "wow") && !state.merged;
      panel.hidden = view !== v;
    });
    $("#log-n").textContent = state.audit.length || "";
    $$(".filters button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === filter)));
    if (view === "src") renderSrc(); else if (view === "led") renderLedger(a); else if (view === "wow") renderWow(a); else renderLog();
    renderTape(a, opts.printing);
    $("#merge-bar").hidden = state.merged;
    $("#merge-title").textContent = state.files.length ? `${state.files.length}개 파일을 한 장으로 합칩니다` : "합칠 파일이 없어요";
    $("#merge").disabled = !state.files.length;
  }

  /* ───────── 알림 (되돌리기 지원) ───────── */
  let toastTimer = null, undoFn = null;
  function toast(msg, undo) {
    $("#toast-t").textContent = msg;
    undoFn = undo || null;
    $("#toast-undo").hidden = !undo;
    $("#toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  $("#toast-undo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });
  /** 바꾸기 + 기록 + 되돌리기. 되돌리면 그 사실도 기록에 남긴다 */
  function withUndo(msg, change) {
    const before = snapshot();
    change();
    save(); render();
    toast(msg, () => { const audit = state.audit; state = before; state.audit = audit; log("되돌리기", "-", msg, ""); save(); render(); toast("되돌렸어요"); });
  }

  /* ───────── 취합: 파일이 장부로 빨려 들어가는 효과 ───────── */
  function merge() {
    if (!state.files.length) return;
    const target = $(".sheet-area").getBoundingClientRect();
    const finish = () => {
      state.merged = true; view = "led"; filter = "all";
      const a = analyze();
      log("취합", `${state.files.length}개 부서 · ${a.all.length}행`, "", `차이 ${a.diff === 0 ? 0 : signed(a.diff)}`);
      save();
      render({ printing: true });
      toast(a.dupLeft.length + a.bad.size ? `${a.dupLeft.length + a.bad.size}건을 확인해 주세요` : "검산을 통과했어요");
    };
    if (reduceMotion) return finish();
    const items = $$(".file > .open");
    items.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      if (r.width === 0) return;
      const fly = document.createElement("div");
      fly.className = "fly";
      fly.textContent = b.querySelector(".fn").firstChild.textContent;
      Object.assign(fly.style, { left: `${r.left}px`, top: `${r.top}px` });
      document.body.appendChild(fly);
      const dx = target.left + target.width / 2 - r.left - 50, dy = target.top + 60 - r.top;
      setTimeout(() => { fly.style.transform = `translate(${dx}px, ${dy}px) scale(.6)`; fly.style.opacity = "0"; }, 20 + i * 45);
      setTimeout(() => fly.remove(), 700 + i * 45);
    });
    setTimeout(finish, 520 + items.length * 45);
  }

  /* ───────── 고치기 ───────── */
  const findRow = (id) => { for (const f of state.files) { const r = f.rows.find((x) => x.id === id); if (r) return { r, f }; } return null; };
  function excludeDups() {
    const a = analyze();
    if (!a.dupLeft.length) return;
    withUndo(`중복 ${a.dupLeft.length}행을 제외했어요`, () => {
      a.dupLeft.forEach((id) => { const x = findRow(id); log("행 제외", `${x.f.dept} · ${x.r.item}`, `${won(toNum(x.r.amount))}원`, "제외(중복)"); });
      state.excluded.push(...a.dupLeft);
    });
  }
  function applyTypo(id) {
    const x = findRow(id);
    if (!x) return;
    const col = Number.isNaN(toNum(x.r.amount)) ? "amount" : "qty";
    const fx = HJ.fixTypo(x.r[col]);
    if (fx == null) return focusBad();
    withUndo(`${x.f.dept} ${COL_NAMES[col]} “${x.r[col]}” → ${won(fx)}로 고쳤어요`, () => {
      log("오타 고침", `${x.f.dept} ${x.f.rows.indexOf(x.r) + 2}행 ${COL_NAMES[col]}`, x.r[col], won(fx));
      x.r[col] = String(fx);
      if (filter === "issue") { const left = analyze(); if (!left.bad.size && !left.dupLeft.length) filter = "all"; }
    });
  }
  function focusBad() {
    const a = analyze();
    const x = a.all.find((y) => a.bad.has(y.r.id));
    if (!x) return;
    if (HJ.fixTypo(x.r.amount) != null || HJ.fixTypo(x.r.qty) != null) { view = "led"; applyTypo(x.r.id); return; }
    view = "led"; filter = "issue"; render();
    const col = Number.isNaN(toNum(x.r.amount)) ? "amount" : "qty";
    const cell = $(`[data-edit="${x.r.id}"][data-col="${col}"]`);
    if (cell) {
      cell.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      cell.focus();
      const sel = getSelection(); const rg = document.createRange(); rg.selectNodeContents(cell); sel.removeAllRanges(); sel.addRange(rg);
    }
    toast("빨간 칸의 글자를 숫자로 고쳐 주세요");
  }

  /* ───────── 파일 읽기: 여러 개 한꺼번에, 열 이름이 다르면 맞추기 ───────── */
  let xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        s.onload = () => ok(window.XLSX);
        s.onerror = () => { xlsxLoading = null; s.remove(); fail(new Error("SheetJS")); };
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  }
  async function readCells(file) {
    if (/\.csv$/i.test(file.name)) return HJ.parseCSV(await file.text());
    if (/\.xlsx?$/i.test(file.name)) {
      const X = await loadXLSX().catch(() => null);
      if (!X) throw new Error("엑셀 읽기 도구를 불러오지 못했어요. 엑셀에서 ‘CSV로 저장’한 파일을 올려 주세요.");
      const wb = X.read(await file.arrayBuffer());
      return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
    }
    throw new Error("CSV나 엑셀(.xlsx) 파일만 올릴 수 있어요.");
  }

  const queue = [];   // 열 맞추기를 기다리는 파일
  async function addFiles(list) {
    const errs = [], added = [];
    for (const file of list) {
      try {
        const cells = await readCells(file);
        const key = HJ.headerKey((cells[0] || []).map(String));
        const remembered = state.mappings[key];
        const res = HJ.tableToFiles(file.name, cells, remembered ? { mapping: remembered } : {});
        if (res.error) errs.push(`${file.name} · ${res.error}`);
        else if (res.needMap) queue.push({ name: file.name, cells, res, key });
        else res.files.forEach((f) => added.push({ ...f, mapped: !!remembered, name: res.split ? `${f.dept} (${file.name}에서 나눔)` : f.name }));
      } catch (e) { errs.push(`${file.name} · ${e.message}`); }
    }
    $("#drop-err").hidden = !errs.length;
    $("#drop-err").innerHTML = errs.map(esc).join("<br>");
    if (added.length) commitFiles(added);
    nextMap();
  }
  function commitFiles(newFiles) {
    const replaced = newFiles.filter((nf) => state.files.some((x) => x.dept === nf.dept)).length;
    const msg = newFiles.length === 1
      ? `${newFiles[0].dept} 파일 ${newFiles[0].rows.length}행을 ${replaced ? "수정본으로 바꿨어요" : "추가했어요"}`
      : `부서 파일 ${newFiles.length}개를 읽었어요${replaced ? ` · ${replaced}개는 수정본으로 바꿈` : ""}`;
    withUndo(msg, () => {
      newFiles.forEach((nf) => {
        const f = { ...nf, id: uid("f"), at: nowHM(), rows: nf.rows.map((r) => ({ ...r, id: uid("r") })) };
        // 같은 부서 파일이 이미 있으면 새 파일로 바꾼다 (수정본을 다시 받은 경우)
        const i = state.files.findIndex((x) => x.dept === f.dept);
        if (i >= 0) { log("파일 교체", f.dept, `${state.files[i].rows.length}행`, `${f.rows.length}행`); state.files[i] = f; }
        else { log("파일 추가", f.dept, "", `${f.rows.length}행 · 보고 ${won(f.declared)}`); state.files.push(f); }
        state.current = state.files.findIndex((x) => x.id === f.id);
      });
      if (state.merged) view = "led"; else view = "src";
    });
  }

  /* 열 맞추기 창 */
  let mapping = null;
  function nextMap() {
    if (mapping || !queue.length) return;
    mapping = queue.shift();
    const { res, name } = mapping;
    const opts = [["", "쓰지 않음"], ...Object.entries(HJ.FIELD)];
    $("#map-file").textContent = name;
    $("#map-cols").innerHTML = res.needMap.cols.map((c, i) => `
      <div class="mc${c.field && !c.sure ? " guess" : ""}">
        <span class="src-h">${esc(c.header || `(${i + 1}번째 열)`)}</span>
        <span class="arw" aria-hidden="true">→</span>
        <select data-mi="${i}" aria-label="‘${esc(c.header)}’ 열을 무엇으로 읽을까요">${opts.map(([k, v]) => `<option value="${k}"${k === (c.field || "") ? " selected" : ""}>${v}</option>`).join("")}</select>
        <span class="ex">${esc((res.preview[0] || [])[i] ?? "")}</span>
        ${c.field && !c.sure ? `<span class="gtag">추측</span>` : ""}
      </div>`).join("");
    $("#map-dept").value = name.replace(/\.[^.]+$/, "").replace(/_.*$/, "");
    checkMap();
    $("#scrim").hidden = false; $("#mapper").hidden = false;
    $("#mapper select").focus();
  }
  function currentMapping() { return $$("#map-cols select").map((s) => s.value || null); }
  function checkMap() {
    const m = currentMapping();
    const miss = ["item", "qty", "amount"].filter((f) => !m.includes(f));
    const dupF = m.filter((f, i) => f && m.indexOf(f) !== i);
    const msg = miss.length ? `꼭 필요한 열을 골라 주세요: ${miss.map((f) => HJ.FIELD[f]).join(", ")}` : dupF.length ? `‘${HJ.FIELD[dupF[0]]}’을 두 열에 골랐어요` : "";
    $("#map-err").textContent = msg; $("#map-err").hidden = !msg;
    $("#map-ok").disabled = !!msg;
  }
  function closeMap() { $("#mapper").hidden = true; $("#scrim").hidden = true; mapping = null; nextMap(); }
  $("#map-cols").addEventListener("change", checkMap);
  $("#map-cancel").addEventListener("click", () => { toast(`${mapping.name}은 넣지 않았어요`); closeMap(); });
  $("#map-ok").addEventListener("click", () => {
    const m = currentMapping();
    const dept = $("#map-dept").value.trim();
    const r = HJ.tableToFiles(mapping.name, mapping.cells, { mapping: m, dept: m.includes("dept") ? undefined : dept });
    if (r.error) { $("#map-err").textContent = r.error; $("#map-err").hidden = false; return; }
    if ($("#map-remember").checked) state.mappings[mapping.key] = m;
    log("열 맞춤", r.files.map((f) => f.dept).join(", "), mapping.res.needMap.cols.map((c) => c.header).join(" · "), m.map((f) => (f ? HJ.FIELD[f] : "-")).join(" · "));
    commitFiles(r.files.map((f) => ({ ...f, mapped: true })));
    closeMap();
  });

  /** 다른 양식 파일로 시험해 보기: 제휴몰팀이 자기 양식(열 이름이 다름)으로 보낸 CSV */
  function trySample() {
    const csv = "매출일,영업 담당,거래처 이름,상품명칭,판매수량,판매 금액(VAT 포함)\n10/13,문채원,오렌지마켓,A4 용지(박스),30,\"780,000\"\n10/14,문채원,하나디자인,노트북 거치대,12,\"384,000\"\n10/16,백현우,누리교육,무선 키보드,20,\"780,000\"\n합계,,,,,\"1,944,000\"\n";
    addFiles([new File([csv], "제휴몰팀_10월3주_실적.csv", { type: "text/csv" })]);
  }

  /* ───────── 내려받기 ───────── */
  const HEADER = ["부서", "일자", "담당", "거래처", "품목", "수량", "금액"];
  function resultRows() {
    return analyze().used.map((x) => [x.f.dept, x.r.date, x.r.owner, x.r.client, x.r.item, toNum(x.r.qty), Number.isNaN(toNum(x.r.amount)) ? x.r.amount : toNum(x.r.amount)]);
  }
  const auditRows = () => [["시각", "확인자", "한 일", "위치", "전", "후"], ...state.audit.slice().reverse().map((l) => [l.t, l.who, l.act, l.where, l.before, l.after])];
  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  const toCsv = (rows) => "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  function downloadCSV() {
    saveBlob(new Blob([toCsv([HEADER, ...resultRows()])], { type: "text/csv;charset=utf-8" }), "다온오피스_10월3주_실적취합.csv");
    toast("CSV를 내려받았어요");
  }
  function downloadAuditCSV() {
    saveBlob(new Blob([toCsv(auditRows())], { type: "text/csv;charset=utf-8" }), "다온오피스_10월3주_검산기록.csv");
    toast("검산 기록을 CSV로 내려받았어요");
  }
  async function downloadXLSX() {
    try {
      const X = await loadXLSX();
      const a = analyze();
      const wb = X.utils.book_new();
      const sheet = (rows, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws["!cols"] = widths.map((w) => ({ wch: w })); return ws; };
      X.utils.book_append_sheet(wb, sheet([HEADER, ...resultRows()], [12, 8, 8, 12, 16, 6, 12]), "통합");
      X.utils.book_append_sheet(wb, sheet([["부서", "행", "보고 합계", "행 합계", "차이", "판정"], ...state.files.map((f) => [f.dept, f.rows.length, f.declared, a.perFile[f.id].sum, a.perFile[f.id].diff, a.perFile[f.id].diff === 0 ? "일치" : "확인 필요"])], [12, 6, 12, 12, 10, 10]), "부서별 검산");
      const cmp = HJ.compareWeeks(state.files, state.last, state.excluded);
      X.utils.book_append_sheet(wb, sheet([["부서", "지난주", "이번 주", "증감", "증감률(%)", "살펴볼 부서"], ...cmp.map((c) => [c.dept, c.last, c.now, c.diff, c.rate == null ? "" : Math.round(c.rate * 10) / 10, c.flag ? "예" : ""])], [12, 12, 12, 12, 10, 10]), "지난주 비교");
      X.utils.book_append_sheet(wb, sheet(auditRows(), [12, 18, 10, 26, 18, 18]), "검산 기록");
      X.writeFile(wb, "다온오피스_10월3주_실적취합.xlsx");
      log("내려받기", "엑셀 4시트", "", "통합 · 부서별 검산 · 지난주 비교 · 검산 기록"); save(); render();
      toast("엑셀 파일을 내려받았어요 (시트 4개)");
    } catch {
      downloadCSV();
      toast("엑셀 도구를 불러오지 못해 CSV로 내려받았어요");
    }
  }

  /* ───────── 이벤트 연결 ───────── */
  $("#files").addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    const del = e.target.closest("[data-del]");
    if (del) {
      const i = Number(del.dataset.del);
      const f = state.files[i];
      withUndo(`${f.dept} 파일을 뺐어요`, () => {
        const ids = new Set(f.rows.map((r) => r.id));
        log("파일 빼기", f.dept, `${f.rows.length}행`, "");
        state.files.splice(i, 1);
        state.excluded = state.excluded.filter((id) => !ids.has(id));
        state.current = Math.max(0, Math.min(state.current, state.files.length - 1));
        if (!state.files.length) { state.merged = false; view = "src"; }
      });
      return;
    }
    if (open) { state.current = Number(open.dataset.open); view = "src"; save(); render(); }
  });
  VIEWS.forEach((v) => $(`#tab-${v}`).addEventListener("click", () => { view = v; render(); }));
  $(".sheet-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const open = VIEWS.filter((v) => !$(`#tab-${v}`).disabled);
    const i = open.indexOf(view);
    view = open[(i + (e.key === "ArrowRight" ? 1 : open.length - 1)) % open.length];
    render(); $(`#tab-${view}`).focus();
  });
  $$(".filters button").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; render(); }));
  $("#merge").addEventListener("click", merge);
  $("#tape").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fix]");
    if (!b) return;
    if (b.dataset.fix === "dup") excludeDups(); else focusBad();
  });
  $("#ledger").addEventListener("click", (e) => {
    const ex = e.target.closest("[data-exclude]"), rs = e.target.closest("[data-restore]"), ty = e.target.closest("[data-typo]");
    if (ex) { const x = findRow(ex.dataset.exclude); withUndo("이 행을 제외했어요", () => { log("행 제외", `${x.f.dept} · ${x.r.item}`, `${won(toNum(x.r.amount))}원`, "제외"); state.excluded.push(ex.dataset.exclude); }); }
    if (rs) { const x = findRow(rs.dataset.restore); withUndo("행을 되살렸어요", () => { log("행 되살림", `${x.f.dept} · ${x.r.item}`, "제외", `${won(toNum(x.r.amount))}원`); state.excluded = state.excluded.filter((id) => id !== rs.dataset.restore); }); }
    if (ty) applyTypo(ty.dataset.typo);
  });
  // 장부 숫자 칸 고치기: Enter로 확정, Esc로 취소
  $("#ledger").addEventListener("keydown", (e) => {
    const td = e.target.closest("[data-edit]");
    if (!td) return;
    if (e.key === "Enter") { e.preventDefault(); td.blur(); }
    if (e.key === "Escape") { td.dataset.cancel = "1"; td.blur(); }
  });
  $("#ledger").addEventListener("focusout", (e) => {
    const td = e.target.closest("[data-edit]");
    if (!td) return;
    if (td.dataset.cancel) { render(); return; }
    const x = findRow(td.dataset.edit);
    const col = td.dataset.col, v = td.textContent.trim();
    if (!x || v === String(x.r[col]) || (Number.isFinite(toNum(v)) && toNum(v) === toNum(x.r[col]))) { render(); return; }
    if (Number.isNaN(toNum(v))) {
      toast(`“${v}”에는 숫자가 아닌 글자가 있어요`);
      x.r[col] = v; save(); render();
      return;
    }
    withUndo(`${COL_NAMES[col]}을 ${won(toNum(v))}${col === "amount" ? "원" : "개"}으로 고쳤어요`, () => {
      log("칸 수정", `${x.f.dept} ${x.f.rows.indexOf(x.r) + 2}행 ${COL_NAMES[col]}`, x.r[col], won(toNum(v)));
      x.r[col] = String(toNum(v));
      const left = analyze();
      if (filter === "issue" && !left.bad.size && !left.dupLeft.length) filter = "all";
    });
    const row = $(`tr[data-row="${x.r.id}"]`);
    if (row && !reduceMotion) row.classList.add("flash");
  });
  $("#who").addEventListener("change", (e) => { state.who = e.target.value.trim() || "이름 없음"; save(); toast(`확인자를 ‘${state.who}’로 바꿨어요`); });
  $("#dl-audit").addEventListener("click", downloadAuditCSV);
  $("#try-sample").addEventListener("click", trySample);

  // 파일 올리기: 여러 개 고르기 + 끌어다 놓기 (부서 파일 10개를 한 번에)
  $("#file").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) addFiles(fs); });
  const drop = $("#drop");
  let depth = 0;
  const showDrop = (on) => document.body.classList.toggle("dragging", on);
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const fs = [...e.dataTransfer.files]; if (fs.length) addFiles(fs); });
  // 화면 어디에 놓아도 받는다
  document.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { depth++; showDrop(true); } });
  document.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) showDrop(false); });
  document.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", (e) => { depth = 0; showDrop(false); if (e.target.closest("#drop")) return; const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });

  $("#dl-csv").addEventListener("click", downloadCSV);
  $("#dl-xlsx").addEventListener("click", downloadXLSX);
  $("#scrim").addEventListener("click", () => { if (mapping) $("#map-cancel").click(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && mapping) $("#map-cancel").click(); });
  $("#reset").addEventListener("click", () => {
    view = "src"; filter = "all";
    withUndo("샘플 데이터로 되돌렸어요", () => { state = fresh(); });
  });

  render();
})();
