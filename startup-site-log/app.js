/* 오늘공정 — 화면 (DOM 다루기만 한다. 폴더 검사·일지·공유 문구는 logic.js, AI 호출은 ai-client.js)
 *
 * 1) 현장 폴더를 고르고 사진을 올린다. 사진은 그 폴더로만 들어간다.
 * 2) 사진마다 공정·메모를 고치면 규칙 일지가 바로 다시 쓰인다.
 * 3) '일지 쓰기'를 누르면 Claude(sitelog.write)가 문장을 다듬는다. 형식이 틀리거나
 *    안전 확인 건에 '문제없다'고 쓰면 버리고 규칙 일지를 둔다.
 * 4) 고객에게 보이는 화면을 미리 보고, 공유 문구·링크를 만든다 (이름은 가리고, 주소는 넣지 않는다).
 */
(function () {
  "use strict";
  const L = window.OneulGongjeong;
  const STORE_KEY = "startup-site-log-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());

  /* ---------- 샘플 현장 (가상) ---------- */
  const SITES = [
    { id: "A", label: "A현장", name: "아파트 34평 전체", client: "한서윤", plan: ["철거", "설비", "전기", "목공", "타일", "도배", "바닥", "마감"] },
    { id: "B", label: "B현장", name: "빌라 59㎡ 부분", client: "오민재", plan: ["철거", "목공", "도배", "바닥", "마감"] },
    { id: "C", label: "C현장", name: "상가 18평 카페", client: "배지아", plan: ["철거", "전기", "목공", "타일", "도배", "마감"] },
  ];
  const siteOf = (id) => SITES.find((s) => s.id === id) || SITES[0];

  function seed() {
    const t = today(), y = L.addDays(t, -1), y2 = L.addDays(t, -2);
    let n = 0;
    const P = (site, date, time, process, note, file) => ({ id: `s${++n}`, site, date, time, process, note, file: file || `IMG_${3000 + n * 7}.jpg`, include: true });
    const photos = [
      P("A", y2, "09:10", "철거", "거실·주방 철거 완료, 폐기물 반출"),
      P("A", y2, "14:20", "철거", "욕실 2곳 기존 타일 철거"),
      P("A", y, "10:00", "설비", "욕실 급수·배수 배관 교체"),
      P("A", y, "13:30", "전기", "주방 콘센트 2구 추가 배선"),
      P("A", y, "16:00", "목공", "거실 천장틀 보강"),
      P("A", t, "08:40", "설비", "욕실 방수 1차 바름, 24시간 양생"),
      P("A", t, "09:30", "타일", "욕실 벽 타일 붙이기 시작 (300×600 그레이)"),
      P("A", t, "11:10", "타일", "주방 벽 타일 절반 완료"),
      P("A", t, "13:20", "전기", "거실 매입등 위치 표시"),
      P("A", t, "14:20", "도배", "작은방 초배 작업", "B현장_도배_1420.jpg"), // 다른 현장 사진이 섞여 들어온 예
      P("A", t, "15:00", "설비", "안방 욕실 배관 연결부 누수 의심 자국"),
      P("B", y, "15:30", "목공", "현관 걸레받이 교체"),
      P("B", t, "11:00", "도배", "거실 벽지 시공 (아이보리)"),
      P("C", y, "10:00", "철거", "기존 카운터·선반 철거"),
      P("C", t, "10:40", "전기", "카운터 하부 콘센트 배선"),
      P("C", t, "14:10", "목공", "벽 선반 자리 보강"),
    ];
    return { site: "A", date: t, photos, logs: {}, view: "mine", salt: Math.random().toString(36).slice(2, 8) };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.photos) && v.logs && typeof v.site === "string") return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  const urls = {}; // 직접 올린 사진의 미리보기 (이 브라우저 안에서만, 저장하지 않음)
  let waiting = false;
  let runToken = 0;

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  const snapshot = () => JSON.parse(JSON.stringify(st));
  const key = () => `${st.site}|${st.date}`;
  const site = () => siteOf(st.site);
  const dates = () => [...new Set(st.photos.filter((p) => p.site === st.site).map((p) => p.date).concat(today()))].sort();

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 샘플 그림 (현장 사진 대신) ---------- */
  function scene(proc, i) {
    const k = (i * 37) % 5;
    const wall = ["#D9D4CC", "#CFC9BF", "#DCD8D1", "#D3CEC6", "#E0DBD3"][k];
    const base = `<rect width="160" height="120" fill="${wall}"/><rect y="86" width="160" height="34" fill="#A9A39A"/>`;
    const art = {
      철거: `<path d="M20 20h50v40H20z" fill="#BDB6AC"/><path d="M28 30l12 8-6 10 14 4" stroke="#8B8378" stroke-width="2" fill="none"/><path d="M84 96l14-14 12 10 16-8 12 12H84z" fill="#857D72"/><rect x="100" y="70" width="16" height="12" fill="#6F675D"/>`,
      설비: `<rect y="86" width="160" height="34" fill="#5E8C7A"/><path d="M30 10v60h70v-40" stroke="#5A7A8C" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M120 10v76" stroke="#C9CDD0" stroke-width="6"/><circle cx="100" cy="30" r="6" fill="#3F5A6A"/>`,
      전기: `<path d="M14 24c30 0 30 20 60 20s30-16 72-16" stroke="#E38B2C" stroke-width="3" fill="none"/><path d="M14 34c40 0 40 26 70 26" stroke="#E2C23B" stroke-width="3" fill="none"/><rect x="80" y="52" width="16" height="20" rx="2" fill="#F4F4F2" stroke="#8C8C8C"/><rect x="118" y="20" width="16" height="16" rx="2" fill="#F4F4F2" stroke="#8C8C8C"/>`,
      목공: `<g fill="#C9A06A" stroke="#9B7647"><rect x="20" y="10" width="8" height="76"/><rect x="60" y="10" width="8" height="76"/><rect x="100" y="10" width="8" height="76"/><rect x="140" y="10" width="8" height="76"/><rect x="20" y="10" width="128" height="7"/><rect x="20" y="48" width="128" height="6"/></g>`,
      타일: `<rect x="0" y="0" width="96" height="86" fill="#9EA3A6"/><g stroke="#E8E9EA" stroke-width="2"><path d="M0 22h96M0 44h96M0 66h96M32 0v86M64 0v86M16 22v22M48 22v22M80 22v22M16 66v20M48 66v20M80 66v20"/></g><rect x="110" y="62" width="30" height="20" fill="#7D858A"/>`,
      도배: `<rect x="0" y="0" width="92" height="86" fill="#EFE9DC"/><g stroke="#E1D8C6" stroke-width="1"><path d="M30 0v86M61 0v86"/></g><rect x="104" y="20" width="14" height="66" fill="#F3EEE4" stroke="#CFC6B6"/><circle cx="111" cy="20" r="7" fill="#E4DCCB" stroke="#CFC6B6"/>`,
      바닥: `<rect y="70" width="160" height="50" fill="#B98A5E"/><g stroke="#946B45" stroke-width="1.2"><path d="M0 80h160M0 92h160M0 106h160M30 70v10M80 80v12M120 92v14M50 106v14"/></g>`,
      마감: `<rect x="40" y="18" width="80" height="50" rx="2" fill="#F6F8F9" stroke="#C7CCCF" stroke-width="3"/><path d="M80 18v50M40 43h80" stroke="#D5DADD" stroke-width="2"/><circle cx="20" cy="14" r="8" fill="#F2D488"/>`,
    }[proc] || `<rect x="58" y="42" width="44" height="32" rx="5" fill="#fff"/><circle cx="80" cy="58" r="9" fill="#9AA6AB"/>`;
    return `<svg viewBox="0 0 160 120" role="img" aria-label="${esc(proc || "현장")} 샘플 그림">${base}${art}<text x="154" y="114" text-anchor="end" font-size="8" fill="rgba(0,0,0,.45)" font-family="sans-serif">샘플 그림</text></svg>`;
  }
  const pic = (p, i) => (urls[p.id] ? `<img src="${urls[p.id]}" alt="${esc(p.file)}">` : scene(p.process, i));

  /* ---------- 일지 ---------- */
  function ruleNow() { return L.ruleLog(site(), st.date, st.photos, site().plan); }
  function current() { return st.logs[key()] || { log: ruleNow(), mode: { kind: "rule", reason: "" } }; }
  function flagsOf() { return L.shareable(st.photos, st.site, st.date).map((p) => L.safetyFlag(p.note)).filter(Boolean); }
  /** 사진을 고치면 규칙 일지로 다시 쓴다 (Claude는 '일지 쓰기'를 눌렀을 때만) */
  function photosChanged() { delete st.logs[key()]; save(); renderAll(); }

  /* ---------- 그리기 ---------- */
  function renderFolders() {
    $("folders").innerHTML = SITES.map((s) => {
      const mine = st.photos.filter((p) => p.site === s.id);
      const bad = mine.filter((p) => L.photoIssues(p, s.id).some((i) => i.kind === "mixed")).length;
      return `<button type="button" class="folder" data-site="${s.id}" aria-current="${s.id === st.site}">
        <svg viewBox="0 0 30 26" aria-hidden="true"><path d="M1 4a3 3 0 0 1 3-3h7l3 3h12a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3z" fill="${s.id === st.site ? "#17708C" : "#9FB3BA"}"/><text x="15" y="19" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="sans-serif">${s.id}</text></svg>
        <span class="fx"><b>${esc(s.label)}</b><small>${esc(s.name)} · ${esc(L.maskName(s.client))} 고객</small></span>
        ${bad ? `<span class="cnt bad">확인 ${bad}</span>` : ""}<span class="cnt">${mine.length}장</span></button>`;
    }).join("");
  }
  function renderPhotos() {
    const ds = dates();
    const i = ds.indexOf(st.date);
    $("dayLabel").textContent = `${L.withDay(st.date)}${st.date === today() ? " 오늘" : ""}`;
    $("prevDay").disabled = i <= 0;
    $("nextDay").disabled = i >= ds.length - 1;
    $("upSite").textContent = site().label;
    $("upLabel").textContent = `${site().label} 폴더에 사진 올리기`;
    const list = st.photos.filter((p) => p.site === st.site && p.date === st.date).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    if (!list.length) { $("pgrid").innerHTML = `<p class="empty">이 날짜에 올린 사진이 없어요. 위 버튼이나 끌어 놓기로 올려 주세요.</p>`; return; }
    $("pgrid").innerHTML = list.map((p, n) => {
      const iss = L.photoIssues(p, st.site);
      const mixed = iss.find((x) => x.kind === "mixed");
      return `<article class="ph${mixed ? " held" : ""}${p.include === false ? " off" : ""}" data-id="${esc(p.id)}">
        <div class="thumb">${pic(p, n)}${p.time ? `<span class="t">${esc(p.time)}</span>` : ""}</div>
        <div class="ph-b">
          <span class="fn" title="${esc(p.file)}">${esc(p.file)}</span>
          ${iss.length ? `<div class="iss">${iss.map((x) => `<span class="${x.kind}">${esc(x.msg)}</span>`).join("")}</div>` : ""}
          ${mixed ? `<button type="button" class="mv-btn" data-move="${mixed.code}">${mixed.code}현장 폴더로 옮기기</button>` : ""}
          <label class="sr" for="pr-${esc(p.id)}">공정</label>
          <select id="pr-${esc(p.id)}" data-k="process"><option value="">공정 고르기</option>${L.PROCESSES.map((x) => `<option${x === p.process ? " selected" : ""}>${x}</option>`).join("")}</select>
          <label class="sr" for="nt-${esc(p.id)}">메모</label>
          <input type="text" id="nt-${esc(p.id)}" data-k="note" value="${esc(p.note)}" placeholder="한 줄 메모 (예: 욕실 방수 1차)">
          ${mixed ? `<span class="fn">다른 현장 의심이라 공유에서 빠져요</span>` : `<label class="inc"><input type="checkbox" data-k="include"${p.include !== false ? " checked" : ""}>일지에 넣기</label>`}
        </div></article>`;
    }).join("");
  }
  function renderSteps() {
    const pr = L.progress(st.photos, st.site, st.date, site().plan);
    $("steps").innerHTML = pr.order.map((p) => {
      const c = pr.today.includes(p) ? "today" : pr.done.includes(p) ? "done" : p === pr.next ? "next" : "";
      const sr = c === "today" ? " (오늘)" : c === "done" ? " (끝남)" : c === "next" ? " (다음)" : "";
      return `<li class="${c}">${p}<span class="sr">${sr}</span></li>`;
    }).join("");
  }
  function modeChip(m) {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    if (m.kind === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(m.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="공정별로 사진 메모를 묶었어요">규칙 기반${m.reason ? ` · ${esc(m.reason)}` : ""}</span>`;
  }
  function renderLog() {
    const { log, mode } = current();
    $("modeChip").innerHTML = modeChip(mode);
    $("viewMine").setAttribute("aria-pressed", String(st.view === "mine"));
    $("viewClient").setAttribute("aria-pressed", String(st.view === "client"));
    $("logBody").classList.toggle("waiting", waiting);
    if (!log.count) { $("logBody").innerHTML = `<p class="empty">공유할 사진이 없어요. 사진을 올리거나 ‘일지에 넣기’를 켜 주세요.</p>`; return; }
    if (st.view === "client") {
      const pics = L.shareable(st.photos, st.site, st.date);
      $("logBody").innerHTML = `<div class="phone" aria-label="고객에게 보이는 화면"><pre>${esc(L.shareText(site(), st.date, log, flagsOf()))}</pre>
        <div class="pics">${pics.slice(0, 8).map((p, i) => pic(p, i)).join("")}</div></div>`;
      return;
    }
    $("logBody").innerHTML = `<p class="sum">${esc(log.summary)}</p>
      <ul class="items">${log.items.map((x) => `<li><span class="p">${esc(x.process)}</span><span>${esc(x.done)}${x.next ? ` <span class="nx">→ ${esc(x.next)}</span>` : ""}${x.flag ? `<br><span class="flag">${esc(x.flag)} · 담당자 확인 필요 (고객에게는 ‘확인 중’으로)</span>` : ""}</span></li>`).join("")}</ul>
      <p class="kv"><b>다음 작업</b>${esc(log.next)}</p>
      ${log.ask ? `<p class="kv"><b>고객 확인</b>${esc(log.ask)}</p>` : ""}
      <p class="kv"><b>공유 사진</b>${log.count}장</p>`;
  }
  function renderAll() { renderFolders(); renderPhotos(); renderSteps(); renderLog(); }

  /* ---------- 일지 쓰기 ---------- */
  async function write() {
    const rule = ruleNow();
    if (!rule.count) { toast("공유할 사진이 없어요"); return; }
    const my = ++runToken;
    const k = key();
    st.logs[k] = { log: rule, mode: { kind: "rule", reason: "" } };
    waiting = AI.status().enabled !== false;
    renderLog();
    const list = L.shareable(st.photos, st.site, st.date);
    const allowed = [...new Set(list.map((p) => p.process).filter(Boolean))];
    const flags = flagsOf();
    const r = await AI.ask("sitelog.write", {
      site: site().name,
      date: L.withDay(st.date),
      photos: list.map((p) => ({ time: p.time, process: p.process, note: L.safetyFlag(p.note) ? "안전 확인 필요 (담당자가 판단, 내용 생략)" : p.note })),
      next: rule.next,
      safety: flags.length,
    });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 이 결과는 버린다
    waiting = false;
    const n = r && L.normalizeLog(r.data, allowed, flags.length > 0);
    st.logs[k] = n ? { log: L.mergeAi(rule, n), mode: { kind: "ai", ms: r.ms } } : { log: rule, mode: { kind: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") } };
    save();
    if (k === key()) renderLog();
    toast(`${n ? "Claude가" : "규칙으로"} ${site().label} ${L.withDay(st.date)} 일지를 썼어요`);
  }

  /* ---------- 이벤트 ---------- */
  $("folders").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-site]"); if (!b) return;
    st.site = b.dataset.site;
    if (!dates().includes(st.date)) st.date = dates().slice(-1)[0];
    $("linkOut").hidden = true;
    save(); renderAll();
  });
  $("prevDay").addEventListener("click", () => { const ds = dates(); st.date = ds[Math.max(0, ds.indexOf(st.date) - 1)]; save(); renderAll(); });
  $("nextDay").addEventListener("click", () => { const ds = dates(); st.date = ds[Math.min(ds.length - 1, ds.indexOf(st.date) + 1)]; save(); renderAll(); });
  $("pgrid").addEventListener("change", (e) => {
    const el = e.target.closest("[data-k]"); if (!el) return;
    const p = st.photos.find((x) => x.id === el.closest(".ph").dataset.id); if (!p) return;
    if (el.dataset.k === "include") p.include = el.checked;
    else p[el.dataset.k] = el.value.trim();
    if (el.dataset.k === "note" && !p.process) p.process = L.guessProcess(p.note);
    photosChanged();
  });
  $("pgrid").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-move]"); if (!b) return;
    const id = b.closest(".ph").dataset.id;
    const before = snapshot();
    const i = st.photos.findIndex((x) => x.id === id);
    st.photos[i] = L.moveTo(st.photos[i], b.dataset.move);
    photosChanged();
    toast(`${b.dataset.move}현장 폴더로 옮겼어요`, () => { st = before; save(); renderAll(); });
  });
  function addFiles(fileList) {
    const files = [...fileList].filter((f) => !f.type || f.type.startsWith("image/"));
    if (!files.length) return;
    const before = snapshot();
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const added = L.assignUploads(files, st.site, st.date, time);
    added.forEach((p, i) => { try { urls[p.id] = URL.createObjectURL(files[i]); } catch (err) { /* 미리보기 없이 그림으로 */ } });
    st.photos.push(...added);
    photosChanged();
    const held = added.filter((p) => p.held).length;
    toast(`${added.length}장을 ${site().label} 폴더에 올렸어요${held ? ` · ${held}장은 다른 현장 이름이라 보류` : ""}`, () => { st = before; save(); renderAll(); });
  }
  $("files").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  const up = document.querySelector(".upload");
  up.addEventListener("dragover", (e) => { e.preventDefault(); up.classList.add("over"); });
  up.addEventListener("dragleave", () => up.classList.remove("over"));
  up.addEventListener("drop", (e) => { e.preventDefault(); up.classList.remove("over"); addFiles(e.dataTransfer.files); });

  $("write").addEventListener("click", write);
  $("viewMine").addEventListener("click", () => { st.view = "mine"; save(); renderLog(); });
  $("viewClient").addEventListener("click", () => { st.view = "client"; save(); renderLog(); });
  $("copy").addEventListener("click", async () => {
    const { log } = current();
    if (!log.count) { toast("공유할 사진이 없어요"); return; }
    const txt = L.shareText(site(), st.date, log, flagsOf());
    try { await navigator.clipboard.writeText(txt); toast("공유 문구를 복사했어요. 이름은 가려져 있어요"); }
    catch (e) { st.view = "client"; renderLog(); toast("고객 화면에서 직접 복사해 주세요"); }
  });
  $("link").addEventListener("click", async () => {
    const tok = L.shareToken(st.site, st.date, st.salt);
    const url = `${location.origin}${location.pathname}#view=${tok}`;
    $("linkOut").hidden = false;
    $("linkOut").textContent = `${url} — 주소에는 이름·현장 위치가 들어가지 않아요. 이 데모에서는 같은 브라우저에서 열면 고객 화면이 보여요.`;
    try { await navigator.clipboard.writeText(url); toast("공유 링크를 복사했어요"); } catch (e) { toast("링크를 만들었어요"); }
  });
  $("reset").addEventListener("click", () => {
    const before = snapshot();
    st = seed(); save(); $("linkOut").hidden = true; renderAll();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  // 공유 링크로 들어오면 그 현장·날짜의 고객 화면을 연다
  const m = location.hash.match(/^#view=([0-9a-f]{8})$/);
  if (m) {
    for (const s of SITES) for (const d of [...new Set(st.photos.filter((p) => p.site === s.id).map((p) => p.date))]) {
      if (L.shareToken(s.id, d, st.salt) === m[1]) { st.site = s.id; st.date = d; st.view = "client"; }
    }
  }
  if (!dates().includes(st.date)) st.date = today();
  renderAll();
  AI.probe().then(() => { if (!st.logs[key()]) write(); });
})();
