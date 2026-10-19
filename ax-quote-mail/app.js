/* 견적함 · app.js — 화면만 다룬다. 계산은 logic.js(QM), AI 호출은 ai-client.js(AI).
 *
 * 흐름
 *  1. '분류하기' → 규칙(QM.classify)으로 즉시 분류해 카드를 분류함으로 날린다
 *  2. 동시에 메일마다 Claude(mail.classify)에 물어본다. 답이 오면 그 결과로 다시 놓는다
 *     (확신 0.6 미만이면 '확인 필요'). AI가 안 되면 규칙 결과가 그대로 남는다
 *  3. 견적 요청은 진행표에 올라가고, '회신 초안'(mail.reply)을 바로 쓸 수 있다
 *  4. 키보드만으로 분류할 수 있다 — J/K 이동, 1~4 분류, E 추천 확정, R 회신, ? 도움말
 */
(() => {
  "use strict";

  const STORE_KEY = "gyeonjeokham:v3";
  const ME = { company: "다온오피스", sender: "영업지원팀 엑셀탈출" };
  const TODAY = new Date("2026-10-19T09:00:00+09:00"); // 샘플 기준일 (월)
  const { CATS, LANES, LANE_LABEL } = QM;
  const KEY_TO_CAT = { 1: "quote", 2: "order", 3: "ask", 4: "etc" };
  const BAR = { quote: "var(--red)", order: "var(--order)", ask: "var(--teal)", etc: "var(--etc)" };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = () => matchMedia("(max-width: 860px)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sec = (ms) => `${(ms / 1000).toFixed(1)}초`;

  /* ───────── 샘플 메일 (모든 회사·사람은 가상) ───────── */
  const SAMPLE = [
    ["한빛상사 구매팀", "김수정 과장", "sujeong.kim@hanbit.example", "08:02", "A4 용지 견적 요청드립니다", "안녕하세요, 한빛상사 구매팀 김수정입니다.\n\nA4 용지 50박스 견적 부탁드립니다.\n11월 5일까지 납품 가능하신지도 함께 알려 주세요.\n\n감사합니다."],
    ["대성테크 총무팀", "이준호 대리", "junho.lee@daesung.example", "08:09", "27인치 모니터 단가 문의", "27인치 모니터 12대 단가가 얼마인지 궁금합니다.\n이달 말까지 설치까지 끝나야 해서 일정도 같이 알려 주세요."],
    ["미래물산", "박서윤 주임", "seoyun@mirae.example", "08:15", "발주서 송부 (프린터 토너 30개)", "지난주 견적 주신 프린터 토너 30개 발주서 첨부합니다.\n입고일 확인 부탁드립니다."],
    ["서울푸드 경영지원팀", "정하늘 사원", "haneul@seoulfood.example", "08:21", "사무용 의자 견적서 요청", "사무용 의자 8개 견적서 보내 주세요.\n납기는 11월 20일 희망합니다."],
    ["그린오피스", "마케팅팀", "news@greenoffice.example", "08:30", "11월 신제품 카탈로그 안내", "11월 신제품 카탈로그를 안내드립니다.\n이번 달 한정 할인 행사도 함께 확인해 보세요."],
    ["동해물류", "최민혁 팀장", "mh.choi@donghae.example", "08:34", "무선 키보드 고장 문의", "지난달 받은 무선 키보드 2대가 고장 났습니다.\nAS 가능한지 문의드립니다."],
    ["하나디자인", "오지원 실장", "jiwon@hana-design.example", "08:41", "노트북 거치대 가격 알려 주세요", "노트북 거치대 25개 가격과 배송 일정 알려 주세요.\n12월 1일까지 필요합니다."],
    ["코리아메디", "윤재민 과장", "jm.yoon@koreamedi.example", "08:47", "주문 확정 · 프린터 토너 40개", "어제 받은 견적대로 프린터 토너 40개 주문 확정합니다.\n세금계산서는 기존 담당자에게 보내 주세요."],
    ["누리교육", "한소희 대리", "sohee@nuri.example", "08:52", "작년 단가 그대로인지 확인 부탁드립니다", "작년에 주문했던 A4 용지와 같은 단가인지 확인 부탁드립니다.\n수량은 정해지면 다시 말씀드릴게요."],
    ["바른회계사무소", "강도현 세무사", "dh.kang@barun.example", "09:01", "빠른 납품 감사합니다", "이번 납품 빠르게 처리해 주셔서 감사합니다.\n다음 분기에도 잘 부탁드립니다."],
    ["태양전자 구매팀", "서지호 차장", "jiho.seo@taeyang.example", "09:06", "모니터 30대 + 키보드 30개 견적", "모니터 27형 30대, 무선 키보드 30개 견적 부탁드립니다.\n11월 15일까지 회신 주시면 내부 품의 올리겠습니다."],
    ["한빛상사 구매팀", "김수정 과장", "sujeong.kim@hanbit.example", "09:12", "젖은 용지 반품 가능할까요", "어제 받은 용지 일부가 젖어서 왔습니다.\n반품이나 교환 가능할까요? 사진 첨부합니다."],
    ["스마트오피스협회", "사무국", "office@smartassoc.example", "09:18", "사무 자동화 세미나 초대", "11월 사무 자동화 세미나에 초대합니다.\n참가 신청은 협회 홈페이지에서 받습니다."],
    ["정우건설 현장사무소", "임태윤 소장", "ty.lim@jungwoo.example", "09:25", "의자 추가 주문 전에 견적 먼저", "현장 사무실 의자 10개 추가 주문하려는데, 단가 견적 먼저 받을 수 있을까요?"],
    ["오렌지마켓", "배유진 매니저", "yujin@orange.example", "09:31", "토너 입고 일정 확인", "발주한 토너 입고 일정 확인 부탁드립니다.\n이번 주 안에 받아야 합니다."],
    ["코리아메디", "윤재민 과장", "jm.yoon@koreamedi.example", "09:38", "회의 테이블 6개 견적 부탁드려요", "신규 회의실에 회의 테이블 6개 넣으려고 합니다.\n이번 주 금요일까지 견적 부탁드립니다."],
  ];
  let seq = 0;
  const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;
  function makeMail([co, person, email, at, subj, body]) {
    // ai: Claude 결과 {cat, need, confidence, reason, items, ms} / reply: 회신 초안 {subject, body, mode, ms}
    return { id: uid(), co, person, email, at, subj, body, final: null, status: "견적 작성 전", ai: null, reply: null, ...QM.extract({ subj, body }) };
  }
  const fresh = () => ({ mails: SAMPLE.map(makeMail), sorted: false, lane: "need", cur: null });

  /* ───────── 상태 ───────── */
  let state = load() || fresh();
  const pending = new Set(); // Claude에 물어보는 중인 메일 id (저장하지 않음)
  function load() { try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 저장 실패해도 화면은 동작 */ } }
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const find = (id) => state.mails.find((x) => x.id === id);

  /** 메일 한 통의 판단: 사람이 정한 것 > Claude > 규칙 */
  function verdictOf(m) {
    const rule = QM.classify(m);
    if (m.ai) return { by: "ai", cat: m.ai.cat, need: m.ai.need, alt: m.ai.cat === rule.cat ? rule.alt : rule.cat, confidence: m.ai.confidence, rule };
    return { by: "rule", cat: rule.cat, need: rule.need, alt: rule.alt, confidence: rule.confidence, rule };
  }
  const laneOf = (m) => m.final || (verdictOf(m).need ? "need" : verdictOf(m).cat);
  const recOf = (m) => verdictOf(m).cat; // '확인 필요'에서 E로 확정할 때의 추천

  /* ───────── AI 상태 표시 ───────── */
  AI.onChange((s) => {
    const ind = $("#ai-ind");
    ind.dataset.on = s.enabled === true ? "on" : s.enabled === false ? "off" : "wait";
    $("#ai-ind-t").textContent = s.enabled === true ? "Claude 연결됨" : s.enabled === false ? "규칙 모드" : "AI 확인 중";
    ind.title = s.enabled === false ? `AI를 쓸 수 없어 규칙으로 분류합니다 (${s.reason})` : "메일 분류와 회신 초안에 Claude를 씁니다";
    renderNote();
  });

  function renderNote() {
    const s = AI.status();
    const done = state.mails.filter((m) => m.ai).length;
    const avg = (() => { const t = state.mails.filter((m) => m.ai && m.ai.ms); return t.length ? t.reduce((a, m) => a + m.ai.ms, 0) / t.length : 0; })();
    const el = $("#ai-note");
    if (pending.size) el.innerHTML = `<span class="chip ai busy">Claude가 읽는 중 · ${state.mails.length - pending.size}/${state.mails.length}</span>`;
    else if (done) el.innerHTML = `<span class="chip ai">Claude로 분석 · ${done}통 · 평균 ${sec(avg)}</span><span class="hint">확신 60% 미만은 사람에게 넘깁니다</span>`;
    else if (s.enabled === false) el.innerHTML = `<span class="chip rule">규칙 기반 · ${esc(s.reason)}</span><span class="hint">단어 점수가 비슷하면 사람에게 넘깁니다</span>`;
    else el.innerHTML = `<span class="hint">분류하면 Claude가 메일을 한 통씩 읽습니다</span>`;
  }

  /* ───────── 카드 ───────── */
  function card(m, where) {
    const v = verdictOf(m);
    const lane = state.sorted ? laneOf(m) : "";
    const busy = pending.has(m.id);
    let tags = "";
    if (state.sorted && lane !== "need") {
      tags = m.ai
        ? `<span class="aitag">AI ${Math.round(m.ai.confidence * 100)}%</span>`
        : (v.rule.hits[lane] || []).slice(0, 3).map((w) => `<span>${esc(w)}</span>`).join("");
      if (m.final) tags = `<span class="me">직접 정함</span>` + tags;
    }
    let pick = "";
    if (where === "lane" && lane === "need") {
      const opts = [v.cat, v.alt].filter((k, i, a) => k && a.indexOf(k) === i);
      pick = `<span class="pick">${opts.map((k, i) => `<button type="button" data-pick="${k}" data-id="${m.id}" class="${i === 0 ? "rec" : ""}">${LANE_LABEL[k]}${i === 0 ? `<kbd>E</kbd>` : ""}</button>`).join("")}</span>`;
    }
    const snippet = m.body.replace(/\s+/g, " ").trim();
    return `<div class="mail c-${lane || "none"}${busy ? " busy" : ""}${state.cur === m.id ? " cur" : ""}" data-id="${m.id}">
      <button type="button" class="mail-hit" data-open="${m.id}" aria-label="${esc(m.co)} · ${esc(m.subj)} 자세히 보기"></button>
      <span class="from"><b>${esc(m.co)}</b><span>${esc(m.at)}</span></span>
      <span class="subj">${esc(m.subj)}</span>
      <span class="snip">${esc(snippet)}</span>
      ${tags ? `<span class="why">${tags}</span>` : ""}
      ${pick}
    </div>`;
  }

  /* ───────── 그리기 ───────── */
  function render() {
    const counts = Object.fromEntries(LANES.map((k) => [k, 0]));
    state.mails.forEach((m) => counts[laneOf(m)]++);
    $("#s-all").textContent = state.mails.length;
    $("#s-quote").textContent = state.sorted ? counts.quote : "–";
    $("#s-need").textContent = state.sorted ? counts.need : "–";

    $("#sort").hidden = state.sorted;
    $("#sort").textContent = `메일 ${state.mails.length}통 분류하기`;
    $("#compose").hidden = !state.sorted;
    $(".room").classList.toggle("is-sorted", state.sorted);
    $("#pile").innerHTML = state.sorted
      ? `<div class="done"><b>편지함을 비웠어요</b>${state.mails.length}통을 분류함에 나눠 담았습니다.</div>`
      : state.mails.length ? state.mails.map((m) => card(m, "pile")).join("") : `<div class="done"><b>받은 메일이 없어요</b>아래에서 새 메일을 넣어 보세요.</div>`;

    $("#lane-tabs").innerHTML = LANES.map((k) => `<button type="button" role="tab" data-lane="${k}" aria-selected="${state.lane === k}">${LANE_LABEL[k]} ${state.sorted ? counts[k] : ""}</button>`).join("");
    $("#lanes").innerHTML = LANES.map((k) => {
      const list = state.sorted ? state.mails.filter((m) => laneOf(m) === k) : [];
      const empty = !state.sorted
        ? (k === "need" ? "애매한 메일은<br>여기서 사람이 정해요" : "분류하면 여기로<br>들어옵니다")
        : (k === "need" ? "모두 정했어요" : "이 분류의 메일이 없어요");
      return `<div class="lane l-${k}${state.lane === k ? " on" : ""}" role="tabpanel" aria-label="${LANE_LABEL[k]}">
        <div class="lane-h"><b>${LANE_LABEL[k]}</b><span class="n">${state.sorted ? list.length : "·"}</span></div>
        <div class="lane-list">${list.length ? list.map((m) => card(m, "lane")).join("") : `<div class="lane-empty">${empty}</div>`}</div>
      </div>`;
    }).join("");

    renderTable();
    renderNote();
  }

  function renderTable() {
    const qs = state.sorted ? state.mails.filter((m) => laneOf(m) === "quote") : [];
    const STATUS = ["견적 작성 전", "작성 중", "발송 완료"];
    const head = `<thead><tr><th>접수</th><th>거래처</th><th>제목</th><th>품목·수량</th><th>납기</th><th>진행</th><th><span class="sr">회신</span></th></tr></thead>`;
    if (!qs.length) {
      $("#qt").innerHTML = head + `<tbody><tr class="empty"><td colspan="7">${state.sorted ? "견적 요청 메일이 없어요." : "메일을 분류하면 견적 요청이 여기에 모입니다."}</td></tr></tbody>`;
      $("#ledger-sum").textContent = "";
      return;
    }
    const soon = qs.filter((m) => { const d = QM.daysLeft(m.due, TODAY); return d !== null && d <= 7; }).length;
    const sent = qs.filter((m) => m.status === "발송 완료").length;
    $("#ledger-sum").innerHTML = `${qs.length}건 · 회신 완료 <b>${sent}</b> · 납기 7일 이내 <b class="hot">${soon}</b>`;
    $("#qt").innerHTML = head + "<tbody>" + qs.map((m) => {
      const left = QM.daysLeft(m.due, TODAY);
      return `<tr>
        <td class="t">${esc(m.at)}</td>
        <td class="co"><b>${esc(m.co)}</b><span>${esc(m.person)}</span></td>
        <td>${esc(m.subj)}</td>
        <td contenteditable="true" spellcheck="false" data-edit="${m.id}" data-k="items" aria-label="${esc(m.co)} 품목·수량">${esc(m.items || "—")}</td>
        <td class="due${left !== null && left <= 7 ? " soon" : ""}" contenteditable="true" spellcheck="false" data-edit="${m.id}" data-k="due" aria-label="${esc(m.co)} 납기">${esc(m.due || "—")}${left !== null && left <= 7 ? ` · D-${left}` : ""}</td>
        <td><select data-status="${m.id}" data-v="${esc(m.status)}" aria-label="${esc(m.co)} 진행 상태">${STATUS.map((s) => `<option${s === m.status ? " selected" : ""}>${s}</option>`).join("")}</select></td>
        <td><button type="button" class="btn sm ghost" data-reply="${m.id}">${m.reply ? "초안 보기" : "회신 초안"}</button></td>
      </tr>`;
    }).join("") + "</tbody>";
  }

  /* ───────── FLIP: 카드가 제자리로 날아가는 효과 ───────── */
  function flip(change, { stagger = 0 } = {}) {
    if (reduceMotion) { change(); return; }
    const first = new Map($$(".mail[data-id]").map((el) => [el.dataset.id, el.getBoundingClientRect()]));
    change();
    let i = 0;
    $$(".mail[data-id]").forEach((el) => {
      const a = first.get(el.dataset.id);
      const b = el.getBoundingClientRect();
      if (!a || b.width === 0 || (Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2)) return;
      el.animate(
        [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, zIndex: 5 }, { transform: "none", zIndex: 5 }],
        { duration: 520, delay: stagger * i++, easing: "cubic-bezier(.3,.7,.2,1)", fill: "backwards" },
      );
    });
  }

  /* ───────── 알림 + 되돌리기 ───────── */
  let toastTimer = null, undoFn = null;
  function toast(msg, undo) {
    $("#toast-t").textContent = msg;
    undoFn = undo || null;
    $("#toast-undo").hidden = !undo;
    $("#toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  $("#toast-undo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  /* ───────── Claude에게 묻기 (동시에 3통씩) ───────── */
  function askClassify(ids) {
    if (AI.status().enabled === false) return;
    const queue = ids.filter((id) => { const m = find(id); return m && !m.ai; });
    queue.forEach((id) => pending.add(id));
    render();
    let running = 0;
    const next = () => {
      if (!queue.length) { if (!running) done(); return; }
      const id = queue.shift(), m = find(id);
      if (!m) { pending.delete(id); next(); return; }
      running++;
      AI.ask("mail.classify", { from: `${m.co} ${m.person}`, subject: m.subj, body: m.body }).then((r) => {
        running--;
        pending.delete(id);
        const mm = find(id);
        const a = r && QM.fromAi(r.data);
        if (mm && a) {
          flip(() => {
            mm.ai = { ...a, ms: r.ms };
            // 규칙이 품목을 못 찾았을 때만 Claude가 뽑은 품목을 진행표에 쓴다 (사람이 고친 칸은 그대로)
            if (a.items.length && !mm.items && !mm.itemsEdited) mm.items = QM.itemsText(a.items);
            save(); render();
            if (!$("#drawer").hidden && $("#drawer").dataset.id === id) openDrawer(id, { keepFocus: true });
          });
        } else render();
        next();
      });
    };
    for (let k = 0; k < 3; k++) next();
    function done() {
      render();
      const changed = state.mails.filter((m) => m.ai && m.ai.cat !== QM.classify(m).cat).length;
      if (state.mails.some((m) => m.ai)) toast(changed ? `Claude가 다 읽었어요 · 규칙과 판단이 다른 메일 ${changed}통을 옮겼어요` : "Claude가 다 읽었어요 · 규칙과 판단이 같아요");
    }
  }

  /* ───────── 동작 ───────── */
  function sortAll() {
    flip(() => { state.sorted = true; state.cur = null; save(); render(); }, { stagger: 32 });
    const need = state.mails.filter((m) => laneOf(m) === "need").length;
    const q = state.mails.filter((m) => laneOf(m) === "quote").length;
    toast(`견적 요청 ${q}통을 골랐어요 · ${need}통은 확인이 필요해요`);
    if (narrow()) { state.lane = need ? "need" : "quote"; render(); }
    askClassify(state.mails.map((m) => m.id));
  }
  function pick(id, k) {
    const m = find(id);
    if (!m || !state.sorted) return;
    const before = snapshot();
    flip(() => { m.final = k; save(); render(); });
    toast(`‘${LANE_LABEL[k]}’로 정했어요`, () => { state = before; save(); render(); });
  }
  function removeMail(id) {
    const before = snapshot();
    const m = find(id);
    state.mails = state.mails.filter((x) => x.id !== id);
    if (state.cur === id) state.cur = null;
    save(); closeDrawer(); render();
    toast(`‘${m.subj}’ 메일을 지웠어요`, () => { state = before; save(); render(); });
  }

  /* ───────── 회신 초안 (Claude mail.reply, 안 되면 규칙 템플릿) ───────── */
  function writeReply(id) {
    const m = find(id);
    if (!m) return;
    m.reply = { loading: true };
    renderReply(m);
    const ex = { items: m.items, due: m.due };
    AI.ask("mail.reply", { company: ME.company, sender: ME.sender, from: `${m.co} ${m.person}`, subject: m.subj, body: m.body, items: ex.items, due: ex.due }).then((r) => {
      const mm = find(id);
      if (!mm) return;
      if (r && r.data && r.data.body) {
        mm.reply = { subject: String(r.data.subject || `RE: ${mm.subj}`), body: String(r.data.body), mode: "ai", ms: r.ms };
      } else {
        const d = QM.replyDraft(mm, ME);
        mm.reply = { ...d, mode: "rule", reason: AI.status().reason || "AI 응답 없음" };
      }
      if (mm.status === "견적 작성 전") mm.status = "작성 중";
      save(); renderTable(); renderReply(mm);
    });
  }
  function renderReply(m) {
    const box = $("#reply-box");
    if (!box || $("#drawer").dataset.id !== m.id) return;
    const r = m.reply;
    if (!r) { box.innerHTML = `<button type="button" class="btn red" data-write="${m.id}">회신 초안 쓰기 <kbd>R</kbd></button><p class="hint">받은 품목·수량·납기를 확인하고 견적 회신 일정을 알리는 메일을 씁니다. 단가는 쓰지 않아요.</p>`; return; }
    if (r.loading) { box.innerHTML = `<div class="shimmer" aria-label="Claude가 회신을 쓰는 중"><i></i><i></i><i></i><i></i></div>`; return; }
    const chip = r.mode === "ai" ? `<span class="chip ai">Claude로 작성 · ${sec(r.ms)}</span>` : `<span class="chip rule">규칙 템플릿 · ${esc(r.reason || "")}</span>`;
    const mailto = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.body)}`;
    box.innerHTML = `${chip}
      <label class="fl" for="r-subj">제목</label><input id="r-subj" value="${esc(r.subject)}">
      <label class="fl" for="r-body">본문</label><textarea id="r-body" rows="12">${esc(r.body)}</textarea>
      <div class="r-act">
        <button type="button" class="btn" data-copy="${m.id}">본문 복사</button>
        <a class="btn ghost" id="r-mailto" href="${mailto}">메일 앱에서 열기</a>
        <button type="button" class="btn ghost" data-write="${m.id}">다시 쓰기</button>
      </div>`;
    const sync = () => {
      m.reply.subject = $("#r-subj").value; m.reply.body = $("#r-body").value; save();
      $("#r-mailto").href = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(m.reply.subject)}&body=${encodeURIComponent(m.reply.body)}`;
    };
    $("#r-subj").addEventListener("input", sync);
    $("#r-body").addEventListener("input", sync);
  }

  /* ───────── 자세히 보기 ───────── */
  let lastFocus = null;
  function highlight(text, hits) {
    const marks = [];
    for (const [k, words] of Object.entries(hits)) words.forEach((w) => marks.push([w, k]));
    marks.sort((a, b) => b[0].length - a[0].length);
    const out = esc(text);
    if (!marks.length) return out;
    const re = new RegExp(marks.map(([w]) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    const kind = Object.fromEntries(marks.map(([w, k]) => [esc(w).toLowerCase(), k]));
    return out.replace(re, (s) => `<mark class="k-${kind[s.toLowerCase()]}">${s}</mark>`);
  }
  function openDrawer(id, { keepFocus = false } = {}) {
    const m = find(id);
    if (!m) return;
    if (!keepFocus) lastFocus = document.activeElement;
    const v = verdictOf(m), c = v.rule;
    const lane = state.sorted ? laneOf(m) : null;
    const max = Math.max(4, ...Object.values(c.score));
    const busy = pending.has(m.id);
    const aiBlock = m.ai
      ? `<div class="ai-card">
          <div class="ai-top"><span class="chip ai">Claude로 분석 · ${sec(m.ai.ms || 0)}</span><span class="conf"><i style="width:${m.ai.confidence * 100}%"></i></span><b>${Math.round(m.ai.confidence * 100)}%</b></div>
          <p><b>${LANE_LABEL[m.ai.cat]}</b>${m.ai.need ? " — 확신이 60%보다 낮아 사람에게 넘겼어요" : ""}. ${esc(m.ai.reason)}</p>
          ${m.ai.items.length ? `<p class="small">뽑은 품목: ${m.ai.items.map((it) => `<span class="it">${esc(it.name)}${it.qty ? ` × ${it.qty}` : ""}${it.due ? ` · ${esc(it.due)}` : ""}</span>`).join("")}</p>` : ""}
        </div>`
      : busy ? `<div class="shimmer" aria-label="Claude가 읽는 중"><i></i><i></i></div>`
      : `<div class="ai-card rule"><span class="chip rule">규칙 기반 · ${esc(AI.status().reason || "AI 결과 없음")}</span><p class="small">아래 단어 점수로 분류했어요.</p></div>`;
    const verdict = c.score[c.cat] === 0
      ? "맞는 단어가 없어 ‘기타’로 보냈어요."
      : c.need
        ? `‘${LANE_LABEL[c.cat]}’ ${c.score[c.cat]}점, ‘${LANE_LABEL[c.alt]}’ ${c.score[c.alt]}점으로 차이가 1점 이하예요.`
        : `‘${LANE_LABEL[c.cat]}’ 점수가 가장 높아요.`;
    $("#d-body").innerHTML = `
      <p class="d-meta"><b>${esc(m.co)}</b> · ${esc(m.person)} &lt;${esc(m.email)}&gt;<br>10월 19일(월) ${esc(m.at)}</p>
      <h3 id="d-subj">${highlight(m.subj, c.hits)}</h3>
      <div class="letter">${highlight(m.body, c.hits)}</div>
      <div class="d-sec"><h4>판단</h4>${aiBlock}</div>
      <details class="d-sec rule-sec"${m.ai ? "" : " open"}>
        <summary>규칙 점수 <span>· 제목 2점, 본문 1점 · Claude가 안 될 때 이걸로 분류</span></summary>
        <div class="scores">${Object.keys(CATS).map((k) => `<span>${CATS[k].label}</span><span class="bar"><i style="width:${(c.score[k] / max) * 100}%;background:${BAR[k]}"></i></span><span class="v">${c.score[k]}</span>`).join("")}</div>
        <p class="verdict${c.need ? " need" : ""}">${verdict}</p>
      </details>
      ${state.sorted ? `<div class="d-sec"><h4>분류 정하기 <span class="keys"><kbd>1</kbd>~<kbd>4</kbd></span></h4><div class="cat-pick">${Object.keys(CATS).map((k, i) => `<button type="button" data-set="${k}" aria-pressed="${lane === k}"><kbd>${i + 1}</kbd>${CATS[k].label}</button>`).join("")}</div></div>` : ""}
      ${lane === "quote" ? `<div class="d-sec"><h4>견적 회신</h4><div id="reply-box" class="reply-box"></div></div>` : ""}
      <button class="d-del" type="button" data-del="${m.id}">이 메일 지우기</button>`;
    $("#scrim").hidden = false;
    $("#drawer").hidden = false;
    $("#drawer").dataset.id = id;
    if (lane === "quote") renderReply(m);
    if (!keepFocus) $("#d-close").focus();
  }
  function closeDrawer() {
    if ($("#drawer").hidden) return;
    $("#drawer").hidden = true;
    $("#scrim").hidden = true;
    $("#drawer").dataset.id = "";
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  /* ───────── 새 메일 넣기 (즉석 검증 + 미리 보기) ───────── */
  const cSubj = $("#c-subj"), cBody = $("#c-body"), cFrom = $("#c-from");
  function previewNew() {
    const subj = cSubj.value.trim(), body = cBody.value.trim();
    if (!subj && !body) { $("#c-preview").textContent = ""; return; }
    const c = QM.classify({ subj, body });
    const ex = QM.extract({ subj, body });
    $("#c-preview").innerHTML = (c.need
      ? `규칙 미리 보기: <b>확인 필요</b> (${LANE_LABEL[c.cat]} ↔ ${LANE_LABEL[c.alt]})`
      : `규칙 미리 보기: <b>${LANE_LABEL[c.cat]}</b>${c.hits[c.cat].length ? ` · ${c.hits[c.cat].map(esc).join(", ")}` : ""}${ex.items ? ` · ${esc(ex.items)}` : ""}`)
      + (AI.status().enabled === false ? "" : `<br><span class="hint">넣으면 Claude가 다시 읽고 판단합니다</span>`);
  }
  [cSubj, cBody].forEach((el) => el.addEventListener("input", () => {
    previewNew();
    if (cSubj.value.trim() || cBody.value.trim()) { $("#c-err").hidden = true; cBody.classList.remove("invalid"); cSubj.classList.remove("invalid"); }
  }));
  $("#compose").addEventListener("submit", (e) => {
    e.preventDefault();
    const subj = cSubj.value.trim(), body = cBody.value.trim();
    if (!subj && !body) {
      $("#c-err").textContent = "제목이나 본문 중 하나는 적어 주세요.";
      $("#c-err").hidden = false;
      cSubj.classList.add("invalid"); cBody.classList.add("invalid");
      cSubj.focus();
      return;
    }
    const at = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const [co, ...rest] = (cFrom.value.trim() || "직접 넣은 메일").split(" ");
    const m = makeMail([co, rest.join(" ") || "-", "-", at, subj || "(제목 없음)", body || subj]);
    const before = snapshot();
    state.mails.unshift(m);
    state.lane = laneOf(m);
    save(); render();
    const el = $(`.mail[data-id="${m.id}"]`);
    if (el) {
      el.classList.add("new");
      if (!reduceMotion) {
        const from = $("#compose").getBoundingClientRect(), to = el.getBoundingClientRect();
        el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(.9)`, opacity: .3 }, { transform: "none", opacity: 1 }], { duration: 560, easing: "cubic-bezier(.3,.7,.2,1)" });
      }
      setTimeout(() => el.classList.remove("new"), 2400);
    }
    cSubj.value = ""; cBody.value = ""; cFrom.value = ""; $("#c-preview").textContent = "";
    toast(`‘${LANE_LABEL[laneOf(m)]}’ 분류함에 넣었어요`, () => { state = before; save(); render(); });
    askClassify([m.id]);
  });

  /* ───────── 키보드 분류 ───────── */
  function visibleOrder() {
    // 화면에 보이는 순서: 분류함 왼쪽 칸부터 위에서 아래로 (좁은 화면은 지금 탭만)
    const lanes = narrow() ? [state.lane] : LANES;
    return lanes.flatMap((k) => state.mails.filter((m) => laneOf(m) === k)).map((m) => m.id);
  }
  function moveCursor(step) {
    const ids = visibleOrder();
    if (!ids.length) return;
    const i = ids.indexOf(state.cur);
    state.cur = ids[i < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, i + step))];
    render();
    const el = $(`.mail[data-id="${state.cur}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }
  function openHelp() { $("#help").hidden = false; $("#scrim").hidden = false; $("#help-close").focus(); }
  function closeHelp() { if ($("#help").hidden) return; $("#help").hidden = true; if ($("#drawer").hidden) $("#scrim").hidden = true; }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeHelp(); closeDrawer(); return; }
    const typing = e.target.closest("input, textarea, select, [contenteditable='true']");
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "?") { e.preventDefault(); openHelp(); return; }
    if (!state.sorted) { if (k === "Enter" && document.activeElement === document.body) sortAll(); return; }
    const drawerId = !$("#drawer").hidden ? $("#drawer").dataset.id : null;
    const id = drawerId || state.cur;
    if (k === "j" || k === "J" || k === "ArrowDown") { if (!drawerId) { e.preventDefault(); moveCursor(1); } return; }
    if (k === "k" || k === "K" || k === "ArrowUp") { if (!drawerId) { e.preventDefault(); moveCursor(-1); } return; }
    if (!id) return;
    if (KEY_TO_CAT[k]) { pick(id, KEY_TO_CAT[k]); if (drawerId) openDrawer(id, { keepFocus: true }); return; }
    if (k === "e" || k === "E") { const m = find(id); if (m && laneOf(m) === "need") { pick(id, recOf(m)); if (drawerId) openDrawer(id, { keepFocus: true }); } return; }
    if ((k === "o" || k === "Enter") && !drawerId) { openDrawer(id); return; }
    if (k === "r" || k === "R") { const m = find(id); if (m && laneOf(m) === "quote") { if (!drawerId) openDrawer(id); writeReply(id); } else toast("회신 초안은 견적 요청 메일에서 쓸 수 있어요"); }
  });

  /* ───────── 클릭 ───────── */
  document.addEventListener("click", async (e) => {
    const p = e.target.closest("[data-pick]");
    if (p) { e.stopPropagation(); pick(p.dataset.id, p.dataset.pick); return; }
    const o = e.target.closest("[data-open]");
    if (o) { state.cur = o.dataset.open; openDrawer(o.dataset.open); return; }
    const s = e.target.closest("[data-set]");
    if (s) { const id = $("#drawer").dataset.id; pick(id, s.dataset.set); openDrawer(id, { keepFocus: true }); return; }
    const d = e.target.closest("[data-del]");
    if (d) { removeMail(d.dataset.del); return; }
    const w = e.target.closest("[data-write]");
    if (w) { writeReply(w.dataset.write); return; }
    const r = e.target.closest("[data-reply]");
    if (r) { const m = find(r.dataset.reply); openDrawer(m.id); if (!m.reply) writeReply(m.id); return; }
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const m = find(cp.dataset.copy);
      try { await navigator.clipboard.writeText(`${m.reply.subject}\n\n${m.reply.body}`); toast("회신 초안을 복사했어요 · 메일에 붙여 넣으세요"); }
      catch { $("#r-body").select(); toast("복사가 막혀 있어요 · 선택된 본문을 Ctrl+C로 복사하세요"); }
      return;
    }
    const t = e.target.closest("[data-lane]");
    if (t) { state.lane = t.dataset.lane; save(); render(); }
  });
  $("#sort").addEventListener("click", sortAll);
  $("#scrim").addEventListener("click", () => { closeHelp(); closeDrawer(); });
  $("#d-close").addEventListener("click", closeDrawer);
  $("#help-open").addEventListener("click", openHelp);
  $("#help-close").addEventListener("click", closeHelp);
  $("#qt").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-status]");
    if (!sel) return;
    const m = find(sel.dataset.status);
    m.status = sel.value; sel.dataset.v = sel.value; save(); renderTable();
    toast(`${m.co} 견적을 ‘${m.status}’(으)로 바꿨어요`);
  });
  $("#qt").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest("[data-edit]")) { e.preventDefault(); e.target.blur(); } });
  $("#qt").addEventListener("focusout", (e) => {
    const td = e.target.closest("[data-edit]");
    if (!td) return;
    const m = find(td.dataset.edit);
    const v = td.textContent.replace(/ · D-\d+$/, "").trim();
    if (!m || v === (m[td.dataset.k] || "—")) return;
    m[td.dataset.k] = v === "—" ? "" : v;
    if (td.dataset.k === "items") m.itemsEdited = true;
    save(); renderTable();
    toast("진행표를 고쳤어요");
  });
  $("#dl").addEventListener("click", () => {
    const qs = state.mails.filter((m) => state.sorted && laneOf(m) === "quote");
    if (!qs.length) { toast("내려받을 견적 요청이 없어요"); return; }
    const csv = QM.toCsv([["접수", "거래처", "담당자", "이메일", "제목", "품목·수량", "납기", "진행", "판단"], ...qs.map((m) => [m.at, m.co, m.person, m.email, m.subj, m.items, m.due, m.status, m.final ? "사람" : m.ai ? `Claude ${Math.round(m.ai.confidence * 100)}%` : "규칙"])]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "견적요청_진행표_1019.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast(`견적 요청 ${qs.length}건을 CSV로 내려받았어요`);
  });
  $("#reset").addEventListener("click", () => {
    const before = snapshot();
    pending.clear();
    state = fresh(); save(); closeDrawer(); render();
    toast("샘플 데이터로 되돌렸어요", () => { state = before; save(); render(); });
  });

  render();
  AI.probe().then(() => {
    // 예전에 분류만 해 두고 AI 결과가 없는 메일이 있으면 이어서 묻는다
    if (state.sorted) askClassify(state.mails.filter((m) => !m.ai && !m.final).map((m) => m.id));
  });
})();
