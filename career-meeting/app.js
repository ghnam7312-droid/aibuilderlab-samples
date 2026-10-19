/* 회의끝 — 회의록을 결정사항·할 일·논의로 나누고 업무판에 올린다
 *
 * 1) 회의록을 줄 단위로 읽는다.
 *    - "@이름"이 있으면 할 일 (마감: 10/24 · 금요일까지 · 오늘 · 내일)
 *    - "결정:" 또는 "~하기로 함"이면 결정사항
 *    - 나머지는 논의
 * 2) 결과에서 담당·마감을 바로 고치고, 할 일을 업무판에 올린다.
 * 3) 업무판은 끌어 놓기(마우스) 또는 화살표 버튼(키보드)으로 단계를 바꾼다.
 *
 * 'AI 정리'는 이 데모에서 규칙으로 돈다. 실제 버전은 AI 요약 + Notion API.
 */

const STORE_KEY = "hoeuikkeut-v2";
const COLS = [["todo", "할 일"], ["doing", "진행 중"], ["done", "완료"]];
const DAYS = "일월화수목금토";
const AV_COLORS = ["#2F5BFF", "#0E8F65", "#B4489C", "#D9730D", "#6B5BD6", "#0B7A99"];

/* ---------- 날짜 도우미 ---------- */
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const plus = (n) => { const d = today0(); d.setDate(d.getDate() + n); return d; };
const withDay = (d) => `${md(d)}(${DAYS[d.getDay()]})`;
function nextWeekday(ch) {
  const t = DAYS.indexOf(ch), d = today0();
  d.setDate(d.getDate() + (((t - d.getDay() + 7) % 7) || 7));
  return d;
}
// "10/24" → 올해 날짜. 두 달 넘게 지난 날짜면 내년으로 본다.
function parseMD(m, d) {
  const now = today0();
  const x = new Date(now.getFullYear(), m - 1, d);
  if (now - x > 60 * 86400000) x.setFullYear(x.getFullYear() + 1);
  return x;
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- 샘플 회의록 (오늘 기준 날짜로 만든다) ---------- */
function sampleSrc() {
  return `[동아리 운영진 주간회의] ${withDay(today0())} 19:00
참석: 민지, 준호, 서연, 도윤

- 지난 해커톤 밋업 피드백 212건 확인. 발표 시간이 짧았다는 의견이 가장 많았음
- 결정: 다음 밋업 발표는 팀당 7분에서 10분으로 늘림
- 장소 후보 2곳(학생회관 3층, 공학관 세미나실) 비교. 공학관이 넓지만 주말 대관이 어려움
- 결정: 11월 밋업은 ${md(plus(26))}(토) 학생회관 3층에서 진행
- @서연 학생회관 대관 신청서 제출 ${md(plus(4))}까지
- @준호 발표팀 모집 공지 작성해서 단톡방에 올리기 금요일까지
- 마이크가 뒤쪽에서 잘 안 들린다는 의견 → 무선 마이크 1개 추가 검토
- @도윤 무선 마이크 대여 가능한지 학과 사무실에 문의 내일
- 예산은 지난달 남은 18만 원 안에서 쓰기로 함
- @민지 피드백 요약 보고서 동아리 노션에 정리 ${md(plus(7))}까지
- @서연 뒤풀이 장소 예약 ${md(plus(-1))}까지
- 다음 회의는 다음 주 같은 시간`;
}

/* ---------- 회의록 읽기 ---------- */
function parse(src) {
  const raw = src.split(/\n/);
  const lines = [];
  let title = "", attendees = [];
  raw.forEach((r) => {
    const text = r.replace(/^[\s\-•*·]+/, "").trim();
    if (!text) return;
    const idx = lines.length;
    if (!title && /^\[.+\]/.test(text)) { title = text; lines.push({ text, type: "head", label: "제목" }); return; }
    const att = text.match(/^참석\s*[:：]\s*(.+)$/);
    if (att) { attendees = att[1].split(/[,，、\s]+/).filter(Boolean); lines.push({ text, type: "head", label: "참석" }); return; }

    const who = text.match(/@([가-힣A-Za-z0-9_]+)/);
    if (who) {
      let due = null, dueText = "";
      const m1 = text.match(/(\d{1,2})\/(\d{1,2})(\([^)]*\))?\s*(까지)?/);
      const m2 = text.match(/([월화수목금토일])요일\s*까지/);
      const m3 = text.match(/(오늘|내일|모레)(\s*까지)?/);
      if (m1) { due = parseMD(+m1[1], +m1[2]); dueText = m1[0]; }
      else if (m2) { due = nextWeekday(m2[1]); dueText = m2[0]; }
      else if (m3) { due = plus({ 오늘: 0, 내일: 1, 모레: 2 }[m3[1]]); dueText = m3[0]; }
      const what = text.replace(who[0], "").replace(dueText, "").replace(/\s+/g, " ").trim();
      lines.push({ text, type: "task", who: who[1], what, due: due ? iso(due) : "", whoText: who[0], dueText, idx });
    } else if (/^결정\s*[:：]|기로\s*(함|했|결정)|로\s*결정|결정함/.test(text)) {
      lines.push({ text, type: "dec", clean: text.replace(/^결정\s*[:：]\s*/, "") });
    } else lines.push({ text, type: "note" });
  });
  lines.forEach((l, i) => (l.idx = i));
  return { title, attendees, lines };
}

