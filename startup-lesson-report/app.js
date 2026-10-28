/* 오늘수업 — 화면 (DOM만 다룬다. 메모 나누기·검사는 logic.js, AI 호출은 ai-client.js)
 *
 * '리포트 만들기'를 누르면
 *   1) 학생별 메모로 나눠 규칙 초안을 바로 보여 주고
 *   2) 학생마다 그 학생 메모만 Claude 에게 보내 초안을 다시 받는다 (튜터가 손대지 않은 카드만 덮어쓴다)
 * 보내기는 '미리보기 확인'을 누른 카드만, 다른 학생 이름 같은 막는 문제가 없을 때만 된다.
 */
(function () {
  "use strict";
  const L = window.Oneulsueop;
  const STORE_KEY = "startup-lesson-report-v1";
  const $ = (id) => document.getElementById(id);
  // ai-client 가 주는 영어 오류 문구는 화면에 맞게 바꾼다
  const whyKo = (r) => (/fetch|network|load failed/i.test(r || "") ? "네트워크 오류" : r || "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플 (가상의 반·학생·번호) ---------- */
  const MEMO = `공통: 여행 계획 말하기. will과 be going to 차이 연습
민서: be going to를 자연스럽게 씀. 발표 때 목소리가 커짐. 숙제 2번 다시 해 오기
도현: 질문을 먼저 많이 함. 하윤이랑 짝 활동 때 설명을 잘 해 줌.
과거형 실수 2번 (go → went), 다음 시간에 복습
하윤: 처음으로 1분 넘게 말함. th 발음 연습 필요
서아: 오늘 결석. 녹화본으로 30분 복습 부탁`;
  function seed() {
    return {
      cls: "화목 저녁 회화 B반", tutor: "스피킹메이트 튜터", memo: MEMO,
      roster: [
        { name: "민서", to: "parent", phone: "010-0000-2841" },
        { name: "도현", to: "self", phone: "010-0000-5170" },
        { name: "하윤", to: "parent", phone: "010-0000-9033" },
        { name: "서아", to: "parent", phone: "010-0000-4412" },
        { name: "준서", to: "self", phone: "010-0000-7765" },
      ],
      cards: [], log: [], startedAt: 0, doneMin: 0,
    };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.memo === "string" && Array.isArray(v.roster) && Array.isArray(v.cards) && Array.isArray(v.log)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return null;
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  const saved = load();
  let st = saved || seed();
  let parsed = L.parseMemo(st.memo, st.roster);
  let waiting = 0;
  let runToken = 0;
  let editing = null;

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
  const student = (name) => st.roster.find((s) => s.name === name);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${whyKo(s.reason) || "AI 꺼짐"}`;
  });

  /* ---------- 왼쪽: 메모 · 받는 사람 ---------- */
  function renderMemo() {
    if ($("cls").value !== st.cls) $("cls").value = st.cls;
    if ($("memo").value !== st.memo) $("memo").value = st.memo;
    $("roster").innerHTML = st.roster.map((s, i) => `<li>
      <b>${esc(s.name)}</b>
      <label class="sr" for="to${i}">${esc(s.name)} 받는 사람</label>
      <select id="to${i}" data-i="${i}"><option value="parent" ${s.to === "parent" ? "selected" : ""}>보호자</option><option value="self" ${s.to === "self" ? "selected" : ""}>본인 (성인)</option></select>
      <span class="ph">${esc(L.maskPhone(s.phone))}</span>
      <span class="cnt">${(parsed.by[s.name] || []).length ? `메모 ${(parsed.by[s.name] || []).length}줄` : `<em>메모 없음</em>`}</span></li>`).join("");
    const unk = parsed.unknown.length ? ` · 명단에 없는 이름: ${parsed.unknown.join(", ")}` : "";
    $("memoInfo").textContent = `공통 ${parsed.common.length}줄${unk}`;
  }
  $("roster").addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-i]"); if (!sel) return;
    st.roster[+sel.dataset.i].to = sel.value;
    save();
    toast("받는 사람을 바꿨어요. '리포트 만들기'로 초안을 다시 만드세요");
  });
  $("memo").addEventListener("input", () => { st.memo = $("memo").value; parsed = L.parseMemo(st.memo, st.roster); save(); renderMemo(); });
  $("cls").addEventListener("change", () => { st.cls = $("cls").value.trim() || "회화반"; save(); });

  /* ---------- 오른쪽: 미리보기 ---------- */
  function statusOf(c, issues) {
    if (c.sent) return ["sent", "보냄"];
    if (issues.some((i) => i.block)) return ["block", "보내기 막힘"];
    if (c.confirmed) return ["ok", "확인함"];
    return ["todo", "확인 전"];
  }
  function bubble(c) {
    const names = L.otherNames(c.text, c.name, st.roster).filter((n) => !(c.acked || []).includes(n));
    return L.splitByNames(c.text, names).map((p) => (p.hit ? `<mark>${esc(p.s)}</mark>` : esc(p.s))).join("");
  }
  function renderCards() {
    const box = $("cards");
    if (!st.cards.length) { box.innerHTML = `<div class="empty-out"><b>아직 만든 리포트가 없어요</b>왼쪽 메모를 쓰고 '리포트 만들기'를 누르세요.</div>`; renderSendbar(); return; }
    box.innerHTML = st.cards.map((c) => {
      const s = student(c.name) || { to: "self", phone: "" };
      const issues = L.checkMessage(c, st.roster, parsed);
      const [k, label] = statusOf(c, issues);
      const blocked = issues.some((i) => i.block);
      const wait = c.waiting;
      return `<article class="card s-${k}" data-id="${c.id}">
        <header>
          <span class="av" aria-hidden="true">${esc(c.name.slice(-1))}</span>
          <div class="to"><b>${esc(c.name)}</b><span>${s.to === "parent" ? "보호자" : "본인"} · ${esc(L.maskPhone(s.phone))}</span></div>
          <span class="src">${wait ? "Claude 작성 중" : c.ai.mode === "ai" ? `Claude · ${(c.ai.ms / 1000).toFixed(1)}초` : c.edited ? "튜터가 고침" : `규칙${c.ai.reason ? ` · ${esc(c.ai.reason)}` : ""}`}</span>
          <span class="st">${label}</span>
        </header>
        ${editing === c.id
          ? `<label class="sr" for="ed-${c.id}">${esc(c.name)} 메시지 고치기</label><textarea class="ed" id="ed-${c.id}" data-ed="${c.id}">${esc(c.text)}</textarea>`
          : `<div class="bubble${wait ? " waiting" : ""}">${bubble(c)}</div>`}
        ${issues.length && !c.sent ? `<ul class="issues">${issues.map((i) => `<li class="${i.block ? "b" : "w"}"><span>${esc(i.msg)}</span>${i.kind === "other" ? `<span class="fix"><button type="button" data-act="remove" data-name="${esc(i.name)}">그 문장 지우기</button><button type="button" data-act="ack" data-name="${esc(i.name)}">의도한 언급이에요</button></span>` : ""}</li>`).join("")}</ul>` : ""}
        <footer>
          ${c.sent ? `<span class="sent-at">${esc(c.sentAt)} 보냄</span>` : `
          <button type="button" class="ghost-btn sm" data-act="edit">${editing === c.id ? "다 고쳤어요" : "고치기"}</button>
          <label class="confirm${blocked || wait ? " off" : ""}"><input type="checkbox" data-act="confirm" ${c.confirmed ? "checked" : ""} ${blocked || wait ? "disabled" : ""}> 미리보기 확인</label>`}
        </footer>
      </article>`;
    }).join("");
    renderSendbar();
  }
  function renderSendbar() {
    const p = L.progress(st.cards, st.roster);
    $("sendbar").innerHTML = st.cards.length ? `
      <div class="pg"><span><b>${p.confirmed}</b>/${p.total} 확인</span>${p.blocked ? `<span class="bk">막힘 ${p.blocked}</span>` : ""}<span class="snt">보냄 ${p.sent}</span></div>
      <div class="bar-track" aria-hidden="true"><i style="width:${p.total ? (p.sent / p.total) * 100 : 0}%" class="b-sent"></i><i style="width:${p.total ? ((p.confirmed - p.sent) / p.total) * 100 : 0}%" class="b-ok"></i></div>
      <button class="primary" id="send" type="button" ${p.ready ? "" : "disabled"}>${p.ready ? `확인한 ${p.ready}건 보내기` : p.sent === p.total ? "모두 보냈어요" : "확인한 리포트가 없어요"}</button>` : "";
    const any = waiting > 0;
    $("mode").dataset.mode = any ? "wait" : st.cards.some((c) => c.ai.mode === "ai") ? "ai" : "rule";
    const r = st.cards.find((c) => c.ai.reason);
    $("mode").innerHTML = any ? `<i></i>Claude가 ${waiting}건 쓰는 중` : st.cards.some((c) => c.ai.mode === "ai") ? `Claude로 초안 · ${st.cards.filter((c) => c.ai.mode === "ai").length}건` : `규칙 기반${r ? ` · ${esc(r.ai.reason)}` : ""}`;
    $("spent").textContent = st.doneMin ? `${st.doneMin}분` : st.startedAt ? "작성 중" : "-";
  }

  $("cards").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b || b.dataset.act === "confirm") return;
    const c = st.cards.find((x) => x.id === b.closest(".card").dataset.id);
    const act = b.dataset.act;
    const before = clone(c);
    if (act === "edit") { editing = editing === c.id ? null : c.id; renderCards(); if (editing) $(`ed-${c.id}`)?.focus(); return; }
    if (act === "remove") { c.text = L.removeName(c.text, b.dataset.name); c.edited = true; c.confirmed = false; toast(`'${b.dataset.name}'이 든 문장을 지웠어요`, () => { Object.assign(c, before); save(); renderCards(); }); }
    if (act === "ack") { c.acked = [...(c.acked || []), b.dataset.name]; toast(`'${b.dataset.name}' 언급을 그대로 두기로 했어요. 내용을 한 번 더 읽어 주세요`, () => { Object.assign(c, before); save(); renderCards(); }); }
    save(); renderCards();
  });
  $("cards").addEventListener("change", (e) => {
    const cb = e.target.closest('input[data-act="confirm"]'); if (!cb) return;
    const c = st.cards.find((x) => x.id === cb.closest(".card").dataset.id);
    c.confirmed = cb.checked;
    if (editing === c.id) editing = null;
    save(); renderCards();
  });
  $("cards").addEventListener("input", (e) => {
    const ta = e.target.closest("textarea[data-ed]"); if (!ta) return;
    const c = st.cards.find((x) => x.id === ta.dataset.ed);
    c.text = ta.value; c.edited = true;
    if (c.confirmed) { c.confirmed = false; toast("고친 뒤에는 다시 확인해야 보낼 수 있어요"); }
    save(); renderSendbar();
  });

  /* ---------- 보내기 (데모: 기록만) ---------- */
  $("sendbar").addEventListener("click", (e) => {
    if (e.target.id !== "send") return;
    const ready = st.cards.filter((c) => L.canSend(c, st.roster));
    if (!ready.length) return;
    const before = clone({ cards: st.cards, log: st.log, doneMin: st.doneMin });
    const now = new Date();
    const at = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    ready.forEach((c) => { c.sent = true; c.sentAt = at; st.log.unshift(L.logEntry(c, student(c.name), at)); });
    if (st.cards.every((c) => c.sent)) st.doneMin = L.minutes(st.startedAt, Date.now());
    save(); renderCards(); renderLog();
    toast(`${ready.length}건을 보냈어요 (데모: 실제 발송 없음)`, () => { Object.assign(st, before); save(); renderCards(); renderLog(); });
  });
  function renderLog() {
    $("log").innerHTML = st.log.map((l) => `<li><time>${esc(l.at)}</time><b>${esc(l.name)}</b><span>${esc(l.to)} · ${esc(l.phone)}</span><span class="ch">${l.chars}자</span></li>`).join("") || `<li class="none">아직 보낸 리포트가 없어요.</li>`;
  }

  /* ---------- 리포트 만들기 ---------- */
  async function make(opts) {
    if (!st.memo.trim()) { toast("수업 메모를 먼저 써 주세요"); $("memo").focus(); return; }
    const before = clone(st);
    const my = ++runToken;
    parsed = L.parseMemo(st.memo, st.roster);
    const lesson = { className: st.cls, topic: "오늘 수업 내용", tutor: st.tutor };
    st.cards = st.roster.map((s, i) => ({ id: `c${Date.now().toString(36)}${i}`, name: s.name, text: L.draftRule(s, lesson, parsed), edited: false, confirmed: false, acked: [], sent: false, ai: { mode: "rule", reason: "" }, waiting: AI.status().enabled !== false }));
    st.log = []; st.startedAt = Date.now(); st.doneMin = 0; editing = null;
    if (opts && opts.preconfirm) st.cards.forEach((c) => { if (opts.preconfirm.includes(c.name)) c.confirmed = true; });
    waiting = st.cards.filter((c) => c.waiting).length;
    save(); renderMemo(); renderCards(); renderLog();
    if (!(opts && opts.quiet) && before.cards.some((c) => c.edited || c.confirmed || c.sent)) toast("새 초안으로 바꿨어요", () => { st = before; parsed = L.parseMemo(st.memo, st.roster); save(); renderAll(); });

    await Promise.all(st.cards.map(async (c) => {
      const s = student(c.name);
      const notes = parsed.by[c.name] || [];
      const r = await AI.ask("lessonreport.draft", { student: c.name, recipient: s.to === "parent" ? "보호자" : "본인", className: st.cls, common: parsed.common, notes, tutor: st.tutor });
      if (my !== runToken) return;
      c.waiting = false; waiting = Math.max(0, waiting - 1);
      const n = r && L.normalizeDraft(r.data, s, st.roster, notes);
      if (n && !c.edited && !c.confirmed) { c.text = n.message; c.ai = { mode: "ai", ms: r.ms }; }
      else if (!n) c.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : whyKo(AI.status().reason) };
      save(); renderCards();
    }));
  }
  $("make").addEventListener("click", () => make());
  $("memo").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) make(); });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); parsed = L.parseMemo(st.memo, st.roster);
    make({ quiet: true, preconfirm: ["민서", "하윤"] });
    toast("샘플로 되돌렸어요", () => { st = before; parsed = L.parseMemo(st.memo, st.roster); save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  function renderAll() { renderMemo(); renderCards(); renderLog(); }
  const d = new Date();
  $("date").textContent = `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]})`;
  renderAll();
  AI.probe().then(() => { if (!saved) make({ quiet: true, preconfirm: ["민서", "하윤"] }); else { st.cards.forEach((c) => { c.waiting = false; }); renderCards(); } });
})();
