/* 모아닫기 — 화면 (DOM 다루기만 한다. 합치기·검사·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * '정리하기'를 누르면
 *   1) 똑같은 코멘트를 지우고 규칙으로 비슷한 코멘트를 합쳐 바로 보여 주고 (기다리지 않게)
 *   2) Claude(designreview.group)에게 같은 코멘트를 보내 다시 묶는다. 돌아오면 검사해서 덮어쓰고,
 *      틀리면 1)을 그대로 둔다. 어느 쪽이든 이미 닫은 결정(반영함·보류·안 함)은 지킨다.
 */
(function () {
  "use strict";
  const L = window.Moadatgi;
  const STORE_KEY = "career-design-review-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플: 팀 과제 '동네책방 앱' 2차 시안에 달린 피드백 17건 ---------- */
  const SAMPLE = `[카톡] 지우 · 홈: 배너 글씨가 너무 작아요
[피그마] 태민 · 홈: 메인 배너 텍스트 크기 키우면 좋겠어요
[메일] 윤 교수 · 홈: 배너 글자가 작아서 잘 안 읽힙니다
[피그마] 하린 · 홈: 추천 도서 카드 간격이 좁아 답답해요
[카톡] 지우 · 홈: 추천 도서 카드 사이 간격 좁아요
[피그마] 태민 · 검색: 검색창 안내 문구가 애매해요
[메일] 윤 교수 · 검색: 최근 검색어 지우기 버튼이 없음
[카톡] 하린 · 검색: 최근 검색어 삭제 버튼 필요
[메일] 하린 · 검색: 최근 검색어 삭제 버튼 필요
[피그마] 지우 · 상세: 구매 버튼 색이 배경이랑 비슷해서 안 보여요
[메일] 윤 교수 · 상세: 구매 버튼 색상 대비가 약함
[카톡] 태민 · 상세: 리뷰 영역 접기 기능 있으면 좋겠어요
[피그마] 하린 · 상세: 책 소개 글 줄 간격 넓혀 주세요
[메일] 윤 교수 · 결제: 결제가 몇 단계인지 진행 표시 필요. 자세한 건 yoon.prof@example.ac.kr 로
[피그마] 태민 · 결제: 진행 단계 표시가 있으면 좋겠어요
[카톡] 지우 · 결제: 쿠폰 입력칸 위치가 너무 아래
[피그마] 하린 · 결제: 배송지 입력 칸 이름이 안내 문구로만 있어요`;
  // 처음 화면에서 이미 닫혀 있는 결정 (코멘트 id 기준)
  const PRESET = { c1: ["done", ""], c4: ["wont", "브랜드 가이드의 카드 간격(16px) 유지"], c7: ["done", ""], c12: ["hold", "3차 시안에서 리뷰 영역과 함께 검토"] };

  function seed() {
    const comments = L.parsePaste(SAMPLE).ok.map((c, i) => ({ id: `c${i + 1}`, ...c }));
    return { comments, groups: [], removed: [], ai: { mode: "rule", reason: "" }, view: "all", src: "all", ran: false, preset: true };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.comments) && Array.isArray(v.groups)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;
  let asking = null; // 이유를 적는 중인 항목 {id, status}
  let fresh = new Set();

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  // 브라우저가 주는 영어 오류는 한국어로 바꿔 보여 준다
  const why = (r) => (/fetch|network|load failed/i.test(r || "") ? "서버에 연결할 수 없음" : r || "");
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${why(s.reason) || "AI 꺼짐"}`;
  });

  const asStatus = (s) => (s === "hold" ? "보류로" : `${L.STATUS[s]}으로`);
  const byId = () => new Map(st.comments.map((c) => [c.id, c]));
  const groupOf = (cid) => st.groups.find((g) => g.ids.includes(cid));

  /* ---------- 현황 ---------- */
  function renderFlow() {
    const s = L.stats(st.groups);
    const left = st.ran ? s.open : "–";
    $("flow").innerHTML = `
      <div class="st"><b>${st.comments.length}</b><span>받은 코멘트 · 3개 채널</span></div>
      <div class="st"><b>${st.ran ? st.removed.length : "–"}</b><span>똑같은 코멘트 지움</span></div>
      <div class="st"><b>${st.ran ? s.total : "–"}</b><span>수정 항목으로 합침</span></div>
      <div class="st left${st.ran && !s.open ? " zero" : ""}"><b>${left}</b><span>남은 수정 (놓치면 안 되는 것)</span></div>
      <div class="goal">목표치 · 정리 <b>1시간 → 10분</b> · 놓친 수정 <b>0건</b><br>닫음 ${s.closed}/${s.total} · 반영 ${s.done} · 보류 ${s.hold} · 안 함 ${s.wont}<div class="meter"><i style="width:${s.pct}%"></i></div></div>`;
  }

  /* ---------- 왼쪽: 받은 코멘트 ---------- */
  function renderInbox() {
    const counts = { all: st.comments.length };
    st.comments.forEach((c) => { counts[c.source] = (counts[c.source] || 0) + 1; });
    $("srcChips").innerHTML = [["all", "전체"], ...Object.entries(L.SOURCES)].map(([k, n]) =>
      `<button type="button" data-src="${k}" aria-pressed="${st.src === k}">${k === "all" ? "" : `<i class="dot ${k}"></i>`}${n} ${counts[k] || 0}</button>`).join("");
    $("inN").textContent = st.comments.length;
    const list = st.comments.filter((c) => st.src === "all" || c.source === st.src);
    $("comments").innerHTML = list.map((c) => {
      const dup = st.removed.includes(c.id);
      const g = groupOf(c.id);
      const closed = g && g.status !== "open";
      return `<li data-cid="${c.id}" class="${dup ? "dup" : ""}${closed ? " closed" : ""}"><span class="src"><i class="dot ${c.source}"></i>${L.SOURCES[c.source]}</span>
        <span class="tx"><span class="who">${esc(c.author)}</span>${esc(L.maskContact(c.text))}${dup ? `<span class="tag">똑같은 코멘트</span>` : ""}</span><span class="sc">${esc(c.screen)}</span></li>`;
    }).join("") || `<li><span></span><span class="tx">이 채널의 코멘트가 없어요</span></li>`;
  }

  /* ---------- 오른쪽: 수정 항목 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 묶는 중</span>`;
    if (!st.ran) return "";
    if (st.ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(st.ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 비슷한 낱말 규칙으로 합쳤어요">규칙 기반${st.ai.reason ? ` · ${esc(st.ai.reason)}` : ""}</span>`;
  }
  function groupHtml(g, m) {
    const cs = g.ids.map((id) => m.get(id)).filter(Boolean);
    const who = [...new Set(cs.map((c) => c.author))];
    const dupOf = st.removed.filter((rid) => { const r = m.get(rid); return r && cs.some((c) => c.author === r.author && L.norm(c.text) === L.norm(r.text)); }).length;
    const ask = asking && asking.id === g.id;
    return `<article class="group ${g.status}${fresh.has(g.id) ? " new" : ""}" data-gid="${esc(g.id)}">
      <div class="top"><div><div class="sum">${esc(g.summary)}</div>
        <div class="meta"><span class="cnt">${g.ids.length + dupOf}건</span>${g.sources.map((s) => `<i class="dot ${s}" title="${L.SOURCES[s]}"></i>${L.SOURCES[s]}`).join(" ")} · ${who.map(esc).join(", ")}</div></div>
        <span class="badge ${g.status}">${L.STATUS[g.status]}</span></div>
      ${g.reason ? `<p class="reason">이유: ${esc(g.reason)}</p>` : ""}
      ${ask ? `<form class="why" data-why="${asking.status}"><label class="sr" for="why-${esc(g.id)}">${L.STATUS[asking.status]} 이유</label><input id="why-${esc(g.id)}" placeholder="이유 (예: 3차 시안에서 검토)" maxlength="80"><button class="ghost-btn" type="submit">${asStatus(asking.status)} 닫기</button></form>`
        : `<div class="acts">${g.status === "open" ? `<button type="button" data-st="done">반영함</button><button type="button" data-st="hold">보류</button><button type="button" data-st="wont">안 함</button>` : `<button type="button" class="reopen" data-st="open">다시 열기</button>`}
        ${g.ids.length > 1 ? `<button type="button" class="split-btn" data-split>합친 것 나누기</button>` : ""}</div>`}
      ${g.ids.length > 1 || dupOf ? `<details class="orig"><summary>원래 코멘트 ${g.ids.length + dupOf}건</summary><ul>${cs.map((c) => `<li>${L.SOURCES[c.source]} · ${esc(c.author)}: ${esc(L.maskContact(c.text))}${c.alsoIn && c.alsoIn.length ? ` (${c.alsoIn.map((s) => L.SOURCES[s]).join("·")}에도 같은 글)` : ""}</li>`).join("")}</ul></details>` : ""}
    </article>`;
  }
  function renderGroups() {
    document.querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === st.view)));
    $("modeChip").innerHTML = modeChip();
    $("groups").classList.toggle("waiting", waiting);
    if (!st.ran) { $("groups").innerHTML = `<p class="empty">‘정리하기’를 누르면 같은 의견을 한 항목으로 합쳐 드려요.</p>`; return; }
    const m = byId();
    const show = st.groups.filter((g) => st.view === "all" || (st.view === "open" ? g.status === "open" : g.status !== "open"));
    const screens = [...new Set(st.groups.map((g) => g.screen))];
    $("groups").innerHTML = screens.map((sc) => {
      const gs = show.filter((g) => g.screen === sc);
      if (!gs.length) return "";
      const all = st.groups.filter((g) => g.screen === sc);
      return `<h3 class="screen-h">${esc(sc)} <span>${all.filter((g) => g.status === "open").length}개 남음 / ${all.length}</span></h3>` + gs.map((g) => groupHtml(g, m)).join("");
    }).join("") || `<p class="empty">${st.view === "open" ? "남은 수정이 없어요. 모두 닫았어요." : "아직 닫은 항목이 없어요."}</p>`;
    fresh = new Set();
  }
  function renderAll() { renderFlow(); renderInbox(); renderGroups(); }

  /* ---------- 정리하기 ---------- */
  async function run(opts) {
    const my = ++runToken;
    const old = st.groups;
    const d = L.dedupe(st.comments);
    st.removed = d.removed;
    let groups = L.groupComments(d.comments);
    if (st.preset) {
      // 샘플의 미리 닫힌 결정을 얹는다
      groups = groups.map((g) => { const k = g.ids.find((id) => PRESET[id]); return k ? { ...g, status: PRESET[k][0], reason: PRESET[k][1] } : g; });
      st.preset = false;
    } else groups = L.carryStatus(old, groups);
    st.groups = groups; st.ran = true; st.ai = { mode: "rule", reason: "" };
    asking = null;
    waiting = AI.status().enabled !== false;
    save(); renderAll();
    // 보내는 것은 id·화면·내용뿐 (이름은 보내지 않는다)
    const r = await AI.ask("designreview.group", { comments: d.comments.map((c) => ({ id: c.id, screen: c.screen, text: L.maskContact(c.text) })) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeGroups(r.data, d.comments);
    if (n) {
      const before = new Set(st.groups.map((g) => g.id));
      st.groups = L.carryStatus(st.groups, n);
      fresh = new Set(st.groups.filter((g) => !before.has(g.id)).map((g) => g.id));
      st.ai = { mode: "ai", ms: r.ms };
    } else st.ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : why(AI.status().reason) };
    save(); renderAll();
    if (!(opts && opts.quiet)) toast(`코멘트 ${st.comments.length}건 → 수정 항목 ${st.groups.length}개 (${st.ai.mode === "ai" ? "Claude" : "규칙"})`);
  }

  /* ---------- 닫기 ---------- */
  function close(gid, status, reason) {
    const before = st.groups;
    const r = L.setStatus(st.groups, gid, status, reason);
    if (!r.ok) { toast(r.error); return false; }
    st.groups = r.groups; asking = null;
    save(); renderAll();
    const s = L.stats(st.groups);
    toast(status === "open" ? "다시 열었어요" : s.open ? `${asStatus(status)} 닫았어요 · 남은 수정 ${s.open}개` : "모든 수정 항목을 닫았어요", () => { st.groups = before; save(); renderAll(); });
    return true;
  }
  $("groups").addEventListener("click", (e) => {
    const card = e.target.closest(".group");
    if (!card) return;
    const gid = card.dataset.gid;
    const b = e.target.closest("button[data-st]");
    if (b) {
      const s = b.dataset.st;
      if (s === "hold" || s === "wont") { asking = { id: gid, status: s }; renderGroups(); document.getElementById(`why-${gid}`)?.focus(); return; }
      close(gid, s);
      return;
    }
    if (e.target.closest("button[data-split]")) {
      const before = st.groups;
      st.groups = L.splitGroup(st.groups, gid, st.comments);
      save(); renderAll();
      toast("합친 항목을 나눴어요", () => { st.groups = before; save(); renderAll(); });
    }
  });
  $("groups").addEventListener("submit", (e) => {
    const f = e.target.closest("form.why");
    if (!f) return;
    e.preventDefault();
    const gid = f.closest(".group").dataset.gid;
    if (!close(gid, f.dataset.why, f.querySelector("input").value)) f.querySelector("input").focus();
  });
  $("groups").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && asking) { asking = null; renderGroups(); }
  });
  // 항목에 올리면 왼쪽의 원래 코멘트가 밝혀진다
  function light(gid) {
    document.querySelectorAll(".comments li.lit").forEach((x) => x.classList.remove("lit"));
    const g = st.groups.find((x) => x.id === gid);
    if (!g) return;
    const m = byId();
    const twins = st.removed.filter((rid) => g.ids.some((id) => m.get(id).author === m.get(rid).author && L.norm(m.get(id).text) === L.norm(m.get(rid).text)));
    g.ids.concat(twins).forEach((id) => document.querySelector(`.comments li[data-cid="${id}"]`)?.classList.add("lit"));
  }
  $("groups").addEventListener("mouseover", (e) => { const c = e.target.closest(".group"); light(c ? c.dataset.gid : null); });
  $("groups").addEventListener("focusin", (e) => { const c = e.target.closest(".group"); light(c ? c.dataset.gid : null); });
  $("groups").addEventListener("mouseleave", () => light(null));

  document.querySelector(".items-tools .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    st.view = b.dataset.v; save(); renderGroups();
  });
  $("srcChips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-src]");
    if (!b) return;
    st.src = b.dataset.src; save(); renderInbox();
  });
  $("run").addEventListener("click", () => run());
  $("pasteAdd").addEventListener("click", () => {
    const p = L.parsePaste($("pasteIn").value);
    if (!p.ok.length) { toast(p.bad.length ? `${p.bad.join(", ")}번째 줄을 읽지 못했어요. [카톡] 이름 · 화면: 내용 형식인지 봐 주세요` : "붙여 넣은 코멘트가 없어요"); return; }
    const before = { comments: st.comments, groups: st.groups, removed: st.removed };
    let n = st.comments.reduce((mx, c) => Math.max(mx, +c.id.slice(1) || 0), 0);
    st.comments = st.comments.concat(p.ok.map((c) => ({ id: `c${++n}`, ...c })));
    $("pasteIn").value = "";
    run({ quiet: true }).then(() => toast(`${p.ok.length}건을 더했어요${p.bad.length ? ` · ${p.bad.length}줄은 형식이 달라 뺐어요` : ""}`, () => { Object.assign(st, before); save(); renderAll(); }));
  });
  $("notion").addEventListener("click", async () => {
    if (!st.groups.length) { toast("먼저 ‘정리하기’를 눌러 주세요"); return; }
    const out = L.toNotionMd($("projTitle").textContent, st.groups, st.comments);
    $("mdOut").textContent = out;
    $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(out); toast("복사했어요. Notion 페이지에 붙여 넣으세요"); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed();
    run({ quiet: true });
    toast("샘플 코멘트로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  renderAll();
  AI.probe().then(() => { if (!st.ran) run({ quiet: true }); });
})();