/* ---------- 상태 ---------- */
function seed() {
  const src = sampleSrc();
  const result = parse(src);
  // 샘플은 할 일을 미리 업무판에 올려 둔다 (하나는 진행 중, 하나는 완료)
  const tasks = result.lines.filter((l) => l.type === "task").map((l, i) => ({
    id: i + 1, who: l.who, what: l.what, due: l.due, line: l.idx, status: i === 1 ? "doing" : i === 3 ? "done" : "todo",
  }));
  return { src, result, edits: {}, tasks, mode: "mark", person: "all" };
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v && typeof v.src === "string" && Array.isArray(v.tasks)) return v;
  } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
  return seed();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 무시: 화면은 계속 동작 */ } }
let st = load();
let justRan = false;

/* ---------- 공통 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// 담당자마다 겹치지 않는 색: 참석자 → 업무판에 나온 순서대로 배정
function colorOf(name) {
  const names = [...new Set([...(st.result?.attendees || []), ...st.tasks.map((t) => t.who)])];
  const i = names.indexOf(name);
  return AV_COLORS[(i < 0 ? names.length : i) % AV_COLORS.length];
}
const avatar = (name) => `<span class="av" style="background:${colorOf(name)}" aria-hidden="true">${esc(name.slice(-2))}</span>`;
function dueChip(due) {
  if (!due) return `<span class="chip">마감 없음</span>`;
  const d = new Date(due + "T00:00:00");
  const n = Math.round((d - today0()) / 86400000);
  if (n < 0) return `<span class="chip late">${-n}일 지남</span>`;
  if (n === 0) return `<span class="chip soon">오늘 마감</span>`;
  if (n <= 2) return `<span class="chip soon">D-${n}</span>`;
  return `<span class="chip">${withDay(d)}</span>`;
}
let toastTimer;
function toast(msg, undo) {
  $("toastMsg").textContent = msg;
  $("toastUndo").hidden = !undo;
  $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2200);
}

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
function renderMarked() {
  const r = st.result;
  const box = $("marked");
  if (!r) { box.innerHTML = `<li class="note"><span class="k">—</span><span>'정리하기'를 누르면 줄마다 무엇인지 표시돼요.</span></li>`; return; }
  const K = { head: "머리", dec: "결정", task: "할 일", note: "논의" };
  box.innerHTML = r.lines.map((l, i) => {
    let body = esc(l.text);
    if (l.type === "task") {
      body = body.replace(esc(l.whoText), `<span class="who">${esc(l.whoText)}</span>`);
      if (l.dueText) body = body.replace(esc(l.dueText), `<span class="when">${esc(l.dueText)}</span>`);
    }
    return `<li class="${l.type}" data-line="${l.idx}" style="--i:${i}"><span class="k">${l.label || K[l.type]}</span><span>${body}</span></li>`;
  }).join("");
  box.classList.toggle("just", justRan);
  const counts = r.lines.reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
  $("srcInfo").textContent = `${r.lines.length}줄 · 결정 ${counts.dec || 0} · 할 일 ${counts.task || 0}`;
}

/* ---------- 오른쪽: 정리 결과 ---------- */
function renderOut() {
  const r = st.result;
  if (!r) {
    $("out").innerHTML = `<div class="empty-out"><div><b>아직 정리하지 않았어요</b>왼쪽에 회의록을 넣고 '정리하기'를 누르세요.</div></div>`;
    return;
  }
  const dec = r.lines.filter((l) => l.type === "dec");
  const tasks = r.lines.filter((l) => l.type === "task").map((l) => ({ ...l, ...(st.edits[l.idx] || {}) }));
  const notes = r.lines.filter((l) => l.type === "note");
  const onBoard = (t) => st.tasks.some((x) => x.line === t.idx);
  const pending = tasks.filter((t) => !onBoard(t)).length;
  $("out").innerHTML = `
    <div class="pane-h"><h2 class="t">${esc(r.title.replace(/^\[|\].*$/g, "") || "회의 정리")}</h2><span class="ai-note" title="실제 버전은 AI 요약을 씁니다">브라우저 규칙 기반 데모</span></div>
    <p class="meta">${r.attendees.length ? `참석 ${r.attendees.length}명 · ${r.attendees.map(esc).join(", ")}` : "참석자 줄이 없어요 (참석: 이름, 이름)"}</p>
    <div class="blk dec"><h3>결정사항 <span class="n">${dec.length}</span></h3>
      <ul>${dec.map((l) => `<li>${esc(l.clean)}</li>`).join("") || `<li>찾은 결정이 없어요. '결정:'으로 시작하면 찾아요.</li>`}</ul></div>
    <div class="blk task"><h3>할 일 <span class="n">${tasks.length}</span></h3>
      ${tasks.length ? `<table class="tt"><thead><tr><th class="c-who">담당</th><th>할 일</th><th class="c-due">마감</th></tr></thead><tbody>
      ${tasks.map((t) => `<tr data-line="${t.idx}">
        <td class="c-who"><label class="sr" for="w${t.idx}">담당</label><input id="w${t.idx}" data-k="who" value="${esc(t.who)}"></td>
        <td><label class="sr" for="x${t.idx}">할 일</label><input id="x${t.idx}" data-k="what" value="${esc(t.what)}"></td>
        <td class="c-due"><label class="sr" for="d${t.idx}">마감 (월/일)</label><input id="d${t.idx}" data-k="due" placeholder="월/일" value="${t.due ? md(new Date(t.due + "T00:00:00")) : ""}"></td>
      </tr>`).join("")}</tbody></table>` : `<ul><li>찾은 할 일이 없어요. '@이름'을 붙이면 찾아요.</li></ul>`}
    </div>
    <div class="blk note"><h3>논의 <span class="n">${notes.length}</span></h3><ul>${notes.slice(0, 4).map((l) => `<li>${esc(l.text)}</li>`).join("") || "<li>없음</li>"}</ul></div>
    <button class="primary sm" id="push" type="button" ${pending ? "" : "disabled"}>${pending ? `할 일 ${pending}건 업무판에 올리기` : "모두 업무판에 있어요"}</button>`;
}

