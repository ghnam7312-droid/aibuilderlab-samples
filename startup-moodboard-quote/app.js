/* 첫그림 — 화면 (DOM 다루기만 한다. 면적·견적·검사는 logic.js, AI 호출은 ai-client.js)
 *
 * 면적·범위·등급을 바꾸면 견적표와 회신 문장이 그 자리에서 다시 계산된다.
 * '무드보드 · 견적 만들기'를 누르면
 *   1) 메모의 단어로 스타일을 골라(규칙) 무드보드를 바로 보여 주고
 *   2) 연락처를 지운 메모를 Claude(moodboard.brief)에게 보내 스타일·색·첫 문단을 다시 받는다.
 *      형식이 틀리거나 금액이 섞여 오면 버리고 1)을 그대로 둔다.
 * 금액은 늘 logic.buildQuote 가 계산한다. AI는 금액을 만들지 않는다.
 */
(function () {
  "use strict";
  const L = window.Cheotgeurim;
  const STORE_KEY = "startup-moodboard-quote-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 고객 (가상의 인물) ---------- */
  const SAMPLES = [
    { name: "한서윤", space: "apt", value: 34, unit: "평", grade: "mid", scope: ["demo", "elec", "wall", "floor", "light", "bath", "kitchen"],
      memo: "34평 아파트, 아이 둘. 거실이 넓어 보였으면 좋겠고 원목 느낌을 좋아하심. 너무 하얀 건 차가워 보여서 싫다고.\n주방 상판 교체, 욕실 2개 모두. 입주는 12월 초 희망.\n연락처 010-2468-1357 (문자 선호)" },
    { name: "오민재", space: "villa", value: 59, unit: "㎡", grade: "basic", scope: ["wall", "floor", "film", "light", "bath"],
      memo: "빌라 59㎡, 혼자 사는 직장인. 모던하고 차분하게, 그레이 톤. 수납을 최대한 늘리고 싶어 함.\n주방은 그대로, 욕실만 교체. 예산은 아직 정하지 않음." },
    { name: "배지아", space: "shop", value: 18, unit: "평", grade: "mid", scope: ["demo", "elec", "wall", "floor", "light", "bath"],
      memo: "18평 상가, 작은 카페 창업 준비. 식물을 많이 두는 편안한 분위기, 초록 포인트 원함.\n화장실 1개 손님용으로 교체. 오픈 목표 2월. 메일 jia.cafe@example.com" },
  ];

  /* ---------- 상태 ---------- */
  function seed(i = 0) {
    const s = SAMPLES[i];
    return { sample: i, form: { name: s.name, space: s.space, value: s.value, unit: s.unit, grade: s.grade, scope: s.scope.slice(), memo: s.memo }, brief: L.ruleBrief(s.memo), mode: { kind: "rule", reason: "" } };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.form && Array.isArray(v.form.scope) && v.brief && Array.isArray(v.brief.palette)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed(0);
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;

  const m2 = () => L.toM2(st.form.value, st.form.unit);
  const quote = () => L.buildQuote({ m2: m2(), space: st.form.space, scope: st.form.scope, grade: st.form.grade });

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

  /* ---------- 입력 화면 ---------- */
  function buildForm() {
    $("space").innerHTML = Object.entries(L.SPACES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
    $("scope").innerHTML = L.ITEMS.map((it) => `<label class="chk"><input type="checkbox" value="${it.id}">${esc(it.name.replace(/ \(.+\)/, ""))}</label>`).join("");
    $("grade").innerHTML = L.GRADES.map(([k, n]) => `<button type="button" data-g="${k}">${n}</button>`).join("");
  }
  function fillForm() {
    const f = st.form;
    $("name").value = f.name; $("space").value = f.space; $("area").value = f.value; $("memo").value = f.memo;
    document.querySelectorAll("#scope input").forEach((c) => { c.checked = f.scope.includes(c.value); });
    renderSegs();
  }
  function renderSegs() {
    document.querySelectorAll("#unit button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.u === st.form.unit)));
    document.querySelectorAll("#grade button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.g === st.form.grade)));
    document.querySelectorAll("[data-sample]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.sample) === st.sample)));
  }
  function renderArea() {
    const a = m2();
    $("areaConv").innerHTML = a ? `견적은 <b>${L.areaLabel(a)}</b> 기준으로 계산해요` : "면적을 넣어 주세요";
    const ws = L.checkArea(st.form.value, st.form.unit, st.form.space, st.form.memo);
    $("areaWarn").innerHTML = ws.map((w, i) => `<div class="warn ${w.level === "err" ? "err" : ""}"><span>${esc(w.msg)}</span>${w.suggest ? `<button type="button" data-fix="${i}" aria-label="${esc(w.suggest.value + w.suggest.unit)}로 바꾸기">${esc(w.suggest.value + w.suggest.unit)} 적용</button>` : ""}</div>`).join("");
    $("areaWarn")._ws = ws;
    $("area").setAttribute("aria-invalid", String(!a));
  }

  /* ---------- 무드보드 ---------- */
  const pick = (pal, role, i) => (pal.find((p) => p.role === role) || pal[i] || pal[0]);
  function roomSvg(pal) {
    const wall = pick(pal, "벽", 0), floor = pick(pal, "바닥", 1), acc = pick(pal, "포인트", 2), fab = pick(pal, "패브릭", 3), met = pick(pal, "금속", 4), top = pick(pal, "상판", 5);
    const fp = floor.material === "wood"
      ? `<pattern id="fp" width="26" height="12" patternUnits="userSpaceOnUse"><rect width="26" height="12" fill="${floor.hex}"/><path d="M0 11.5h26M13 0v12" stroke="rgba(0,0,0,.12)" stroke-width="1"/></pattern>`
      : `<pattern id="fp" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="${floor.hex}"/><path d="M0 23.5h24M23.5 0v24" stroke="rgba(255,255,255,.55)" stroke-width="1.2"/></pattern>`;
    return `<svg class="room" viewBox="0 0 400 260" role="img" aria-label="${esc(`샘플 공간 그림: 벽 ${wall.name}, 바닥 ${floor.name}, 포인트 ${acc.name}`)}">
      <defs>${fp}</defs>
      <rect width="400" height="260" fill="${wall.hex}"/>
      <rect x="0" y="0" width="120" height="186" fill="${acc.hex}"/>
      <path d="M0 186 L400 186 L400 260 L0 260 Z" fill="url(#fp)"/>
      <path d="M0 186 L400 186" stroke="rgba(0,0,0,.12)" stroke-width="2"/>
      <rect x="236" y="38" width="118" height="92" rx="3" fill="#F7FAFC" stroke="rgba(0,0,0,.12)" stroke-width="3"/>
      <path d="M295 38v92M236 84h118" stroke="rgba(0,0,0,.10)" stroke-width="2"/>
      <rect x="150" y="192" width="200" height="8" rx="4" fill="rgba(0,0,0,.08)"/>
      <rect x="150" y="146" width="186" height="44" rx="10" fill="${fab.hex}" stroke="rgba(0,0,0,.08)"/>
      <rect x="140" y="160" width="206" height="32" rx="10" fill="${fab.hex}" stroke="rgba(0,0,0,.10)"/>
      <rect x="156" y="190" width="6" height="12" fill="${met.hex}"/><rect x="324" y="190" width="6" height="12" fill="${met.hex}"/>
      <rect x="60" y="214" width="96" height="9" rx="4" fill="${top.hex}" stroke="rgba(0,0,0,.12)"/>
      <rect x="104" y="222" width="8" height="26" fill="${met.hex}"/>
      <path d="M48 70h44l-8 22H56z" fill="${met.hex}"/><rect x="69" y="92" width="2.5" height="96" fill="${met.hex}"/><ellipse cx="70" cy="190" rx="16" ry="4" fill="${met.hex}"/>
      <circle cx="372" cy="170" r="16" fill="rgba(70,110,60,.75)"/><rect x="362" y="178" width="20" height="18" rx="3" fill="${top.hex}" stroke="rgba(0,0,0,.12)"/>
      <text x="12" y="250" font-size="10" fill="rgba(0,0,0,.4)" font-family="sans-serif">샘플 그림 · 실제 시공 사진 아님</text>
    </svg>`;
  }
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 고르는 중</span>`;
    if (st.mode.kind === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(st.mode.ms / 1000).toFixed(1)}초</span>`;
    if (st.mode.kind === "pick") return `<span class="mode" data-mode="pick">직접 고름</span>`;
    return `<span class="mode" data-mode="rule" title="메모의 단어로 스타일을 골랐어요">규칙 기반${st.mode.reason ? ` · ${esc(st.mode.reason)}` : ""}</span>`;
  }
  function renderMood() {
    const b = st.brief;
    $("modeChip").innerHTML = modeChip();
    $("styles").innerHTML = L.STYLES.map((s) => `<button type="button" data-style="${s.id}" aria-pressed="${s.id === b.styleId}"><i style="background:linear-gradient(135deg, ${s.palette[0][2]} 50%, ${s.palette[2][2]} 50%)"></i>${esc(s.name)}</button>`).join("");
    $("mood").classList.toggle("waiting", waiting);
    $("mood").innerHTML = `
      <div>${roomSvg(b.palette)}</div>
      <div>
        <p class="style-name">${esc(b.style)}</p>
        <ul class="kw" aria-label="키워드">${b.keywords.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
        <p class="intro">${esc(b.intro)}</p>
        <ul class="swatches" aria-label="색·재질 견본">${b.palette.map((p) => `<li class="sw"><div class="chip m-${p.material}" style="background-color:${p.hex}" aria-hidden="true"></div><div class="cap"><b>${esc(p.role)} · ${esc(p.name)}</b><span>${p.hex}</span></div></li>`).join("")}</ul>
      </div>`;
  }

  /* ---------- 견적 · 회신 ---------- */
  function renderQuote() {
    const q = quote();
    if (!q.m2) { $("quote").innerHTML = `<p class="empty">면적을 넣으면 견적 초안이 나와요.</p>`; return; }
    if (!q.lines.length) { $("quote").innerHTML = `<p class="empty">공사 범위를 하나 이상 골라 주세요.</p>`; return; }
    const gname = L.GRADES.find(([k]) => k === q.grade)[1];
    $("quote").innerHTML = `
      <p class="print-head">${esc(L.maskName(st.form.name))} 고객님 · ${esc(L.SPACES[st.form.space].name)} ${L.areaLabel(q.m2)} · ${gname} 등급 · 가상의 샘플 단가로 만든 견적 초안</p>
      <table class="qt">
        <thead><tr><th>항목</th><th class="n">수량</th><th class="n c-price">샘플 단가</th><th class="n">금액</th></tr></thead>
        <tbody>${q.lines.map((l) => `<tr><td>${esc(l.name)}${l.est ? `<span class="est">추정</span>` : ""}</td><td class="n">${l.qty.toLocaleString("ko-KR")}${l.unit}</td><td class="n c-price">${L.won(l.price)}</td><td class="n">${L.won(l.amount)}</td></tr>`).join("")}</tbody>
        <tfoot>
          <tr><td colspan="3">소계</td><td class="n">${L.won(q.subtotal)}</td></tr>
          <tr><td colspan="3">현장 관리·경비 (${Math.round(L.OVERHEAD * 100)}%)</td><td class="n">${L.won(q.overhead)}</td></tr>
          <tr><td colspan="3">부가세 (10%)</td><td class="n">${L.won(q.vat)}</td></tr>
          <tr class="sum"><td colspan="3">합계 (만 원 단위)</td><td class="n">${L.won(q.total)}</td></tr>
        </tfoot>
      </table>
      <p class="range">실측 전 초안이라 <b>${L.manwon(q.low)} ~ ${L.manwon(q.high)}</b> 범위로 안내해요. 수량은 모두 ${L.areaLabel(q.m2)}에서 나왔어요.</p>`;
  }
  function renderReply() {
    const q = quote();
    $("reply").textContent = q.m2 && q.lines.length
      ? L.replyText({ name: st.form.name, brief: st.brief, quote: q, scope: st.form.scope, space: st.form.space })
      : "면적과 공사 범위를 넣으면 회신 문장이 만들어져요.";
  }
  function renderAll() { renderSegs(); renderArea(); renderMood(); renderQuote(); renderReply(); }
  const live = () => { renderArea(); renderQuote(); renderReply(); save(); };

  /* ---------- 만들기 ---------- */
  async function make() {
    if (!m2()) { $("area").focus(); toast("면적을 먼저 넣어 주세요"); return; }
    const my = ++runToken;
    st.brief = L.ruleBrief(st.form.memo);
    st.mode = { kind: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderAll();
    const r = await AI.ask("moodboard.brief", {
      memo: L.scrub(st.form.memo).slice(0, 2000),
      space: L.SPACES[st.form.space].name,
      area: L.areaLabel(m2()),
      scope: L.scopeNames(st.form.scope),
      styles: L.STYLES.map((s) => s.name),
    });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 이 결과는 버린다
    waiting = false;
    const n = r && L.normalizeBrief(r.data);
    if (n) { st.mode = { kind: "ai", ms: r.ms }; st.brief = n; }
    else st.mode = { kind: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    save();
    renderAll();
    toast(`${st.mode.kind === "ai" ? "Claude가" : "규칙으로"} '${st.brief.style}' 무드보드를 만들었어요`);
  }

  /* ---------- 이벤트 ---------- */
  $("form").addEventListener("submit", (e) => { e.preventDefault(); make(); });
  $("name").addEventListener("input", (e) => { st.form.name = e.target.value; renderReply(); save(); });
  $("space").addEventListener("change", (e) => { st.form.space = e.target.value; live(); });
  $("area").addEventListener("input", (e) => { st.form.value = e.target.value.replace(/[^\d.]/g, ""); live(); });
  $("memo").addEventListener("input", (e) => { st.form.memo = e.target.value; renderArea(); save(); });
  $("scope").addEventListener("change", () => {
    st.form.scope = [...document.querySelectorAll("#scope input:checked")].map((c) => c.value);
    live();
  });
  // 단위만 바꾸면 같은 면적이 유지되도록 숫자를 따라 바꾼다
  $("unit").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-u]"); if (!b || b.dataset.u === st.form.unit) return;
    const a = m2();
    st.form.unit = b.dataset.u;
    if (a) st.form.value = st.form.unit === "평" ? L.toPy(a) : a;
    $("area").value = st.form.value;
    renderSegs(); live();
  });
  // 경고의 제안 단위로 바꾸기 (숫자는 그대로, 단위만 바로잡는다)
  $("areaWarn").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-fix]"); if (!b) return;
    const w = $("areaWarn")._ws[Number(b.dataset.fix)];
    const before = { value: st.form.value, unit: st.form.unit };
    st.form.value = w.suggest.value; st.form.unit = w.suggest.unit;
    $("area").value = st.form.value;
    renderSegs(); live();
    toast(`${L.areaLabel(m2())}로 바로잡았어요`, () => { Object.assign(st.form, before); $("area").value = before.value; renderSegs(); live(); });
  });
  $("grade").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-g]"); if (!b) return;
    st.form.grade = b.dataset.g; renderSegs(); live();
  });
  $("styles").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-style]"); if (!b || b.dataset.style === st.brief.styleId) return;
    const before = { brief: st.brief, mode: st.mode };
    const s = L.styleById(b.dataset.style);
    st.brief = { styleId: s.id, style: s.name, keywords: s.words.slice(), palette: L.paletteOf(s), intro: `상담 내용을 바탕으로 '${s.name}' 방향의 무드보드를 정리했어요.` };
    st.mode = { kind: "pick" };
    save(); renderMood(); renderReply();
    toast(`'${s.name}'로 바꿨어요`, () => { st.brief = before.brief; st.mode = before.mode; save(); renderMood(); renderReply(); });
  });
  document.querySelector(".samples").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sample]"); if (!b) return;
    const before = st;
    st = seed(Number(b.dataset.sample));
    fillForm(); make();
    toast(`샘플 고객 ${L.maskName(st.form.name)}님으로 바꿨어요`, () => { st = before; save(); fillForm(); renderAll(); });
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(0); fillForm(); make();
    toast("샘플로 되돌렸어요", () => { st = before; save(); fillForm(); renderAll(); });
  });
  $("copy").addEventListener("click", async () => {
    const txt = $("reply").textContent;
    try { await navigator.clipboard.writeText(txt); toast("회신 문장을 복사했어요. 이름은 가려져 있어요"); }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents($("reply"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      toast("선택해 두었어요. 직접 복사해 주세요");
    }
  });
  $("print").addEventListener("click", () => window.print());

  /* ---------- 시작 ---------- */
  buildForm();
  fillForm();
  renderAll();
  // 직접 고른 스타일이 저장돼 있으면 그대로 둔다
  AI.probe().then(() => { if (st.mode.kind !== "pick") make(); });
})();
