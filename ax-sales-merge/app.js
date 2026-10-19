/* 한장 — 부서 실적 자동 취합·검산
 *
 * 흐름: 부서 파일(행 + 부서가 보고한 합계) → 취합 → 검산 테이프
 * 검산의 핵심은 "부서가 보고한 합계"와 "행을 더한 합계"를 맞춰 보는 것.
 *  - 같은 행을 두 번 붙여 넣으면 행 합계가 보고 합계보다 커진다 (중복 의심)
 *  - 금액에 글자가 섞이면 그 행이 빠져 행 합계가 작아진다 (형식 오류)
 * 둘 다 고치면 차이가 0이 되고 "검산 통과" 도장이 찍힌다.
 */
(() => {
  "use strict";

  const STORE_KEY = "hanjang:v2";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ───────── 샘플 데이터 (가상의 회사 다온오피스(주)) ───────── */
  const DEPTS = [
    ["영업1팀", ["김도윤", "이서연"], "08:12"],
    ["영업2팀", ["박지훈", "최유나"], "08:25"],
    ["영업3팀", ["정민재", "강하린"], "08:31"],
    ["온라인팀", ["조은비", "윤태오"], "08:36"],
    ["B2B팀", ["장서우", "임하준"], "08:40"],
    ["수도권지사", ["한지민", "오세훈"], "08:47"],
    ["영남지사", ["서예린", "신동현"], "08:52"],
    ["호남지사", ["권나은", "황준서"], "08:55"],
    ["충청지사", ["안소율", "송민기"], "08:58"],
    ["해외사업팀", ["류지안", "홍시우"], "09:41"],
  ];
  const CLIENTS = ["한빛상사", "대성테크", "미래물산", "서울푸드", "하나디자인", "코리아메디", "태양전자", "누리교육", "정우건설", "오렌지마켓", "바른회계", "동해물류"];
  const ITEMS = [["프린터 토너", 48000], ["A4 용지(박스)", 26000], ["모니터 27형", 289000], ["무선 키보드", 39000], ["사무용 의자", 159000], ["노트북 거치대", 32000], ["복합기 렌탈(월)", 120000], ["회의 테이블", 420000]];
  const DAYS = ["10/12", "10/13", "10/14", "10/15", "10/16"];
  const ROWS_PER = [4, 5, 4, 6, 5, 4, 5, 4, 5, 4];

  let seq = 0;
  const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

  function sampleFiles() {
    const files = DEPTS.map(([dept, people, at], d) => {
      const rows = [];
      for (let j = 0; j < ROWS_PER[d]; j++) {
        const [item, price] = ITEMS[(d * 3 + j * 2) % ITEMS.length];
        const qty = 2 + ((d * 7 + j * 5) % 17);
        rows.push({
          id: uid("r"), date: DAYS[(d + j) % 5], owner: people[j % 2],
          client: CLIENTS[(d * 2 + j) % CLIENTS.length], item, qty: String(qty), amount: String(qty * price),
        });
      }
      // 부서가 보고한 합계 (사고가 나기 전 올바른 합계)
      const declared = rows.reduce((s, r) => s + Number(r.amount), 0);
      return { id: uid("f"), dept, name: `${dept}_10월3주_실적.xlsx`, at, declared, rows, sample: true };
    });
    // 사고 1: 영업2팀이 같은 행을 두 번 붙여 넣었다
    files[1].rows.splice(2, 0, { ...files[1].rows[1], id: uid("r") });
    // 사고 2: 호남지사 금액에 영문 O가 섞였다 (1,590,000 → 1,59O,000)
    const hn = files[7].rows[2];
    hn.item = "사무용 의자"; hn.qty = "10"; hn.amount = "1,59O,000";
    files[7].declared = files[7].rows.reduce((s, r) => s + (r === hn ? 1590000 : Number(r.amount)), 0);
    return files;
  }

  /* ───────── 상태 + 저장 ───────── */
  const fresh = () => ({ files: sampleFiles(), excluded: [], merged: false, current: 0 });
  let state = load() || fresh();
  let view = "src";        // src | led
  let filter = "all";      // all | issue

  function load() {
    try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 저장 못 해도 화면은 동작 */ }
  }
  const snapshot = () => JSON.parse(JSON.stringify(state));

  /* ───────── 숫자·글자 도우미 ───────── */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // "1,590,000원" → 1590000, 숫자가 아닌 글자가 섞이면 NaN
  function toNum(v) {
    const s = String(v ?? "").replace(/[,\s원]/g, "");
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  const won = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "—");
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + won(Math.abs(n));
  const COLS = ["date", "owner", "client", "item", "qty", "amount"];
  const COL_NAMES = { date: "일자", owner: "담당", client: "거래처", item: "품목", qty: "수량", amount: "금액" };

  /* ───────── 검산 계산 ───────── */
  function analyze() {
    const all = [];
    state.files.forEach((f) => f.rows.forEach((r, i) => all.push({ ...r, f, idx: i })));
    const seen = new Map();
    const dup = new Set();
    for (const r of all) {
      const key = [r.f.dept, r.owner, r.client, r.item, toNum(r.qty), toNum(r.amount)].join("|");
      if (seen.has(key)) dup.add(r.id); else seen.set(key, r.id);
    }
    const bad = new Set(all.filter((r) => Number.isNaN(toNum(r.qty)) || Number.isNaN(toNum(r.amount))).map((r) => r.id));
    const ex = new Set(state.excluded);
    const used = all.filter((r) => !ex.has(r.id));
    const valid = used.filter((r) => !bad.has(r.id));
    const rowSum = valid.reduce((s, r) => s + toNum(r.amount), 0);
    const declared = state.files.reduce((s, f) => s + f.declared, 0);
    const exSum = all.filter((r) => ex.has(r.id) && !bad.has(r.id)).reduce((s, r) => s + toNum(r.amount), 0);
    const dupLeft = [...dup].filter((id) => !ex.has(id));
    const perFile = new Map(state.files.map((f) => {
      const s = f.rows.filter((r) => !ex.has(r.id) && !bad.has(r.id)).reduce((t, r) => t + toNum(r.amount), 0);
      return [f.id, { sum: s, diff: s - f.declared }];
    }));
    return { all, dup, bad, ex, used, valid, rowSum, declared, exSum, dupLeft, perFile, diff: rowSum - declared };
  }

  /* ───────── 그리기: 받은 파일 ───────── */
  const XL_ICON = `<svg class="xl" viewBox="0 0 22 26" aria-hidden="true"><rect x="1" y="1" width="20" height="24" rx="3" fill="#E2EEE7" stroke="#1F5C45" stroke-width="1.2"/><path d="M6 9h10M6 13h10M6 17h6" stroke="#1F5C45" stroke-width="1.4" stroke-linecap="round"/></svg>`;

  function renderFiles(a) {
    $("#file-count").textContent = state.files.length;
    const ul = $("#files");
    if (!state.files.length) {
      ul.innerHTML = `<li class="hint" style="padding:8px 4px">받은 파일이 없어요. 아래에서 파일을 추가하세요.</li>`;
      return;
    }
    ul.innerHTML = state.files.map((f, i) => {
      const pf = a.perFile.get(f.id);
      const late = f.at > "09:00";
      let mark = "";
      if (state.merged) mark = pf.diff === 0 ? `<span style="color:var(--green);font-weight:700">✓ 맞음</span>` : `<span class="late">${signed(pf.diff)}</span>`;
      return `<li class="file${state.merged ? " merged" : ""}" aria-current="${i === state.current && view === "src"}" data-i="${i}">
        <button class="open" type="button" data-open="${i}" aria-label="${esc(f.dept)} 파일 보기">
          ${XL_ICON}
          <span class="fn">${esc(f.dept)}</span>
          <span class="fa">${mark || `${f.rows.length}행`}<br><span class="${late ? "late" : ""}">${esc(f.at)}${late ? " 늦음" : ""}</span></span>
          <span class="fs">보고 ${won(f.declared)}원</span>
        </button>
        <button class="del" type="button" data-del="${i}" aria-label="${esc(f.dept)} 파일 빼기">✕</button>
      </li>`;
    }).join("");
  }

  /* ───────── 그리기: 원본 시트 ───────── */
  function renderSrc() {
    const f = state.files[state.current];
    const t = $("#src");
    if (!f) { t.innerHTML = `<tbody><tr><td style="padding:40px;text-align:center;color:var(--ink-3)">파일을 고르면 원본이 여기에 보여요.</td></tr></tbody>`; return; }
    const letters = ["", "A", "B", "C", "D", "E", "F"];
    t.innerHTML =
      `<thead><tr class="letters">${letters.map((l) => `<th${l ? "" : ' class="rn"'}>${l}</th>`).join("")}</tr>` +
      `<tr class="cols"><th class="rn">1</th>${COLS.map((c) => `<th class="${c === "qty" || c === "amount" ? "n" : ""}">${COL_NAMES[c]}</th>`).join("")}</tr></thead><tbody>` +
      f.rows.map((r, i) => `<tr><td class="rn">${i + 2}</td>${COLS.map((c) => {
        const isNum = c === "qty" || c === "amount";
        const v = isNum && Number.isFinite(toNum(r[c])) ? won(toNum(r[c])) : r[c];
        return `<td class="${isNum ? "n" : ""}">${esc(v)}</td>`;
      }).join("")}</tr>`).join("") +
      `<tr><td class="rn">${f.rows.length + 2}</td><td colspan="5" style="font-weight:700">합계 (부서 보고)</td><td class="n" style="font-weight:700">${won(f.declared)}</td></tr></tbody>`;
    $("#sheet-meta").textContent = `${f.name} · ${f.rows.length}행`;
  }

  /* ───────── 그리기: 통합 장부 ───────── */
  function renderLedger(a) {
    const issues = a.dupLeft.length + a.bad.size;
    $("#issue-n").textContent = issues;
    let rn = 1;
    let html = `<thead><tr class="cols"><th class="rn">#</th>${COLS.map((c) => `<th class="${c === "qty" || c === "amount" ? "n" : ""}">${COL_NAMES[c]}</th>`).join("")}<th class="st">상태</th></tr></thead><tbody>`;
    for (const f of state.files) {
      const rows = f.rows.filter((r) => filter === "all" || (a.dup.has(r.id) && !a.ex.has(r.id)) || a.bad.has(r.id) || (a.ex.has(r.id) && filter === "all"));
      if (!rows.length) continue;
      const pf = a.perFile.get(f.id);
      html += `<tr class="grp"><td class="rn"></td><td colspan="7">${esc(f.dept)} <span style="font-weight:500;color:var(--ink-3)">· ${esc(f.name)}</span></td></tr>`;
      for (const r of rows) {
        const isDup = a.dup.has(r.id), isBad = a.bad.has(r.id), isOff = a.ex.has(r.id);
        const cls = isOff ? "off" : isDup ? "dup" : "";
        let st = `<span class="pill ok">정상</span>`;
        if (isOff) st = `<span class="pill off">제외</span><button class="row-act" type="button" data-restore="${r.id}">되살리기</button>`;
        else if (isDup) st = `<span class="pill dup">중복 의심</span><button class="row-act" type="button" data-exclude="${r.id}">제외</button>`;
        else if (isBad) st = `<span class="pill bad">형식 오류</span>`;
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

  /* ───────── 그리기: 검산 테이프 ───────── */
  function renderTape(a, printing = false) {
    const tape = $("#tape");
    if (!state.merged) {
      tape.classList.remove("printing");
      tape.innerHTML = `<div class="tape-empty"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="6" width="28" height="36" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16h16M16 22h16M16 28h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><p>취합하면 이 종이에<br>검산 결과가 찍힙니다</p></div>`;
      return;
    }
    const now = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const ln = (k, v, cls = "", extra = "") => `<div class="ln ${cls}"><span class="k">${k}</span><span class="dots"></span><span class="v">${v}</span>${extra}</div>`;
    const firstDup = a.all.find((r) => a.dupLeft.includes(r.id));
    const firstBad = a.all.find((r) => a.bad.has(r.id));
    const dupAmt = a.all.filter((r) => a.dupLeft.includes(r.id)).reduce((s, r) => s + (toNum(r.amount) || 0), 0);
    const pass = a.diff === 0 && !a.dupLeft.length && !a.bad.size;
    let h = `<div class="hd">다온오피스 실적 검산</div><div class="sub">${esc(now)} · 10월 3주</div>`;
    h += ln("받은 파일", `${state.files.length}개`);
    h += ln("원본 행", `${a.all.length}행`);
    h += ln("부서 보고 합계", won(a.declared));
    h += `<hr class="cut">`;
    h += ln("중복 의심", a.dupLeft.length ? `${a.dupLeft.length}행` : "없음", a.dupLeft.length ? "minus" : "", a.dupLeft.length ? `<button type="button" data-fix="dup">제외</button>` : "");
    if (firstDup) h += `<div class="ln note">${esc(firstDup.f.dept)} · ${esc(firstDup.owner)} · ${esc(firstDup.item)} ${signed(dupAmt)}</div>`;
    h += ln("형식 오류", a.bad.size ? `${a.bad.size}칸` : "없음", a.bad.size ? "minus" : "", a.bad.size ? `<button type="button" data-fix="bad">고치기</button>` : "");
    if (firstBad) h += `<div class="ln note">${esc(firstBad.f.dept)} ${firstBad.idx + 2}행 금액 “${esc(firstBad.amount)}”</div>`;
    if (state.excluded.length) h += ln("제외한 행", `${state.excluded.length}행 · ${won(a.exSum)}`);
    h += `<hr class="cut">`;
    h += ln("취합 행", `${a.valid.length}행`);
    h += ln("행 합계", won(a.rowSum), "sum");
    h += ln("차이", a.diff === 0 ? "0" : signed(a.diff), a.diff === 0 ? "" : "minus");
    h += pass
      ? `<div class="stamp pass">검산 통과<small>보고 합계 = 행 합계</small></div>`
      : `<div class="stamp fail">확인 필요<small>${a.dupLeft.length + a.bad.size}건 남음</small></div>`;
    tape.innerHTML = h;
    // 한 줄씩 찍히는 효과: 사용자가 '취합'을 눌렀을 때만
    tape.classList.toggle("printing", printing && !reduceMotion);
    if (printing && !reduceMotion) {
      $$(".ln, .cut, .stamp", tape).forEach((el, i) => { el.style.animationDelay = `${i * 70}ms`; });
    }
  }

  /* ───────── 전체 다시 그리기 ───────── */
  function render(opts = {}) {
    const a = analyze();
    renderFiles(a);
    $("#tab-led").disabled = !state.merged;
    $("#tab-src").setAttribute("aria-selected", String(view === "src"));
    $("#tab-led").setAttribute("aria-selected", String(view === "led"));
    $("#sheet-src").hidden = view !== "src";
    $("#sheet-led").hidden = view !== "led";
    $$(".filters button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === filter)));
    if (view === "src") renderSrc(); else renderLedger(a);
    renderTape(a, opts.printing);
    const mb = $("#merge-bar");
    mb.hidden = state.merged && view === "led";
    $("#merge-title").textContent = state.files.length ? `${state.files.length}개 파일을 한 장으로 합칩니다` : "합칠 파일이 없어요";
    $("#merge").disabled = !state.files.length;
    $("#merge").textContent = state.merged ? "통합 장부 보기" : "취합하고 검산하기";
  }

  /* ───────── 알림 (되돌리기 지원) ───────── */
  let toastTimer = null;
  let undoFn = null;
  function toast(msg, undo) {
    $("#toast-t").textContent = msg;
    undoFn = undo || null;
    $("#toast-undo").hidden = !undo;
    $("#toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("on"), undo ? 5000 : 2200);
  }
  $("#toast-undo").addEventListener("click", () => {
    if (undoFn) undoFn();
    undoFn = null;
    $("#toast").classList.remove("on");
  });
  // 상태를 통째로 기억해 두었다가 되돌린다
  function withUndo(msg, change) {
    const before = snapshot();
    change();
    save(); render();
    toast(msg, () => { state = before; save(); render(); toast("되돌렸어요"); });
  }

  /* ───────── 취합: 파일이 장부로 빨려 들어가는 효과 ───────── */
  function merge() {
    if (!state.files.length) return;
    if (state.merged) { view = "led"; render(); return; }
    const target = $(".sheet-area").getBoundingClientRect();
    const finish = () => {
      state.merged = true; view = "led"; filter = "all"; save();
      render({ printing: true });
      const a = analyze();
      toast(a.dupLeft.length + a.bad.size ? `${a.dupLeft.length + a.bad.size}건을 확인해 주세요` : "검산을 통과했어요");
    };
    if (reduceMotion) return finish();
    const items = $$(".file > .open");
    items.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      if (r.width === 0) return;
      const fly = document.createElement("div");
      fly.className = "fly";
      fly.textContent = b.querySelector(".fn").textContent;
      Object.assign(fly.style, { left: `${r.left}px`, top: `${r.top}px` });
      document.body.appendChild(fly);
      const dx = target.left + target.width / 2 - r.left - 50;
      const dy = target.top + 60 - r.top;
      setTimeout(() => {
        fly.style.transform = `translate(${dx}px, ${dy}px) scale(.6)`;
        fly.style.opacity = "0";
      }, 20 + i * 45);
      setTimeout(() => fly.remove(), 700 + i * 45);
    });
    setTimeout(finish, 520 + items.length * 45);
  }

  /* ───────── 고치기 ───────── */
  function excludeDups() {
    const a = analyze();
    if (!a.dupLeft.length) return;
    withUndo(`중복 ${a.dupLeft.length}행을 제외했어요`, () => { state.excluded.push(...a.dupLeft); });
  }
  function focusBad() {
    const a = analyze();
    const r = a.all.find((x) => a.bad.has(x.id));
    if (!r) return;
    view = "led"; filter = "issue"; render();
    const col = Number.isNaN(toNum(r.amount)) ? "amount" : "qty";
    const cell = $(`[data-edit="${r.id}"][data-col="${col}"]`);
    if (cell) {
      cell.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      cell.focus();
      const sel = getSelection(); const rg = document.createRange(); rg.selectNodeContents(cell); sel.removeAllRanges(); sel.addRange(rg);
    }
    toast("빨간 칸의 글자를 숫자로 고쳐 주세요");
  }
  function findRow(id) {
    for (const f of state.files) { const r = f.rows.find((x) => x.id === id); if (r) return r; }
    return null;
  }

  /* ───────── 파일 읽기 (CSV · XLSX) ───────── */
  const HEAD = { 부서: "dept", 담당: "owner", 담당자: "owner", 거래처: "client", 품목: "item", 수량: "qty", 금액: "amount", 일자: "date", 날짜: "date" };
  function parseCSV(text) {
    return text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).map((line) => {
      const out = []; let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    });
  }
  // 표(2차원 배열) → 파일 객체. 문제가 있으면 { error } 를 돌려준다.
  function tableToFile(name, cells) {
    cells = cells.filter((r) => r.some((c) => String(c ?? "").trim()));
    if (!cells.length) return { error: "빈 파일이에요." };
    let map = null;
    const head = cells[0].map((c) => HEAD[String(c).trim()]);
    if (head.filter(Boolean).length >= 3) { map = head; cells = cells.slice(1); }
    else map = ["dept", "owner", "client", "item", "qty", "amount"]; // 머리글이 없으면 순서대로
    const need = ["dept", "item", "qty", "amount"].filter((k) => !map.includes(k));
    if (need.length) return { error: `필요한 열이 없어요: ${need.map((k) => ({ dept: "부서", item: "품목", qty: "수량", amount: "금액" }[k])).join(", ")}. 첫 줄에 열 이름을 적어 주세요.` };
    let declared = null;
    const rows = [];
    for (const c of cells) {
      const o = {}; map.forEach((k, i) => { if (k) o[k] = String(c[i] ?? "").trim(); });
      if (/합계|총계/.test(o.dept || "") || /합계|총계/.test(o.item || "")) { declared = toNum(o.amount); continue; }
      rows.push({ id: uid("r"), date: o.date || "", owner: o.owner || "", client: o.client || "", item: o.item || "", qty: o.qty || "", amount: o.amount || "", dept: o.dept });
    }
    if (!rows.length) return { error: "읽을 수 있는 행이 없어요." };
    const dept = rows[0].dept || name.replace(/\.[^.]+$/, "");
    rows.forEach((r) => delete r.dept);
    const rowSum = rows.reduce((s, r) => s + (toNum(r.amount) || 0), 0);
    const at = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    return { file: { id: uid("f"), dept, name, at, declared: Number.isFinite(declared) ? declared : rowSum, rows } };
  }

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

  async function addFromFile(file) {
    const err = $("#drop-err");
    err.hidden = true;
    let res;
    if (/\.csv$/i.test(file.name)) {
      res = tableToFile(file.name, parseCSV(await file.text()));
    } else if (/\.xlsx?$/i.test(file.name)) {
      try {
        const X = await loadXLSX();
        const wb = X.read(await file.arrayBuffer());
        res = tableToFile(file.name, X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false }));
      } catch {
        res = { error: "엑셀 읽기 도구를 불러오지 못했어요. 엑셀에서 ‘CSV로 저장’한 파일을 올려 주세요." };
      }
    } else {
      res = { error: "CSV나 엑셀(.xlsx) 파일만 올릴 수 있어요." };
    }
    if (res.error) { err.textContent = `${file.name} · ${res.error}`; err.hidden = false; return; }
    withUndo(`${res.file.dept} 파일 ${res.file.rows.length}행을 추가했어요`, () => {
      state.files.push(res.file);
      state.current = state.files.length - 1;
      view = "src";
    });
  }

  /* ───────── 내려받기 ───────── */
  function resultRows() {
    const a = analyze();
    return a.used.map((r) => [r.f.dept, r.date, r.owner, r.client, r.item, toNum(r.qty), Number.isNaN(toNum(r.amount)) ? r.amount : toNum(r.amount)]);
  }
  const HEADER = ["부서", "일자", "담당", "거래처", "품목", "수량", "금액"];
  function save_(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function downloadCSV() {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = "﻿" + [HEADER, ...resultRows()].map((r) => r.map(q).join(",")).join("\r\n");
    save_(new Blob([csv], { type: "text/csv;charset=utf-8" }), "다온오피스_10월3주_실적취합.csv");
    toast("CSV를 내려받았어요");
  }
  async function downloadXLSX() {
    try {
      const X = await loadXLSX();
      const a = analyze();
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([HEADER, ...resultRows()]), "통합");
      const by = state.files.map((f) => [f.dept, f.rows.length, f.declared, a.perFile.get(f.id).sum, a.perFile.get(f.id).diff]);
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["부서", "행", "보고 합계", "행 합계", "차이"], ...by]), "부서별 검산");
      X.writeFile(wb, "다온오피스_10월3주_실적취합.xlsx");
      toast("엑셀 파일을 내려받았어요 (시트 2개)");
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
        state.files.splice(i, 1);
        state.excluded = state.excluded.filter((id) => !ids.has(id));
        state.current = Math.max(0, Math.min(state.current, state.files.length - 1));
        if (!state.files.length) { state.merged = false; view = "src"; }
      });
      return;
    }
    if (open) { state.current = Number(open.dataset.open); view = "src"; save(); render(); }
  });
  $("#tab-src").addEventListener("click", () => { view = "src"; render(); });
  $("#tab-led").addEventListener("click", () => { if (state.merged) { view = "led"; render(); } });
  $(".sheet-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = view === "src" && state.merged ? "led" : "src";
    view = next; render(); $(next === "src" ? "#tab-src" : "#tab-led").focus();
  });
  $$(".filters button").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; render(); }));
  $("#merge").addEventListener("click", merge);
  $("#tape").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fix]");
    if (!b) return;
    if (b.dataset.fix === "dup") excludeDups(); else focusBad();
  });
  $("#ledger").addEventListener("click", (e) => {
    const ex = e.target.closest("[data-exclude]");
    const rs = e.target.closest("[data-restore]");
    if (ex) withUndo("이 행을 제외했어요", () => state.excluded.push(ex.dataset.exclude));
    if (rs) withUndo("행을 되살렸어요", () => { state.excluded = state.excluded.filter((id) => id !== rs.dataset.restore); });
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
    const r = findRow(td.dataset.edit);
    const v = td.textContent.trim();
    if (!r || v === String(r[td.dataset.col]) || (Number.isFinite(toNum(v)) && toNum(v) === toNum(r[td.dataset.col]))) { render(); return; }
    if (Number.isNaN(toNum(v))) {
      td.classList.add("bad");
      toast(`“${v}”에는 숫자가 아닌 글자가 있어요`);
      r[td.dataset.col] = v; save(); render();
      return;
    }
    const before = snapshot();
    r[td.dataset.col] = String(toNum(v));
    save();
    const left = analyze();
    if (filter === "issue" && !left.bad.size && !left.dupLeft.length) filter = "all";
    render();
    const row = $(`tr[data-row="${r.id}"]`);
    if (row && !reduceMotion) row.classList.add("flash");
    toast(`${COL_NAMES[td.dataset.col]}을 ${won(toNum(v))}${td.dataset.col === "amount" ? "원" : "개"}으로 고쳤어요`, () => { state = before; save(); render(); });
  });

  // 파일 올리기: 고르기 + 끌어다 놓기
  $("#file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) addFromFile(f); });
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) addFromFile(f); });

  $("#dl-csv").addEventListener("click", downloadCSV);
  $("#dl-xlsx").addEventListener("click", downloadXLSX);
  $("#reset").addEventListener("click", () => {
    view = "src"; filter = "all";
    withUndo("샘플 데이터로 되돌렸어요", () => { state = fresh(); });
  });

  render();
})();