// 결과 표에서 담당·할 일·마감 고치기
$("out").addEventListener("change", (e) => {
  const inp = e.target.closest("input[data-k]");
  if (!inp) return;
  const line = Number(inp.closest("tr").dataset.line);
  const ed = (st.edits[line] = st.edits[line] || {});
  if (inp.dataset.k === "due") {
    const v = inp.value.trim();
    const m = v.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (v && !m) { inp.setAttribute("aria-invalid", "true"); toast("마감은 10/24처럼 월/일로 써 주세요"); return; }
    inp.removeAttribute("aria-invalid");
    ed.due = m ? iso(parseMD(+m[1], +m[2])) : "";
  } else ed[inp.dataset.k] = inp.value.trim();
  // 이미 업무판에 있는 카드도 함께 고친다
  const card = st.tasks.find((t) => t.line === line);
  if (card) Object.assign(card, ed);
  save();
  renderBoard();
});
$("out").addEventListener("click", (e) => {
  if (e.target.id !== "push") return;
  const before = st.tasks.slice();
  const tasks = st.result.lines.filter((l) => l.type === "task").map((l) => ({ ...l, ...(st.edits[l.idx] || {}) }));
  const added = [];
  for (const t of tasks) {
    if (st.tasks.some((x) => x.line === t.idx)) continue;
    const card = { id: Date.now() + t.idx, who: t.who, what: t.what, due: t.due, line: t.idx, status: "todo", fresh: true };
    st.tasks.push(card);
    added.push(card);
  }
  save(); renderOut(); renderBoard();
  added.forEach((c) => delete c.fresh);
  toast(`할 일 ${added.length}건을 올렸어요`, () => { st.tasks = before; save(); renderOut(); renderBoard(); });
  $("boardTitle").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
});

