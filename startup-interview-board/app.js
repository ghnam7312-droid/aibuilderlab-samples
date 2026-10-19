/*
 * app.js — 들어보니 화면 (AI 빌더랩 1기 목표 모델 예시)
 *
 * 인터뷰 카드마다 가설(H1, H2)에 대한 근거를 '지지 / 반증 / 상관없음'으로 태그한다.
 * - 인터뷰를 붙이거나 고치면 Claude(interview.analyze)가 핵심어·핵심 문장·가설별 입장을 '제안'한다.
 *   연결이 안 되면 기록된 숫자(리포트 시간, 낼 금액)로 규칙 제안을 만든다.
 * - 사람이 눌러 확정한 것만 근거로 센다. 확정한 근거가 쌓이면 도장이 '검증 중 → 검증됨 / 반증됨'으로 바뀐다.
 * - 질문 점검기는 규칙으로 바로 판정하고, 유도 질문이면 Claude(interview.question)가 고쳐 쓴다.
 * 계산 규칙은 logic.js(DeurLogic). 저장은 localStorage.
 */
(() => {
  "use strict";

  const L = window.DeurLogic;
  const KEY = "deureoboni-v3";
  const { ROLES, HYPS, STAMP } = L;
  const RC = { 원장: "var(--r-own)", 강사: "var(--r-tea)", 학부모: "var(--r-par)" };
  const VIEWS = ["board", "insight", "qd", "price"];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ───────── 샘플 인터뷰 15명 (모두 가상 인물) ───────── */
  const SAMPLE = () => ({
    role: "전체",
    myQs: [
      { t: "지난달 학부모 리포트는 누가, 몇 시간 들여 만들었나요?", ok: true },
      { t: "마지막으로 리포트를 보낸 날, 어떤 순서로 만드셨어요?", ok: true },
    ],
    // 이미 확정한 근거 (H2는 원장 3명만 확정해 둔 '검증 중' 상태로 시작)
    ev: { "1|H1": "y", "2|H1": "y", "3|H1": "y", "4|H1": "n", "5|H1": "y", "7|H1": "y", "8|H1": "y", "9|H1": "y", "10|H1": "n",
          "1|H2": "y", "2|H2": "y", "4|H2": "n" },
    ivs: [
      ["원장", "원장 1 · 수학 · 학생 120명", 12, 8, '지난달 학부모 리포트를 강사 3명이 나눠 썼다. 한 명당 4시간. 엑셀 성적표를 캡처해서 카톡으로 보냄.\n"점수보다 다음에 뭘 할지 물어보는 학부모가 많아요."'],
      ["원장", "원장 2 · 영어 · 학생 60명", 8, 5, '분기마다 상담 전에 리포트를 만든다. 지난달엔 2번 미뤘다.\n"기존 학원 프로그램은 월 20만 원인데 기능이 너무 많아서 안 써요."'],
      ["원장", "원장 3 · 수학 · 학생 200명", 20, 10, '상담 실장이 리포트 전담. 지난달 20시간 정도. 교재가 반마다 달라 단원표를 손으로 맞춤.\n"우리 교재 단원 순서대로 나와야 해요."'],
      ["원장", "원장 4 · 국어 · 학생 45명", 3, 0, '리포트를 따로 안 만든다. 상담 때 말로 설명.\n"작은 학원은 리포트까지 신경 쓸 여유가 없어요."'],
      ["원장", "원장 5 · 수학 · 학생 85명", 10, 7, '지난달 학부모 문의 카톡이 하루 10건 넘음. 엑셀 성적표를 매주 만듦.\n"카톡으로 바로 보낼 수 있으면 좋겠어요."'],
      ["원장", "원장 6 · 과학 · 학생 70명", 6, 6, '시험 끝나면 오답 노트를 출력해서 나눠 준다. 리포트는 월 1회.\n"10만 원 넘으면 고민해요. 5만 원 정도면 바로 써 볼게요."'],
      ["강사", "강사 1 · 수학 · 3년차", 5, 0, '지난달 리포트 쓰느라 주말 이틀을 썼다. 학생 40명.\n"채점보다 문구 쓰는 게 더 오래 걸려요."'],
      ["강사", "강사 2 · 영어 · 5년차", 4, 0, '학생별 코멘트를 메모장에 써 두고 복사함. 엑셀로 점수 정리.\n"매번 같은 말을 다르게 쓰려니 힘들어요."'],
      ["강사", "강사 3 · 수학 · 1년차", 6, 0, '선배 강사 양식을 받아서 씀. 오답 유형은 감으로 판단.\n"어떤 유형을 틀렸는지 근거를 대기가 어려워요."'],
      ["강사", "강사 4 · 국어 · 7년차", 2, 0, "리포트는 원장님이 씀. 나는 점수만 넘김."],
      ["강사", "강사 5 · 수학 · 4년차", 5, 0, '지난달 손글씨 풀이를 보고 오답 이유를 적었다. 학생 35명에 5시간.\n"학생이 고른 답만 입력해도 유형이 나오면 좋겠어요."'],
      ["학부모", "학부모 1 · 중2 자녀", 0, 0, '지난달 학원 리포트를 받았지만 점수만 있었다.\n"그래서 집에서 뭘 시키면 되는지 모르겠어요."'],
      ["학부모", "학부모 2 · 중1 자녀", 0, 0, '카톡으로 받은 성적표 캡처를 잘 안 봄. 상담 때만 확인.\n"다음 주에 뭘 하는지가 궁금해요."'],
      ["학부모", "학부모 3 · 초6 자녀", 0, 0, '리포트를 받은 적이 없다. 궁금하면 직접 전화함.\n"전화하기 미안해서 잘 안 물어봐요."'],
      ["학부모", "학부모 4 · 중3 자녀", 0, 0, '두 학원 리포트를 비교해 봄. 단원별로 나온 쪽이 이해가 쉬웠다.\n"단원별로 약한 게 보이면 좋아요."'],
    ].map((r, i) => ({ id: i + 1, role: r[0], name: r[1], hours: r[2], price: r[3], memo: r[4] })),
  });

  let S = load();
  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && Array.isArray(v.ivs)) return v; } catch (e) { /* 저장소 사용 불가 */ }
    return SAMPLE();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ } }

  const confirmed = (v, h) => S.ev[v.id + "|" + h.id];
  const tally = (h) => L.tally(S.ivs, S.ev, h.id);
  /** 카드의 주제: Claude가 읽었으면 Claude 핵심어, 아니면 말 사전 */
  const topicsFor = (v) => (v.ai && v.ai.mode === "ai" && v.ai.keywords.length ? v.ai.keywords : L.topicsOf(v.memo));
  /** 제안: Claude 입장 > 숫자 규칙 */
  function suggestion(v, h) {
    const a = v.ai && v.ai.mode === "ai" && v.ai.stances && v.ai.stances[h.id];
    return a ? { s: a.s, src: "ai", why: a.why } : { s: h.auto(v), src: "rule", why: h.crit };
  }

  /* ───────── 알림 ───────── */
  let undoFn = null, toastT = 0;
  function toast(msg, undo) {
    $("#toastMsg").textContent = msg; undoFn = undo || null; $("#toastUndo").hidden = !undo;
    $("#toast").classList.add("on"); clearTimeout(toastT);
    toastT = setTimeout(() => { $("#toast").classList.remove("on"); undoFn = null; }, undo ? 5000 : 2400);
  }
  $("#toastUndo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  /* ───────── Claude 연결 ───────── */
  const REASON = { "AI 키 미설정": "AI 키 미설정", "서버에 연결할 수 없음": "서버 연결 안 됨", "사용량 한도": "사용량 한도" };
  function chip(a, waiting) {
    if (waiting) return `<span class="ai-chip wait"><i></i>Claude가 읽는 중…</span>`;
    if (!a) return "";
    if (a.mode === "ai") return `<span class="ai-chip ai"><i></i>Claude로 분석 · ${(a.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="ai-chip rule" title="${esc(a.reason || "")}"><i></i>규칙 기반 · ${esc(REASON[a.reason] || a.reason || "AI 미사용")}</span>`;
  }
  AI.onChange((st) => {
    const el = $("#aiStatus");
    el.className = "ai-status " + (st.enabled === true ? "on" : st.enabled === false ? "off" : "");
    el.querySelector("span").textContent = st.enabled === true ? "Claude 연결됨" : st.enabled === false ? `규칙 모드 · ${REASON[st.reason] || st.reason || "AI 꺼짐"}` : "AI 확인 중…";
  });
  AI.probe();

  const reading = new Set();
  /** 인터뷰 한 건을 Claude에게 읽힌다. 실패하면 규칙 결과를 남긴다 */
  async function analyze(id) {
    const v = S.ivs.find((x) => x.id === id); if (!v || reading.has(id)) return;
    reading.add(id); if (tab() === "board") renderBoard();
    const res = await AI.ask("interview.analyze", {
      role: v.role, who: v.name, hoursLastMonth: v.hours, priceWilling: v.price, memo: v.memo,
      hypotheses: HYPS.map((h) => ({ id: h.id, text: h.text, criterion: h.crit })),
    });
    const norm = res && L.normalizeAnalyze(res.data, v.memo, HYPS.map((h) => h.id));
    const cur = S.ivs.find((x) => x.id === id);
    if (cur) {
      cur.ai = norm ? { mode: "ai", ms: res.ms, ...norm } : { mode: "rule", reason: res ? "응답 형식 오류" : AI.status().reason || "AI 미사용" };
      save();
    }
    reading.delete(id);
    if (tab() === "board") renderBoard();
    if (tab() === "insight") renderInsight();
  }

  /* ───────── 탭 ───────── */
  const tab = () => $(".tabs [aria-selected=true]").dataset.v;
  function go(v) { $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.v === v))); render(); }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.v)));
  $(".tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const bs = $$(".tabs button"); const i = bs.indexOf(document.activeElement); if (i < 0) return;
    const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length]; n.focus(); n.click();
  });
  function render() {
    const v = tab();
    VIEWS.forEach((x) => ($("#v-" + x).hidden = x !== v));
    const c = (r) => S.ivs.filter((x) => x.role === r).length;
    $("#projMeta").textContent = `인터뷰 ${S.ivs.length}명 · 원장 ${c("원장")} · 강사 ${c("강사")} · 학부모 ${c("학부모")}`;
    ({ board: renderBoard, insight: renderInsight, qd: renderQd, price: renderPrice })[v]();
  }

  /* ═════════ ① 보드 ═════════ */
  let lastTally = {};       // 도장이 바뀌는 순간에만 움직임을 주려고 직전 상태를 기억
  function renderHyps(changed) {
    $("#hyps").innerHTML = HYPS.map((h) => {
      const t = tally(h); const prev = lastTally[h.id];
      const flip = changed && prev && prev.st !== t.st;
      const grew = changed && prev && (prev.y !== t.y || prev.n !== t.n);
      const blocks = Array.from({ length: t.y }, (_, i) => `<i class="y${grew && i === t.y - 1 && t.y > prev.y ? " new" : ""}"></i>`).join("") +
        Array.from({ length: t.n }, (_, i) => `<i class="n${grew && i === t.n - 1 && t.n > prev.n ? " new" : ""}"></i>`).join("");
      return `<article class="hyp" aria-label="${h.id} ${STAMP[t.st]}">
        <span class="hid">${h.id} 가설</span>
        <span class="stamp ${t.st}${flip ? " flip" : ""}">${STAMP[t.st]}</span>
        <blockquote>${esc(h.text)}</blockquote>
        <div class="crit">${esc(h.crit)}</div>
        <div class="meter" aria-hidden="true">${blocks}</div>
        <div class="tally"><span>지지 <b>${t.y}</b></span><span>반증 <b>${t.n}</b></span></div>
      </article>`;
    }).join("") + `<p class="hyp-note">지지가 3건 이상이고 반증의 2배 이상이면 ‘검증됨’, 반증이 더 많으면 ‘반증됨’이에요.</p>`;
    HYPS.forEach((h) => (lastTally[h.id] = tally(h)));
  }

  const ICON_EDIT = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 14.5V16h1.5l8.6-8.6-1.5-1.5L4 14.5zM14.6 4.4l1.5 1.5 1-1a1 1 0 0 0 0-1.4l-.1-.1a1 1 0 0 0-1.4 0l-1 1z"/></svg>`;
  const ICON_DEL = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10l-.8 10.2a1 1 0 0 1-1 .8H6.8a1 1 0 0 1-1-.8L5 6zm3-3h4l.5 1.5H16V6H4V4.5h3.5L8 3z"/></svg>`;
  function cardHtml(v, isNew) {
    const waiting = reading.has(v.id);
    const quotes = L.quotesOf(v.memo); const plain = L.plainOf(v.memo);
    const key = v.ai && v.ai.mode === "ai" ? v.ai.quote : "";
    const facts = v.role === "학부모" ? "" : `<div class="facts"><span>지난달 리포트 <b>${v.hours}시간</b></span>${v.role === "원장" ? `<span>낼 금액 <b>${v.price ? "월 " + v.price + "만 원" : "안 냄"}</b></span>` : ""}</div>`;
    const ev = HYPS.map((h) => {
      const c = confirmed(v, h); const sg = suggestion(v, h); const e = c || sg.s;
      const label = e === "y" ? "지지" : e === "n" ? "반증" : "상관없음";
      if (!c && e === "x") return "";   // 상관없는 가설은 제안하지 않는다
      return c
        ? `<button type="button" class="ev-b ${e}" data-ev="${v.id}|${h.id}" aria-label="${h.id} 근거 ${label}로 확정됨. 눌러서 바꾸기">${h.id} ${label}</button>`
        : `<button type="button" class="ev-b sug ${e}${sg.src === "ai" ? " by-ai" : ""}" data-ev="${v.id}|${h.id}" title="${esc(sg.why)}" aria-label="${h.id} ${label} ${sg.src === "ai" ? "Claude" : "규칙"} 제안. 이유: ${esc(sg.why)}. 눌러서 확정하기">${h.id} ${label}?<span class="auto">${sg.src === "ai" ? "Claude" : "제안"}</span></button>`;
    }).join("");
    const why = HYPS.map((h) => { const a = v.ai && v.ai.mode === "ai" && v.ai.stances && v.ai.stances[h.id]; return a && a.why && !confirmed(v, h) && a.s !== "x" ? `<li><b>${h.id}</b> ${esc(a.why)}</li>` : ""; }).join("");
    const mark = (q) => (key && q.replace(/\s+/g, " ") === key.replace(/\s+/g, " ") ? " key" : "");
    return `<article class="card${isNew ? " new" : ""}${waiting ? " reading" : ""}" data-role="${esc(v.role)}" data-id="${v.id}">
      <div class="ch"><span class="nm">${esc(v.name)}</span><span class="role">${esc(v.role)}</span>
        <span class="icons"><button type="button" class="ic" data-edit="${v.id}" aria-label="${esc(v.name)} 인터뷰 고치기" title="고치기">${ICON_EDIT}</button><button type="button" class="ic del" data-del="${v.id}" aria-label="${esc(v.name)} 인터뷰 지우기" title="지우기">${ICON_DEL}</button></span></div>
      ${facts}
      ${plain ? `<p class="memo">${esc(plain)}</p>` : ""}
      ${quotes.map((q) => `<p class="voice${mark(q)}">“${esc(q)}”${mark(q) ? `<span class="keytag">핵심 문장</span>` : ""}</p>`).join("")}
      ${key && !quotes.some((q) => mark(q)) ? `<p class="voice key">${esc(key)}<span class="keytag">핵심 문장</span></p>` : ""}
      <div class="kws">${topicsFor(v).map((k) => `<span class="kw${v.ai && v.ai.mode === "ai" ? " ai" : ""}">${esc(k)}</span>`).join("")}</div>
      ${why ? `<ul class="why">${why}</ul>` : ""}
      <div class="ai-line">${chip(v.ai, waiting)}<button type="button" class="mini" data-ana="${v.id}"${waiting ? " disabled" : ""}>${v.ai ? "다시 읽기" : "Claude로 읽기"}</button></div>
      ${ev ? `<div class="ev">${ev}</div>` : ""}
    </article>`;
  }

  function renderBoard(opts = {}) {
    renderHyps(opts.changed);
    $("#roleF").innerHTML = ["전체", ...ROLES].map((r) => `<button type="button" data-r="${r}" aria-pressed="${S.role === r}">${r !== "전체" ? `<span class="dot" style="background:${RC[r]}"></span>` : ""}${r} <small>${r === "전체" ? S.ivs.length : S.ivs.filter((v) => v.role === r).length}</small></button>`).join("");
    const q = $("#find").value.trim();
    const list = S.ivs.filter((v) => (S.role === "전체" || v.role === S.role) && (!q || (v.memo + v.name + topicsFor(v).join(" ")).includes(q)));
    const focusId = document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-ev],[data-ana]") ? (document.activeElement.dataset.ev || "ana" + document.activeElement.dataset.ana) : null;
    $("#cards").innerHTML = list.map((v) => cardHtml(v, opts.newId === v.id)).join("")
      || (S.ivs.length ? `<div class="empty"><b>맞는 인터뷰가 없어요</b>다른 말로 찾거나 역할을 ‘전체’로 바꿔 보세요.</div>`
        : `<div class="empty"><b>아직 붙인 인터뷰가 없어요</b>‘인터뷰 기록하기’로 첫 카드를 붙여 보세요.</div>`);
    if (focusId) { const el = focusId.startsWith("ana") ? $(`[data-ana="${focusId.slice(3)}"]`) : $(`[data-ev="${focusId}"]`); if (el && !el.disabled) el.focus(); }
  }

  $("#cards").addEventListener("click", (e) => {
    const evb = e.target.closest("[data-ev]");
    if (evb) {
      const [id, hid] = evb.dataset.ev.split("|"); const v = S.ivs.find((x) => x.id === +id); const h = HYPS.find((x) => x.id === hid);
      const k = v.id + "|" + h.id; const before = S.ev[k];
      S.ev[k] = L.nextTag(before, suggestion(v, h).s);
      save(); renderBoard({ changed: true });
      const again = $(`[data-ev="${evb.dataset.ev}"]`); if (again) again.focus();
      return;
    }
    const ana = e.target.closest("[data-ana]"); if (ana) { analyze(+ana.dataset.ana); return; }
    const ed = e.target.closest("[data-edit]"); if (ed) { openDlg(S.ivs.find((x) => x.id === +ed.dataset.edit)); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      const i = S.ivs.findIndex((x) => x.id === +del.dataset.del); const removed = S.ivs.splice(i, 1)[0];
      save(); render();
      toast(`‘${removed.name}’ 카드를 지웠어요`, () => { S.ivs.splice(i, 0, removed); save(); render(); });
    }
  });
  $("#roleF").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; S.role = b.dataset.r; save(); renderBoard(); });
  $("#find").addEventListener("input", () => renderBoard());

  /* 인터뷰 기록·고치기 창 */
  const dlg = $("#addDlg"); let editing = null;
  function openDlg(v) {
    editing = v ? v.id : null;
    $("#addForm").reset(); $$("#addForm .err").forEach((x) => (x.hidden = true)); $$("#addForm [aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
    $("#addH").textContent = v ? "인터뷰 고치기" : "인터뷰 기록하기";
    $("#addSave").textContent = v ? "고치고 다시 읽기" : "보드에 붙이기";
    if (v) {
      $(`#addForm input[name=role][value="${v.role}"]`).checked = true;
      $("#fName").value = v.name; $("#fHours").value = v.hours; $("#fPrice").value = v.price; $("#fMemo").value = v.memo;
    }
    memoHint();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    $("#fName").focus();
  }
  function memoHint() {
    const m = $("#fMemo").value; const q = L.quotesOf(m).length;
    $("#memoHint").textContent = m.trim() ? `인용 ${q}개 · ${L.topicsOf(m).length ? "주제: " + L.topicsOf(m).join(", ") : "아직 주제 단어가 없어요"}` : "";
  }
  $("#fMemo").addEventListener("input", memoHint);
  $("#openAdd").addEventListener("click", () => openDlg(null));
  $("#addCancel").addEventListener("click", () => dlg.close());
  $("#addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#fName").value.trim(); const memo = $("#fMemo").value.trim();
    $("#eName").hidden = !!name; $("#fName").setAttribute("aria-invalid", String(!name));
    $("#eMemo").hidden = !!memo; $("#fMemo").setAttribute("aria-invalid", String(!memo));
    if (!name) { $("#fName").focus(); return; }
    if (!memo) { $("#fMemo").focus(); return; }
    const role = $("#addForm").elements.role.value;
    const data = { role, name, memo, hours: Math.max(0, +$("#fHours").value || 0), price: Math.max(0, +$("#fPrice").value || 0) };
    let id;
    if (editing) {
      const v = S.ivs.find((x) => x.id === editing); const before = { ...v };
      Object.assign(v, data); delete v.ai; id = v.id;
      toast("고쳤어요 · Claude가 다시 읽고 있어요", () => { Object.assign(v, before); save(); render(); });
    } else {
      id = Math.max(0, ...S.ivs.map((v) => v.id)) + 1;
      S.ivs.unshift({ id, ...data });
      toast("보드에 붙였어요 · Claude가 읽고 제안을 달아요");
    }
    if (S.role !== "전체" && S.role !== role) S.role = "전체";
    save(); dlg.close();
    $("#find").value = "";
    go("board"); renderBoard({ changed: true, newId: editing ? null : id });
    analyze(id);
  });

  /* ═════════ ② 인사이트 ═════════ */
  function renderInsight() {
    const rows = L.topicCounts(S.ivs);
    const max = Math.max(1, ...rows.map((r) => r.n));
    $("#kw").innerHTML = rows.map((r) => `<div class="kwr"><span>${esc(r.k)}</span><span class="b" role="img" aria-label="${ROLES.map((x, i) => `${x} ${r.by[i]}명`).join(", ")}">${r.by.map((n, i) => `<i style="width:${(n / max) * 100}%;background:${RC[ROLES[i]]}"></i>`).join("")}</span><b>${r.n}명</b></div>`).join("") +
      `<div class="kw-legend">${ROLES.map((r) => `<span><i style="background:${RC[r]}"></i>${r}</span>`).join("")}</div>`;
    // Claude가 뽑은 핵심어 모음
    const aiIvs = S.ivs.filter((v) => v.ai && v.ai.mode === "ai");
    const freq = {}; aiIvs.forEach((v) => v.ai.keywords.forEach((k) => { freq[k] = (freq[k] || 0) + 1; }));
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 14);
    $("#aiKw").innerHTML = top.length
      ? `<div class="cloud">${top.map(([k, n]) => `<span class="ck" style="--s:${Math.min(1.5, 0.9 + n * 0.15)}">${esc(k)}<small>${n}</small></span>`).join("")}</div><p class="sm">Claude가 읽은 인터뷰 ${aiIvs.length}건에서 뽑았어요.</p>`
      : `<p class="sm">아직 Claude가 읽은 인터뷰가 없어요. 보드에서 카드의 ‘Claude로 읽기’를 누르거나 새 인터뷰를 붙이면 여기에 핵심어가 모여요.${AI.status().enabled === false ? " 지금은 Claude에 연결할 수 없어 말 사전으로만 세고 있어요." : ""}</p>`;
    $("#quotes").innerHTML = ROLES.map((r) => S.ivs.filter((v) => v.role === r).flatMap((v) => {
      const k = v.ai && v.ai.mode === "ai" && v.ai.quote; const qs = L.quotesOf(v.memo);
      return (k ? [k, ...qs.filter((q) => q !== k)] : qs).map((q) => ({ q, v }));
    }).slice(0, 2).map(({ q, v }) => `<figure class="quote" style="--rc:${RC[r]}"><p>“${esc(q)}”</p><small>${esc(v.name)}</small></figure>`).join("")).join("")
      || `<div class="empty"><b>뽑을 인용이 없어요</b>메모에 고객의 말을 큰따옴표로 적어 두면 여기에 모여요.</div>`;
  }

  /* ═════════ ③ 질문 설계 ═════════ */
  const PAIRS = [
    ["학부모 리포트 기능이 있으면 쓰시겠어요?", "지난달 학부모 리포트를 누가, 몇 시간 들여 만들었나요?"],
    ["이런 서비스가 필요하다고 생각하세요?", "마지막으로 리포트를 보낸 날, 어떤 순서로 만드셨어요?"],
    ["월 5만 원이면 괜찮을까요?", "지금 성적 관리에 매달 얼마를 쓰고 계세요?"],
    ["AI가 분석해 주면 좋겠죠?", "학생이 왜 틀렸는지 지난주엔 어떻게 판단하셨어요?"],
  ];
  const VERDICT = {
    bad: ["답을 유도해요", "사람들은 ‘쓰겠다’고 쉽게 말하지만 실제로는 잘 안 씁니다. 지난달 실제로 한 일을 물어보세요."],
    good: ["좋은 질문이에요", "실제로 한 일을 묻고 있어요. 답에서 시간·금액·횟수 같은 숫자가 나오는지 확인하세요."],
    mid: ["조금 더 구체적으로", "‘지난달’, ‘마지막으로’, ‘몇 시간’처럼 과거의 구체적인 행동을 넣어 보세요."],
  };
  const qCache = new Map(); let qTimer = 0; let qSeq = 0;
  function verdictHtml(q) {
    const v = L.checkQuestion(q); if (!v) return "";
    const c = qCache.get(q.trim());
    const fix = (v === "bad" || v === "mid" || (c && c.leading)) ? (c ? c : { pending: true }) : null;
    return `<div class="verdict ${v}"><b>${VERDICT[v][0]}</b><span>${VERDICT[v][1]}</span></div>
      ${fix ? `<div class="rewrite${fix.pending ? " shimmer" : ""}">
        <div class="rw-h"><b>이렇게 바꿔 보세요</b>${fix.pending ? chip(null, true).replace("읽는", "고치는") : chip(fix.src, false)}</div>
        <p class="rw">${fix.pending ? "질문을 고쳐 쓰는 중…" : esc(fix.rewrite)}</p>
        ${fix.reason && !fix.pending ? `<p class="sm">${esc(fix.reason)}</p>` : ""}
        ${fix.pending ? "" : `<button type="button" class="btn sm" id="useRw">이 질문으로 바꾸기</button>`}
      </div>` : ""}`;
  }
  /** 유도 질문이면 Claude에게 고쳐 쓰게 한다 (입력이 멈추고 0.9초 뒤, 같은 질문은 다시 묻지 않음) */
  function scheduleRewrite(q) {
    clearTimeout(qTimer);
    const t = q.trim(); const v = L.checkQuestion(t);
    if (!t || t.length < 6 || v === "good" || qCache.has(t)) return;
    const seq = ++qSeq;
    qTimer = setTimeout(async () => {
      const res = await AI.ask("interview.question", { question: t, context: "학원 원장·강사·학부모 대상 학부모 리포트 문제 인터뷰" });
      const norm = res && L.normalizeQuestion(res.data);
      qCache.set(t, norm && norm.rewrite
        ? { ...norm, src: { mode: "ai", ms: res.ms } }
        : { leading: v === "bad", reason: "", rewrite: L.ruleRewrite(t), src: { mode: "rule", reason: res ? "응답 형식 오류" : AI.status().reason || "AI 미사용" } });
      if (seq === qSeq && $("#qIn").value.trim() === t) $("#qChk").innerHTML = verdictHtml(t);
    }, 900);
  }
  function renderQd() {
    $("#pairs").innerHTML = PAIRS.map((p) => `<li><span class="x"><span class="sr-only">바꾸기 전: </span>${esc(p[0])}</span><span class="ar" aria-hidden="true">→</span><span class="o">${esc(p[1])}</span></li>`).join("");
    $("#qChk").innerHTML = verdictHtml($("#qIn").value);
    $("#qList").innerHTML = S.myQs.map((q, i) => `<li><div><span>${esc(q.t)}</span><span><span class="tag ${q.ok ? "y" : "n"}">${q.ok ? "행동 질문" : "유도 질문"}</span> <button type="button" data-qdel="${i}" aria-label="질문 지우기">지우기</button></span></div></li>`).join("")
      || `<li class="none">아직 담은 질문이 없어요. 위에서 질문을 점검하고 담아 보세요.</li>`;
  }
  $("#qIn").addEventListener("input", () => { $("#qChk").innerHTML = verdictHtml($("#qIn").value); $("#qIn").removeAttribute("aria-invalid"); scheduleRewrite($("#qIn").value); });
  $("#qIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#qSave").click(); } });
  $("#qChk").addEventListener("click", (e) => {
    if (!e.target.closest("#useRw")) return;
    const c = qCache.get($("#qIn").value.trim()); if (!c) return;
    const before = $("#qIn").value; $("#qIn").value = c.rewrite; $("#qChk").innerHTML = verdictHtml(c.rewrite); $("#qIn").focus();
    toast("질문을 바꿨어요", () => { $("#qIn").value = before; $("#qChk").innerHTML = verdictHtml(before); });
  });
  $("#qSave").addEventListener("click", () => {
    const t = $("#qIn").value.trim();
    if (!t) { $("#qIn").setAttribute("aria-invalid", "true"); $("#qChk").innerHTML = `<div class="verdict bad"><b>비어 있어요</b><span>담을 질문을 먼저 적어 주세요.</span></div>`; $("#qIn").focus(); return; }
    S.myQs.push({ t, ok: L.checkQuestion(t) !== "bad" }); save(); $("#qIn").value = ""; renderQd(); toast("질문을 목록에 담았어요");
  });
  $("#qList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-qdel]"); if (!b) return;
    const i = +b.dataset.qdel; const removed = S.myQs.splice(i, 1)[0]; save(); renderQd();
    toast("질문을 지웠어요", () => { S.myQs.splice(i, 0, removed); save(); renderQd(); });
  });

  /* ═════════ ④ 가격 응답 ═════════ */
  function renderPrice() {
    const p = L.priceStats(S.ivs);
    const max = Math.max(1, ...p.buckets.map((b) => b.n));
    $("#priceBars").innerHTML = p.own ? p.buckets.map((b) => `<div class="pr ${b.cls}"><span>${b.label}</span><span class="b"><i style="width:${(b.n / max) * 100}%"></i></span><b>${b.n}명</b></div>`).join("") +
      `<p class="line10"><i></i>파란 막대가 ‘월 10만 원 이하로 내겠다’는 응답이에요.</p>`
      : `<div class="empty"><b>원장 인터뷰가 없어요</b>원장님을 만나 기록하면 가격 응답이 여기 모여요.</div>`;
    const q = S.ivs.filter((v) => v.role === "원장").flatMap((v) => L.quotesOf(v.memo)).find((x) => /만 원/.test(x));
    $("#priceSum").innerHTML = `
      <div class="big"><div><small>돈을 내겠다는 원장</small><b>${p.pay} / ${p.own}</b></div><div><small>그중 월 10만 원 이하</small><b>${Math.round(p.underShare * 100)}%</b></div></div>
      <div class="decision">
        <p>응답 중간값은 <b>월 ${p.median}만 원</b>이에요. 기존 학원 프로그램(월 20만 원대)은 비싸고 기능이 많아 안 쓴다는 말이 반복되어, 가격 기준을 <b>‘월 10만 원 이하’</b>로 정했어요.</p>
        ${q ? `<p class="voice">“${esc(q)}”</p>` : ""}
      </div>`;
  }

  /* ═════════ 인사이트 리포트 (미리보기 → 인쇄·PDF) ═════════ */
  function reportHtml() {
    const c = (r) => S.ivs.filter((x) => x.role === r).length;
    const p = L.priceStats(S.ivs);
    const topics = L.topicCounts(S.ivs, topicsFor).filter((t) => t.n).slice(0, 5);
    const today = new Date(); const d = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}.`;
    const evOf = (h, s) => S.ivs.filter((v) => S.ev[v.id + "|" + h.id] === s);
    const quoteOf = (v) => (v.ai && v.ai.mode === "ai" && v.ai.quote) || L.quotesOf(v.memo)[0] || "";
    const aiN = S.ivs.filter((v) => v.ai && v.ai.mode === "ai").length;
    const verdict = HYPS.map((h) => ({ h, t: tally(h) }));
    return `<article class="rep">
      <header class="rep-h">
        <div class="rep-brand"><svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#241E3A"/><path d="M10 11h20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-9l-6 5v-5h-5a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2z" fill="#F2C14E"/></svg><span>들어보니 · 인터뷰 인사이트 리포트</span></div>
        <h1>학원 리포트 문제 검증</h1>
        <p>${d} · 인터뷰 ${S.ivs.length}명 (원장 ${c("원장")} · 강사 ${c("강사")} · 학부모 ${c("학부모")})${aiN ? ` · Claude 분석 ${aiN}건` : ""}</p>
      </header>
      <section class="rep-sum">
        ${verdict.map(({ h, t }) => `<div class="rs ${t.st}"><span class="stamp ${t.st}">${STAMP[t.st]}</span><b>${h.id}</b><p>${esc(h.text)}</p><small>지지 ${t.y} · 반증 ${t.n} · ${esc(h.crit)}</small></div>`).join("")}
      </section>
      <section><h2>가설별 근거</h2>
        ${verdict.map(({ h }) => `<h3>${h.id} · ${esc(h.text)}</h3>
          <table><thead><tr><th>입장</th><th>누구</th><th>근거가 된 말</th></tr></thead><tbody>
          ${["y", "n"].flatMap((s) => evOf(h, s).map((v) => `<tr><td class="${s}">${s === "y" ? "지지" : "반증"}</td><td>${esc(v.name)}</td><td>${esc(quoteOf(v) || L.plainOf(v.memo).split("\n")[0])}</td></tr>`)).join("") || `<tr><td colspan="3">아직 확정한 근거가 없어요</td></tr>`}
          </tbody></table>`).join("")}
      </section>
      <section class="rep-two">
        <div><h2>많이 나온 이야기</h2><ol class="rep-topics">${topics.map((t) => `<li><span>${esc(t.k)}</span><b>${t.n}명</b></li>`).join("")}</ol></div>
        <div><h2>가격 응답 (원장 ${p.own}명)</h2>
          <ul class="rep-price">${p.buckets.map((b) => `<li><span>${b.label}</span><i style="width:${p.own ? (b.n / p.own) * 100 : 0}%"></i><b>${b.n}</b></li>`).join("")}</ul>
          <p>중간값 <b>월 ${p.median}만 원</b> · 내겠다는 원장 중 ${Math.round(p.underShare * 100)}%가 월 10만 원 이하</p></div>
      </section>
      <section><h2>그대로 옮긴 말</h2>
        <div class="rep-quotes">${ROLES.map((r) => S.ivs.filter((v) => v.role === r).map((v) => ({ q: quoteOf(v), v })).filter((x) => x.q).slice(0, 2).map(({ q, v }) => `<blockquote>“${esc(q)}”<cite>${esc(v.name)}</cite></blockquote>`).join("")).join("")}</div>
      </section>
      <section><h2>그래서 이렇게 정했어요</h2>
        <ol class="rep-next">
          <li>${verdict[0].t.st === "ok" ? "리포트 작성 시간은 실제로 큰 문제다 — ‘다음 주 계획’ 리포트 자동 작성을 첫 기능으로" : "리포트 작성 시간 문제는 근거를 더 모은다 — 원장·강사 인터뷰 추가"}</li>
          <li>가격은 ${p.median ? `중간값(월 ${p.median}만 원)에 맞춰 ` : ""}월 10만 원 이하 요금제부터 시험</li>
          <li>학부모는 점수보다 ‘다음에 뭘 할지’를 원한다 — 리포트 맨 위에 다음 주 계획</li>
        </ol>
      </section>
      <footer class="rep-f">AI 빌더랩 1기 목표 모델 예시 · 인터뷰 대상은 모두 가상 인물입니다 · 근거는 사람이 확정한 것만 셉니다</footer>
    </article>`;
  }
  const rdlg = $("#repDlg");
  $("#openReport").addEventListener("click", () => {
    $("#repBody").innerHTML = reportHtml();
    if (typeof rdlg.showModal === "function") rdlg.showModal(); else rdlg.setAttribute("open", "");
  });
  $("#repClose").addEventListener("click", () => rdlg.close());
  $("#repPrint").addEventListener("click", () => {
    // 모달은 인쇄가 불안정해서, 같은 내용을 보통 영역에 옮겨 인쇄한다
    $("#printArea").innerHTML = reportHtml();
    rdlg.close();
    document.body.classList.add("printing");
    const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => { window.print(); setTimeout(done, 500); }, 30);
  });

  /* ───────── 되돌리기 ───────── */
  $("#reset").addEventListener("click", () => {
    const before = S; S = SAMPLE(); lastTally = {}; qCache.clear(); save(); $("#find").value = ""; render();
    toast("샘플 데이터로 되돌렸어요", () => { S = before; save(); render(); });
  });

  render();
})();
