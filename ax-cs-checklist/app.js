/* 본보기 — 화면 (DOM 다루기만 한다. 체크리스트·정책·예시 고르기는 logic.js, AI 호출은 ai-client.js)
 *
 * '점검하기'를 누르면
 *   1) 규칙으로 10항목을 바로 점검하고 (근거 문장 · 고칠 점 · 우리 팀 실제 예시)
 *   2) Claude 에게 같은 답변을 보내 판단만 다시 받는다. 정책·약속·쉬운 말은 규칙이 정하고,
 *      근거가 답변에 없는 말이면 지운다. 모범 답안은 받지 않는다.
 * 교육 자료 탭은 실제 우수 응답(팀장 평가 4.5점 이상, 정책과 같은 것)만 예시로 쓴다.
 */
(function () {
  "use strict";
  const L = window.Bonbogi;
  const STORE_KEY = "ax-cs-checklist-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 우리 팀 응답 (가상의 쇼핑몰 '솔담리빙') ---------- */
  const RESPONSES = [
    { id: "r1", source: "real", rating: 4.9, by: "윤○○ · 상담 6년차", inquiry: "의자 색이 달라 반품하고 싶어요", text: "안녕하세요, 솔담리빙 고객지원팀입니다. 받으신 의자 색상이 생각과 달라 반품을 문의하셨네요. 기대와 달라 불편하셨을 것 같아 죄송합니다. 반품은 상품을 받으신 날부터 7일 이내에 신청하실 수 있고, 단순 변심이라 왕복 배송비 6,000원이 들어요. 마이페이지 > 주문 내역에서 반품 신청을 눌러 주시면 내일까지 수거 일정을 문자로 보내 드립니다. 더 궁금하신 점은 이 채팅으로 말씀해 주세요. 감사합니다." },
    { id: "r2", source: "real", rating: 4.8, by: "김○○ · 상담 4년차", inquiry: "주문한 식탁이 아직 출고 준비 중이에요", text: "안녕하세요, 솔담리빙 고객지원팀입니다. 주문하신 식탁이 아직 출고 준비 중이라 문의 주셨네요. 오래 기다리시게 해서 죄송합니다. 확인해 보니 제작 일정이 늦어져 이번 주 금요일 출고 예정이고, 출고되면 송장번호를 문자로 보내 드려요. 주말 전 수령이 꼭 필요하시면 이 채팅으로 말씀해 주세요. 감사합니다." },
    { id: "r3", source: "real", rating: 4.7, by: "정○○ · 상담 5년차", inquiry: "화병이 깨져서 왔어요", text: "안녕하세요, 솔담리빙 고객지원팀입니다. 화병이 깨진 채로 도착했다고 남겨 주신 글 확인했어요. 받자마자 속상하셨을 텐데 정말 죄송합니다. 파손 상품은 배송비 없이 교환이나 반품을 도와드려요. 깨진 부분 사진을 이 문의에 첨부해 주시면 오늘 안에 확인하고 진행 방법을 안내드릴게요. 다른 궁금한 점은 고객센터 채팅으로 편하게 물어봐 주세요. 감사합니다." },
    { id: "r4", source: "real", rating: 4.6, by: "이○○ · 상담 3년차", inquiry: "반품한 러그 환불은 언제 되나요", text: "안녕하세요, 솔담리빙 고객지원팀입니다. 반품하신 러그의 환불이 언제 되는지 문의하셨네요. 기다리시게 해서 죄송합니다. 환불은 반품 상품이 확인된 뒤 영업일 3~5일 안에 결제하신 카드로 들어가요. 확인해 보니 상품은 어제 도착해 지금 검수 중이에요. 카드사 반영이 늦으면 이 문의에 답장 주세요. 감사합니다." },
    { id: "r6", source: "real", rating: 4.9, by: "오○○ · 상담 7년차", inquiry: "침대 커버를 슈퍼싱글로 바꾸고 싶어요", text: "안녕하세요, 솔담리빙 고객지원팀입니다. 침대 커버를 슈퍼싱글로 바꾸고 싶다고 말씀해 주셨네요. 포장을 뜯지 않으셨다면 받으신 날부터 7일 이내에 교환 신청이 가능하고, 사이즈 변경은 단순 변심이라 왕복 배송비 6,000원이 들어요. 마이페이지 > 주문 내역에서 교환 신청을 눌러 슈퍼싱글을 선택해 주시면 내일 수거 기사님이 방문해요. 더 궁금하신 점은 이 채팅으로 물어봐 주세요. 좋은 하루 보내세요." },
    { id: "r5", source: "real", rating: 4.0, by: "박○○ · 상담 2년차", inquiry: "회원 등급이 궁금해요", text: "회원 등급은 마이페이지에서 확인 가능합니다." },
    { id: "r7", source: "real", rating: 4.7, by: "한○○ · 상담 5년차 (작년 응답)", inquiry: "반품 기한이 궁금해요", text: "안녕하세요, 솔담리빙 고객지원팀입니다. 반품 기한을 문의하셨네요. 반품은 받으신 날부터 14일 이내에 신청하시면 돼요. 감사합니다." },
    { id: "a1", source: "ai", rating: null, by: "AI가 만든 모범 답안", inquiry: "반품하고 싶어요", text: "안녕하세요, 솔담리빙입니다! 고객님의 소중한 의견에 감사드립니다. 반품은 받으신 날부터 14일 이내 언제든 가능하며, 배송비는 무료로 처리해 드립니다. 최선을 다하겠습니다." },
    { id: "a2", source: "ai", rating: null, by: "AI가 만든 모범 답안", inquiry: "환불이 늦어요", text: "불편을 드려 정말 죄송합니다. 바로 전액 환불해 드리고, 사과의 뜻으로 쿠폰도 드리겠습니다." },
  ];
  /* ---------- 연습 문의와 신입의 첫 답변 ---------- */
  const INQ = [
    { id: "ret", label: "반품 · 배송비", q: "의자를 받은 지 5일 됐는데 색이 생각과 달라서 반품하고 싶어요. 배송비는 얼마인가요?", draft: "반품은 받으신 날부터 14일 안에 하시면 되고 배송비는 3,000원입니다. 회수 접수는 무료로 처리해 드릴게요." },
    { id: "ship", label: "배송 지연", q: "주문한 지 일주일인데 아직 출고 준비 중이에요. 이번 주말까지 받을 수 있나요?", draft: "안녕하세요. 현재 출고지시 전 상태입니다. 익일 출고 예정이니 반드시 주말 전에 받으시게 해 드리겠습니다." },
    { id: "dmg", label: "파손", q: "화병이 깨져서 왔어요. 어떻게 해야 하나요?", draft: "안녕하세요 솔담리빙 고객지원팀입니다. 파손 건은 당사 귀책 확인 후 처리됩니다. 사진 보내 주세요." },
  ];
  const SEED_HIST = [{ at: "1주차", inq: "반품 · 배송비", score: 40, mode: "rule" }, { at: "1주차", inq: "배송 지연", score: 56, mode: "rule" }, { at: "2주차", inq: "파손", score: 70, mode: "rule" }];

  /* ---------- 상태 ---------- */
  const seed = () => ({ inq: "ret", answers: Object.fromEntries(INQ.map((x) => [x.id, x.draft])), hist: SEED_HIST.slice(), tab: "check" });
  function load() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && v.answers && Array.isArray(v.hist)) return v; } catch (e) { /* 처음부터 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let res = null, mode = { kind: "rule", reason: "" }, waiting = false, runToken = 0, checkedText = "";
  const inq = () => INQ.find((x) => x.id === st.inq) || INQ[0];

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 위쪽 숫자 ---------- */
  function renderGoals() {
    const real = RESPONSES.filter((r) => r.source === "real").length;
    $("gSrc").textContent = `팀 실제 응답 ${real}건을 분석해 뽑음`;
    $("gEx").textContent = `${RESPONSES.filter((r) => L.usable(r).ok).length}건`;
    $("gScore").textContent = res ? `${res.passed}/${res.applicable}` : "—";
    $("gScoreSub").textContent = res ? `${res.score}점 · 해당 없음 ${10 - res.applicable}항목 제외` : "점검하기를 눌러 주세요";
  }

  /* ---------- 답변 점검 ---------- */
  function renderLeft() {
    $("inqs").innerHTML = INQ.map((x) => `<button type="button" data-inq="${x.id}" aria-pressed="${x.id === st.inq}">${esc(x.label)}</button>`).join("");
    $("inq").textContent = inq().q;
    $("answer").value = st.answers[st.inq] ?? "";
    $("policy").innerHTML = L.POLICY.map((p) => `<li><b>${esc(p.key)}</b> ${esc(p.text)}</li>`).join("");
    info();
  }
  function info() {
    const v = $("answer").value;
    $("ansInfo").textContent = `${v.length}자${checkedText && v !== checkedText ? " · 고친 뒤 다시 점검하세요" : ""}`;
  }
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 읽는 중</span>`;
    if (mode.kind === "ai") return `<span class="mode" data-mode="ai">Claude로 점검 · ${(mode.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 항목별 규칙으로 점검했어요">규칙 기반${mode.reason ? ` · ${esc(mode.reason)}` : ""}</span>`;
  }
  const ICON = { pass: "✓", fail: "!", na: "–" };
  function renderResult() {
    if (!res) { $("result").innerHTML = `<div class="empty-out"><b>아직 점검하지 않았어요</b>답변을 쓰고 ‘점검하기’를 누르세요.</div>`; return; }
    const fails = res.items.filter((r) => r.status === "fail").length;
    $("result").innerHTML = `
      <div class="pane-h"><h2>점검 결과</h2>${modeChip()}</div>
      <div class="score${waiting ? " waiting" : ""}">
        <div class="ring" style="--p:${res.score}"><b>${res.passed}</b><span>/ ${res.applicable}</span></div>
        <p>${fails ? `<b>${fails}항목</b>을 고치면 돼요. 고칠 항목마다 우리 팀 선배가 실제로 쓴 문장을 붙였어요.` : "<b>모든 항목 통과.</b> 이 답변은 그대로 보내도 좋아요."}</p>
      </div>
      <ol class="checks${waiting ? " waiting" : ""}">${res.items.map((r, i) => {
        const it = L.itemOf(r.id);
        const ex = r.status === "fail" ? L.exemplars(r.id, RESPONSES, 1)[0] : null;
        return `<li class="${r.status}">
          <span class="ic" aria-label="${r.status === "pass" ? "통과" : r.status === "fail" ? "고칠 점" : "해당 없음"}">${ICON[r.status]}</span>
          <div class="ck">
            <div class="ck-h"><span class="no">${i + 1}</span><b>${esc(it.label)}</b></div>
            ${r.status === "pass" && r.evidence ? `<q class="ev">${esc(r.evidence)}</q>` : ""}
            ${r.status === "fail" && r.evidence ? `<q class="ev bad">${esc(r.evidence)}</q>` : ""}
            ${r.status !== "pass" ? `<p class="note">${esc(r.note || it.why)}</p>` : ""}
            ${ex ? `<div class="ex"><span>우리 팀 실제 예시 · ${esc(ex.resp.by)} · ${ex.resp.rating}점</span><q>${esc(ex.evidence || ex.resp.text)}</q></div>` : ""}
          </div></li>`;
      }).join("")}</ol>`;
  }
  function renderHist() {
    const p = L.progress(st.hist);
    $("hist").innerHTML = st.hist.length ? `
      <div class="spark" role="img" aria-label="연습 점수 변화">${st.hist.slice(-12).map((h) => `<span style="--h:${h.score}" title="${esc(h.at)} · ${esc(h.inq)} · ${h.score}점"><i>${h.score}</i></span>`).join("")}</div>
      <p>${p.count}번 연습 · 처음 ${p.first}점 → 최근 ${p.last}점 · 최고 ${p.best}점. ${p.steady ? "<b>최근 3번 모두 80점 이상 — 실전 응대를 시작해도 좋아요.</b>" : "최근 3번이 모두 80점을 넘으면 실전 응대를 시작해요."}</p>`
      : `<p class="mute">아직 기록이 없어요.</p>`;
  }

  /** Claude 에게 판단만 다시 받는다. 그 사이 다시 눌렀으면 false */
  async function askAi(answer, q, rule, my) {
    const r = await AI.ask("cschecklist.review", { inquiry: q.q, answer, items: L.ITEMS.map((i) => ({ id: i.id, label: i.label, why: i.why })), policy: L.POLICY.map((p) => `${p.key}: ${p.text}`) });
    if (my !== runToken) return false;
    waiting = false;
    const n = r && L.normalizeReview(r.data, answer);
    if (n) { res = L.mergeReview(rule, n); mode = { kind: "ai", ms: r.ms }; }
    else mode = { kind: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    return true;
  }
  async function run() {
    const my = ++runToken;
    const answer = $("answer").value.trim();
    if (!answer) { toast("답변을 먼저 써 주세요"); $("answer").focus(); return; }
    st.answers[st.inq] = $("answer").value;
    checkedText = $("answer").value;
    const q = inq();
    const rule = L.review(answer, q.q);
    res = rule; mode = { kind: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderResult(); renderGoals(); info();
    if (!(await askAi(answer, q, rule, my))) return;
    st.hist.push({ at: "오늘", inq: q.label, score: res.score, mode: mode.kind });
    save();
    renderResult(); renderGoals(); renderHist();
  }

  /* ---------- 교육 자료 ---------- */
  function renderBook() {
    $("cards").innerHTML = L.ITEMS.map((it, i) => {
      const ex = L.exemplars(it.id, RESPONSES, 2);
      return `<li class="card"><div class="c-h"><span class="no">${i + 1}</span><h3>${esc(it.label)}</h3></div><p>${esc(it.why)}</p>
        ${ex.map((e) => `<figure><blockquote>${esc(e.evidence || e.resp.text)}</blockquote><figcaption>${esc(e.resp.by)} · 팀장 평가 ${e.resp.rating}점 · “${esc(e.resp.inquiry)}”에 대한 답</figcaption></figure>`).join("") || `<p class="mute">${it.id === "promise" || it.id === "plain" ? "우수 응답 모두 이 항목을 지켰어요. 금지 표현 목록으로 점검해요." : "아직 예시가 없어요."}</p>`}</li>`;
    }).join("");
    const out = RESPONSES.filter((r) => !L.usable(r).ok);
    $("excluded").innerHTML = `<summary>예시로 쓰지 않는 응답 ${out.length}건과 이유</summary><ul>${out.map((r) => `<li><b>${esc(r.by)}</b> <span class="why">${esc(L.usable(r).why)}</span><q>${esc(r.text)}</q></li>`).join("")}</ul>`;
  }
  function setTab(t) {
    st.tab = t;
    [["check", "tab-check", "p-check"], ["book", "tab-book", "p-book"]].forEach(([k, tab, panel]) => {
      $(tab).setAttribute("aria-selected", String(k === t));
      $(tab).tabIndex = k === t ? 0 : -1;
      $(panel).hidden = k !== t;
    });
    save();
  }

  /* ---------- 이벤트 ---------- */
  $("run").addEventListener("click", run);
  $("answer").addEventListener("input", () => { st.answers[st.inq] = $("answer").value; info(); save(); });
  $("answer").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("inqs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-inq]"); if (!b || b.dataset.inq === st.inq) return;
    st.inq = b.dataset.inq; checkedText = ""; res = null; runToken++; waiting = false;
    renderLeft(); renderResult(); renderGoals(); save();
  });
  $("clearHist").addEventListener("click", () => {
    const before = st.hist; st.hist = []; save(); renderHist();
    toast("연습 기록을 지웠어요", () => { st.hist = before; save(); renderHist(); });
  });
  ["tab-check", "tab-book"].forEach((id) => {
    $(id).addEventListener("click", () => setTab(id === "tab-check" ? "check" : "book"));
    $(id).addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const t = st.tab === "check" ? "book" : "check"; setTab(t); $(`tab-${t}`).focus();
    });
  });
  $("print").addEventListener("click", () => { setTab("book"); window.print(); });
  $("copyBook").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(L.buildBooklet(RESPONSES)); toast("교육 자료를 텍스트로 복사했어요"); }
    catch (e) { toast("복사하지 못했어요. 인쇄 · PDF를 써 주세요"); }
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); checkedText = ""; renderLeft(); setTab("check"); renderHist(); run();
    toast("샘플 답변과 기록으로 되돌렸어요", () => { st = before; save(); renderLeft(); setTab(st.tab); renderHist(); run(); });
  });

  /* ---------- 시작 ---------- */
  renderLeft(); renderBook(); renderHist(); setTab(st.tab || "check");
  res = L.review($("answer").value, inq().q); checkedText = $("answer").value;
  renderResult(); renderGoals();
  // 처음 화면: 신입의 첫 답변을 바로 점검해 보여 준다 (기록에는 남기지 않음)
  AI.probe().then(async () => {
    if (AI.status().enabled === false) { mode = { kind: "rule", reason: AI.status().reason }; renderResult(); return; }
    const my = ++runToken; waiting = true; renderResult();
    const answer = $("answer").value.trim();
    if (await askAi(answer, inq(), L.review(answer, inq().q), my)) { renderResult(); renderGoals(); }
  });
})();
