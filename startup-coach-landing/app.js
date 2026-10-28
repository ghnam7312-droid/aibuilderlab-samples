/* 다음걸음 — 화면 (DOM 다루기만 한다. 계산·과장 검사·실험 판단은 logic.js, AI 호출은 ai-client.js)
 *
 * '새 문구 만들기'를 누르면
 *   1) 상품 구성으로 규칙 문구를 바로 넣고 (기다리지 않게)
 *   2) Claude에게 상품과 '게시 동의한 후기'만 보내 문구를 받는다. 형식이 틀리면 버린다.
 *   3) 어느 쪽이든 과장 표현 검사(cleanCopy)를 거친 뒤에만 B안에 들어간다.
 */
(function () {
  "use strict";
  const L = window.Daeumgeoleum;
  const STORE_KEY = "startup-coach-landing-v1";
  const SINGLE = 80000;
  const INCLUDES = ["회차마다 과제 피드백", "이력서·포트폴리오 첨삭 2회", "모의 면접 1회", "4주 뒤 점검 메시지", "상담 요약 리포트"];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 (후기·숫자 모두 가상) ---------- */
  function seed() {
    return {
      pack: { sessions: 4, price: 280000, includes: INCLUDES.slice(0, 3) },
      A: { headline: "1회 커리어 상담 · 60분", sub: "이력서와 고민을 듣고 방향을 함께 정리합니다. 80,000원", bullets: ["전 HR 담당자 코치", "상담 후 요약 리포트"], cta: "상담 예약하기" },
      // 지난번 AI 초안: 과장 표현이 그대로 남아 있다
      B: { headline: "4주 만에 합격 보장! 직무 전환 코칭", sub: "100% 맞춤 코칭으로 누구나 원하는 직무로", bullets: ["업계 최고의 HR 출신 코치", "연봉 2배 상승 사례 다수", "회차마다 과제 피드백"], cta: "지금 바로 합격하기" },
      reviews: [
        { id: "r1", who: "김○○ · 교직원 → HR", text: "4주 동안 매주 과제가 있어서 미루지 않았어요. 이력서 첫 문단을 세 번 고쳤습니다.", consent: true },
        { id: "r2", who: "박○○ · 매장 매니저 → 서비스 기획", text: "제 경험을 기획 언어로 바꾸는 법을 배웠고, 면접에서 그대로 썼어요.", consent: true },
        { id: "r3", who: "이○○ · QA → 데이터 분석", text: "포트폴리오 주제를 같이 좁혀 준 게 가장 도움이 됐어요.", consent: false },
      ],
      ab: { A: { visitors: 1240, apps: 26 }, B: { visitors: 1180, apps: 52 } },
      view: "B", ai: { mode: "rule", reason: "지난번 AI 초안" }, replaced: [], published: null,
    };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.pack && v.A && v.B && Array.isArray(v.reviews) && v.ab) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false, runToken = 0;

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

  /* ---------- 고객 여정 · 상품 ---------- */
  function renderJourney() {
    const m = L.packageMath(SINGLE, st.pack);
    const steps = [["알게 됨", "블로그 · 커뮤니티 글"], ["1회 상담", `${L.won(SINGLE)} · 60분`], [`${m.sessions}주 패키지`, `${L.won(m.price)} · 회당 ${L.won(m.per)}`], ["사후 점검", "끝나고 4주 뒤 메시지"]];
    $("journey").innerHTML = steps.map(([t, s], i) => `<li class="${i === 2 ? "new" : ""}"><b>${esc(t)}</b><span>${esc(s)}</span>${i === 2 ? `<em>새 상품</em>` : ""}</li>`).join("");
  }
  function fillProd() {
    $("sessions").value = st.pack.sessions; $("price").value = st.pack.price;
    $("incl").innerHTML = `<legend class="fld">포함 항목</legend>` + INCLUDES.map((x, i) => `<label><input type="checkbox" value="${i}" ${st.pack.includes.includes(x) ? "checked" : ""}>${esc(x)}</label>`).join("");
  }
  function renderMath() {
    const m = L.packageMath(SINGLE, st.pack);
    $("math").innerHTML = `<div><span>회당</span><b>${L.won(m.per)}</b></div><div><span>1회 상담 ${m.sessions}번</span><b>${L.won(SINGLE * m.sessions)}</b></div>
      <p class="${m.cheaper ? "good" : "warn"}">${m.cheaper ? `1회 상담보다 회당 ${m.rate}% 낮아요 (${L.won(m.save)} 절약)` : "회당 가격이 1회 상담보다 높아요. 패키지를 고를 이유가 약해요"}</p>`;
  }
  $("prodForm").addEventListener("input", () => {
    st.pack.sessions = Math.min(12, Math.max(1, Number($("sessions").value) || 1));
    st.pack.price = Math.max(0, Number($("price").value) || 0);
    st.pack.includes = [...$("incl").querySelectorAll("input:checked")].map((c) => INCLUDES[+c.value]);
    save(); renderJourney(); renderMath(); renderPreview();
  });
  $("prodForm").addEventListener("submit", (e) => e.preventDefault());

  /* ---------- B안 문구 ---------- */
  const FIELDS = ["headline", "sub", "bullets", "cta"];
  function fillCopy() {
    $("headline").value = st.B.headline; $("sub").value = st.B.sub; $("bullets").value = st.B.bullets.join("\n"); $("cta").value = st.B.cta;
  }
  function readCopy() {
    st.B = { headline: $("headline").value.trim(), sub: $("sub").value.trim(), bullets: $("bullets").value.split("\n").map((x) => x.trim()).filter(Boolean), cta: $("cta").value.trim() };
  }
  FIELDS.forEach((k) => $(k).addEventListener("input", () => { readCopy(); st.replaced = []; save(); renderLint(); renderPreview(); }));
  function renderLint() {
    const lint = L.lintClaims(st.B);
    FIELDS.forEach((k) => $(k).setAttribute("aria-invalid", String(lint.some((x) => x.field.split(".")[0] === k))));
    const name = { headline: "제목", sub: "부제", bullets: "항목", cta: "버튼" };
    $("lint").innerHTML = lint.length
      ? lint.map((x) => `<li><b>${esc(name[x.field.split(".")[0]])}${x.field.includes(".") ? ` ${+x.field.split(".")[1] + 1}` : ""}</b> <mark>${esc(x.match)}</mark> · ${esc(x.why)}</li>`).join("")
      : `<li class="clear">과장 표현이 없어요</li>`;
    $("clean").disabled = !lint.length;
    $("replaced").innerHTML = st.replaced.map((r) => `<li><s>${esc(r.from)}</s> → ${esc(r.to)}</li>`).join("");
    const chip = $("mode");
    if (waiting) { chip.dataset.mode = "wait"; chip.innerHTML = "<i></i>Claude가 쓰는 중"; }
    else if (st.ai.mode === "ai") { chip.dataset.mode = "ai"; chip.textContent = `Claude로 작성 · ${(st.ai.ms / 1000).toFixed(1)}초`; }
    else { chip.dataset.mode = "rule"; chip.textContent = `규칙 기반${st.ai.reason ? ` · ${st.ai.reason}` : ""}`; }
  }
  function applyClean(copy, label) {
    const r = L.cleanCopy(copy, st.pack, SINGLE, st.reviews);
    st.B = r.copy; st.replaced = r.replaced;
    fillCopy(); save(); renderLint(); renderPreview();
    return r.replaced.length;
  }
  $("clean").addEventListener("click", () => {
    const before = JSON.parse(JSON.stringify({ B: st.B, replaced: st.replaced }));
    const n = applyClean(st.B);
    toast(`과장 표현 ${n}곳을 사실 문장과 실제 후기로 바꿨어요`, () => { st.B = before.B; st.replaced = before.replaced; fillCopy(); save(); renderLint(); renderPreview(); });
  });
  $("gen").addEventListener("click", async () => {
    const my = ++runToken;
    const before = JSON.parse(JSON.stringify(st.B));
    st.B = L.ruleCopy(st.pack, SINGLE, st.reviews); st.replaced = []; st.ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    fillCopy(); renderLint(); renderPreview();
    const m = L.packageMath(SINGLE, st.pack);
    // 이름이 들어간 후기 원문 대신, 가린 이름 + 게시 동의한 후기만 보낸다
    const r = await AI.ask("coachlanding.copy", { product: `${m.sessions}주 직무 전환 코칭 패키지`, sessions: m.sessions, price: L.won(m.price), perSession: L.won(m.per), single: L.won(SINGLE), includes: st.pack.includes, reviews: L.usable(st.reviews).map((x) => ({ who: x.who, text: x.text })) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeCopy(r.data);
    if (n) { const fixed = applyClean(n); st.ai = { mode: "ai", ms: r.ms }; if (fixed) toast(`Claude 문구에서 과장 표현 ${fixed}곳을 고쳤어요`); }
    else st.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    save(); renderLint(); renderPreview();
    if (!n) toast("상품 구성으로 문구를 만들었어요", () => { st.B = before; fillCopy(); save(); renderLint(); renderPreview(); });
  });

  /* ---------- 미리보기 · 게시 ---------- */
  function renderPreview() {
    const c = st[st.view];
    document.querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === st.view)));
    const lint = L.lintClaims(c);
    const hl = (t) => { let h = esc(t); lint.forEach((x) => { h = h.split(esc(x.match)).join(`<mark>${esc(x.match)}</mark>`); }); return h; };
    $("preview").innerHTML = `<p class="kick">${st.view === "A" ? "A안 · 지금까지 쓰던 문구" : "B안 · 실험 중"}</p>
      <h3>${hl(c.headline) || "(제목 없음)"}</h3><p class="sub">${hl(c.sub)}</p>
      <ul>${c.bullets.map((b) => `<li class="${b.startsWith("“") ? "rv" : ""}">${hl(b)}</li>`).join("")}</ul>
      <span class="cta">${hl(c.cta) || "신청하기"}</span>`;
    const ck = L.publishCheck(st.B, st.pack, SINGLE, st.reviews);
    $("check").innerHTML = `<b>B안 게시 전 확인</b><ul>${ck.checks.map((x) => `<li class="${x.ok ? "ok" : "no"}">${esc(x.label)}</li>`).join("")}</ul>${st.published ? `<p class="pub">게시됨 · ${esc(st.published.at)}</p>` : ""}`;
    $("publish").disabled = !ck.ok;
  }
  document.querySelector(".seg").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; st.view = b.dataset.v; save(); renderPreview(); });
  $("publish").addEventListener("click", () => {
    const d = new Date();
    st.published = { copy: JSON.parse(JSON.stringify(st.B)), at: `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
    save(); renderPreview();
    toast("B안을 게시했어요. 실험 숫자가 쌓이면 아래에서 비교해요");
  });
  $("copy").addEventListener("click", async () => {
    const t = L.toText(st[st.view]);
    try { await navigator.clipboard.writeText(t); toast(`${st.view}안 문구를 복사했어요`); }
    catch (e) { toast("복사할 수 없는 환경이에요. 미리보기에서 직접 선택해 주세요"); }
  });

  /* ---------- A/B ---------- */
  function renderAb() {
    const r = L.abTest(st.ab.A, st.ab.B);
    const max = Math.max(r.rateA, r.rateB, 1);
    const row = (k, rate) => `<tr><th scope="row">${k}안</th>
      <td><label class="sr" for="v${k}">${k}안 방문</label><input type="number" min="0" id="v${k}" data-ab="${k}.visitors" value="${st.ab[k].visitors}"></td>
      <td><label class="sr" for="a${k}">${k}안 신청</label><input type="number" min="0" id="a${k}" data-ab="${k}.apps" value="${st.ab[k].apps}"></td>
      <td class="rate"><b>${rate}%</b><i style="width:${Math.round((rate / max) * 100)}%" class="${r.winner === k ? "win" : ""}"></i></td></tr>`;
    $("ab").innerHTML = `<thead><tr><th></th><th>방문</th><th>신청</th><th>전환율</th></tr></thead><tbody>${row("A", r.rateA)}${row("B", r.rateB)}</tbody>`;
    $("verdict").className = `verdict ${r.winner ? "has" : ""}`;
    $("verdict").textContent = `${r.verdict}${r.lift !== null && r.winner ? ` · B는 A보다 ${r.lift > 0 ? "+" : ""}${r.lift}%` : ""}`;
  }
  $("ab").addEventListener("change", (e) => {
    const i = e.target.closest("input[data-ab]"); if (!i) return;
    const [k, f] = i.dataset.ab.split(".");
    st.ab[k][f] = Math.max(0, Math.floor(Number(i.value) || 0));
    save(); renderAb();
  });

  /* ---------- 후기 ---------- */
  function renderReviews() {
    $("reviews").innerHTML = st.reviews.map((r) => `<li class="${r.consent ? "" : "nc"}"><p>“${esc(r.text)}”</p><div><span>${esc(r.who)}</span>
      <label><input type="checkbox" data-r="${r.id}" ${r.consent ? "checked" : ""}> 게시 동의</label></div></li>`).join("");
  }
  $("reviews").addEventListener("change", (e) => {
    const c = e.target.closest("input[data-r]"); if (!c) return;
    st.reviews.find((r) => r.id === c.dataset.r).consent = c.checked;
    save(); renderReviews(); renderPreview();
    if (!c.checked && L.unconsentedUsed(st.B, st.reviews).length) toast("B안에 이 후기가 있어요. 게시 전 확인에서 막혀요");
  });

  $("reset").addEventListener("click", () => {
    const before = st; st = seed(); save(); renderAll();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  function renderAll() { fillProd(); fillCopy(); renderJourney(); renderMath(); renderLint(); renderPreview(); renderAb(); renderReviews(); }
  renderAll();
  AI.probe();
})();
