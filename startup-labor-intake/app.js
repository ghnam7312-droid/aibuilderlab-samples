/* 사실먼저 — 화면 (DOM 다루기만 한다. 사실 정리·판단 막기·메모는 logic.js, AI 호출은 ai-client.js)
 *
 * '사실 정리하기'를 누르면
 *   1) 규칙으로 바로 정리해 보여 주고 (기다리지 않게)
 *   2) Claude 에게 같은 설명을 보내 다시 정리한다. 돌아온 값은 normalizeAi()로 검사해
 *      판단 문장은 빼서 '노무사 상담에서 확인'으로 옮기고, 원문에 근거가 없는 값은 버린다.
 *      응답 형식이 틀리면 1)을 그대로 둔다.
 * 개인정보: 연락처는 저장하지 않고, 목록·메모에서는 이름을 가린다. 주소창에는 아무것도 싣지 않는다.
 */
(function () {
  "use strict";
  const L = window.Sasilmeonjeo;
  const STORE_KEY = "startup-labor-intake-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 샘플 접수 3건 (가상의 의뢰인) ---------- */
  function samples() {
    return [
      { id: "s1", name: "정하윤", side: "근로자", at: "오늘 09:12",
        story: `2025년 3월 4일부터 동네 카페에서 일했어요. 주 5일, 오전 9시부터 오후 6시까지 일했고 쉬는 시간은 따로 없었어요. 월급은 매달 210만 원 받았어요. 근로계약서는 처음에 쓰자고 했는데 결국 안 썼어요. 사장님 포함해서 직원은 6명 정도예요. 2026년 9월 30일에 사장님이 다음 달부터 나오지 말라고 해서 그만뒀어요. 퇴직금을 받을 수 있나요? 마지막 달 월급도 아직 절반만 들어왔어요.` },
      { id: "s2", name: "오태민", side: "사업주", at: "어제 18:40",
        story: `저희 분식집은 직원이 4명이에요. 아르바이트생 한 명이 2026년 1월 10일부터 일하고 있어요. 주 3일, 하루 6시간씩 근무해요. 시급은 12,000원으로 주고 있어요. 계약서는 처음에 작성했어요. 그런데 이 친구가 주휴수당을 달라고 하는데 줘야 하는 건가요?` },
      { id: "s3", name: "한서진", side: "근로자", at: "어제 11:05",
        story: `회사에서 갑자기 다음 달부터 연봉을 깎겠다고 해요. 3년 넘게 다녔는데 이게 맞는 건가요? 동의서에 사인하라고 하는데 안 하면 어떻게 되나요?` },
    ];
  }
  function seed() {
    const list = samples().map((x) => ({ ...x, result: L.extract(x.story, today()), ai: { mode: "rule", reason: "" }, answers: {} }));
    return { list, cur: "s1", mode: "sent", n: 1 };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.list) && v.list.length && v.list.every((x) => typeof x.story === "string" && x.result && x.result.facts)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  // 연락처는 저장하지 않는다 (phone 필드를 빼고 저장)
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...st, list: st.list.map(({ phone, ...x }) => x) })); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false, runToken = 0;
  const cur = () => st.list.find((x) => x.id === st.cur) || st.list[0];

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  function flash(el) {
    if (!el) return;
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  }

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 접수 목록 ---------- */
  function renderList() {
    $("intakes").innerHTML = st.list.map((x) => {
      const c = L.coverage(x.result.facts);
      return `<li><button type="button" data-id="${esc(x.id)}" aria-current="${x.id === st.cur}">
        <span class="nm">${esc(L.maskName(x.name) || "이름 없음")}<span class="side-t">${esc(x.side)}</span></span>
        <span class="sm-t">${esc(x.at)} · 사실 ${c.done}/${c.total} · 확인할 것 ${c.total - c.done}</span>
        <span class="bar-m" aria-hidden="true"><i style="width:${Math.round((c.done / c.total) * 100)}%"></i></span>
      </button></li>`;
    }).join("");
  }
  $("intakes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b || b.dataset.id === st.cur) return;
    st.cur = b.dataset.id; waiting = false; runToken++;
    save(); renderAll();
  });
  $("newIntake").addEventListener("click", () => {
    const id = `n${Date.now().toString(36)}`;
    st.list.unshift({ id, name: "", side: "근로자", at: "방금", story: "", result: L.extract("", today()), ai: { mode: "rule", reason: "" }, answers: {} });
    st.cur = id;
    save(); renderAll(); setMode("edit");
    $("fName").focus();
  });

  /* ---------- 왼쪽: 의뢰인 설명 ---------- */
  function setMode(m) {
    st.mode = m;
    $("story").hidden = m !== "edit";
    $("sents").hidden = m === "edit";
    $("modeEdit").setAttribute("aria-pressed", String(m === "edit"));
    $("modeSent").setAttribute("aria-pressed", String(m === "sent"));
    if (m === "edit") $("story").focus();
    save();
  }
  function renderInput() {
    const x = cur();
    $("fName").value = x.name;
    $("fPhone").value = x.phone || "";
    $("story").value = x.story;
    document.querySelectorAll("[data-side]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.side === x.side)));
    const r = x.result;
    const used = new Set(Object.values(r.facts).map((f) => f.quote));
    const qs = new Set(r.questions.map((q) => q.quote));
    $("sents").innerHTML = r.sentences.length ? r.sentences.map((s, i) => {
      const keys = Object.entries(r.facts).filter(([, f]) => f.quote === i).map(([k]) => L.LABEL[k]).filter(Boolean);
      const cls = qs.has(i) ? "q" : used.has(i) ? "used" : "";
      const tag = qs.has(i) ? `<span class="tag">노무사 상담에서 확인</span>` : keys.length ? `<span class="tag">${esc(keys.join(" · "))}</span>` : "";
      return `<li class="${cls}" data-s="${i}"><span>${esc(s)}${tag}</span></li>`;
    }).join("") : `<li><span>‘고치기’를 눌러 의뢰인 설명을 넣어 주세요.</span></li>`;
    $("inInfo").textContent = `${r.sentences.length}문장 · 근거로 쓴 문장 ${[...used].filter((i) => i >= 0).length}`;
  }
  $("modeEdit").addEventListener("click", () => setMode("edit"));
  $("modeSent").addEventListener("click", () => { if ($("story").value !== cur().story) { run(); return; } setMode("sent"); });
  $("fName").addEventListener("input", (e) => { cur().name = e.target.value.trim(); save(); renderList(); });
  $("fPhone").addEventListener("input", (e) => { cur().phone = e.target.value; });
  document.querySelector(".side").addEventListener("click", (e) => {
    const b = e.target.closest("[data-side]"); if (!b) return;
    cur().side = b.dataset.side; save(); renderInput(); renderList(); renderOut();
  });
  $("story").addEventListener("input", () => { $("inInfo").textContent = "고친 뒤 ‘사실 정리하기’"; });
  $("story").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });

  /* ---------- 오른쪽: 사실 정리 ---------- */
  function modeChip(x) {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 읽는 중</span>`;
    if (x.ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(x.ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 날짜·금액·낱말 규칙으로 정리했어요">규칙 기반${x.ai.reason ? ` · ${esc(x.ai.reason)}` : ""}</span>`;
  }
  const fromBtn = (q) => (q >= 0 ? `<button type="button" class="from" data-s="${q}" aria-label="${q + 1}번째 문장 보기">${q + 1}번 문장</button>` : `<span class="from calc">계산</span>`);
  function renderOut() {
    const x = cur(), r = x.result;
    if (!r.sentences.length) { $("out").innerHTML = `<div class="empty-out"><div><b>아직 설명이 없어요</b><br>의뢰인 설명을 넣고 ‘사실 정리하기’를 누르세요.</div></div>`; return; }
    const c = L.coverage(r.facts);
    const miss = L.missing(r.facts);
    const toAsk = r.questions.map((q) => ({ text: q.text, quote: q.quote, kind: "의뢰인 질문" })).concat((r.blocked || []).map((t) => ({ text: t, quote: -1, kind: "AI 판단 차단" })));
    $("out").innerHTML = `
      <div class="pane-h"><h2>사실 정리 · ${esc(L.maskName(x.name) || "새 접수")} (${esc(x.side)})</h2>${modeChip(x)}</div>
      <div class="cov"><span>정리한 사실 <b>${c.done}/${c.total}</b></span><span class="bar-m" aria-hidden="true"><i style="width:${Math.round((c.done / c.total) * 100)}%"></i></span></div>
      <div class="res${waiting ? " waiting" : ""}">
      <table class="facts"><tbody>
        ${L.FIELDS.map((f) => { const v = r.facts[f.key]; const a = x.answers[f.key];
          return `<tr><th scope="row">${esc(f.label)}</th><td><div class="v">${v ? `<span>${esc(v.value)}${v.by === "ai" ? `<span class="by-ai">Claude</span>` : ""}</span>${fromBtn(v.quote)}` : a ? `<span>${esc(a)} <span class="by-ai">접수 후 확인</span></span>` : `<span class="none">설명에 없음 → 아래에서 확인</span>`}</div></td></tr>`; }).join("")}
        ${r.facts.period?.value ? `<tr><th scope="row">근무 기간</th><td><div class="v"><span>${esc(r.facts.period.value)}</span>${fromBtn(-1)}</div></td></tr>` : ""}
      </tbody></table>
      ${miss.length ? `<div class="blk"><h3>상담 전에 확인할 것 <span class="n">${miss.filter((m) => !x.answers[m.key]).length}</span></h3><ul class="ask">
        ${miss.map((m) => `<li class="${x.answers[m.key] ? "ok" : ""}"><label for="a-${m.key}">${esc(m.ask)}</label><input id="a-${m.key}" data-a="${m.key}" value="${esc(x.answers[m.key] || "")}" placeholder="통화·문자로 들은 답 적기" autocomplete="off"></li>`).join("")}</ul></div>` : ""}
      <div class="blk to-ask"><h3>노무사 상담에서 확인 <span class="n">${toAsk.length}</span></h3>
        ${toAsk.length ? `<ul>${toAsk.map((q) => `<li class="${q.kind === "AI 판단 차단" ? "blocked" : ""}"><span>${q.kind === "AI 판단 차단" ? `<s>${esc(q.text)}</s>` : esc(q.text)}</span><span class="k">${q.kind}</span></li>`).join("")}</ul>` : `<ul><li><span>의뢰인이 남긴 질문이 없어요.</span></li></ul>`}
        <p>여기 있는 질문에는 이 도구와 AI가 답하지 않아요. 상담에서 노무사가 사실관계를 보고 판단합니다.${r.dropped ? ` 원문에 근거가 없는 AI 값 ${r.dropped}개도 버렸어요.` : ""}</p>
      </div>
      ${r.timeline.length ? `<div class="blk"><h3>날짜순</h3><ol class="tl">${r.timeline.map((t) => `<li><b>${esc(t.date)}${t.approx ? "(일자 미상)" : ""}</b>${esc(t.text.length > 46 ? t.text.slice(0, 46) + "…" : t.text)}</li>`).join("")}</ol></div>` : ""}
      ${r.note ? `<p class="fine">Claude 메모 · ${esc(r.note)}</p>` : ""}
      </div>
      <div class="out-tools">
        <button class="primary" id="copyMemo" type="button">상담 준비 메모 복사</button>
        <button class="ghost-btn" id="print" type="button">인쇄</button>
      </div>`;
  }
  $("out").addEventListener("click", async (e) => {
    const f = e.target.closest("button.from[data-s]");
    if (f) { if (st.mode === "edit") setMode("sent"); flash(document.querySelector(`#sents li[data-s="${f.dataset.s}"]`)); return; }
    if (e.target.id === "print") { window.print(); return; }
    if (e.target.id === "copyMemo") {
      const text = L.memo(cur(), cur().result, cur().answers);
      try { await navigator.clipboard.writeText(text); toast("메모를 복사했어요 (이름·연락처는 가렸어요)"); }
      catch (err) { toast("복사할 수 없는 환경이에요. 인쇄를 이용해 주세요"); }
    }
  });
  $("out").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-a]"); if (!inp) return;
    const x = cur(), k = inp.dataset.a, before = x.answers[k];
    if (inp.value.trim()) x.answers[k] = inp.value.trim().slice(0, 80); else delete x.answers[k];
    save(); renderOut(); renderList();
    toast(`${L.LABEL[k]} 답을 적었어요`, () => { if (before) x.answers[k] = before; else delete x.answers[k]; save(); renderOut(); });
  });
  // 결과 행에 올리면 근거 문장이 밝혀진다
  function lightS(i) {
    document.querySelectorAll("#sents li.lit").forEach((x) => x.classList.remove("lit"));
    if (i !== undefined && +i >= 0) document.querySelector(`#sents li[data-s="${i}"]`)?.classList.add("lit");
  }
  $("out").addEventListener("mouseover", (e) => { const b = e.target.closest("tr")?.querySelector("button.from"); lightS(b ? b.dataset.s : undefined); });
  $("out").addEventListener("mouseleave", () => lightS());

  /* ---------- 정리하기 ---------- */
  async function run() {
    const x = cur();
    const v = $("story").value.trim();
    if (!v) { setMode("edit"); toast("의뢰인 설명을 먼저 넣어 주세요"); return; }
    const my = ++runToken;
    x.story = $("story").value;
    const t = today();
    const rule = L.extract(x.story, t);
    x.result = rule; x.ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    setMode("sent"); renderAll();

    // 이름·연락처는 보내지 않는다. 설명 안의 전화번호·이메일도 가려서 보낸다
    const r = await AI.ask("laborintake.facts", { story: L.maskText(x.story).slice(0, 4000), side: x.side, today: t, fields: L.FIELDS.map((f) => ({ key: f.key, label: f.label })) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeAi(r.data, rule.sentences);
    if (n) { x.result = L.merge(rule, n); x.ai = { mode: "ai", ms: r.ms }; }
    else x.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    save(); renderAll();
    const c = L.coverage(x.result.facts);
    toast(`${x.ai.mode === "ai" ? "Claude가" : "규칙으로"} 사실 ${c.done}/${c.total}개를 정리했어요${x.result.blocked?.length ? ` · 판단 문장 ${x.result.blocked.length}개는 상담으로 넘김` : ""}`);
  }
  $("run").addEventListener("click", run);

  /* ---------- 판단 문장 검사 ---------- */
  function checkGuard() {
    const s = $("gIn").value.trim(), out = $("gOut");
    if (!s) { out.dataset.k = ""; out.textContent = "문장을 넣으면 바로 검사해요."; return; }
    if (L.isQuestion(s)) { out.dataset.k = "judge"; out.textContent = "의뢰인 질문 → 답하지 않고 ‘노무사 상담에서 확인’ 목록에 넣어요."; return; }
    if (L.isJudgement(s)) { out.dataset.k = "judge"; out.textContent = `판단 문장 (‘${s.match(L.JUDGE)[0]}’) → 결과에서 빼고 ‘노무사 상담에서 확인’으로 옮겨요.`; return; }
    out.dataset.k = "fact"; out.textContent = "사실 문장 → 정리 결과에 그대로 둘 수 있어요.";
  }
  $("gIn").addEventListener("input", checkGuard);
  document.querySelector(".g-ex").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (!b) return; $("gIn").value = b.dataset.g; checkGuard(); });

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); waiting = false; runToken++;
    save(); renderAll(); setMode("sent");
    toast("샘플 접수 3건으로 되돌렸어요", () => { st = before; save(); renderAll(); setMode(st.mode); });
  });

  function renderAll() { renderList(); renderInput(); renderOut(); }

  /* ---------- 시작 ---------- */
  renderAll();
  setMode(st.mode === "edit" ? "edit" : "sent");
  checkGuard();
  AI.probe().then((s) => { if (s.enabled && cur().ai.mode !== "ai") run(); });
})();
