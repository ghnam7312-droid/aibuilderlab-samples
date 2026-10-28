/* 값찾기 — 화면 (DOM만 다룬다. 질문 검사·집계·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * 왼쪽: 질문지 검사. '질문지 검사'를 누르면 규칙 결과가 바로 나오고, Claude 결과가 오면 덮어쓴다.
 * 오른쪽: 가격 3안 실험. 아래 인터뷰 표에서 반응·지출·제시한 안을 바꾸면 바로 다시 계산한다.
 */
(function () {
  "use strict";
  const L = window.Gapchatgi;
  const STORE_KEY = "startup-price-test-v1";
  const OPTIONS = [{ id: "A", price: 15000 }, { id: "B", price: 30000 }, { id: "C", price: 49000 }];
  const $ = (id) => document.getElementById(id);
  // ai-client 가 주는 영어 오류 문구는 화면에 맞게 바꾼다
  const whyKo = (r) => (/fetch|network|load failed/i.test(r || "") ? "네트워크 오류" : r || "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------- 샘플 (가상의 질문지·인터뷰) ---------- */
  const QS = [
    "AI가 말하기 숙제를 첨삭해 주면 쓰실 건가요?",
    "한 달에 얼마면 내시겠어요?",
    "수업 사이에 연습할 수 있으면 좋을 것 같지 않으세요?",
    "지난달에 영어 회화에 얼마를 쓰셨어요?",
    "말하기 숙제를 받으면 하실 것 같나요?",
    "마지막으로 회화 수업을 그만둔 이유가 뭐였어요?",
    "지난 2주 동안 수업 말고 영어로 말해 본 적이 있나요?",
  ];
  const P = (code, seg, spent, option, reaction) => ({ code, seg, spent, option, reaction });
  function seed() {
    return {
      qs: QS.slice(), checked: null, ai: { mode: "rule", reason: "" }, basis: "paid", seg: "all", fixed: 0,
      people: [
        P("P01", "직장인", 0, "A", "관심"), P("P02", "직장인", 120000, "B", "선결제"), P("P03", "직장인", 150000, "C", "선결제"),
        P("P04", "대학생", 0, "A", "선결제"), P("P05", "직장인", 90000, "B", "선결제"), P("P06", "학부모", 300000, "C", "관심"),
        P("P07", "직장인", 60000, "A", "관심"), P("P08", "학부모", 200000, "B", "관심"), P("P09", "직장인", 0, "C", "거절"),
        P("P10", "대학생", 0, "A", "관심"), P("P11", "대학생", 0, "B", "거절"), P("P12", "직장인", 80000, "C", "거절"),
      ],
    };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.qs) && Array.isArray(v.people) && v.people.length) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;

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
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${whyKo(s.reason) || "AI 꺼짐"}`;
  });

  /* ---------- 질문지 ---------- */
  const items = () => st.checked && st.checked.length === st.qs.length ? st.checked : L.checkQuestions(st.qs);
  const KCLASS = { "미래 가정": "lead", "동의 유도": "lead", "가격 직접 묻기": "lead", "지난 행동": "past", "보통": "plain" };
  function renderQs() {
    const list = items();
    const lead = L.countLeading(list);
    $("qSum").innerHTML = `<span class="${lead ? "bad" : "good"}"><b>${lead}</b>개 유도형</span><span><b>${list.filter((x) => x.kind === "지난 행동").length}</b>개 지난 행동</span><span>전체 ${list.length}개</span>${st.fixed ? `<span class="good">바꾼 질문 ${st.fixed}개</span>` : ""}`;
    $("qs").innerHTML = list.map((it, i) => `<li class="${KCLASS[it.kind]}">
      <div class="q-row">
        <label class="sr" for="q${i}">질문 ${i + 1}</label>
        <input id="q${i}" data-i="${i}" value="${esc(it.q)}">
        <span class="kind">${esc(it.kind)}</span>
        <button type="button" class="x" data-del="${i}" aria-label="질문 ${i + 1} 지우기">✕</button>
      </div>
      <p class="why">${esc(it.reason)}${it.byRule ? " <em>(Claude가 바꾼 질문이 또 유도형이라 규칙의 안을 넣었어요)</em>" : ""}</p>
      ${it.rewrite ? `<div class="rw"><span>바꿀 안</span><q>${esc(it.rewrite)}</q>${it.leading || it.kind === "보통" ? `<button type="button" data-swap="${i}">바꾸기</button>` : ""}</div>` : ""}
    </li>`).join("");
    $("fixAll").disabled = !lead;
    $("check").disabled = waiting;
    const m = $("mode");
    if (waiting) { m.dataset.mode = "wait"; m.innerHTML = "<i></i>Claude가 읽는 중"; }
    else if (st.ai.mode === "ai") { m.dataset.mode = "ai"; m.textContent = `Claude로 검사 · ${(st.ai.ms / 1000).toFixed(1)}초`; }
    else { m.dataset.mode = "rule"; m.textContent = `규칙 기반${st.ai.reason ? ` · ${st.ai.reason}` : ""}`; }
  }
  function setQ(i, text) {
    st.qs[i] = text;
    if (st.checked && st.checked.length === st.qs.length) st.checked[i] = L.checkQuestions([text])[0]; // 고친 줄은 규칙으로 다시 본다
  }
  $("qs").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-i]"); if (!inp) return;
    const v = inp.value.trim();
    if (!v) { inp.value = st.qs[+inp.dataset.i]; return; }
    setQ(+inp.dataset.i, v); save(); renderQs();
  });
  $("qs").addEventListener("click", (e) => {
    const sw = e.target.closest("button[data-swap]");
    const del = e.target.closest("button[data-del]");
    if (!sw && !del) return;
    const before = clone({ qs: st.qs, checked: st.checked, fixed: st.fixed });
    const undo = () => { Object.assign(st, before); save(); renderQs(); };
    if (sw) {
      const i = +sw.dataset.swap;
      setQ(i, items()[i].rewrite); st.fixed++;
      toast("지난 행동을 묻는 질문으로 바꿨어요", undo);
    } else {
      const i = +del.dataset.del;
      st.qs.splice(i, 1); if (st.checked) st.checked.splice(i, 1);
      toast("질문을 지웠어요", undo);
    }
    save(); renderQs();
  });
  $("qAdd").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("qNew").value.trim(); if (!v) return;
    st.qs.push(v); if (st.checked) st.checked.push(L.checkQuestions([v])[0]);
    $("qNew").value = ""; save(); renderQs();
    const k = L.classify(v);
    toast(L.LEADING.has(k) ? `‘${k}’ 질문이에요. 바꿀 안을 확인하세요` : `‘${k}’ 질문으로 추가했어요`);
  });
  $("fixAll").addEventListener("click", () => {
    const before = clone({ qs: st.qs, checked: st.checked, fixed: st.fixed });
    let n = 0;
    items().forEach((it, i) => { if (it.leading && it.rewrite) { setQ(i, it.rewrite); n++; } });
    st.fixed += n; save(); renderQs();
    toast(`유도형 ${n}개를 바꿨어요`, () => { Object.assign(st, before); save(); renderQs(); });
  });
  async function check(quiet) {
    const my = ++runToken;
    st.checked = L.checkQuestions(st.qs);
    st.ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    save(); renderQs();
    const qs = st.qs.slice();
    const r = await AI.ask("pricetest.questions", { goal: "영어 말하기 숙제 첨삭 서비스를 돈을 내고 꾸준히 쓸지 알아보는 인터뷰", questions: qs });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeCheck(r.data, qs);
    if (n && qs.join("\n") === st.qs.join("\n")) { st.checked = n; st.ai = { mode: "ai", ms: r.ms }; }
    else st.ai = { mode: "rule", reason: r ? (n ? "그사이 질문이 바뀜" : "응답 형식이 맞지 않음") : whyKo(AI.status().reason) };
    save(); renderQs();
    if (quiet !== true) toast(`${st.ai.mode === "ai" ? "Claude가" : "규칙으로"} 유도형 질문 ${L.countLeading(items())}개를 찾았어요`);
  }
  $("check").addEventListener("click", () => check());

  /* ---------- 가격 실험 ---------- */
  const view = () => (st.seg === "all" ? st.people : st.people.filter((p) => p.seg === st.seg));
  function renderPrice() {
    const ppl = view();
    const rows = L.tally(ppl, OPTIONS, st.basis);
    const paidRows = L.tally(ppl, OPTIONS, "paid");
    const pick = L.best(rows);
    document.querySelectorAll("[data-basis]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.basis === st.basis)));
    const max = Math.max(1, ...rows.map((r) => r.per100));
    $("opts").innerHTML = rows.map((r) => `<div class="opt${pick && pick.id === r.id ? " win" : ""}">
      <div class="o-h"><span class="o-id">${r.id}안</span>${pick && pick.id === r.id ? `<span class="badge">기대 매출 1위</span>` : ""}</div>
      <div class="o-price">월 ${L.won(r.price)}</div>
      <div class="o-n">제시 ${r.shown}명 · 선결제 ${r.paid}명 · 관심 ${r.interest}명</div>
      <div class="o-rate"><span>${st.basis === "paid" ? "결제율" : "관심 포함"}</span><b>${L.pct(r.rate)}</b></div>
      <div class="o-bar" aria-hidden="true"><i style="width:${(r.per100 / max) * 100}%"></i></div>
      <div class="o-rev">100명당 기대 매출 <b>${L.won(r.per100)}</b></div>
    </div>`).join("");
    const pPick = L.best(paidRows);
    const flip = st.basis === "interest" && pick && pPick && pick.id !== pPick.id;
    const scope = st.seg === "all" ? `${ppl.length}명` : `${st.seg} ${ppl.length}명`;
    $("verdict").innerHTML = !pick ? `<b>결정 보류</b><span>${scope} 중 ${st.basis === "paid" ? "선결제한" : "관심을 보인"} 사람이 없어요.</span>`
      : flip ? `<b>관심까지 세면 ${pick.id}안(월 ${L.won(pick.price)})이 1위</b><span>말로 한 ‘쓸게요’는 결제가 아니라서 결정에 쓰지 않아요. 선결제만 세면 ${pPick.id}안이에요.</span>`
      : `<b>월 ${L.won(pick.price)}(${pick.id}안)으로 정해요</b><span>${scope} 기준, 100명에게 보이면 기대 매출 ${L.won(pick.per100)}. ${rows.filter((r) => r.id !== pick.id).map((r) => `${r.id}안 ${L.won(r.per100)}`).join(" · ")}</span>`;
    const pv = L.pastVsPaid(ppl);
    const r = (g) => (g.n ? g.paid / g.n : 0);
    const note = L.sampleNote(L.tally(ppl, OPTIONS, "paid"));
    $("pv").innerHTML = `<h3>지난 행동이 결제를 더 잘 말해 줘요</h3>
      <div class="pv-row"><span>최근 3개월 회화에 돈을 쓴 사람</span><div class="pv-bar"><i style="width:${r(pv.spent) * 100}%"></i></div><b>${pv.spent.paid}/${pv.spent.n}명</b></div>
      <div class="pv-row"><span>쓰지 않은 사람</span><div class="pv-bar none"><i style="width:${r(pv.none) * 100}%"></i></div><b>${pv.none.paid}/${pv.none.n}명</b></div>
      ${note ? `<p class="note">${esc(note)}</p>` : ""}`;
  }
  document.querySelector(".p-pane .seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-basis]"); if (!b) return;
    st.basis = b.dataset.basis; save(); renderPrice();
  });

  /* ---------- 인터뷰 표 ---------- */
  function renderTable() {
    const ppl = view();
    $("seg").value = st.seg;
    $("pt").innerHTML = `<thead><tr><th>번호</th><th>구분</th><th>최근 3개월 회화 지출</th><th>제시한 안</th><th>반응</th></tr></thead><tbody>${ppl.map((p) => {
      const i = st.people.indexOf(p);
      return `<tr>
        <td class="code">${esc(p.code)}</td><td>${esc(p.seg)}</td>
        <td><label class="sr" for="s${i}">${esc(p.code)} 지출</label><input id="s${i}" data-spent="${i}" type="number" min="0" step="10000" inputmode="numeric" value="${p.spent || 0}"><span class="unit">원</span></td>
        <td><label class="sr" for="o${i}">${esc(p.code)} 제시한 안</label><select id="o${i}" data-opt="${i}">${OPTIONS.map((o) => `<option value="${o.id}" ${o.id === p.option ? "selected" : ""}>${o.id} · ${L.won(o.price)}</option>`).join("")}</select></td>
        <td><button type="button" class="re r-${p.reaction}" data-re="${i}" aria-label="${esc(p.code)} 반응 ${esc(p.reaction)}, 눌러서 바꾸기">${esc(p.reaction)}</button></td>
      </tr>`;
    }).join("")}</tbody>`;
  }
  $("pt").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-re]"); if (!b) return;
    const p = st.people[+b.dataset.re];
    p.reaction = L.nextReaction(p.reaction);
    save(); renderTable(); renderPrice();
    document.querySelector(`button[data-re="${b.dataset.re}"]`)?.focus();
  });
  $("pt").addEventListener("change", (e) => {
    const s = e.target.closest("[data-spent]"), o = e.target.closest("[data-opt]");
    if (s) st.people[+s.dataset.spent].spent = Math.max(0, Number(s.value) || 0);
    if (o) st.people[+o.dataset.opt].option = o.value;
    save(); renderPrice();
  });
  $("seg").addEventListener("change", (e) => { st.seg = e.target.value; save(); renderTable(); renderPrice(); });

  /* ---------- 내보내기 ---------- */
  $("md").addEventListener("click", async () => {
    const rows = L.tally(st.people, OPTIONS, "paid");
    const out = L.summaryMd(rows, L.best(rows), L.pastVsPaid(st.people), { leading: st.fixed, total: st.qs.length });
    $("mdOut").textContent = out; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(out); toast("복사했어요. 사업계획서·투자 설명 자료에 붙여 넣으세요"); }
    catch (e) { $("mdBox").open = true; toast("아래 내용을 직접 복사해 주세요"); }
  });
  $("csv").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.csv(st.people)], { type: "text/csv;charset=utf-8" }));
    a.download = "값찾기-인터뷰.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${st.people.length}명 기록을 CSV로 내려받았어요 (이름 없이 번호만)`);
  });

  /* ---------- 시작 ---------- */
  function renderAll() { renderQs(); renderPrice(); renderTable(); }
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); save(); renderAll(); check(true);
    toast("샘플로 되돌렸어요", () => { st = before; save(); renderAll(); });
  });
  renderAll();
  AI.probe().then(() => { if (!st.checked || st.ai.mode !== "ai") check(true); });
})();