/* ---------- 업무판 ---------- */
function renderPeople() {
  const names = [...new Set(st.tasks.map((t) => t.who))];
  $("people").innerHTML = `<button type="button" data-p="all" aria-pressed="${st.person === "all"}" aria-label="모든 담당자"><span class="all">전체</span></button>` +
    names.map((n) => `<button type="button" data-p="${esc(n)}" aria-pressed="${st.person === n}" aria-label="${esc(n)}의 할 일만">${avatar(n)}</button>`).join("");
}
function renderBoard() {
  renderPeople();
  const list = st.person === "all" ? st.tasks : st.tasks.filter((t) => t.who === st.person);
  $("board").innerHTML = COLS.map(([k, label], ci) => {
    const cards = list.filter((t) => t.status === k)
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    return `<div class="col" data-col="${k}" aria-label="${label}">
      <div class="col-h">${label}<span>${cards.length}</span></div>
      ${cards.map((t) => `<article class="card${k === "done" ? " done" : ""}${t.fresh ? " new" : ""}" draggable="true" data-id="${t.id}" data-line="${t.line ?? ""}">
          <div class="what">${esc(t.what)}</div>
          <div class="row">${avatar(t.who)}<span class="who-n">${esc(t.who)}</span>${k === "done" ? `<span class="chip">완료</span>` : dueChip(t.due)}
            <span class="mv">
              <button type="button" data-mv="-1" ${ci === 0 ? "disabled" : ""} aria-label="${COLS[ci - 1]?.[1] ?? ""}(으)로">←</button>
              <button type="button" data-mv="1" ${ci === 2 ? "disabled" : ""} aria-label="${COLS[ci + 1]?.[1] ?? ""}(으)로">→</button>
              <button type="button" data-del aria-label="삭제">✕</button>
            </span></div>
        </article>`).join("") || `<div class="empty">${k === "done" ? "끝낸 일을 여기로 옮겨요" : "비어 있어요"}</div>`}
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
    document.querySelector(`.card[data-id="${t.id}"] button[data-mv="${mv.dataset.mv}"]:not(:disabled)`)?.focus();
  }
  if (e.target.closest("button[data-del]")) {
    const idx = st.tasks.findIndex((x) => String(x.id) === card.dataset.id);
    const [gone] = st.tasks.splice(idx, 1);
    save(); renderBoard(); renderOut();
    toast("할 일을 지웠어요", () => { st.tasks.splice(idx, 0, gone); save(); renderBoard(); renderOut(); });
  }
});
// 끌어 놓기
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
// 카드에 올리면 회의록의 출처 줄을 밝힌다
$("board").addEventListener("mouseover", (e) => {
  const c = e.target.closest(".card");
  document.querySelectorAll(".marked li.lit").forEach((x) => x.classList.remove("lit"));
  if (c && c.dataset.line !== "") document.querySelector(`.marked li[data-line="${c.dataset.line}"]`)?.classList.add("lit");
});
$("board").addEventListener("mouseleave", () => document.querySelectorAll(".marked li.lit").forEach((x) => x.classList.remove("lit")));
$("people").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-p]"); if (!b) return;
  st.person = b.dataset.p; save(); renderBoard();
});

/* ---------- Notion용 복사 ---------- */
$("notion").addEventListener("click", async () => {
  if (!st.tasks.length) { toast("업무판이 비어 있어요. 할 일을 먼저 올려 주세요"); return; }
  const title = st.result?.title?.replace(/^\[|\].*$/g, "") || "회의 할 일";
  const dec = st.result ? st.result.lines.filter((l) => l.type === "dec").map((l) => `- ${l.clean}`).join("\n") : "";
  const md2 = `## ${title}\n\n${dec ? `### 결정사항\n${dec}\n\n` : ""}` + COLS.map(([k, label]) => {
    const l = st.tasks.filter((t) => t.status === k);
    return l.length ? `### ${label}\n` + l.map((t) => `- [${k === "done" ? "x" : " "}] ${t.what} @${t.who}${t.due ? ` (마감 ${md(new Date(t.due + "T00:00:00"))})` : ""}`).join("\n") : "";
  }).filter(Boolean).join("\n\n");
  $("mdOut").textContent = md2;
  $("mdBox").hidden = false;
  try { await navigator.clipboard.writeText(md2); toast("복사했어요. Notion 페이지에 붙여 넣으세요"); }
  catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
});

