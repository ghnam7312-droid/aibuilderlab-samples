/*
 * 들어보니 — 고객 인터뷰 보드 (AI 빌더랩 1기 목표 모델 예시)
 *
 * 인터뷰 카드마다 가설(H1, H2)에 대한 근거를 '지지 / 반증 / 상관없음'으로 태그한다.
 * 기록된 숫자(리포트에 쓴 시간, 낼 수 있는 금액)로 태그를 '제안'하고, 사람이 눌러 확정한 것만 근거로 센다.
 * 확정한 근거가 쌓이면 가설 도장이 '검증 중 → 검증됨 / 반증됨'으로 바뀐다.
 * 'AI 요약'은 데모에서 브라우저 규칙(키워드 사전 + 따옴표 인용)으로 동작한다. 저장은 localStorage.
 */
(() => {
  "use strict";

  const KEY = "deureoboni-v2";
  const ROLES = ["원장", "강사", "학부모"];
  const RC = { 원장: "var(--r-own)", 강사: "var(--r-tea)", 학부모: "var(--r-par)" };

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

  /* ───────── 가설과 근거 ───────── */
  const HYPS = [
    { id: "H1", text: "원장·강사는 학부모 리포트에 한 달 4시간 넘게 쓴다", crit: "지난달 리포트에 쓴 시간 4시간 이상이면 지지",
      auto: (v) => (v.role === "학부모" ? "x" : v.hours >= 4 ? "y" : "n") },
    { id: "H2", text: "원장은 월 10만 원 이하라면 리포트 도구에 돈을 낸다", crit: "낼 수 있는 금액이 1~10만 원이면 지지",
      auto: (v) => (v.role !== "원장" ? "x" : v.price > 0 && v.price <= 10 ? "y" : "n") },
  ];
  const confirmed = (v, h) => S.ev[v.id + "|" + h.id];         // 확정한 태그 (없으면 undefined)
  function tally(h) {
    let y = 0, n = 0;
    S.ivs.forEach((v) => { const e = confirmed(v, h); if (e === "y") y++; else if (e === "n") n++; });
    const st = y >= 3 && y >= n * 2 ? "ok" : n > y ? "no" : "wait";
    return { y, n, st };
  }
  const STAMP = { ok: "검증됨", no: "반증됨", wait: "검증 중" };

  /* ───────── 'AI 요약' 규칙: 말 사전 + 따옴표 인용 ───────── */
  const DICT = {
    "리포트에 드는 시간": ["시간", "주말", "오래", "미뤘"],
    "엑셀·캡처 수작업": ["엑셀", "손으로", "메모장", "캡처", "출력"],
    "카톡으로 전달": ["카톡"],
    "다음에 뭘 할지": ["다음 주", "다음에", "뭘 시키", "뭘 하는"],
    "단원별로 보기": ["단원"],
    "오답 유형 근거": ["유형", "오답"],
    "가격 부담": ["만 원", "비싸", "넘으면"],
  };
  const topicsOf = (memo) => Object.entries(DICT).filter(([, ws]) => ws.some((w) => memo.includes(w))).map(([k]) => k);
  const quotesOf = (memo) => [...memo.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const plainOf = (memo) => memo.replace(/"[^"]+"/g, "").trim();

  /* ───────── 알림 ───────── */
  let undoFn = null, toastT = 0;
  function toast(msg, undo) {
    $("#toastMsg").textContent = msg; undoFn = undo || null; $("#toastUndo").hidden = !undo;
    $("#toast").classList.add("on"); clearTimeout(toastT);
    toastT = setTimeout(() => { $("#toast").classList.remove("on"); undoFn = null; }, undo ? 5000 : 2200);
  }
  $("#toastUndo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  /* ───────── 탭 ───────── */
  const tab = () => $(".tabs [aria-selected=true]").dataset.v;
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b))); render();
  }));
  function render() {
    const v = tab();
    ["board", "insight", "qd", "price"].forEach((x) => ($("#v-" + x).hidden = x !== v));
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
      const blocks = Array.from({ length: t.y }, (_, i) => `<i class="y${grew && i === t.y - 1 && (!prev || t.y > prev.y) ? " new" : ""}"></i>`).join("") +
        Array.from({ length: t.n }, (_, i) => `<i class="n${grew && i === t.n - 1 && (!prev || t.n > prev.n) ? " new" : ""}"></i>`).join("");
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

  function cardHtml(v, isNew) {
    const quotes = quotesOf(v.memo); const plain = plainOf(v.memo);
    const facts = v.role === "학부모" ? "" : `<div class="facts"><span>지난달 리포트 <b>${v.hours}시간</b></span>${v.role === "원장" ? `<span>낼 금액 <b>${v.price ? "월 " + v.price + "만 원" : "안 냄"}</b></span>` : ""}</div>`;
    const ev = HYPS.map((h) => {
      const c = confirmed(v, h); const e = c || h.auto(v);
      const label = e === "y" ? "지지" : e === "n" ? "반증" : "상관없음";
      if (!c && e === "x") return "";   // 상관없는 가설은 제안하지 않는다
      return c
        ? `<button type="button" class="ev-b ${e}" data-ev="${v.id}|${h.id}" aria-label="${h.id} 근거 ${label}로 확정됨. 눌러서 바꾸기">${h.id} ${label}</button>`
        : `<button type="button" class="ev-b sug ${e}" data-ev="${v.id}|${h.id}" aria-label="${h.id} ${label} 제안. 눌러서 확정하기">${h.id} ${label}?<span class="auto">제안</span></button>`;
    }).join("");
    return `<article class="card${isNew ? " new" : ""}" data-role="${esc(v.role)}">
      <div class="ch"><span class="nm">${esc(v.name)}</span><span class="role">${esc(v.role)}</span></div>
      ${facts}
      ${plain ? `<p class="memo">${esc(plain)}</p>` : ""}
      ${quotes.map((q) => `<p class="voice">“${esc(q)}”</p>`).join("")}
      <div class="kws">${topicsOf(v.memo).map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>
      <div class="ev">${ev}<button type="button" class="del" data-del="${v.id}" aria-label="${esc(v.name)} 인터뷰 지우기">지우기</button></div>
    </article>`;
  }

  function renderBoard(opts = {}) {
    renderHyps(opts.changed);
    $("#roleF").innerHTML = ["전체", ...ROLES].map((r) => `<button type="button" data-r="${r}" aria-pressed="${S.role === r}">${r !== "전체" ? `<span class="dot" style="background:${RC[r]}"></span>` : ""}${r} <small>${r === "전체" ? S.ivs.length : S.ivs.filter((v) => v.role === r).length}</small></button>`).join("");
    const q = $("#find").value.trim();
    const list = S.ivs.filter((v) => (S.role === "전체" || v.role === S.role) && (!q || (v.memo + v.name).includes(q)));
    $("#cards").innerHTML = list.map((v) => cardHtml(v, opts.newId === v.id)).join("")
      || (S.ivs.length ? `<div class="empty"><b>맞는 인터뷰가 없어요</b>다른 말로 찾거나 역할을 ‘전체’로 바꿔 보세요.</div>`
        : `<div class="empty"><b>아직 붙인 인터뷰가 없어요</b>‘인터뷰 기록하기’로 첫 카드를 붙여 보세요.</div>`);
  }

  $("#cards").addEventListener("click", (e) => {
    const evb = e.target.closest("[data-ev]");
    if (evb) {
      // 근거 태그를 지지 → 반증 → 상관없음 순서로 바꾼다
      const [id, hid] = evb.dataset.ev.split("|"); const v = S.ivs.find((x) => x.id === +id); const h = HYPS.find((x) => x.id === hid);
      // 제안이면 그대로 확정, 이미 확정했으면 지지 → 반증 → 상관없음 → 지지 순서로 바꾼다
      const k = v.id + "|" + h.id; const c = S.ev[k]; const order = ["y", "n", "x"];
      S.ev[k] = c ? order[(order.indexOf(c) + 1) % 3] : h.auto(v);
      save(); renderBoard({ changed: true });
      const again = $(`[data-ev="${evb.dataset.ev}"]`); if (again) again.focus();
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      const i = S.ivs.findIndex((x) => x.id === +del.dataset.del); const removed = S.ivs.splice(i, 1)[0];
      save(); render();
      toast(`‘${removed.name}’ 카드를 지웠어요`, () => { S.ivs.splice(i, 0, removed); save(); render(); });
    }
  });
  $("#roleF").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; S.role = b.dataset.r; save(); renderBoard(); });
  $("#find").addEventListener("input", () => renderBoard());

  /* 인터뷰 기록 창 */
  const dlg = $("#addDlg");
  $("#openAdd").addEventListener("click", () => {
    $("#addForm").reset(); $$("#addForm .err").forEach((x) => (x.hidden = true)); $$("#addForm [aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    $("#fName").focus();
  });
  $("#addCancel").addEventListener("click", () => dlg.close());
  $("#addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#fName").value.trim(); const memo = $("#fMemo").value.trim();
    $("#eName").hidden = !!name; $("#fName").setAttribute("aria-invalid", String(!name));
    $("#eMemo").hidden = !!memo; $("#fMemo").setAttribute("aria-invalid", String(!memo));
    if (!name) { $("#fName").focus(); return; }
    if (!memo) { $("#fMemo").focus(); return; }
    const role = $("#addForm").elements.role.value;
    const id = Math.max(0, ...S.ivs.map((v) => v.id)) + 1;
    S.ivs.unshift({ id, role, name, memo, hours: Math.max(0, +$("#fHours").value || 0), price: Math.max(0, +$("#fPrice").value || 0) });
    if (S.role !== "전체" && S.role !== role) S.role = "전체";
    save(); dlg.close();
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.v === "board")));
    ["board", "insight", "qd", "price"].forEach((x) => ($("#v-" + x).hidden = x !== "board"));
    $("#find").value = "";
    render(); renderBoard({ changed: true, newId: id });
    toast("보드에 붙였어요 · 가설 근거에 바로 반영됐어요");
  });

  /* ═════════ ② 인사이트 ═════════ */
  function renderInsight() {
    const rows = Object.keys(DICT).map((k) => {
      const by = ROLES.map((r) => S.ivs.filter((v) => v.role === r && topicsOf(v.memo).includes(k)).length);
      return { k, by, n: by.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...rows.map((r) => r.n));
    $("#kw").innerHTML = rows.map((r) => `<div class="kwr"><span>${esc(r.k)}</span><span class="b" role="img" aria-label="${ROLES.map((x, i) => `${x} ${r.by[i]}명`).join(", ")}">${r.by.map((n, i) => `<i style="width:${(n / max) * 100}%;background:${RC[ROLES[i]]}"></i>`).join("")}</span><b>${r.n}명</b></div>`).join("") +
      `<div class="kw-legend">${ROLES.map((r) => `<span><i style="background:${RC[r]}"></i>${r}</span>`).join("")}</div>`;
    $("#quotes").innerHTML = ROLES.map((r) => S.ivs.filter((v) => v.role === r).flatMap((v) => quotesOf(v.memo).map((q) => ({ q, v }))).slice(0, 2)
      .map(({ q, v }) => `<figure class="quote" style="--rc:${RC[r]}"><p>“${esc(q)}”</p><small>${esc(v.name)}</small></figure>`).join("")).join("")
      || `<div class="empty"><b>뽑을 인용이 없어요</b>메모에 고객의 말을 큰따옴표로 적어 두면 여기에 모여요.</div>`;
  }

  /* ═════════ ③ 질문 설계 ═════════ */
  const PAIRS = [
    ["학부모 리포트 기능이 있으면 쓰시겠어요?", "지난달 학부모 리포트를 누가, 몇 시간 들여 만들었나요?"],
    ["이런 서비스가 필요하다고 생각하세요?", "마지막으로 리포트를 보낸 날, 어떤 순서로 만드셨어요?"],
    ["월 5만 원이면 괜찮을까요?", "지금 성적 관리에 매달 얼마를 쓰고 계세요?"],
    ["AI가 분석해 주면 좋겠죠?", "학생이 왜 틀렸는지 지난주엔 어떻게 판단하셨어요?"],
  ];
  const BAD = [/하시겠어요/, /쓰시겠/, /사시겠/, /좋을까요/, /좋겠죠/, /괜찮을까요/, /필요하(다고|신가요|세요)/, /원하(시나요|세요)/, /어떨까요/, /의향/, /않나요/, /이면\s*\S*(괜찮|쓰|사)/];
  const GOOD = [/지난(달|주|번)/, /최근/, /마지막으로/, /실제로/, /얼마(나|를)/, /몇\s*(번|시간|명)/, /어떻게\s*(하셨|판단하셨|만드셨)/, /누가/, /어떤 순서/];
  function check(q) {
    if (!q.trim()) return "";
    if (BAD.some((r) => r.test(q))) return `<div class="verdict bad"><b>답을 유도해요</b><span>사람들은 ‘쓰겠다’고 쉽게 말하지만 실제로는 잘 안 씁니다. “지난달 실제로 어떻게 하셨어요?”처럼 과거에 한 일을 물어보세요.</span></div>`;
    if (GOOD.some((r) => r.test(q))) return `<div class="verdict good"><b>좋은 질문이에요</b><span>실제로 한 일을 묻고 있어요. 답에서 시간·금액·횟수 같은 숫자가 나오는지 확인하세요.</span></div>`;
    return `<div class="verdict mid"><b>조금 더 구체적으로</b><span>‘지난달’, ‘마지막으로’, ‘몇 시간’처럼 과거의 구체적인 행동을 넣어 보세요.</span></div>`;
  }
  function renderQd() {
    $("#pairs").innerHTML = PAIRS.map((p) => `<li><span class="x"><span class="sr-only" style="position:absolute;left:-9999px">바꾸기 전: </span>${esc(p[0])}</span><span class="ar" aria-hidden="true">→</span><span class="o">${esc(p[1])}</span></li>`).join("");
    $("#qChk").innerHTML = check($("#qIn").value);
    $("#qList").innerHTML = S.myQs.map((q, i) => `<li><div><span>${esc(q.t)}</span><span><span class="tag ${q.ok ? "y" : "n"}">${q.ok ? "행동 질문" : "유도 질문"}</span> <button type="button" data-qdel="${i}" aria-label="질문 지우기">지우기</button></span></div></li>`).join("")
      || `<li class="none">아직 담은 질문이 없어요. 위에서 질문을 점검하고 담아 보세요.</li>`;
  }
  $("#qIn").addEventListener("input", () => { $("#qChk").innerHTML = check($("#qIn").value); $("#qIn").removeAttribute("aria-invalid"); });
  $("#qIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#qSave").click(); } });
  $("#qSave").addEventListener("click", () => {
    const t = $("#qIn").value.trim();
    if (!t) { $("#qIn").setAttribute("aria-invalid", "true"); $("#qChk").innerHTML = `<div class="verdict bad"><b>비어 있어요</b><span>담을 질문을 먼저 적어 주세요.</span></div>`; $("#qIn").focus(); return; }
    S.myQs.push({ t, ok: !BAD.some((r) => r.test(t)) }); save(); $("#qIn").value = ""; renderQd(); toast("질문을 목록에 담았어요");
  });
  $("#qList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-qdel]"); if (!b) return;
    const i = +b.dataset.qdel; const removed = S.myQs.splice(i, 1)[0]; save(); renderQd();
    toast("질문을 지웠어요", () => { S.myQs.splice(i, 0, removed); save(); renderQd(); });
  });

  /* ═════════ ④ 가격 응답 ═════════ */
  function renderPrice() {
    const own = S.ivs.filter((v) => v.role === "원장");
    const B = [["안 냄", (p) => p === 0, "zero"], ["5만 원 이하", (p) => p > 0 && p <= 5, ""], ["5~10만 원", (p) => p > 5 && p <= 10, ""], ["10만 원 넘게", (p) => p > 10, "over"]];
    const max = Math.max(1, ...B.map((b) => own.filter((v) => b[1](v.price)).length));
    $("#priceBars").innerHTML = own.length ? B.map(([l, f, c]) => { const n = own.filter((v) => f(v.price)).length;
      return `<div class="pr ${c}"><span>${l}</span><span class="b"><i style="width:${(n / max) * 100}%"></i></span><b>${n}명</b></div>`; }).join("") +
      `<p class="line10"><i></i>파란 막대가 ‘월 10만 원 이하로 내겠다’는 응답이에요.</p>`
      : `<div class="empty"><b>원장 인터뷰가 없어요</b>원장님을 만나 기록하면 가격 응답이 여기 모여요.</div>`;
    const pay = own.filter((v) => v.price > 0); const under = pay.filter((v) => v.price <= 10);
    const sorted = pay.map((v) => v.price).sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
    const q = own.flatMap((v) => quotesOf(v.memo)).find((x) => /만 원/.test(x));
    $("#priceSum").innerHTML = `
      <div class="big"><div><small>돈을 내겠다는 원장</small><b>${pay.length} / ${own.length}</b></div><div><small>그중 월 10만 원 이하</small><b>${pay.length ? Math.round((under.length / pay.length) * 100) : 0}%</b></div></div>
      <div class="decision">
        <p>응답 중간값은 <b>월 ${med}만 원</b>이에요. 기존 학원 프로그램(월 20만 원대)은 비싸고 기능이 많아 안 쓴다는 말이 반복되어, 가격 기준을 <b>‘월 10만 원 이하’</b>로 정했어요.</p>
        ${q ? `<p class="voice">“${esc(q)}”</p>` : ""}
      </div>`;
  }

  /* ───────── 되돌리기 ───────── */
  $("#reset").addEventListener("click", () => {
    const before = S; S = SAMPLE(); lastTally = {}; save(); $("#find").value = ""; render();
    toast("샘플 데이터로 되돌렸어요", () => { S = before; save(); render(); });
  });

  render();
})();
