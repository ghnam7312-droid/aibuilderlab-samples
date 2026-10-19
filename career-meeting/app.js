/* 회의끝 — 화면 (DOM 다루기만 한다. 규칙·날짜·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * '정리하기'를 누르면
 *   1) 규칙으로 바로 정리해 보여 주고 (기다리지 않게)
 *   2) Claude 에게 같은 회의록을 보내 다시 정리한다. 돌아오면 줄 색이 다시 칠해지고,
 *      항목마다 '몇 번째 줄에서 나왔는지'가 붙는다. 실패하면 1)을 그대로 둔다.
 * 할 일은 업무판에 올리고, 마감 알림을 보여 주고, .ics 캘린더와 Notion 마크다운으로 내보낸다.
 */
(function () {
  "use strict";
  const L = window.Hoeuikkeut;
  const STORE_KEY = "hoeuikkeut-v3";
  const COLS = [["todo", "할 일"], ["doing", "진행 중"], ["done", "완료"]];
  const AV_COLORS = ["#2F5BFF", "#0E8F65", "#B4489C", "#D9730D", "#6B5BD6", "#0B7A99"];
  const K = { head: "머리", dec: "결정", task: "할 일", note: "논의" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 예시 회의록 (오늘 기준 날짜로 만든다) ---------- */
  function sample(kind) {
    const t = today();
    if (kind === "format") {
      return `[동아리 운영진 주간회의] ${L.withDay(t)} 19:00
참석: 민지, 준호, 서연, 도윤

- 지난 해커톤 밋업 피드백 212건 확인. 발표 시간이 짧았다는 의견이 가장 많았음
- 결정: 다음 밋업 발표는 팀당 7분에서 10분으로 늘림
- 장소 후보 2곳(학생회관 3층, 공학관 세미나실) 비교. 공학관이 넓지만 주말 대관이 어려움
- 결정: 11월 밋업은 ${L.md(L.addDays(t, 26))}(토) 학생회관 3층에서 진행
- @서연 학생회관 대관 신청서 제출 ${L.md(L.addDays(t, 4))}까지
- @준호 발표팀 모집 공지 작성해서 단톡방에 올리기 금요일까지
- 마이크가 뒤쪽에서 잘 안 들린다는 의견 → 무선 마이크 1개 추가 검토
- @도윤 무선 마이크 대여 가능한지 학과 사무실에 문의 내일
- 예산은 지난달 남은 18만 원 안에서 쓰기로 함
- @민지 피드백 요약 보고서 동아리 노션에 정리 ${L.md(L.addDays(t, 7))}까지
- @서연 뒤풀이 장소 예약 ${L.md(L.addDays(t, -1))}까지
- 다음 회의는 다음 주 같은 시간`;
    }
    // 받아 적은 그대로: 표시가 없어서 규칙으로는 거의 못 찾는다
    return `동아리 운영진 회의 ${L.withDay(t)} 저녁 7시 (기록: 민지)
참석: 민지, 준호, 서연, 도윤

지난 밋업 피드백 212개 다 읽어 봤는데 발표 시간 짧다는 얘기가 제일 많았음. 다들 10분은 줘야 한다는 쪽이라 다음부터 팀당 10분으로 가기로.
장소는 학생회관 3층이랑 공학관 세미나실 놓고 얘기했는데, 공학관은 주말 대관이 거의 안 돼서 결국 학생회관으로 정함. 날짜는 ${L.md(L.addDays(t, 26))} 토요일.
대관 신청서는 서연이가 이번 주 금요일까지 내 주기로 했고, 발표팀 모집 공지는 준호가 다음 주 월요일까지 단톡에 올리기로.
뒤쪽에서 마이크 안 들린다는 말이 꽤 있어서 도윤이가 내일 학과 사무실에 무선 마이크 빌릴 수 있는지 물어보기로 함.
예산은 지난달 남은 18만 원 안에서 해결하는 걸로.
피드백 요약은 내가(민지) 정리해서 다음 주 수요일까지 노션에 올릴 예정.
뒤풀이는 아직 장소 미정. 서연이가 후보 두 군데 알아 오기로.
다음 회의는 다음 주 같은 시간.`;
  }

  /* ---------- 상태 ---------- */
  function seed() {
    const src = sample("free");
    const result = L.parse(src, today());
    return { src, sample: "free", result, rule: null, ai: { mode: "rule", reason: "" }, edits: {}, tasks: [], mode: "mark", person: "all", ran: false };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.src === "string" && Array.isArray(v.tasks) && v.result && Array.isArray(v.result.lines)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let justRan = false;
  let waiting = false;
  let runToken = 0;

  /* ---------- 공통 ---------- */
  function colorOf(name) {
    const names = [...new Set([...(st.result?.attendees || []), ...st.tasks.map((t) => t.who)])];
    const i = names.indexOf(name);
    return AV_COLORS[(i < 0 ? names.length : i) % AV_COLORS.length];
  }
  const avatar = (name) => `<span class="av" style="background:${colorOf(name)}" aria-hidden="true">${esc(String(name).slice(-2))}</span>`;
  function dueChip(due) {
    const s = L.dueStatus(due, today());
    if (s.kind === "none") return `<span class="chip">마감 없음</span>`;
    if (s.kind === "late") return `<span class="chip late">${-s.n}일 지남</span>`;
    if (s.kind === "today") return `<span class="chip soon">오늘 마감</span>`;
    if (s.kind === "soon") return `<span class="chip soon">D-${s.n}</span>`;
    return `<span class="chip">${L.withDay(due)}</span>`;
  }
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
  const tasksWithEdits = () => (st.result?.tasks || []).map((t, n) => ({ ...t, n, ...(st.edits[n] || {}) }));

  /* ---------- AI 상태 ---------- */
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 왼쪽: 회의록 ---------- */
  const src = $("src");
  function setMode(m) {
    st.mode = m;
    src.hidden = m !== "edit";
    $("marked").hidden = m === "edit";
    $("modeEdit").setAttribute("aria-pressed", String(m === "edit"));
    $("modeMark").setAttribute("aria-pressed", String(m === "mark"));
    if (m === "edit") src.focus();
    save();
  }
  function renderSamples() {
    document.querySelectorAll("[data-sample]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sample === st.sample)));
  }
  function renderMarked() {
    const r = st.result;
    const box = $("marked");
    if (!r || !r.lines.length) { box.innerHTML = `<li class="note"><span class="k">—</span><span>회의록을 넣고 '정리하기'를 누르세요.</span></li>`; return; }
    box.innerHTML = r.lines.map((l, i) => {
      let body = esc(l.text);
      if (l.type === "task") {
        if (l.whoText) body = body.replace(esc(l.whoText), `<span class="who">${esc(l.whoText)}</span>`);
        if (l.dueText) body = body.replace(esc(l.dueText), `<span class="when">${esc(l.dueText)}</span>`);
      }
      // 이 줄에서 나온 항목 (Claude 정리일 때)
      const refs = (l.refs || []).map((ref) => {
        const [kind, n] = ref.split(":");
        const label = kind === "task" ? `할 일 ${+n + 1}` : kind === "dec" ? `결정 ${+n + 1}` : `논의 ${+n + 1}`;
        return `<button type="button" class="ref r-${kind}" data-go="${kind}:${n}">→ ${label}</button>`;
      }).join("");
      return `<li class="${l.type}" data-line="${l.idx}" style="--i:${i}"><span class="k">${l.label || K[l.type]}</span><span class="tx">${body}${refs ? `<span class="refs">${refs}</span>` : ""}</span></li>`;
    }).join("");
    box.classList.toggle("just", justRan);
    box.classList.toggle("waiting", waiting);
    $("srcInfo").textContent = `${r.lines.length}줄 · 결정 ${r.decisions.length} · 할 일 ${r.tasks.length}`;
  }

  /* ---------- 오른쪽: 정리 결과 ---------- */
  function srcBtn(line) {
    return line >= 0 ? `<button type="button" class="from" data-line="${line}" aria-label="${line + 1}번째 줄 보기">${line + 1}줄</button>` : `<span class="from none" title="회의록에서 같은 문장을 찾지 못했어요">문맥</span>`;
  }
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 읽는 중</span>`;
    if (st.ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(st.ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 표시(@이름, 결정:)만 읽었어요">규칙 기반${st.ai.reason ? ` · ${esc(st.ai.reason)}` : ""}</span>`;
  }
  function renderOut() {
    const r = st.result;
    if (!r || !st.ran) {
      $("out").innerHTML = `<div class="empty-out"><div><b>아직 정리하지 않았어요</b>회의록을 넣고 '정리하기'를 누르면 결정·할 일·논의로 나눠 드려요.</div></div>`;
      return;
    }
    const tasks = tasksWithEdits();
    const onBoard = (t) => st.tasks.some((x) => x.n === t.n && x.run === st.runId);
    const pending = tasks.filter((t) => !onBoard(t)).length;
    const cmp = st.cmp;
    $("out").innerHTML = `
      <div class="pane-h"><h2 class="t">${esc(r.title || "회의 정리")}</h2>${modeChip()}</div>
      <p class="meta">${r.attendees.length ? `참석 ${r.attendees.length}명 · ${r.attendees.map(esc).join(", ")}` : "참석자 줄이 없어요 (참석: 이름, 이름)"}</p>
      ${cmp ? `<p class="cmp">같은 회의록에서 <b>규칙</b>은 결정 ${cmp.rule.dec}·할 일 ${cmp.rule.task}건, <b>Claude</b>는 결정 ${cmp.ai.dec}·할 일 ${cmp.ai.task}건을 찾았어요.</p>` : ""}
      <div class="res${waiting ? " waiting" : ""}">
      <div class="blk dec"><h3>결정사항 <span class="n">${r.decisions.length}</span></h3>
        <ul>${r.decisions.map((d, n) => `<li data-item="dec:${n}" data-src="${d.line}"><span>${esc(d.text)}</span>${srcBtn(d.line)}</li>`).join("") || `<li class="none">찾은 결정이 없어요.${st.ai.mode !== "ai" ? " '결정:'으로 시작하면 규칙도 찾아요." : ""}</li>`}</ul></div>
      <div class="blk task"><h3>할 일 <span class="n">${tasks.length}</span></h3>
        ${tasks.length ? `<table class="tt"><thead><tr><th class="c-who">담당</th><th>할 일</th><th class="c-due">마감</th><th class="c-src"><span class="sr">출처</span></th></tr></thead><tbody>
        ${tasks.map((t) => `<tr data-item="task:${t.n}" data-src="${t.line}" data-n="${t.n}">
          <td class="c-who"><label class="sr" for="w${t.n}">담당</label><input id="w${t.n}" data-k="who" value="${esc(t.who)}"></td>
          <td><label class="sr" for="x${t.n}">할 일</label><input id="x${t.n}" data-k="what" value="${esc(t.what)}"></td>
          <td class="c-due"><label class="sr" for="d${t.n}">마감 (월/일)</label><input id="d${t.n}" data-k="due" placeholder="월/일" value="${t.due ? L.md(t.due) : ""}"></td>
          <td class="c-src">${srcBtn(t.line)}</td>
        </tr>`).join("")}</tbody></table>` : `<ul><li class="none">찾은 할 일이 없어요.${st.ai.mode !== "ai" ? " AI가 꺼져 있어 '@이름'이 붙은 줄만 읽었어요." : ""}</li></ul>`}
      </div>
      <div class="blk note"><h3>논의 <span class="n">${r.notes.length}</span></h3><ul>${r.notes.slice(0, 5).map((d, n) => `<li data-item="note:${n}" data-src="${d.line}">${esc(d.text)}</li>`).join("") || "<li>없음</li>"}</ul></div>
      </div>
      <button class="primary sm" id="push" type="button" ${pending && !waiting ? "" : "disabled"}>${waiting ? "Claude 결과를 기다리는 중" : pending ? `할 일 ${pending}건 업무판에 올리기` : "모두 업무판에 있어요"}</button>`;
  }

  // 결과 표에서 담당·할 일·마감 고치기
  $("out").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-k]");
    if (!inp) return;
    const n = Number(inp.closest("tr").dataset.n);
    const ed = (st.edits[n] = st.edits[n] || {});
    if (inp.dataset.k === "due") {
      const v = inp.value.trim();
      const m = v.match(/^(\d{1,2})\/(\d{1,2})$/);
      const due = m ? L.parseMD(today(), +m[1], +m[2]) : "";
      if (v && !due) { inp.setAttribute("aria-invalid", "true"); toast("마감은 10/24처럼 월/일로 써 주세요"); return; }
      inp.removeAttribute("aria-invalid");
      ed.due = due;
    } else ed[inp.dataset.k] = inp.value.trim();
    const card = st.tasks.find((t) => t.n === n && t.run === st.runId);
    if (card) Object.assign(card, ed);
    save();
    renderBoard();
  });
  $("out").addEventListener("click", (e) => {
    const from = e.target.closest("button.from");
    if (from) {
      if (st.mode === "edit") setMode("mark");
      flash(document.querySelector(`.marked li[data-line="${from.dataset.line}"]`));
      return;
    }
    if (e.target.id !== "push") return;
    const before = st.tasks.slice();
    const added = [];
    for (const t of tasksWithEdits()) {
      if (st.tasks.some((x) => x.n === t.n && x.run === st.runId)) continue;
      const card = { id: `${st.runId}-${t.n}`, run: st.runId, n: t.n, who: t.who, what: t.what, due: t.due, line: t.line, status: "todo", fresh: true };
      st.tasks.push(card);
      added.push(card);
    }
    save(); renderOut(); renderBoard();
    added.forEach((c) => delete c.fresh);
    toast(`할 일 ${added.length}건을 올렸어요`, () => { st.tasks = before; save(); renderOut(); renderBoard(); });
    $("boardTitle").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  });
  // 결과 항목 ↔ 출처 줄 함께 밝히기
  function lightLine(line) {
    document.querySelectorAll(".marked li.lit").forEach((x) => x.classList.remove("lit"));
    if (line !== undefined && line !== "" && Number(line) >= 0) document.querySelector(`.marked li[data-line="${line}"]`)?.classList.add("lit");
  }
  $("out").addEventListener("mouseover", (e) => { const it = e.target.closest("[data-src]"); lightLine(it ? it.dataset.src : undefined); });
  $("out").addEventListener("focusin", (e) => { const it = e.target.closest("[data-src]"); lightLine(it ? it.dataset.src : undefined); });
  $("out").addEventListener("mouseleave", () => lightLine());
  $("marked").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-go]");
    if (!b) return;
    flash(document.querySelector(`#out [data-item="${b.dataset.go}"]`));
  });

  /* ---------- 업무판 ---------- */
  function renderPeople() {
    const names = [...new Set(st.tasks.map((t) => t.who))];
    if (st.person !== "all" && !names.includes(st.person)) st.person = "all";
    $("people").innerHTML = `<button type="button" data-p="all" aria-pressed="${st.person === "all"}" aria-label="모든 담당자"><span class="all">전체</span></button>` +
      names.map((n) => `<button type="button" data-p="${esc(n)}" aria-pressed="${st.person === n}" aria-label="${esc(n)}의 할 일만">${avatar(n)}</button>`).join("");
  }
  function renderRemind() {
    const list = L.reminders(st.tasks, today());
    const box = $("remind");
    box.hidden = !list.length;
    if (!list.length) return;
    const lab = (s) => (s.kind === "late" ? `${-s.n}일 지남` : s.kind === "today" ? "오늘 마감" : `D-${s.n}`);
    box.innerHTML = `<b>마감 알림</b>` + list.map((t) =>
      `<button type="button" class="rm ${t.ds.kind}" data-card="${esc(t.id)}"><span class="lab">${lab(t.ds)}</span>${esc(t.who)} · ${esc(t.what.length > 22 ? t.what.slice(0, 22) + "…" : t.what)}</button>`).join("");
  }
  function renderBoard() {
    renderPeople();
    renderRemind();
    const list = st.person === "all" ? st.tasks : st.tasks.filter((t) => t.who === st.person);
    $("board").innerHTML = COLS.map(([k, label], ci) => {
      const cards = list.filter((t) => t.status === k).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      return `<div class="col" data-col="${k}" aria-label="${label}">
        <div class="col-h">${label}<span>${cards.length}</span></div>
        ${cards.map((t) => `<article class="card${k === "done" ? " done" : ""}${t.fresh ? " new" : ""}" draggable="true" data-id="${esc(t.id)}" data-line="${t.run === st.runId && t.line >= 0 ? t.line : ""}">
            <div class="what">${esc(t.what)}</div>
            <div class="row">${avatar(t.who)}<span class="who-n">${esc(t.who)}</span>${k === "done" ? `<span class="chip">완료</span>` : dueChip(t.due)}
              <span class="mv">
                <button type="button" data-mv="-1" ${ci === 0 ? "disabled" : ""} aria-label="${COLS[ci - 1]?.[1] ?? ""}(으)로">←</button>
                <button type="button" data-mv="1" ${ci === 2 ? "disabled" : ""} aria-label="${COLS[ci + 1]?.[1] ?? ""}(으)로">→</button>
                <button type="button" data-del aria-label="삭제">✕</button>
              </span></div>
          </article>`).join("") || `<div class="empty">${k === "done" ? "끝낸 일을 여기로 옮겨요" : k === "todo" && !st.tasks.length ? "정리한 할 일을 '업무판에 올리기'로 가져와요" : "비어 있어요"}</div>`}
      </div>`;
    }).join("");
  }
  function moveCard(id, to) {
    const t = st.tasks.find((x) => String(x.id) === String(id));
    if (!t || t.status === to) return;
    t.status = to;
    save(); renderBoard();
    if (to === "done") toast(`'${t.what.slice(0, 18)}${t.what.length > 18 ? "…" : ""}' 완료`);
  }
  $("board").addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const mv = e.target.closest("button[data-mv]");
    if (mv) {
      const t = st.tasks.find((x) => String(x.id) === card.dataset.id);
      const ci = COLS.findIndex(([k]) => k === t.status) + Number(mv.dataset.mv);
      moveCard(t.id, COLS[ci][0]);
      document.querySelector(`.card[data-id="${CSS.escape(String(t.id))}"] button[data-mv="${mv.dataset.mv}"]:not(:disabled)`)?.focus();
    }
    if (e.target.closest("button[data-del]")) {
      const idx = st.tasks.findIndex((x) => String(x.id) === card.dataset.id);
      const [gone] = st.tasks.splice(idx, 1);
      save(); renderBoard(); renderOut();
      toast("할 일을 지웠어요", () => { st.tasks.splice(idx, 0, gone); save(); renderBoard(); renderOut(); });
    }
  });
  $("remind").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-card]");
    if (!b) return;
    st.person = "all"; renderBoard();
    flash(document.querySelector(`.card[data-id="${CSS.escape(b.dataset.card)}"]`));
  });
  let dragId = null;
  $("board").addEventListener("dragstart", (e) => {
    const c = e.target.closest(".card"); if (!c) return;
    dragId = c.dataset.id; c.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
  });
  $("board").addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".dragging,.over").forEach((x) => x.classList.remove("dragging", "over")); });
  $("board").addEventListener("dragover", (e) => {
    const col = e.target.closest(".col"); if (!col || !dragId) return;
    e.preventDefault();
    document.querySelectorAll(".col.over").forEach((x) => x !== col && x.classList.remove("over"));
    col.classList.add("over");
  });
  $("board").addEventListener("drop", (e) => {
    const col = e.target.closest(".col"); if (!col || !dragId) return;
    e.preventDefault();
    moveCard(dragId, col.dataset.col);
  });
  $("board").addEventListener("mouseover", (e) => { const c = e.target.closest(".card"); lightLine(c ? c.dataset.line : undefined); });
  $("board").addEventListener("mouseleave", () => lightLine());
  $("people").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    st.person = b.dataset.p; save(); renderBoard();
  });

  /* ---------- 내보내기 ---------- */
  $("notion").addEventListener("click", async () => {
    if (!st.tasks.length) { toast("업무판이 비어 있어요. 할 일을 먼저 올려 주세요"); return; }
    const out = L.toNotionMd(st.result?.title, st.result?.decisions || [], st.tasks, COLS);
    $("mdOut").textContent = out;
    $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(out); toast("복사했어요. Notion 페이지에 붙여 넣으세요"); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("ics").addEventListener("click", () => {
    const withDue = st.tasks.filter((t) => t.due && t.status !== "done");
    if (!withDue.length) { toast(st.tasks.length ? "마감이 있는 할 일이 없어요. 결과 표에서 마감을 넣어 주세요" : "업무판이 비어 있어요. 할 일을 먼저 올려 주세요"); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const ics = L.buildIcs(st.tasks, st.result?.title || "회의 할 일", stamp);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    a.download = `회의끝-할일-${today().replace(/-/g, "")}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`할 일 ${withDue.length}건을 캘린더 파일로 내려받았어요`);
  });

  /* ---------- 정리하기 ---------- */
  function relinkCards() {
    // 회의록이 바뀌었으니 업무판 카드의 출처 줄을 다시 맞춘다 (같은 담당·할 일이면 유지)
    st.tasks.forEach((t) => {
      const hit = st.result.tasks.findIndex((x) => x.who === t.who && x.what === t.what);
      if (hit >= 0) { t.run = st.runId; t.n = hit; t.line = st.result.tasks[hit].line; }
      else { t.line = L.matchLine(t.what, st.result.lines); }
    });
  }
  async function run(opts) {
    const v = src.value.trim();
    if (!v) { setMode("edit"); toast("회의록을 먼저 붙여 넣어 주세요"); return; }
    const my = ++runToken;
    st.src = src.value;
    const t = today();
    const rule = L.parse(src.value, t);
    st.result = rule; st.ai = { mode: "rule", reason: "" }; st.cmp = null; st.edits = {}; st.ran = true;
    st.runId = `r${Date.now().toString(36)}`;
    relinkCards();
    waiting = AI.status().enabled !== false;
    justRan = true;
    setMode("mark");
    renderMarked(); renderOut(); renderBoard();
    justRan = false;

    const r = await AI.ask("meeting.extract", { notes: src.value.slice(0, 8000), today: t, weekday: L.DAYS[L.d0(t).getDay()] + "요일" });
    if (my !== runToken) return; // 그 사이 다시 눌렀으면 이 결과는 버린다
    waiting = false;
    const n = r && L.normalizeExtract(r.data);
    if (n) {
      st.result = L.mergeAi(rule, n);
      st.cmp = L.compare(rule, st.result);
      st.ai = { mode: "ai", ms: r.ms };
      relinkCards();
      justRan = true;
    } else {
      st.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    }
    // 처음 온 사람: 업무판도 채워 둔다 (하나는 진행 중, 하나는 완료)
    if (opts && opts.seedBoard && !st.tasks.length) {
      tasksWithEdits().forEach((x, i) => st.tasks.push({ id: `${st.runId}-${x.n}`, run: st.runId, n: x.n, who: x.who, what: x.what, due: x.due, line: x.line, status: i === 1 ? "doing" : i === 3 ? "done" : "todo" }));
    }
    save();
    renderMarked(); renderOut(); renderBoard();
    justRan = false;
    toast(`${st.ai.mode === "ai" ? "Claude가" : "규칙으로"} 결정 ${st.result.decisions.length}건 · 할 일 ${st.result.tasks.length}건을 찾았어요`);
  }
  $("run").addEventListener("click", () => run());
  $("modeEdit").addEventListener("click", () => setMode("edit"));
  $("modeMark").addEventListener("click", () => {
    if (src.value !== st.src) { run(); return; }
    setMode("mark");
  });
  document.querySelector(".samples").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sample]");
    if (!b || b.dataset.sample === st.sample && src.value === sample(st.sample)) return;
    const before = { src: src.value, sample: st.sample };
    st.sample = b.dataset.sample;
    src.value = sample(st.sample);
    renderSamples();
    run();
    toast(st.sample === "free" ? "받아 적은 그대로의 회의록이에요" : "형식을 맞춘 회의록이에요", () => { st.sample = before.sample; src.value = before.src; renderSamples(); run(); });
  });
  src.addEventListener("input", () => { $("srcInfo").textContent = `${src.value.split(/\n/).filter((l) => l.trim()).length}줄 · 고친 뒤 '정리하기'`; });
  src.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed();
    src.value = st.src; renderSamples(); setMode("mark");
    run({ seedBoard: true });
    toast("샘플 회의록으로 되돌렸어요", () => { st = before; save(); src.value = st.src; renderSamples(); setMode(st.mode); renderMarked(); renderOut(); renderBoard(); });
  });

  /* ---------- 시작 ---------- */
  src.value = st.src;
  src.hidden = st.mode !== "edit";
  $("marked").hidden = st.mode === "edit";
  $("modeEdit").setAttribute("aria-pressed", String(st.mode === "edit"));
  $("modeMark").setAttribute("aria-pressed", String(st.mode === "mark"));
  renderSamples();
  renderMarked(); renderOut(); renderBoard();
  // 처음 온 사람에게는 바로 정리해 보여 준다 (AI 상태를 확인한 뒤)
  // AI를 쓸 수 없으면 규칙이 읽을 수 있는 '형식 맞춘 회의록'으로 시작한다
  AI.probe().then((s) => {
    if (st.ran) return;
    if (!s.enabled) { st.sample = "format"; st.src = src.value = sample("format"); renderSamples(); }
    run({ seedBoard: true });
  });
})();
