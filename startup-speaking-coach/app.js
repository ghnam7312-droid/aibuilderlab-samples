/* 말해봄 — 화면 (DOM만 다룬다. 첨삭 규칙·검사는 logic.js, AI 호출은 ai-client.js)
 *
 * '첨삭 받기'를 누르면
 *   1) 규칙으로 바로 첨삭해 보여 주고 (기다리지 않게)
 *   2) Claude 에게 같은 문장을 보내 다시 첨삭한다. 형식이 맞으면 덮어쓰고, 아니면 1)을 둔다.
 * 어느 쪽이든 학생에게 보이는 고칠 점은 2개까지다 (logic.MAX_FIXES).
 * 음성 인식이 없거나 막혀 있어도 받아쓴 문장 입력과 샘플 대본으로 같은 흐름을 쓸 수 있다.
 */
(function () {
  "use strict";
  const L = window.Malhaebom;
  const STORE_KEY = "startup-speaking-coach-v1";
  const TARGET = { label: "ended up -ing", re: "ended up \\w+ing" };
  const HOMEWORK = "지난 주말에 한 일 30초 말하기";

  const $ = (id) => document.getElementById(id);
  // ai-client 가 주는 영어 오류 문구는 화면에 맞게 바꾼다
  const whyKo = (r) => (/fetch|network|load failed/i.test(r || "") ? "네트워크 오류" : r || "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 (가상의 학생) ---------- */
  const SAMPLES = {
    minseo: { secs: 34, said: "Last weekend I go to Busan with my family. We eat a lot of seafood and it was very delicious. Um, on Sunday it rained so we, uh, ended up staying in the hotel. I was very boring but my brother enjoy to play games. Um, I think Busan is more better than Seoul in summer.",
      again: "Last weekend I went to Busan with my family. We ate a lot of seafood and it was very delicious. On Sunday it rained so we ended up staying in the hotel. I was very bored but my brother enjoy to play games." },
    dohyun: { secs: 27, said: "Yesterday I meet my friend in Hongdae. We discuss about our trip plan. He don't like spicy food, so we ended up eating pasta. I am agree with him, pasta was good.",
      again: "Yesterday I met my friend in Hongdae. We discussed our trip plan. He doesn't like spicy food, so we ended up eating pasta." },
    hayoon: { secs: 31, said: "I have lived in Seoul since 5 years. Last month I visit my grandmother in Jeonju. People is very kind there. Um, um, I very like bibimbap.",
      again: "I have lived in Seoul for 5 years. Last month I visit my grandmother in Jeonju. People are very kind there." },
    seoa: { secs: 38, said: "Last Saturday I went hiking with my coworkers. We planned to reach the top, but it started raining, so we ended up having pancakes at a small restaurant near the trail. Honestly, it was the best part of the day.",
      again: "Last Saturday I went hiking with my coworkers, and we ended up having pancakes near the trail because of the rain." },
  };
  function seed() {
    const s = (id, name, level, sample, extra) => ({ id, name, level, submitted: !!sample, said: sample ? SAMPLES[sample].said : "", secs: sample ? SAMPLES[sample].secs : 30, sample: sample || "", fb: null, ai: { mode: "rule", reason: "" }, retry: null, ...extra });
    const list = [
      s("minseo", "민서", "중급", "minseo"),
      s("dohyun", "도현", "초중급", "dohyun"),
      s("hayoon", "하윤", "초급", "hayoon"),
      s("seoa", "서아", "상급", "seoa"),
      s("yerin", "예린", "중급", null, { submitted: true, said: "Last Sunday we watch a movie at home. It was so exciting and I ended up crying at the end. My sister don't like sad movies, so she slept.", secs: 24 }),
      s("junseo", "준서", "초중급", null, { submitted: true, said: "Last night I cook dinner for my parents. I make kimchi fried rice. They say it was good. I enjoy to cook.", secs: 22 }),
      s("jihu", "지후", "초급", null),
      s("taeo", "태오", "중급", null),
    ];
    list.forEach((x) => { if (x.submitted) x.fb = L.review(x.said, x.secs, TARGET); });
    // 민서는 다시 말하기까지 해 본 상태로 시작
    list[0].retry = { said: SAMPLES.minseo.again, checks: L.checkRetry(list[0].fb.fixes, SAMPLES.minseo.again) };
    return { students: list, cur: "minseo", filter: "all" };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.students) && v.students.length && v.students.every((x) => typeof x.said === "string")) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;
  const cur = () => st.students.find((x) => x.id === st.cur) || st.students[0];

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
  async function copy(text, okMsg) {
    $("mdOut").textContent = text;
    $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  }

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${whyKo(s.reason) || "AI 꺼짐"}`;
  });

  /* ---------- 왼쪽: 제출 ---------- */
  const said = $("said");
  function renderInput() {
    const s = cur();
    $("student").innerHTML = st.students.map((x) => `<option value="${x.id}" ${x.id === s.id ? "selected" : ""}>${esc(x.name)} · ${esc(x.level)}${x.submitted ? "" : " · 미제출"}</option>`).join("");
    said.value = s.said;
    $("secs").value = s.secs || "";
    document.querySelectorAll("[data-sample]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sample === s.sample && said.value === SAMPLES[s.sample]?.said)));
    renderCount();
  }
  function renderCount() {
    const w = L.words(said.value);
    $("count").textContent = w ? `${w}단어` : "";
  }
  function renderRate() {
    const r = L.submitRate(st.students);
    $("rateNow").textContent = `${r.pct}%`;
    $("rateNow").title = `${r.n}명 중 ${r.done}명 제출`;
  }

  /* ---------- 오른쪽: 첨삭 ---------- */
  function modeChip(s) {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 듣는 중</span>`;
    if (s.ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 첨삭 · ${(s.ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="자주 나오는 실수 규칙으로 찾았어요">규칙 기반${s.ai.reason ? ` · ${esc(s.ai.reason)}` : ""}</span>`;
  }
  function markedText(s) {
    const { flat, marks } = L.marks(s.said, s.fb.fixes);
    let out = "", at = 0;
    marks.forEach((m) => { out += esc(flat.slice(at, m.start)) + `<mark class="m${m.n + 1}"><sup>${m.n + 1}</sup>${esc(flat.slice(m.start, m.end))}</mark>`; at = m.end; });
    return out + esc(flat.slice(at));
  }
  function renderOut() {
    const s = cur();
    const box = $("out");
    if (!s.fb) {
      box.innerHTML = `<div class="empty-out"><div><b>${esc(s.name)} 학생은 아직 제출 전이에요</b>왼쪽에서 녹음하거나 받아쓴 문장을 넣고 '첨삭 받기'를 누르세요.</div></div>`;
      return;
    }
    const fb = s.fb, m = fb.metrics || L.metrics(s.said, s.secs, TARGET);
    const later = fb.later || [];
    const r = s.retry;
    box.innerHTML = `
      <div class="pane-h"><h2>${esc(s.name)} 첨삭</h2>${modeChip(s)}</div>
      <ul class="metrics" aria-label="측정값">
        <li><b>${m.seconds || "-"}</b>초</li><li><b>${m.words}</b>단어</li><li><b>${m.wpm || "-"}</b>분당 단어</li>
        <li class="${m.fillers >= 3 ? "warn" : ""}"><b>${m.fillers}</b>um·uh</li>
        <li class="${m.target ? "ok" : ""}"><b>${m.target ? "썼음" : "안 씀"}</b>목표 표현</li>
      </ul>
      <div class="res${waiting ? " waiting" : ""}">
        <p class="good"><span>잘한 점</span>${esc(fb.good)}</p>
        <h3 class="fx-h">이번에 고칠 점 <b>${fb.fixes.length}</b><small>한 번에 ${L.MAX_FIXES}개까지만 보여 줘요</small></h3>
        ${fb.fixes.length ? `<ol class="fixes">${fb.fixes.map((f, i) => `<li class="f${i + 1}">
          <span class="no">${i + 1}</span>
          <div><b>${esc(f.title)}</b>${f.count > 1 ? `<span class="rep">같은 실수 ${f.count}번</span>` : ""}
            <p class="swap"><s>${esc(f.wrong)}</s><span aria-hidden="true">→</span><ins>${esc(f.better)}</ins></p>
            ${f.why ? `<p class="why">${esc(f.why)}</p>` : ""}</div></li>`).join("")}</ol>` : `<p class="none">이번엔 고칠 점이 없어요. 다음엔 45초로 늘려 보세요.</p>`}
        <p class="said" aria-label="받아쓴 문장, 고칠 곳 표시">${markedText(s)}</p>
        ${later.length ? `<details class="later"><summary>다음 숙제에서 볼 것 ${later.length}개 <span>튜터만 보기</span></summary><ul>${later.map((x) => `<li>${esc(x.title)}${x.count > 1 ? ` · ${x.count}번` : ""}</li>`).join("")}</ul></details>` : ""}
      </div>
      <div class="again">
        <h3>다시 말하기</h3>
        <p class="script" id="script">${esc(fb.retry)}</p>
        <label class="lab" for="said2">다시 말한 문장</label>
        <textarea id="said2" spellcheck="false" placeholder="고친 대본을 보고 한 번 더 말한 문장">${esc(r ? r.said : "")}</textarea>
        <div class="again-foot">
          ${s.sample ? `<button class="ghost-btn" id="sample2" type="button">샘플 다시 말하기</button>` : ""}
          <button class="dark" id="check" type="button">고쳤는지 확인</button>
        </div>
        ${r ? `<ul class="checks">${r.checks.map((c) => `<li class="${c.fixed ? "c-ok" : "c-no"}">${c.fixed ? "고침" : "아직"} · ${esc(c.title)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="out-foot"><button class="primary sm" id="copyMsg" type="button">카톡용 첨삭 복사</button></div>`;
  }

  $("out").addEventListener("click", (e) => {
    const s = cur();
    if (e.target.id === "sample2") { $("said2").value = SAMPLES[s.sample].again; checkAgain(); return; }
    if (e.target.id === "check") { checkAgain(); return; }
    if (e.target.id === "copyMsg") copy(L.toMessage(s.name, s.fb, HOMEWORK), "복사했어요. 학생 카톡에 붙여 넣으세요");
  });
  function checkAgain() {
    const s = cur();
    const v = $("said2").value.trim();
    if (!v) { toast("다시 말한 문장을 먼저 넣어 주세요"); $("said2").focus(); return; }
    s.retry = { said: v, checks: L.checkRetry(s.fb.fixes, v) };
    save(); renderOut(); renderRoster();
    const ok = s.retry.checks.filter((c) => c.fixed).length;
    toast(`고칠 점 ${s.retry.checks.length}개 중 ${ok}개를 고쳤어요`);
  }

  /* ---------- 첨삭하기 ---------- */
  async function run() {
    const s = cur();
    const v = said.value.trim();
    if (!v) { toast("받아쓴 문장을 먼저 넣어 주세요"); said.focus(); return; }
    if (!/[a-z]/i.test(v)) { toast("영어로 말한 문장을 넣어 주세요"); return; }
    const my = ++runToken;
    const before = { ...s };
    s.said = v; s.secs = Number($("secs").value) || 0; s.submitted = true;
    if (before.said !== v) s.retry = null;
    s.fb = L.review(v, s.secs, TARGET);
    s.ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    save(); renderInput(); renderOut(); renderRoster(); renderRate();

    const r = await AI.ask("speakingcoach.feedback", { homework: HOMEWORK, target: TARGET.label, level: s.level, transcript: v.slice(0, 2000), seconds: s.secs, maxFixes: L.MAX_FIXES });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 버린다
    waiting = false;
    const n = r && L.normalizeFeedback(r.data, v);
    if (n) { s.fb = { ...n, metrics: s.fb.metrics }; s.ai = { mode: "ai", ms: r.ms }; }
    else s.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : whyKo(AI.status().reason) };
    if (s.retry) s.retry.checks = L.checkRetry(s.fb.fixes, s.retry.said); // 고칠 점이 바뀌었을 수 있다
    save(); renderOut(); renderRoster();
    toast(`${s.ai.mode === "ai" ? "Claude가" : "규칙으로"} 고칠 점 ${s.fb.fixes.length}개를 골랐어요`, before.fb && before.said !== v ? () => { Object.assign(s, before); save(); renderAll(); } : null);
  }
  $("run").addEventListener("click", run);
  said.addEventListener("input", () => { renderCount(); document.querySelectorAll("[data-sample]").forEach((b) => b.setAttribute("aria-pressed", "false")); });
  said.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("student").addEventListener("change", (e) => { st.cur = e.target.value; save(); renderAll(); });
  document.querySelector(".samples").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sample]");
    if (!b) return;
    const s = cur();
    s.sample = b.dataset.sample;
    said.value = SAMPLES[s.sample].said; $("secs").value = SAMPLES[s.sample].secs;
    run();
  });

  /* ---------- 녹음하며 받아쓰기 (Web Speech API) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, t0 = 0, tick = null, base = "";
  function setRec(on) {
    $("mic").setAttribute("aria-pressed", String(on));
    $("micLabel").textContent = on ? "멈추기" : "녹음하며 받아쓰기";
    $("recBox").classList.toggle("on", on);
  }
  function noSpeech(msg) {
    $("mic").disabled = true;
    $("micLabel").textContent = "음성 인식 없음";
    $("recNote").textContent = msg;
    $("recBox").classList.add("off");
  }
  function stopRec() {
    clearInterval(tick); tick = null;
    if (t0) $("secs").value = Math.max(1, Math.round((Date.now() - t0) / 1000));
    t0 = 0; setRec(false);
  }
  if (!SR) noSpeech("이 브라우저는 음성 인식을 지원하지 않아요. 휴대폰 키보드의 받아쓰기로 문장을 넣거나, 샘플 녹음 대본을 골라 써 보세요.");
  $("mic").addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    try {
      rec = new SR();
      rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
      base = said.value.trim() ? said.value.trim() + " " : "";
      rec.onresult = (e) => {
        let txt = "";
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        said.value = base + txt.trim(); renderCount();
      };
      rec.onerror = (e) => {
        const why = e.error === "not-allowed" || e.error === "service-not-allowed" ? "마이크 권한이 막혀 있어요." : e.error === "network" ? "음성 인식 서버에 연결할 수 없어요." : e.error === "no-speech" ? "말소리가 들리지 않았어요." : "음성 인식이 멈췄어요.";
        $("recNote").textContent = `${why} 받아쓴 문장을 직접 넣거나 샘플 녹음 대본을 골라도 같은 첨삭을 받을 수 있어요.`;
      };
      rec.onend = () => { rec = null; stopRec(); };
      rec.start();
      t0 = Date.now(); setRec(true);
      tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); $("timer").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 250);
    } catch (err) {
      rec = null; stopRec();
      noSpeech("음성 인식을 시작하지 못했어요. 받아쓴 문장을 직접 넣거나 샘플 녹음 대본을 고르세요.");
    }
  });

  /* ---------- 튜터 화면 ---------- */
  function renderRoster() {
    const f = st.filter;
    const list = st.students.filter((x) => f === "all" || (f === "todo" && !x.submitted) || (f === "retry" && x.submitted && !x.retry && x.fb && x.fb.fixes.length));
    document.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === f)));
    $("roster").innerHTML = list.map((x) => {
      const stat = !x.submitted ? `<span class="tag todo">미제출</span>` : x.fb && !x.fb.fixes.length ? `<span class="tag ok">고칠 점 없음</span>` : x.retry ? `<span class="tag ok">다시 말하기 ${x.retry.checks.filter((c) => c.fixed).length}/${x.retry.checks.length}</span>` : `<span class="tag wait">다시 말하기 전</span>`;
      const fixes = x.fb ? x.fb.fixes.map((y) => esc(y.title)).join(" · ") || "잘한 점만 보냈어요" : "—";
      const more = x.fb && x.fb.later && x.fb.later.length ? `<span class="more">+${x.fb.later.length} 미룸</span>` : "";
      return `<li><button type="button" data-open="${x.id}" aria-current="${x.id === st.cur}"><span class="nm">${esc(x.name)}<small>${esc(x.level)}</small></span><span class="fx">${fixes}${more}</span>${stat}</button></li>`;
    }).join("") || `<li class="none">해당하는 학생이 없어요.</li>`;
  }
  $("roster").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-open]");
    if (!b) return;
    st.cur = b.dataset.open; save(); renderAll();
    document.querySelector(".split").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  document.querySelector(".tutor .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    st.filter = b.dataset.f; save(); renderRoster();
  });
  $("nudge").addEventListener("click", () => {
    const todo = st.students.filter((x) => !x.submitted);
    if (!todo.length) { toast("모두 제출했어요"); return; }
    copy(todo.map((x) => `${x.name} 님, 이번 주 말하기 숙제(${HOMEWORK})가 아직이에요. 30초면 충분하고, 고칠 점은 2개만 돌려드려요.`).join("\n\n"), `미제출 ${todo.length}명 알림 문구를 복사했어요`);
  });

  /* ---------- 시작 ---------- */
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); renderAll();
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });
  function renderAll() { renderInput(); renderOut(); renderRoster(); renderRate(); }
  const now = new Date();
  $("hwWeek").textContent = `이번 주 숙제 · ${now.getMonth() + 1}월 ${Math.ceil(now.getDate() / 7)}주`;
  renderAll();
  // AI가 켜져 있으면 지금 학생의 제출을 Claude로 한 번 더 첨삭한다. 꺼져 있으면 이유만 표시
  AI.probe().then((s) => {
    const c = cur();
    if (!c.fb || c.ai.mode === "ai") return;
    if (s.enabled) run();
    else { c.ai = { mode: "rule", reason: whyKo(s.reason) }; renderOut(); }
  });
})();
