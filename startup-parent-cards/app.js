/* 집으로 — 화면 (DOM만 다룬다. 문장 나누기·카드·근거 검사는 logic.js, AI 호출은 ai-client.js)
 *
 * '실천 카드 만들기'를 누르면
 *   0) 부모 질문에 건강·발달·안전 낱말이 있으면 카드를 만들지 않고 전문가 상담(응급이면 119)으로 넘긴다.
 *   1) 원고 문장에서 규칙으로 카드를 바로 보여 주고 (기다리지 않게)
 *   2) Claude에게 번호 붙은 원고 문장과 개인정보를 가린 질문을 보내 다시 다듬게 한다.
 *      돌아오면 문장마다 근거 검사(ground)를 하고, 말·행동·질문이 모두 남을 때만 덮어쓴다.
 */
(function () {
  "use strict";

  /** 해 볼 말: 문장에 따옴표가 이미 있으면(Claude가 붙인 경우) 겉 따옴표를 또 붙이지 않는다 */
  function quoteSay(t) { return /["“”]/.test(t || "") ? esc(t) : `“${esc(t)}”`; }
  const L = window.Jibeuro;
  const STORE_KEY = "startup-parent-cards-v1";
  const TRY_SAMPLE = {
    sibling: { text: "이 시기 형제 다툼은 정상 발달이니 걱정하지 않아도 됩니다.", ref: "1" },
    phone: { text: "스마트폰은 하루 1시간만 보게 하세요.", ref: "2" },
    sleep: { text: "잠들기 전에 멜라토닌을 조금 먹이면 도움이 됩니다.", ref: "3" },
  };
  const Q_SAMPLE = {
    sibling: "동생이 형 블록을 자꾸 가져가서 매일 싸워요. 둘 다 울 때 뭐라고 말해야 할지 모르겠어요.",
    phone: "영상을 그만 보자고 하면 울어요. 끌 때 뭐라고 말하면 좋을까요?",
    sleep: "자기 전에 더 놀겠다고 해서 매일 실랑이를 해요.",
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const week = () => L.weekKey(L.iso(new Date()));

  /* ---------- 상태 ---------- */
  function seed() {
    return {
      lectureId: "sibling",
      texts: Object.fromEntries(L.LECTURES.map((l) => [l.id, l.text])),
      question: Q_SAMPLE.sibling, seed: 0, tier: "paid",
      queue: [{ week: week(), lectureId: "phone", title: "스마트폰 사용 약속 정하기", say: "스스로 껐네, 약속을 지켰구나", mode: "rule" }],
    };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && v.texts && L.LECTURES.some((l) => l.id === v.lectureId) && Array.isArray(v.queue)) return { ...v, question: "" };
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  // 부모 질문은 저장하지 않는다 (개인정보가 섞일 수 있음)
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...st, question: "" })); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let result = null;   // {lines, dropped, missing, mode, ms, reason} | {stop:'urgent'|'consult', word}
  let waiting = false;
  let runToken = 0;
  const lecture = () => L.LECTURES.find((l) => l.id === st.lectureId);
  const sentences = () => L.splitSentences(st.texts[st.lectureId]);

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

  /* ---------- 왼쪽: 원고 ---------- */
  function cited() {
    if (!result || !result.lines) return new Set();
    return new Set(Object.values(result.lines).flatMap((l) => l.refs));
  }
  function renderAsk() {
    const lec = lecture();
    $("lecTabs").innerHTML = L.LECTURES.map((l) => `<button type="button" role="tab" data-lec="${l.id}" aria-selected="${l.id === st.lectureId}">${esc(l.title)}</button>`).join("");
    $("lecPlace").textContent = lec.place;
    $("src").value = st.texts[st.lectureId];
    $("question").value = st.question || "";
    renderSents(); renderMasked();
  }
  function renderSents() {
    const s = sentences(), c = cited();
    $("sents").innerHTML = s.map((x) => `<li id="s${x.no}" class="${c.has(x.no) ? "cited" : ""}"><span class="sno">${x.no}</span><span>${esc(x.text)}</span></li>`).join("");
    $("srcCount").textContent = `문장 ${s.length}개 · ${st.texts[st.lectureId].length}자`;
  }
  function renderMasked() {
    const q = st.question.trim(), m = L.scrub(q);
    $("masked").hidden = !q || m === q;
    $("masked").innerHTML = `AI에는 이렇게 보내요: <span>${esc(m)}</span>`;
  }
  $("lecTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lec]"); if (!b || b.dataset.lec === st.lectureId) return;
    st.lectureId = b.dataset.lec; st.seed = 0; st.question = Q_SAMPLE[st.lectureId];
    save(); renderAsk(); fillTry(); run();
  });
  $("reread").addEventListener("click", () => {
    const v = $("src").value.trim();
    if (L.splitSentences(v).length < 3) { toast("문장이 3개 이상이어야 카드를 만들 수 있어요"); return; }
    const before = st.texts[st.lectureId];
    st.texts[st.lectureId] = v; st.seed = 0; save(); renderAsk(); run();
    toast("원고를 다시 읽고 번호를 새로 붙였어요", () => { st.texts[st.lectureId] = before; save(); renderAsk(); run(); });
  });
  $("question").addEventListener("input", (e) => { st.question = e.target.value; renderMasked(); });

  /* ---------- 오른쪽: 카드 ---------- */
  function modeBadge() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다듬는 중</span>`;
    if (result.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(result.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 원고 문장을 그대로 골랐어요">규칙 기반${result.reason ? ` · ${esc(result.reason)}` : ""}</span>`;
  }
  const refBtns = (l) => l.refs.map((n) => `<button type="button" class="ref" data-ref="${n}" aria-label="원고 ${n}번 문장 보기">원고 ${n}</button>`).join("");
  function slotHtml(id, label) {
    const l = result.lines[id];
    if (!l) return `<div class="slot empty-slot"><h3>${label}</h3><p>원고에서 고를 문장이 없어요.</p></div>`;
    const text = id === "say" ? quoteSay(l.text) : esc(l.text);
    return `<div class="slot s-${id}"><h3>${label}${l.by === "ai" ? `<span class="by">Claude</span>` : ""}</h3><p>${text}</p><div class="refs">${refBtns(l)}<span class="okmark">근거 일치 ${Math.round(l.check.score * 100)}%</span></div></div>`;
  }
  function stopHtml() {
    const urgent = result.stop === "urgent";
    return `<div class="out-h"><h2>가정 실천 카드</h2></div>
      <div class="stop ${urgent ? "urgent" : ""}" role="alert">
        <b>${urgent ? "카드보다 먼저 아이 상태를 확인해 주세요" : "이 질문은 카드로 답하지 않아요"}</b>
        <p>질문에 ‘${esc(result.word)}’ 같은 ${urgent ? "응급일 수 있는" : "건강·발달·안전에 관한"} 내용이 있어요. 집으로는 이런 부분을 판단하지 않고, AI에도 보내지 않아요.</p>
        ${urgent
          ? `<p class="call">지금 위급하면 <b>119</b>에 전화하거나 가까운 응급실로 가세요.</p>`
          : `<p>소아청소년과, 영유아 건강검진, 지역 육아종합지원센터 같은 전문가 상담을 권해 드려요. 강사에게 답장을 보낼 때도 “전문가와 먼저 상담해 주세요”로 안내합니다.</p>`}
        <p class="fine">질문을 고치면 다시 카드를 만들 수 있어요.</p>
      </div>`;
  }
  function renderOut() {
    const box = $("out");
    if (!result) { box.innerHTML = `<div class="empty"><b>강의를 고르고 카드 만들기를 누르세요</b>원고 문장만 근거로 카드를 만들어요.</div>`; return; }
    if (result.stop) { box.innerHTML = stopHtml(); renderSents(); return; }
    const lec = lecture(), s = sentences();
    const n = Object.keys(result.lines).length;
    const mail = L.buildMail(result, lec, s, st.tier, week());
    box.innerHTML = `<div class="out-h"><h2>가정 실천 카드 <small>${esc(lec.title)}</small></h2>${modeBadge()}</div>
      <p class="meta">카드 문장 ${n}개 모두 원고 번호로 근거를 확인했어요${result.dropped.length ? ` · <b>근거 없는 문장 ${result.dropped.length}개를 버렸어요</b>` : ""}.</p>
      <div class="card ${waiting ? "waiting" : ""}">
        <div class="card-top"><span>이번 주 한 걸음</span><span>${week().replace("-W", "년 ")}주차</span></div>
        ${L.SLOTS.map((x) => slotHtml(x.id, x.label)).join("")}
      </div>
      <div class="out-tools">
        <button type="button" class="ghost-btn" id="again">다른 문장으로</button>
        <button type="button" class="dark" id="enqueue" ${result.missing.length ? "disabled" : ""}>발송함에 담기</button>
      </div>
      ${result.dropped.length ? `<div class="dropped"><h3>버린 문장 <span class="n">${result.dropped.length}</span></h3><ul>${result.dropped.map((d) => `<li><b>${esc(d.text)}</b><span>${esc(d.check.reason)}${d.refs.length ? ` · 적힌 근거 ${d.refs.join(", ")}번` : ""}</span></li>`).join("")}</ul></div>` : ""}
      <div class="mail">
        <div class="mail-h"><h3>주간 구독 메일 미리보기</h3>
          <div class="seg" role="group" aria-label="구독 종류"><button type="button" data-tier="free" aria-pressed="${st.tier === "free"}">무료판</button><button type="button" data-tier="paid" aria-pressed="${st.tier === "paid"}">유료판 · 월 4,900원</button></div>
        </div>
        <p class="m-subj"><span>제목</span>${esc(mail.subject)}</p>
        <pre class="m-body">${esc(mail.body)}</pre>
        <div class="mail-f"><span class="fine">받는 사람 이름 없이 ‘보호자님’으로 나가요.</span><button type="button" class="ghost-btn sm" id="copyMail">메일 내용 복사</button></div>
      </div>`;
    renderSents();
  }
  $("out").addEventListener("click", async (e) => {
    const ref = e.target.closest("[data-ref]");
    if (ref) {
      const li = $("s" + ref.dataset.ref); if (!li) return;
      li.scrollIntoView({ block: "nearest", behavior: "smooth" });
      li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
      return;
    }
    const tier = e.target.closest("[data-tier]");
    if (tier) { st.tier = tier.dataset.tier; save(); renderOut(); return; }
    if (e.target.id === "again") { st.seed++; save(); run(); return; }
    if (e.target.id === "enqueue") {
      const lec = lecture();
      const before = st.queue;
      const r = L.addToQueue(st.queue, { week: week(), lectureId: lec.id, title: lec.title, say: result.lines.say.text, mode: result.mode });
      st.queue = r.queue; save(); renderQueue();
      toast(r.replaced ? `‘${lec.title}’ 카드를 새 카드로 바꿔 담았어요` : `‘${lec.title}’ 카드를 발송함에 담았어요`, () => { st.queue = before; save(); renderQueue(); });
      return;
    }
    if (e.target.id === "copyMail") {
      const m = L.buildMail(result, lecture(), sentences(), st.tier, week());
      try { await navigator.clipboard.writeText(`${m.subject}\n\n${m.body}`); toast("메일 내용을 복사했어요"); } catch (err) { toast("복사 권한이 없어요. 미리보기 글을 직접 선택해 주세요"); }
    }
  });

  /* ---------- 카드 만들기 ---------- */
  async function run() {
    const my = ++runToken;
    const tri = L.triage(st.question);
    if (tri.level !== "none") { waiting = false; result = { stop: tri.level, word: tri.word }; renderOut(); return; }
    const s = sentences();
    result = { ...L.buildCard(s, st.question, st.seed), mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderOut();

    const r = await AI.ask("parentcards.make", { ...L.aiInput(lecture(), s, st.question), seed: st.seed });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 버린다
    waiting = false;
    const c = r && L.normalizeCard(r.data, s);
    if (c && c.usable) result = { ...c, mode: "ai", ms: r.ms };
    else {
      result.reason = !r ? (AI.status().reason || "AI 응답 없음") : !c ? "응답 형식이 맞지 않음" : "근거 있는 문장이 모자람";
      if (c) result.dropped = c.dropped; // 버린 이유는 보여 준다
    }
    renderOut();
  }
  $("ask").addEventListener("submit", (e) => {
    e.preventDefault(); st.seed = 0; save(); run();
    toast(result && result.stop ? "카드 대신 상담 안내를 띄웠어요" : "원고 문장만으로 카드를 만들었어요");
  });

  /* ---------- 근거 검사기 ---------- */
  function fillTry() { const t = TRY_SAMPLE[st.lectureId]; $("tryText").value = t.text; $("tryRef").value = t.ref; checkTry(); }
  function checkTry() {
    const text = $("tryText").value.trim();
    if (!text) { $("tryOut").innerHTML = ""; return; }
    const refs = $("tryRef").value.split(/[^0-9]+/).filter(Boolean).map(Number);
    const c = L.ground({ text, refs }, sentences());
    $("tryOut").innerHTML = c.ok
      ? `<div class="verdict v-ok"><b>카드에 쓸 수 있어요</b>원고 ${refs.join(", ")}번과 ${Math.round(c.score * 100)}% 일치해요.</div>`
      : `<div class="verdict v-no"><b>버려요</b>${esc(c.reason)}</div>`;
  }
  $("tryBtn").addEventListener("click", checkTry);
  $("tryRef").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkTry(); } });
  $("medWords").textContent = `(${L.MED.slice(0, 8).join(", ")} 외)`;

  /* ---------- 발송함 · 목표치 ---------- */
  function renderQueue() {
    const w = week();
    $("qWeek").textContent = w.replace("-W", "년 ") + "주차";
    const list = st.queue.filter((q) => q.week === w);
    $("queue").innerHTML = list.map((q) => `<li><div><b>${esc(q.title)}</b><span>${quoteSay(q.say)}</span></div><em>${q.mode === "ai" ? "Claude" : "규칙"}</em><button type="button" class="x" data-del="${esc(q.lectureId)}" aria-label="${esc(q.title)} 카드 빼기">빼기</button></li>`).join("") || `<li class="none">아직 담은 카드가 없어요.</li>`;
  }
  $("queue").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const before = st.queue;
    st.queue = st.queue.filter((q) => !(q.week === week() && q.lectureId === b.dataset.del));
    save(); renderQueue();
    toast("발송함에서 뺐어요", () => { st.queue = before; save(); renderQueue(); });
  });
  const goal = L.subStats(530, 74);
  $("rate").textContent = `(${goal.rate}%)`;
  $("monthly").textContent = L.won(goal.monthly);

  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); renderAsk(); renderQueue(); fillTry(); run();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAsk(); renderQueue(); fillTry(); run(); });
  });

  /* ---------- 시작 ---------- */
  renderAsk(); renderQueue(); fillTry();
  // 규칙 카드를 먼저 보여 주고, AI 상태를 확인한 뒤 다시 만든다
  result = { ...L.buildCard(sentences(), st.question, st.seed), mode: "rule", reason: "" };
  renderOut();
  AI.probe().then(() => run());
})();
