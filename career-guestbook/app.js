/* 한마디함 — 화면 (DOM 다루기만 한다. 규칙·계산은 logic.js, AI 호출은 ai-client.js)
 *
 * 두 화면이 한 파일에 있다.
 *   - 운영진 화면: 쪽지 벽 + QR + AI 요약. 3초마다 방(room)의 새 글을 가져와 붙인다.
 *   - 참가자 화면(?room=코드&join=1): 폰에서 한마디를 써서 방으로 보낸다.
 *
 * 남긴 글은 서버(/api/demo/room)가 Claude 로 분류해 저장한다. 서버가 안 되면 브라우저 규칙으로 분류해
 * 이 브라우저에만 붙인다. 어느 쪽으로 분류했는지는 쪽지와 요약에 그대로 표시한다.
 */
(function () {
  "use strict";
  const L = window.Hanmadi;
  const ROOM_API = AI.endpoint.replace(/\/ai$/, "/room/");
  const STORE_KEY = "hanmadi-v3";
  const ROOM_KEY = "hanmadi-room";
  const CAT_COLOR = { "칭찬": "#FFE27A", "개선 요청": "#FFB59E", "질문": "#AEDCFF", "기타": "#E6E2DA" };
  const MOOD_ICON = { "긍정": "😊", "부정": "😕", "중립": "🙂" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 화면은 동작 */ } },
  };

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    const b = $("toastUndo");
    b.hidden = !undo;
    b.onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }

  /** 쓰는 동안 쪽지 색·분류 미리보기 (규칙) */
  function bindLivePreview(ta, slip, pill, count, why) {
    function paint() {
      const t = ta.value.trim();
      count.textContent = `${ta.value.length}/300`;
      if (!t) {
        slip.dataset.cat = "기타";
        pill.textContent = "아직 비어 있어요";
        if (why) why.textContent = "단어를 보고 미리 나누고, 남기면 Claude가 다시 읽어요.";
        return;
      }
      const c = L.classify(t);
      slip.dataset.cat = c.cat;
      pill.textContent = `${c.cat} ${MOOD_ICON[c.mood]}`;
      if (why) {
        why.innerHTML = c.hits.length
          ? `미리보기 근거: ${c.hits.map((w) => `<mark>${esc(w)}</mark>`).join(" ")} → <b>${c.cat}</b>`
          : "맞는 단어가 아직 없어 <b>기타</b>로 보고 있어요. 남기면 Claude가 문맥으로 다시 나눠요.";
      }
    }
    ta.addEventListener("input", paint);
    paint();
    return paint;
  }

  /** 방에 글 보내기. 성공하면 서버가 저장한 글(row), 실패하면 null */
  async function postToRoom(room, text) {
    const c = L.classify(text);
    try {
      const r = await fetch(ROOM_API + room, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, rule: { category: c.cat, sentiment: c.mood, topic: c.topic, reason: c.hits.length ? `규칙: ${c.hits.join(", ")}` : "" } }),
      });
      const j = await r.json();
      if (j && j.ok && j.post) return j.post;
      return { error: (j && j.error) || "저장하지 못했어요" };
    } catch (e) {
      return null;
    }
  }

  /* ════════════════ 참가자 화면 ════════════════ */
  function startJoin(room) {
    document.title = "한마디 남기기 · 한마디함";
    $("hostView").hidden = true;
    $("joinView").hidden = false;
    $("jRoom").textContent = room;
    const ta = $("jText");
    const paint = bindLivePreview(ta, $("jLive"), $("jCat"), $("jCount"));

    $("jForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const t = ta.value.trim();
      if (t.length < 5) {
        $("jErr").textContent = t ? "5자 이상 써 주세요." : "한마디를 먼저 써 주세요.";
        $("jErr").hidden = false;
        ta.focus();
        return;
      }
      $("jErr").hidden = true;
      const btn = $("jSubmit");
      btn.disabled = true; btn.textContent = "붙이는 중…";
      const post = await postToRoom(room, t);
      btn.disabled = false; btn.textContent = "익명으로 남기기";
      if (!post || post.error) {
        $("jErr").textContent = post && post.error ? post.error : "인터넷 연결을 확인하고 다시 눌러 주세요. 쓴 글은 그대로 있어요.";
        $("jErr").hidden = false;
        return;
      }
      $("sentSlip").dataset.cat = post.category || "기타";
      $("sentText").textContent = post.body;
      $("sentWhy").textContent = post.mode === "ai"
        ? `Claude가 '${post.category}'(으)로 나눴어요. ${post.reason || ""}`
        : `'${post.category}'(으)로 붙였어요.`;
      $("joinForm").hidden = true;
      $("joinDone").hidden = false;
      ta.value = ""; paint();
    });
    $("jMore").addEventListener("click", () => {
      $("joinDone").hidden = true;
      $("joinForm").hidden = false;
      ta.focus();
    });
  }

  /* ════════════════ 운영진 화면 ════════════════ */
  function startHost() {
    // 샘플 24건 — 오래된 것부터 들어온 것처럼 시간 배치
    const SAMPLE = [
      ["발표 내용이 정말 유익했어요. 실제 서비스 만드는 과정을 처음부터 볼 수 있어서 좋았습니다.", 3],
      ["발표 시간이 너무 짧아서 아쉬웠어요. 질의응답 시간을 늘려 주세요.", 5],
      ["다음 밋업은 언제 하나요? 공지는 어디서 보면 되나요?", 9, "11월 15일(토) 학생회관 3층이에요. 동아리 인스타 공지로 먼저 알려 드릴게요!"],
      ["운영진분들 너무 친절하셨어요. 감사합니다!", 12],
      ["마이크 소리가 뒤쪽에서는 잘 안 들렸어요.", 14],
      ["피자 맛있었어요 ㅎㅎ", 18],
      ["팀 매칭 방식이 재밌었어요. 처음 만난 사람이랑도 금방 친해졌어요.", 21],
      ["자리가 좁아서 노트북 펴기가 불편했어요. 장소를 바꿔 주시면 좋겠어요.", 25],
      ["발표 자료를 받을 수 있나요?", 27],
      ["멘토님 피드백이 구체적이라 큰 도움이 됐습니다.", 31],
      ["시작 시간이 30분 늦어져서 뒤 일정이 힘들었어요.", 34],
      ["참가비 환불은 어떻게 신청하나요?", 38],
      ["네트워킹 시간이 알찼어요. 또 오고 싶어요.", 41],
      ["에어컨이 세서 좀 추웠어요.", 44],
      ["다음엔 초보자용 세션도 있었으면 해요.", 47],
      ["사진은 어디에 올라오나요?", 52],
      ["전체적으로 만족스러웠습니다. 최고!", 55],
      ["주차 안내가 부족했어요. 입구 찾기가 헷갈렸어요.", 58],
      ["그냥 들러 봤는데 분위기 좋네요", 61],
      ["데모 시연이 멋졌어요. 저도 만들어 보고 싶어졌어요.", 66],
      ["뒷자리에서는 화면 글씨가 작아서 잘 안 보였어요. 개선해 주세요.", 70],
      ["팀별 발표 순서는 어떻게 정해지나요?", 74],
      ["한 사람 발표가 너무 길었어요. 시간 관리 부탁드려요.", 79],
      ["처음 왔는데 친절하게 설명해 주셔서 인상 깊었어요.", 83],
    ];
    const seed = () => {
      const now = Date.now();
      return SAMPLE.map(([text, min, reply], i) => ({ id: i + 1, text, at: now - (90 - min) * 60000, reply: reply || "", fix: "" }));
    };

    const saved = store.get(STORE_KEY);
    let items = saved && Array.isArray(saved.items) ? saved.items : seed();
    let cursor = saved && Number(saved.cursor) || 0; // 지금까지 받은 방 글 번호 (숨긴 글을 다시 받지 않게)
    let room = store.get(ROOM_KEY);
    if (!L.validRoom(room)) { room = L.newRoomCode(); store.set(ROOM_KEY, room); }

    let filter = "전체";
    let replyingId = null;
    let justAdded = new Set();
    let summary = null;        // Claude 요약 {lines, actions, ms}
    let summaryAt = 0;         // 요약했을 때의 의견 수
    let ready = false;         // 첫 화면을 그린 뒤부터 상태 변화에 다시 그린다
    const save = () => store.set(STORE_KEY, { items, cursor });

    /* ---- 쪽지 하나의 최종 분류: 사람이 고친 것 > Claude > 규칙 ---- */
    function view(it) {
      const rule = L.classify(it.text);
      const base = it.ai ? it.ai : { cat: rule.cat, mood: rule.mood, topic: rule.topic, reason: "", mode: "rule" };
      return { ...it, cat: it.fix || base.cat, mood: base.mood, topic: base.topic || rule.topic, reason: base.reason, mode: it.ai ? it.ai.mode : "rule", auto: base.cat, hits: rule.hits };
    }

    /* ---- AI 상태 표시 ---- */
    AI.onChange((s) => {
      const el = $("aiState");
      if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
      el.dataset.on = s.enabled ? "on" : "off";
      el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
      el.title = s.enabled ? "남기는 글과 요약을 Claude가 읽습니다" : "AI를 쓸 수 없어 브라우저 규칙으로 나눕니다";
      if (ready) renderDigest(items.map(view));
    });

    /* ---- QR ---- */
    let qrLib = null;
    function loadQr() {
      if (qrLib) return Promise.resolve(qrLib);
      return new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
        s.onload = () => { qrLib = window.qrcode || null; resolve(qrLib); };
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    const joinLink = () => L.joinUrl(location.href, room);
    async function paintQr() {
      $("roomCode").textContent = room;
      const url = joinLink();
      const lib = await loadQr();
      const fallback = `<a class="qr-fallback" href="${esc(url)}" target="_blank" rel="noopener">참가자 화면 열기</a>`;
      if (!lib) { $("qr").innerHTML = fallback; $("stageQr").innerHTML = fallback; return; }
      const q = lib(0, "M");
      q.addData(url);
      q.make();
      const svg = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: "참가자 화면으로 가는 QR 코드" });
      $("qr").innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener" title="참가자 화면 열기">${svg}</a>`;
      $("stageQr").innerHTML = svg;
    }

    /* ---- 실시간: 3초마다 방의 새 글 ---- */
    let pollTimer = null, failures = 0;
    function setLive(on, text) {
      const el = $("liveState");
      el.dataset.on = on;
      el.lastElementChild.textContent = text;
    }
    async function poll() {
      clearTimeout(pollTimer);
      try {
        const r = await fetch(`${ROOM_API}${room}?after=${cursor}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "방 오류");
        failures = 0;
        const added = L.mergeRoom(items, j.posts);
        for (const p of j.posts) cursor = Math.max(cursor, Number(p.id) || 0);
        setLive("on", `실시간 연결됨 · 폰에서 남긴 글 ${items.filter((x) => x.live).length + added.length}건`);
        if (added.length) {
          items.push(...added);
          added.forEach((a) => justAdded.add(a.id));
          if (filter !== "전체" && !added.some((a) => view(a).cat === filter)) filter = "전체";
          save(); render();
          toast(added.length === 1 ? `폰에서 한마디가 들어왔어요: '${view(added[0]).cat}'` : `폰에서 한마디 ${added.length}개가 들어왔어요`);
        } else {
          save();
        }
      } catch (e) {
        failures++;
        setLive("off", failures > 2 ? "실시간 서버에 연결하지 못했어요 · 이 화면의 글만 보여요" : "다시 연결하는 중");
      }
      // 화면이 숨겨져 있으면 천천히, 실패가 이어지면 간격을 늘린다
      const wait = document.hidden ? 15000 : failures ? Math.min(30000, 3000 * (failures + 1)) : 3000;
      pollTimer = setTimeout(poll, wait);
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

    /* ---- 쓰기 (운영진 화면에서도 같은 방으로 보낸다) ---- */
    const ta = $("text");
    const paint = bindLivePreview(ta, $("live"), $("liveCat"), $("count"), $("why"));
    ta.addEventListener("input", () => { $("err").hidden = true; });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("form").requestSubmit(); });

    $("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const t = ta.value.trim();
      if (t.length < 5) {
        $("err").textContent = t ? "조금만 더 써 주세요. 5자 이상이면 남길 수 있어요." : "의견을 먼저 써 주세요.";
        $("err").hidden = false;
        ta.focus();
        return;
      }
      const btn = $("submit");
      btn.disabled = true; btn.textContent = "Claude가 읽는 중…";
      const post = await postToRoom(room, t);
      btn.disabled = false; btn.textContent = "익명으로 남기기";
      let it;
      if (post && !post.error) {
        it = L.fromRoomPost(post);
        cursor = Math.max(cursor, it.rid);
      } else {
        // 서버가 안 되면 이 브라우저에만 규칙 분류로 붙인다
        it = { id: Date.now(), text: t, at: Date.now(), reply: "", fix: "" };
      }
      items.push(it);
      justAdded.add(it.id);
      const v = view(it);
      if (filter !== "전체" && filter !== v.cat) filter = "전체";
      save();
      ta.value = ""; paint();
      render();
      $("why").innerHTML = v.mode === "ai"
        ? `<span class="mode" data-mode="ai">Claude</span> '${esc(v.cat)}'(으)로 나눴어요. ${esc(v.reason)}`
        : `<span class="mode" data-mode="rule">규칙</span> '${esc(v.cat)}'(으)로 붙였어요.${post && post.error ? ` (${esc(post.error)})` : ""}`;
      toast(`'${v.cat}' 쪽지로 붙였어요`);
    });

    /* ---- 요약 ---- */
    function renderDigest(rows) {
      const d = L.digest(rows);
      const pct = (n) => (d.total ? Math.round((n / d.total) * 100) : 0);
      $("dist").innerHTML = d.total
        ? L.CATS.filter((c) => d.counts[c]).map((c) =>
            `<button type="button" data-f="${c}" aria-pressed="${filter === c}" style="flex:${d.counts[c]};background:${CAT_COLOR[c]}" title="${c} ${d.counts[c]}건">${c} ${pct(d.counts[c])}%</button>`).join("")
        : "";

      const useAi = summary && summary.lines.length;
      const lines = useAi ? summary.lines : d.lines;
      const actions = useAi && summary.actions.length ? summary.actions : d.actions;
      const mode = $("sumMode");
      mode.dataset.mode = useAi ? "ai" : "rule";
      mode.textContent = useAi ? `Claude로 요약 · ${(summary.ms / 1000).toFixed(1)}초` : `규칙 기반${AI.status().reason ? ` · ${AI.status().reason}` : ""}`;

      $("lines").innerHTML = lines.length
        ? lines.map((l) => `<li>${esc(l)}</li>`).join("")
        : `<li class="none">아직 들어온 의견이 없어요. QR을 띄우고 첫 한마디를 받아 보세요.</li>`;
      const max = Math.max(1, ...actions.map((a) => a.count || 0));
      $("actions").innerHTML = actions.length
        ? actions.map((a) => `<li><span>${esc(a.topic)}</span><em>${a.count ? `${a.count}건` : ""}</em><div class="meter"><i style="width:${((a.count || 0) / max) * 100}%"></i></div><p>${esc(a.suggestion)}</p></li>`).join("")
        : `<li class="none">개선 요청이 들어오면 주제별로 묶어 할 일로 바꿔 드려요.</li>`;

      const fresh = rows.length - summaryAt;
      const btn = $("resum");
      btn.textContent = useAi && fresh > 0 ? `새 의견 ${fresh}건 반영해 다시 요약` : useAi ? "Claude로 다시 요약" : "Claude로 요약하기";
      btn.classList.toggle("hot", !!useAi && fresh > 0);
    }

    async function summarize() {
      const rows = items.map(view);
      if (!rows.length) return;
      const box = $("lines").parentElement;
      box.classList.add("loading");
      $("resum").disabled = true;
      const r = await AI.ask("guestbook.summary", L.summaryInput(rows));
      box.classList.remove("loading");
      $("resum").disabled = false;
      const s = r && L.normalizeSummary(r.data);
      if (s) {
        summary = { ...s, ms: r.ms };
        summaryAt = rows.length;
      } else {
        summary = null;
        if (r) toast("Claude 응답 형식이 맞지 않아 규칙 요약을 보여 드려요");
      }
      render();
    }
    $("resum").addEventListener("click", summarize);

    /* ---- 벽 ---- */
    const tilt = (id) => { const n = typeof id === "number" ? id : parseInt(String(id).replace(/\D/g, ""), 10) || 1; return (((n * 37) % 7) - 3) * 0.45; };
    function noteHtml(r) {
      const isAsk = r.cat === "질문";
      const reply = r.reply ? `<div class="reply"><b>운영진 답변</b>${esc(r.reply)}</div>` : "";
      const form = replyingId === r.id ? `
        <form class="reply-form" data-reply="${esc(r.id)}">
          <label class="sr" for="rp${esc(r.id)}">답변</label>
          <textarea id="rp${esc(r.id)}" rows="2" placeholder="답변을 써 주세요">${esc(r.reply)}</textarea>
          <div><button type="button" class="cancel" data-cancel>취소</button><button type="submit">답변 저장</button></div>
        </form>` : "";
      const why = r.mode === "ai" ? `Claude: ${r.reason || r.auto}` : r.hits.length ? `규칙: ${r.hits.join(", ")}` : "규칙: 맞는 단어 없음";
      return `
      <article class="note${justAdded.has(r.id) ? " landed" : ""}" data-id="${esc(r.id)}" style="--tilt:${tilt(r.id)}deg">
        <div class="slip" data-cat="${esc(r.cat)}">
          ${r.live ? `<span class="live-tag" title="실시간 방으로 들어온 의견"><i></i>실시간</span>` : ""}
          <p>${esc(r.text)}</p>
          <div class="meta">
            <span class="mood" title="${esc(r.mood)}">${MOOD_ICON[r.mood] || "🙂"}</span>
            <span>${L.ago(r.at)}</span>
            ${r.mode === "ai" ? `<span class="by-ai" title="${esc(why)}">Claude</span>` : ""}
            ${r.fix ? `<span class="fixed" title="자동 분류: ${esc(r.auto)}">사람이 고침</span>` : ""}
            <span class="acts">
              ${isAsk ? `<button type="button" data-act="reply">${r.reply ? "답변 고치기" : "답하기"}</button>` : ""}
              <label class="sr" for="fx${esc(r.id)}">분류 바꾸기</label>
              <select id="fx${esc(r.id)}" data-act="fix" title="분류 바로잡기 · ${esc(why)}">${L.CATS.map((c) => `<option ${c === r.cat ? "selected" : ""}>${c}</option>`).join("")}</select>
              <button type="button" data-act="hide" aria-label="이 의견 숨기기">숨기기</button>
            </span>
          </div>
          ${reply}${form}
        </div>
      </article>`;
    }

    function render() {
      const rows = items.map(view);
      const counts = {};
      L.CATS.forEach((c) => { counts[c] = rows.filter((r) => r.cat === c).length; });
      $("total").textContent = rows.length;
      $("stageCount").textContent = rows.length;
      $("filters").innerHTML = ["전체", ...L.CATS].map((c) =>
        `<button type="button" data-f="${c}" aria-pressed="${filter === c}">${c === "전체" ? "" : `<i style="background:${CAT_COLOR[c]}"></i>`}${c} <small>${c === "전체" ? rows.length : counts[c]}</small></button>`).join("");

      const shown = (filter === "전체" ? rows : rows.filter((r) => r.cat === filter)).sort((a, b) => b.at - a.at);
      $("wall").innerHTML = shown.length
        ? shown.map(noteHtml).join("")
        : `<div class="empty-wall"><b>${filter === "전체" ? "아직 쪽지가 없어요" : `'${filter}' 쪽지가 없어요`}</b>${filter === "전체" ? "QR을 찍어 폰으로 첫 한마디를 남겨 보세요." : "다른 분류를 골라 보세요."}</div>`;
      renderDigest(rows);
      justAdded = new Set();
      const ta2 = replyingId && document.querySelector(`[data-reply="${CSS.escape(String(replyingId))}"] textarea`);
      if (ta2) ta2.focus();
    }

    const idOf = (el) => { const v = el.closest(".note").dataset.id; return /^\d+$/.test(v) ? Number(v) : v; };

    function onFilter(e) {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      filter = filter === b.dataset.f && b.dataset.f !== "전체" ? "전체" : b.dataset.f;
      render();
    }
    $("filters").addEventListener("click", onFilter);
    $("dist").addEventListener("click", onFilter);

    $("wall").addEventListener("click", (e) => {
      const note = e.target.closest(".note");
      if (!note) return;
      const id = idOf(note);
      if (e.target.closest("[data-cancel]")) { replyingId = null; render(); return; }
      const act = e.target.closest("button[data-act]")?.dataset.act;
      if (act === "reply") { replyingId = id; render(); }
      if (act === "hide") {
        const idx = items.findIndex((x) => x.id === id);
        const [removed] = items.splice(idx, 1);
        note.classList.add("leaving");
        save();
        setTimeout(render, 200);
        toast("의견을 숨겼어요", () => { items.splice(idx, 0, removed); save(); render(); });
      }
    });
    $("wall").addEventListener("change", (e) => {
      if (e.target.dataset.act !== "fix") return;
      const it = items.find((x) => x.id === idOf(e.target));
      const auto = view({ ...it, fix: "" }).cat;
      it.fix = e.target.value === auto ? "" : e.target.value;
      save(); render();
      toast(it.fix ? `'${it.fix}'(으)로 바로잡았어요` : "자동 분류로 되돌렸어요");
    });
    $("wall").addEventListener("submit", (e) => {
      const f = e.target.closest("form[data-reply]");
      if (!f) return;
      e.preventDefault();
      const it = items.find((x) => String(x.id) === f.dataset.reply);
      it.reply = f.querySelector("textarea").value.trim();
      replyingId = null;
      save(); render();
      toast(it.reply ? "답변을 저장했어요" : "답변을 지웠어요");
    });

    /* ---- 머리글 ---- */
    $("reset").addEventListener("click", () => {
      const before = items;
      items = seed();
      filter = "전체"; replyingId = null; summary = null; summaryAt = 0;
      save(); render();
      toast("샘플 의견 24건으로 되돌렸어요", () => { items = before; save(); render(); });
    });
    $("share").addEventListener("click", async () => {
      const url = joinLink();
      try { await navigator.clipboard.writeText(url); toast("참가자 링크를 복사했어요. 단톡방에 붙여 넣으세요"); }
      catch (e) { toast(url); }
    });
    $("newRoom").addEventListener("click", () => {
      const before = room;
      room = L.newRoomCode(); cursor = 0;
      items = items.filter((x) => !x.live);
      store.set(ROOM_KEY, room); save();
      paintQr(); render(); poll();
      toast(`새 방 ${room}을 열었어요`, () => { room = before; store.set(ROOM_KEY, room); paintQr(); poll(); });
    });

    /* ---- 행사 진행 모드: 프로젝터용 큰 QR + 벽 ---- */
    function setPresent(on) {
      document.body.classList.toggle("present", on);
      $("stage").setAttribute("aria-hidden", String(!on));
      if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => { /* 전체 화면을 막아도 진행 모드는 된다 */ });
      }
      if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      if (on) $("presentOff").focus();
    }
    $("present").addEventListener("click", () => setPresent(true));
    $("presentOff").addEventListener("click", () => setPresent(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("present")) setPresent(false); });
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && document.body.classList.contains("present")) setPresent(false); });

    /* ---- 시작 ---- */
    render();
    ready = true;
    paintQr();
    poll();
    AI.probe().then((s) => { if (s.enabled) summarize(); });
  }

  const j = Hanmadi.parseJoin(location.search);
  if (j.join) startJoin(j.room); else startHost();
})();
