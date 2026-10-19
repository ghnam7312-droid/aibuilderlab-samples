/* 견적함 — 거래처 견적 요청 메일 자동 분류
 *
 * 1. 메일마다 분류별 단어 점수를 낸다 (제목에 있으면 2점, 본문만 1점)
 * 2. 1등과 2등 점수 차이가 1점 이하이면 사람에게 넘긴다 (확인 필요)
 * 3. 견적 요청은 본문에서 품목·수량·납기를 뽑아 견적 진행표에 올린다
 * 규칙은 아래 RULES 에 모두 드러나 있다. 실제 AI 호출은 없다.
 */
(() => {
  "use strict";

  const STORE_KEY = "gyeonjeokham:v2";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = () => matchMedia("(max-width: 860px)").matches;

  /* ───────── 분류 규칙 ───────── */
  const CATS = {
    quote: { label: "견적 요청", words: ["견적", "단가", "가격", "얼마", "비용", "견적서"] },
    order: { label: "발주·주문", words: ["발주", "주문", "발주서", "주문 확정", "납품 요청", "구매 확정", "입고"] },
    ask: { label: "문의", words: ["문의", "궁금", "확인 부탁", "AS", "고장", "반품", "교환"] },
    etc: { label: "기타", words: ["안내", "공지", "세미나", "뉴스레터", "감사", "초대", "카탈로그"] },
  };
  const LANES = ["need", "quote", "order", "ask", "etc"];
  const LANE_LABEL = { need: "확인 필요", ...Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, v.label])) };
  const BAR = { quote: "var(--red)", order: "var(--order)", ask: "var(--teal)", etc: "var(--etc)" };

  // 끝인사만 있는 줄("감사합니다.")은 점수에서 뺀다 — 거의 모든 메일 끝에 붙어 '기타'로 잘못 끌려가던 문제
  const SIGN_OFF = /^\s*(감사합니다|감사드립니다|고맙습니다|잘 부탁드립니다)[.!~]*\s*$/gm;
  function classify(m) {
    const subj = m.subj.toLowerCase();
    const all = (m.subj + "\n" + m.body.replace(SIGN_OFF, "")).toLowerCase();
    const score = {}, hits = {};
    for (const [k, c] of Object.entries(CATS)) {
      score[k] = 0; hits[k] = [];
      for (const w of c.words) {
        const lw = w.toLowerCase();
        if (all.includes(lw)) { score[k] += subj.includes(lw) ? 2 : 1; hits[k].push(w); }
      }
    }
    const order = Object.keys(CATS).sort((a, b) => score[b] - score[a]);
    const [top, second] = order;
    if (score[top] === 0) return { cat: "etc", alt: null, need: false, score, hits };
    const need = score[second] > 0 && score[top] - score[second] <= 1;
    return { cat: top, alt: second, need, score, hits };
  }

  /* ───────── 품목·수량·납기 뽑기 ───────── */
  const ITEM_WORDS = ["27인치 모니터", "모니터 27형", "A4 용지", "프린터 토너", "사무용 의자", "노트북 거치대", "무선 키보드", "회의 테이블", "모니터", "토너", "용지", "의자", "키보드", "테이블"];
  const TODAY = new Date("2026-10-19T09:00:00+09:00"); // 샘플 기준일 (월)
  function extract(m) {
    const text = m.body || m.subj;
    const items = [];
    const re = /(\d+)\s*(박스|대|개|장|세트|EA)/g;
    let x;
    while ((x = re.exec(text))) {
      const before = text.slice(Math.max(0, x.index - 16), x.index);
      // 수량 바로 앞에서 끝나는 품목 이름을 찾고, 끝 위치가 같으면 더 긴 이름("사무용 의자" > "의자")
      let name = null, end = -1;
      for (const w of ITEM_WORDS) {
        const i = before.lastIndexOf(w);
        if (i < 0) continue;
        const e = i + w.length;
        if (e > end || (e === end && w.length > name.length)) { end = e; name = w; }
      }
      if (name) items.push(`${name} ${x[1]}${x[2]}`);
    }
    const all = m.subj + " " + m.body;
    let due = "";
    const d1 = all.match(/(\d{1,2})월\s*(\d{1,2})일/);
    const d2 = all.match(/이달 말|이번 주\s*[월화수목금]요일|다음 주\s*[월화수목금]요일|이번 주/);
    if (d1) due = `${d1[1]}월 ${d1[2]}일`; else if (d2) due = d2[0];
    return { items: [...new Set(items)].join(", "), due };
  }
  // 납기까지 남은 날 (모르면 null)
  function daysLeft(due) {
    let d = null;
    const m = String(due).match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (m) d = new Date(`2026-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}T09:00:00+09:00`);
    else if (/이달 말/.test(due)) d = new Date("2026-10-31T09:00:00+09:00");
    else if (/이번 주/.test(due)) d = new Date("2026-10-23T09:00:00+09:00");
    else if (/다음 주/.test(due)) d = new Date("2026-10-30T09:00:00+09:00");
    return d ? Math.round((d - TODAY) / 86400000) : null;
  }

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
    return { id: uid(), co, person, email, at, subj, body, final: null, status: "견적 작성 전", ...extract({ subj, body }) };
  }
  const fresh = () => ({ mails: SAMPLE.map(makeMail), sorted: false, lane: "need" });

  /* ───────── 상태 ───────── */
  let state = load() || fresh();
  function load() { try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 저장 실패해도 화면은 동작 */ } }
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const auto = (m) => classify(m);
  const laneOf = (m) => m.final || (auto(m).need ? "need" : auto(m).cat);

  /* ───────── 카드 ───────── */
  function card(m, where) {
    const c = auto(m);
    const lane = state.sorted ? laneOf(m) : "";
    const tags = state.sorted && lane !== "need" ? (c.hits[lane] || []).slice(0, 3).map((w) => `<span>${esc(w)}</span>`).join("") : "";
    let pick = "";
    if (where === "lane" && lane === "need") {
      pick = `<span class="pick">${[c.cat, c.alt].filter(Boolean).map((k, i) => `<button type="button" data-pick="${k}" data-id="${m.id}" class="${i === 0 ? "rec" : ""}">${LANE_LABEL[k]}</button>`).join("")}</span>`;
    }
    const snippet = m.body.replace(/\s+/g, " ").trim();
    return `<div class="mail c-${lane || "none"}" data-id="${m.id}">
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

    // 편지함
    $("#sort").hidden = state.sorted;
    $("#sort").textContent = `메일 ${state.mails.length}통 분류하기`;
    $("#compose").hidden = !state.sorted;
    document.querySelector(".room").classList.toggle("is-sorted", state.sorted);
    $("#pile").innerHTML = state.sorted
      ? `<div class="done"><b>편지함을 비웠어요</b>${state.mails.length}통을 분류함에 나눠 담았습니다.</div>`
      : state.mails.length ? state.mails.map((m) => card(m, "pile")).join("") : `<div class="done"><b>받은 메일이 없어요</b>아래에서 새 메일을 넣어 보세요.</div>`;

    // 분류함 탭 (좁은 화면)
    $("#lane-tabs").innerHTML = LANES.map((k) => `<button type="button" role="tab" data-lane="${k}" aria-selected="${state.lane === k}">${LANE_LABEL[k]} ${state.sorted ? counts[k] : ""}</button>`).join("");

    // 분류함
    $("#lanes").innerHTML = LANES.map((k) => {
      const list = state.sorted ? state.mails.filter((m) => laneOf(m) === k) : [];
      const empty = !state.sorted
        ? (k === "need" ? "점수가 비슷한 메일은<br>여기서 사람이 정해요" : "분류하면 여기로<br>들어옵니다")
        : (k === "need" ? "모두 정했어요" : "이 분류의 메일이 없어요");
      return `<div class="lane l-${k}${state.lane === k ? " on" : ""}" role="tabpanel" aria-label="${LANE_LABEL[k]}">
        <div class="lane-h"><b>${LANE_LABEL[k]}</b><span class="n">${state.sorted ? list.length : "·"}</span></div>
        <div class="lane-list">${list.length ? list.map((m) => card(m, "lane")).join("") : `<div class="lane-empty">${empty}</div>`}</div>
      </div>`;
    }).join("");

    renderTable();
  }

  function renderTable() {
    const qs = state.sorted ? state.mails.filter((m) => laneOf(m) === "quote") : [];
    const STATUS = ["견적 작성 전", "작성 중", "발송 완료"];
    const head = `<thead><tr><th>접수</th><th>거래처</th><th>제목</th><th>품목·수량</th><th>납기</th><th>진행</th></tr></thead>`;
    if (!qs.length) {
      $("#qt").innerHTML = head + `<tbody><tr class="empty"><td colspan="6">${state.sorted ? "견적 요청 메일이 없어요." : "메일을 분류하면 견적 요청이 여기에 모입니다."}</td></tr></tbody>`;
      return;
    }
    $("#qt").innerHTML = head + "<tbody>" + qs.map((m) => {
      const left = daysLeft(m.due);
      return `<tr>
        <td>${esc(m.at)}</td>
        <td class="co"><b>${esc(m.co)}</b><span>${esc(m.person)}</span></td>
        <td>${esc(m.subj)}</td>
        <td contenteditable="true" spellcheck="false" data-edit="${m.id}" data-k="items" aria-label="${esc(m.co)} 품목·수량">${esc(m.items || "—")}</td>
        <td class="due${left !== null && left <= 7 ? " soon" : ""}" contenteditable="true" spellcheck="false" data-edit="${m.id}" data-k="due" aria-label="${esc(m.co)} 납기">${esc(m.due || "—")}${left !== null && left <= 7 ? ` · D-${left}` : ""}</td>
        <td><select data-status="${m.id}" data-v="${esc(m.status)}" aria-label="${esc(m.co)} 진행 상태">${STATUS.map((s) => `<option${s === m.status ? " selected" : ""}>${s}</option>`).join("")}</select></td>
      </tr>`;
    }).join("") + "</tbody>";
  }

  /* ───────── FLIP: 카드가 제자리로 날아가는 효과 ─────────
     바꾸기 전 위치(First)를 재고, 다시 그린 뒤 위치(Last)를 재서,
     그 차이만큼 거꾸로 옮겨 놓았다가(Invert) 원래 자리로 움직인다(Play). */
  function flip(change, { stagger = 0 } = {}) {
    if (reduceMotion) { change(); return; }
    const first = new Map($$(".mail[data-id]").map((el) => [el.dataset.id, el.getBoundingClientRect()]));
    change();
    let i = 0;
    $$(".mail[data-id]").forEach((el) => {
      const a = first.get(el.dataset.id);
      const b = el.getBoundingClientRect();
      if (!a || b.width === 0 || (Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2)) return;
      const dx = a.left - b.left, dy = a.top - b.top;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 5 }, { transform: "none", zIndex: 5 }],
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
    toastTimer = setTimeout(() => $("#toast").classList.remove("on"), undo ? 5000 : 2200);
  }
  $("#toast-undo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  /* ───────── 동작 ───────── */
  function sortAll() {
    flip(() => { state.sorted = true; save(); render(); }, { stagger: 32 });
    const need = state.mails.filter((m) => laneOf(m) === "need").length;
    const q = state.mails.filter((m) => laneOf(m) === "quote").length;
    toast(`견적 요청 ${q}통을 골랐어요 · ${need}통은 확인이 필요해요`);
    if (narrow()) { state.lane = need ? "need" : "quote"; render(); }
  }
  function pick(id, k) {
    const m = state.mails.find((x) => x.id === id);
    if (!m) return;
    const before = snapshot();
    flip(() => { m.final = k; save(); render(); });
    toast(`‘${LANE_LABEL[k]}’로 정했어요`, () => { state = before; save(); render(); });
  }
  function removeMail(id) {
    const before = snapshot();
    const m = state.mails.find((x) => x.id === id);
    state.mails = state.mails.filter((x) => x.id !== id);
    save(); closeDrawer(); render();
    toast(`‘${m.subj}’ 메일을 지웠어요`, () => { state = before; save(); render(); });
  }

  /* ───────── 자세히 보기 ───────── */
  let lastFocus = null;
  function highlight(text, c) {
    // 맞은 단어를 분류 색으로 칠한다 (긴 단어 먼저)
    const marks = [];
    for (const [k, words] of Object.entries(c.hits)) words.forEach((w) => marks.push([w, k]));
    marks.sort((a, b) => b[0].length - a[0].length);
    let out = esc(text);
    if (!marks.length) return out;
    const re = new RegExp(marks.map(([w]) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    const kind = Object.fromEntries(marks.map(([w, k]) => [esc(w).toLowerCase(), k]));
    return out.replace(re, (s) => `<mark class="k-${kind[s.toLowerCase()]}">${s}</mark>`);
  }
  function openDrawer(id) {
    const m = state.mails.find((x) => x.id === id);
    if (!m) return;
    lastFocus = document.activeElement;
    const c = auto(m);
    const lane = state.sorted ? laneOf(m) : null;
    const max = Math.max(4, ...Object.values(c.score));
    const verdict = c.score[c.cat] === 0
      ? "맞는 단어가 없어 ‘기타’로 보냈어요."
      : c.need
        ? `‘${LANE_LABEL[c.cat]}’ ${c.score[c.cat]}점, ‘${LANE_LABEL[c.alt]}’ ${c.score[c.alt]}점으로 차이가 1점 이하라 사람이 정해야 해요.`
        : `‘${LANE_LABEL[c.cat]}’ 점수가 가장 높아 자동으로 분류했어요.`;
    $("#d-body").innerHTML = `
      <p class="d-meta"><b>${esc(m.co)}</b> · ${esc(m.person)} &lt;${esc(m.email)}&gt;<br>10월 19일(월) ${esc(m.at)}</p>
      <h3 id="d-subj">${highlight(m.subj, c)}</h3>
      <div class="letter">${highlight(m.body, c)}</div>
      <div class="d-sec">
        <h4>분류 점수 <span style="font-weight:500;color:var(--ink-3)">· 제목 2점, 본문 1점</span></h4>
        <div class="scores">${Object.keys(CATS).map((k) => `<span>${CATS[k].label}</span><span class="bar"><i style="width:${(c.score[k] / max) * 100}%;background:${BAR[k]}"></i></span><span class="v">${c.score[k]}</span>`).join("")}</div>
        <p class="verdict${c.need ? " need" : ""}">${verdict}</p>
      </div>
      ${state.sorted ? `<div class="d-sec"><h4>분류 정하기</h4><div class="cat-pick">${Object.keys(CATS).map((k) => `<button type="button" data-set="${k}" aria-pressed="${lane === k}">${CATS[k].label}</button>`).join("")}</div></div>` : ""}
      ${(m.items || m.due) ? `<div class="d-sec"><h4>본문에서 뽑은 내용</h4><p style="margin:0;font-size:14px">품목·수량 <b>${esc(m.items || "—")}</b><br>납기 <b>${esc(m.due || "—")}</b></p></div>` : ""}
      <button class="d-del" type="button" data-del="${m.id}">이 메일 지우기</button>`;
    $("#scrim").hidden = false;
    $("#drawer").hidden = false;
    $("#drawer").dataset.id = id;
    $("#d-close").focus();
  }
  function closeDrawer() {
    if ($("#drawer").hidden) return;
    $("#drawer").hidden = true;
    $("#scrim").hidden = true;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  /* ───────── 새 메일 넣기 (즉석 검증 + 미리 보기) ───────── */
  const cSubj = $("#c-subj"), cBody = $("#c-body"), cFrom = $("#c-from");
  function previewNew() {
    const subj = cSubj.value.trim(), body = cBody.value.trim();
    if (!subj && !body) { $("#c-preview").textContent = ""; return; }
    const c = classify({ subj, body });
    const ex = extract({ subj, body });
    $("#c-preview").innerHTML = c.need
      ? `미리 보기: <b>확인 필요</b> (${LANE_LABEL[c.cat]} ↔ ${LANE_LABEL[c.alt]})`
      : `미리 보기: <b>${LANE_LABEL[c.cat]}</b>${c.hits[c.cat].length ? ` · ${c.hits[c.cat].map(esc).join(", ")}` : ""}${ex.items ? ` · ${esc(ex.items)}` : ""}`;
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
  });

  /* ───────── 이벤트 ───────── */
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-pick]");
    if (p) { e.stopPropagation(); pick(p.dataset.id, p.dataset.pick); return; }
    const o = e.target.closest("[data-open]");
    if (o) { openDrawer(o.dataset.open); return; }
    const s = e.target.closest("[data-set]");
    if (s) { const id = $("#drawer").dataset.id; pick(id, s.dataset.set); openDrawer(id); return; }
    const d = e.target.closest("[data-del]");
    if (d) { removeMail(d.dataset.del); return; }
    const t = e.target.closest("[data-lane]");
    if (t) { state.lane = t.dataset.lane; save(); render(); }
  });
  $("#sort").addEventListener("click", sortAll);
  $("#scrim").addEventListener("click", closeDrawer);
  $("#d-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  $("#qt").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-status]");
    if (!sel) return;
    const m = state.mails.find((x) => x.id === sel.dataset.status);
    m.status = sel.value; sel.dataset.v = sel.value; save();
    toast(`${m.co} 견적을 ‘${m.status}’(으)로 바꿨어요`);
  });
  $("#qt").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest("[data-edit]")) { e.preventDefault(); e.target.blur(); } });
  $("#qt").addEventListener("focusout", (e) => {
    const td = e.target.closest("[data-edit]");
    if (!td) return;
    const m = state.mails.find((x) => x.id === td.dataset.edit);
    const v = td.textContent.replace(/ · D-\d+$/, "").trim();
    if (!m || v === (m[td.dataset.k] || "—")) return;
    m[td.dataset.k] = v === "—" ? "" : v;
    save(); renderTable();
    toast("진행표를 고쳤어요");
  });
  $("#dl").addEventListener("click", () => {
    const qs = state.mails.filter((m) => state.sorted && laneOf(m) === "quote");
    if (!qs.length) { toast("내려받을 견적 요청이 없어요"); return; }
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [["접수", "거래처", "담당자", "이메일", "제목", "품목·수량", "납기", "진행"], ...qs.map((m) => [m.at, m.co, m.person, m.email, m.subj, m.items, m.due, m.status])].map((r) => r.map(q).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "견적요청_진행표_1019.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast(`견적 요청 ${qs.length}건을 CSV로 내려받았어요`);
  });
  $("#reset").addEventListener("click", () => {
    const before = snapshot();
    state = fresh(); save(); closeDrawer(); render();
    toast("샘플 데이터로 되돌렸어요", () => { state = before; save(); render(); });
  });

  render();
})();
