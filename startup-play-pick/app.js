/* 오늘놀이 — 화면 (DOM만 다룬다. 추천·안전 검사는 logic.js, AI 호출은 ai-client.js)
 *
 * '오늘 놀이 추천받기'를 누르면
 *   0) 걱정 메모에 건강·발달 이야기가 있으면 사람(의료진·전문가)에게 넘기는 안내를 먼저 띄운다.
 *   1) 강사 놀이 목록에서 규칙으로 바로 3개를 보여 주고 (기다리지 않게)
 *   2) Claude에게 같은 조건을 보내 다시 추천받는다. 돌아오면 안전 기준으로 거른 뒤 덮어쓴다.
 *      형식이 틀리거나 모두 걸러지면 1)을 그대로 둔다.
 */
(function () {
  "use strict";
  const L = window.Oneulnori;
  const STORE_KEY = "startup-play-pick-v1";
  const MINUTES = [10, 20, 30];
  const PLACES = ["실내", "실외", "상관없음"];
  const AREA_COLOR = { "대근육": "#E2583A", "소근육": "#C98A12", "언어": "#2C7BB6", "감각": "#2E9466", "정서·사회": "#9B4DB5" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());

  /* ---------- 상태 ---------- */
  function seed() {
    const t = today();
    // 지난 며칠 동안 한 놀이 (언어·대근육은 이미 해서 다른 영역이 먼저 나온다)
    const log = [
      { date: L.addDays(t, -1), title: "그림책 따라 말하기", area: "언어" },
      { date: L.addDays(t, -2), title: "공 굴려 주고받기", area: "대근육" },
      { date: L.addDays(t, -3), title: "상자 터널 기어가기", area: "대근육" },
      { date: L.addDays(t, -4), title: "동물 소리 흉내 놀이", area: "언어" },
    ];
    return {
      q: { months: 20, minutes: 20, place: "실내", materials: ["종이", "크레파스", "수건", "상자", "컵", "공", "그릇·냄비", "그림책", "페트병", "쌀·콩", "끈·리본"], note: "" },
      seed: 0, log, result: null,
    };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.q && Number.isFinite(v.q.months) && Array.isArray(v.q.materials) && Array.isArray(v.log)) { v.result = null; return v; }
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  // 걱정 메모는 저장하지 않는다 (민감할 수 있는 정보)
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ q: { ...st.q, note: "" }, seed: st.seed, log: st.log })); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;

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

  /* ---------- 왼쪽: 조건 ---------- */
  function renderAsk() {
    const q = st.q;
    $("months").value = q.months; $("monthsR").value = q.months;
    const y = Math.floor(q.months / 12), m = q.months % 12;
    $("mHint").textContent = `만 ${y}세${m ? ` ${m}개월` : ""} · 이 월령에서 빼는 기준: ${L.SAFETY.filter((r) => r.always || q.months < r.under).map((r) => r.label).join(", ")}`;
    $("minutes").innerHTML = MINUTES.map((n) => `<button type="button" data-min="${n}" aria-pressed="${q.minutes === n}">${n}분</button>`).join("");
    $("place").innerHTML = PLACES.map((p) => `<button type="button" data-place="${p}" aria-pressed="${q.place === p}">${p}</button>`).join("");
    $("mats").innerHTML = L.MATERIALS.map((m, i) => {
      const risky = !L.screen({ title: m, materials: [], steps: [] }, q.months).ok; // 이 월령에서 빠지는 재료는 표시만 한다
      return `<label class="mat${risky ? " risky" : ""}"><input type="checkbox" value="${esc(m)}" ${q.materials.includes(m) ? "checked" : ""} id="mat${i}"><span>${esc(m)}</span></label>`;
    }).join("");
    $("note").value = q.note || "";
  }
  function setMonths(v) {
    const n = Math.max(6, Math.min(72, Math.round(Number(v) || 0)));
    st.q.months = n; renderAsk(); save();
  }
  $("monthsR").addEventListener("input", (e) => setMonths(e.target.value));
  $("months").addEventListener("change", (e) => setMonths(e.target.value));
  $("minutes").addEventListener("click", (e) => { const b = e.target.closest("[data-min]"); if (!b) return; st.q.minutes = +b.dataset.min; renderAsk(); save(); });
  $("place").addEventListener("click", (e) => { const b = e.target.closest("[data-place]"); if (!b) return; st.q.place = b.dataset.place; renderAsk(); save(); });
  $("mats").addEventListener("change", () => { st.q.materials = [...$("mats").querySelectorAll("input:checked")].map((x) => x.value); save(); });
  $("note").addEventListener("input", (e) => { st.q.note = e.target.value; });

  function renderTriage(t) {
    const box = $("triage");
    box.hidden = t.level === "none";
    box.dataset.level = t.level;
    if (t.level === "urgent") box.innerHTML = `<b>놀이 추천보다 먼저 확인이 필요해요</b>‘${esc(t.word)}’ 같은 상황은 이 서비스가 판단하지 않아요. 아이 상태가 걱정되면 바로 <b>119</b> 또는 가까운 응급실에 연락하세요.`;
    else if (t.level === "consult") box.innerHTML = `<b>이 부분은 오늘놀이가 판단하지 않아요</b>건강·발달 고민은 소아청소년과나 발달 전문가와 상담해 주세요. 영유아 건강검진 때 물어보셔도 좋아요. 놀이 추천은 아래에 그대로 드려요.`;
  }

  /* ---------- 오른쪽: 결과 ---------- */
  function modeBadge() {
    const r = st.result;
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 고르는 중</span>`;
    if (r.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 추천 · ${(r.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 강사 놀이 목록에서 골랐어요">규칙 기반${r.reason ? ` · ${esc(r.reason)}` : ""}</span>`;
  }
  function playCard(p, i) {
    const done = st.log.some((e) => e.date === today() && e.title === p.title);
    return `<article class="play" style="--c:${AREA_COLOR[p.area] || "#888"}">
      <div class="p-h"><span class="no">${i + 1}</span><h3>${esc(p.title)}</h3>${p.by === "ai" ? `<span class="by">Claude</span>` : ""}</div>
      <div class="p-meta"><span class="area">${esc(p.area)}</span><span>${p.minutes}분</span><span>준비: ${p.materials.length ? p.materials.map(esc).join(", ") : "없음"}</span></div>
      <ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      ${p.tip ? `<p class="tip">${esc(p.tip)}</p>` : ""}
      ${p.check.cautions.map((c) => `<p class="caution"><b>${esc(c.label)}</b> ${esc(c.care)}</p>`).join("")}
      <div class="p-f"><span class="pass">안전 기준 통과</span><button type="button" class="ghost-btn sm" data-done="${i}" ${done ? "disabled" : ""}>${done ? "오늘 했어요 ✓" : "했어요"}</button></div>
    </article>`;
  }
  function renderOut() {
    const r = st.result;
    const box = $("out");
    if (!r) { box.innerHTML = `<div class="empty"><b>조건을 고르고 추천받기를 누르세요</b>월령에 맞고 안전 기준을 통과한 놀이만 보여 드려요.</div>`; return; }
    if (r.stopped) {
      box.innerHTML = `<div class="out-h"><h2>오늘의 놀이</h2></div><div class="empty stop"><b>추천을 멈췄어요</b>왼쪽 안내를 먼저 확인해 주세요. 아이가 괜찮아진 뒤 걱정 메모를 지우고 다시 눌러 주세요.</div>`;
      return;
    }
    const screened = r.screened;
    box.innerHTML = `<div class="out-h"><h2>오늘의 놀이 <small>${st.q.months}개월 · ${st.q.minutes}분 · ${esc(st.q.place)}</small></h2>${modeBadge()}</div>
      <p class="meta">조건에 맞는 놀이 ${r.pool}개 중 <b>${screened.length}개를 안전 기준으로 걸렀어요</b>${r.aiBlocked ? ` (Claude 추천 중 ${r.aiBlocked}개 포함)` : ""}.</p>
      <div class="plays ${waiting ? "waiting" : ""}">${r.picks.length ? r.picks.map(playCard).join("") : `<div class="empty">조건에 맞는 놀이가 없어요. 재료를 더 고르거나 시간을 늘려 보세요.</div>`}</div>
      <div class="out-tools">
        <button type="button" class="ghost-btn" id="again">다른 놀이 보기</button>
        <button type="button" class="dark" id="share" ${r.picks.length ? "" : "disabled"}>가족 단톡용으로 복사</button>
      </div>
      ${screened.length ? `<div class="screened"><h3>걸러낸 놀이 <span class="n">${screened.length}</span></h3><ul>${screened.map((p) => `<li><b>${esc(p.title)}</b>${p.by === "ai" ? `<span class="by">Claude</span>` : ""}<span>${p.check.blocked.map((b) => esc(L.blockReason(b))).join("<br>")}</span></li>`).join("")}</ul></div>` : ""}
      <details class="md" id="mdBox" hidden><summary>복사한 내용 보기</summary><pre id="mdOut"></pre></details>`;
  }
  $("out").addEventListener("click", async (e) => {
    const d = e.target.closest("[data-done]");
    if (d) {
      const p = st.result.picks[+d.dataset.done];
      const before = st.log;
      st.log = L.addLog(st.log, { date: today(), title: p.title, area: p.area });
      save(); renderOut(); renderLog();
      toast(`‘${p.title}’을(를) 기록했어요`, () => { st.log = before; save(); renderOut(); renderLog(); });
      return;
    }
    if (e.target.id === "again") { st.seed++; save(); run((st.result.picks || []).map((p) => p.title)); return; }
    if (e.target.id === "share") {
      const text = L.shareText(st.q, st.result.picks);
      try { await navigator.clipboard.writeText(text); toast("복사했어요. 가족 단톡에 붙여 넣으세요"); } catch (err) { toast("복사 권한이 없어 아래에 펼쳐 두었어요"); }
      $("mdBox").hidden = false; $("mdBox").open = true; $("mdOut").textContent = text;
    }
  });

  /* ---------- 추천 ---------- */
  async function run(exclude) {
    const my = ++runToken;
    const q = st.q;
    const t = today();
    const tri = L.triage(q.note);
    renderTriage(tri);
    if (tri.level === "urgent") { waiting = false; st.result = { stopped: true }; renderOut(); return; }
    const rule = L.recommend(L.CATALOG, q, st.seed, st.log, t, exclude);
    st.result = { ...rule, mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderOut();

    const r = await AI.ask("playpick.recommend", { ...L.aiInput(q, st.log, t), exclude: exclude || [] });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 버린다
    waiting = false;
    const plays = r && L.normalizePlays(r.data);
    const s = plays && L.screenAi(plays, q.months);
    if (s && s.usable) {
      st.result = { picks: s.picks, screened: [...s.screened, ...rule.screened], pool: rule.pool + plays.length, aiBlocked: s.screened.length, mode: "ai", ms: r.ms };
    } else {
      st.result.reason = !r ? (AI.status().reason || "AI 응답 없음") : !plays ? "응답 형식이 맞지 않음" : "추천이 모두 안전 기준에 걸림";
    }
    save(); renderOut();
  }
  $("ask").addEventListener("submit", (e) => { e.preventDefault(); st.seed = 0; run(); toast("안전 기준을 거친 놀이를 골랐어요"); });

  /* ---------- 이번 주 기록 ---------- */
  function renderLog() {
    const wa = L.weekAreas(st.log, today());
    const max = Math.max(3, ...Object.values(wa));
    $("bars").innerHTML = L.AREAS.map((a) => `<div class="bar-row"><span>${a}</span><i><b style="width:${(wa[a] / max) * 100}%;background:${AREA_COLOR[a]}"></b></i><em>${wa[a]}</em></div>`).join("");
    const week = st.log.filter((e) => e.date >= L.addDays(today(), -6)).slice().reverse();
    $("logSum").textContent = `최근 7일 ${week.length}회`;
    $("log").innerHTML = week.slice(0, 5).map((e) => `<li><span>${e.date.slice(5).replace("-", "/")}</span>${esc(e.title)}</li>`).join("") || `<li class="none">아직 기록이 없어요.</li>`;
  }

  /* ---------- 아이디어 검사 ---------- */
  function checkIdea() {
    const v = $("idea").value.trim();
    if (!v) { $("ideaOut").innerHTML = ""; return; }
    const c = L.screen({ title: v, materials: [], steps: [] }, st.q.months);
    $("ideaOut").innerHTML = !c.ok
      ? `<div class="verdict v-no"><b>${st.q.months}개월에는 빼요</b>${c.blocked.map((b) => esc(L.blockReason(b))).join("<br>")}</div>`
      : c.cautions.length ? `<div class="verdict v-care"><b>어른 곁에서 해요</b>${c.cautions.map((x) => esc(x.care)).join("<br>")}</div>`
      : `<div class="verdict v-ok"><b>목록에 걸리는 낱말이 없어요</b>그래도 처음 하는 놀이는 곁에서 지켜봐 주세요.</div>`;
  }
  $("ideaBtn").addEventListener("click", checkIdea);
  $("idea").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkIdea(); } });
  $("rules").innerHTML = L.SAFETY.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.always ? "항상" : r.under ? `${L.monthsLabel(r.under)} 미만` : "빼지 않음 · 주의"}</td><td>${r.words.slice(0, 6).map(esc).join(", ")}${r.words.length > 6 ? " 외" : ""}</td></tr>`).join("");

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); renderAsk(); renderLog(); run();
    $("idea").value = "쌀 촉감 놀이"; checkIdea();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAsk(); renderLog(); run(); });
  });

  /* ---------- 시작 ---------- */
  renderAsk(); renderLog();
  $("idea").value = "쌀 촉감 놀이"; checkIdea();
  // 규칙 결과를 먼저 보여 주고, AI 상태를 확인한 뒤 다시 추천한다
  st.result = { ...L.recommend(L.CATALOG, st.q, st.seed, st.log, today()), mode: "rule", reason: "" };
  renderOut();
  AI.probe().then(() => run());
})();