/* ---------- 정리하기 · 모드 · 되돌리기 ---------- */
$("run").addEventListener("click", () => {
  const v = src.value.trim();
  if (!v) { setMode("edit"); toast("회의록을 먼저 붙여 넣어 주세요"); return; }
  st.src = src.value;
  st.result = parse(src.value);
  st.edits = {};
  // 회의록이 바뀌었으니 출처 줄 연결을 다시 맞춘다 (같은 담당·할 일이면 유지)
  st.tasks.forEach((t) => {
    const hit = st.result.lines.find((l) => l.type === "task" && l.who === t.who && l.what === t.what);
    t.line = hit ? hit.idx : null;
  });
  save();
  justRan = true;
  setMode("mark");
  renderMarked(); renderOut(); renderBoard();
  justRan = false;
  const c = st.result.lines.reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
  toast(`결정 ${c.dec || 0}건 · 할 일 ${c.task || 0}건을 찾았어요`);
});
$("modeEdit").addEventListener("click", () => setMode("edit"));
$("modeMark").addEventListener("click", () => {
  if (src.value !== st.src) { $("run").click(); return; }
  setMode("mark");
});
src.addEventListener("input", () => { $("srcInfo").textContent = `${src.value.split(/\n/).filter((l) => l.trim()).length}줄 · 고친 뒤 '정리하기'`; });
src.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("run").click(); });
$("reset").addEventListener("click", () => {
  const before = st;
  st = seed();
  save();
  src.value = st.src; setMode("mark"); renderMarked(); renderOut(); renderBoard();
  toast("샘플 회의록으로 되돌렸어요", () => { st = before; save(); src.value = st.src; setMode(st.mode); renderMarked(); renderOut(); renderBoard(); });
});

/* ---------- 시작 ---------- */
src.value = st.src;
src.hidden = st.mode !== "edit";
$("marked").hidden = st.mode === "edit";
$("modeEdit").setAttribute("aria-pressed", String(st.mode === "edit"));
$("modeMark").setAttribute("aria-pressed", String(st.mode === "mark"));
renderMarked(); renderOut(); renderBoard();
