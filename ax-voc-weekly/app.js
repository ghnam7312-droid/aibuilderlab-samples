/* 같은말 — 화면 (DOM 다루기만 한다. 주제·개인정보·집계·메일은 logic.js, AI 호출은 ai-client.js)
 *
 * '리포트 만들기'를 누르면
 *   1) 규칙으로 바로 리포트를 쓰고 (주제별 건수 · 늘어난 불만 · 상품팀 요청)
 *   2) 개인정보를 지운 숫자와 대표 문장만 Claude 에게 보내 문장을 다시 쓴다.
 *      개인정보가 섞였거나 없는 숫자를 쓰면 버리고 1)을 그대로 둔다.
 * 보내기 직전에 메일 본문 전체를 한 번 더 검사해(piiGate) 개인정보가 있으면 막는다.
 */
(function () {
  "use strict";
  const L = window.Gateunmal;
  const STORE_KEY = "ax-voc-weekly-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());
  const WEEK = L.reportWeek(today());

  /* ---------- 샘플 문의 (가상의 쇼핑몰 '솔담리빙', 리포트 주 기준 날짜로 만든다) ---------- */
  const NAMES = ["김지현", "박서윤", "이준호", "최예은", "정우진", "강하은", "조민준", "윤채은", "장도윤", "임서아", "한지민", "신유진", "권태호", "황보람", "송다인", "안지후", "류하준", "배수아"];
  const POOL = {
    chair: ["원목 식탁 의자에 앉을 때마다 삐걱 소리가 나요", "산 지 2주 된 의자가 벌써 흔들거려요", "의자 다리 쪽에서 삐걱거리는 소리가 계속 나요", "식탁 의자 4개 중 2개가 삐걱거려요. 나사를 조여도 그래요"],
    rug: ["거실 러그에서 털이 너무 많이 빠져요", "러그 청소기를 돌려도 털이 날려요", "아이가 있는데 러그 털이 빠져서 걱정돼요", "세탁 한 번 했더니 보풀이 심해요"],
    ship: ["배송이 예정일보다 3일 늦어요", "주문한 지 일주일인데 아직 안 와요", "배송 지연 안내 문자를 못 받았어요"],
    damage: ["화병이 깨져서 왔어요", "상자가 찌그러져서 왔고 안에 액자도 파손됐어요", "포장이 터져서 도착했어요"],
    pickup: ["반품 신청했는데 수거 기사님이 안 오세요", "수거 예정일이 지났어요"],
    size: ["침대 커버 사이즈가 안 맞아요. 슈퍼싱글이라고 해서 샀는데 작아요", "이불 치수 안내가 상세 페이지에 없어요"],
    pay: ["앱에서 결제 오류가 나요", "결제 화면에서 앱이 멈춰요"],
    etc: ["기사님이 친절하셨어요, 감사합니다", "회원 등급 기준이 궁금해요"],
  };
  // [이번 주 건수, 지난주 건수]
  const PLAN = { chair: [9, 3], rug: [7, 2], ship: [6, 9], damage: [4, 4], pickup: [3, 3], size: [3, 2], pay: [2, 5], etc: [2, 2] };
  function sample() {
    const out = [];
    let k = 0;
    Object.entries(PLAN).forEach(([topic, [cur, last]]) => {
      for (let i = 0; i < cur + last; i++, k++) {
        const name = NAMES[k % NAMES.length];
        const phone = `010-${String(3000 + ((k * 397) % 6000)).padStart(4, "0")}-${String(1000 + ((k * 761) % 9000)).padStart(4, "0")}`;
        const day = i < cur ? (i * 3 + k) % 7 : -1 - ((i * 2 + k) % 7);
        let text = POOL[topic][i % POOL[topic].length];
        // 고객이 글 안에 직접 남기는 개인정보 (예전 리포트에 그대로 실렸던 것)
        if (k % 4 === 0) text += `. ${name}입니다, ${phone}로 연락 주세요`;
        else if (k % 4 === 1) text += `. 주문번호 SD2610${String(100 + k)}`;
        else if (k % 7 === 2) text += `. 솔담시 하늘구 버들로 ${10 + k} ${100 + (k % 5)}동 ${1000 + k}호로 받았어요`;
        else if (k % 9 === 3) text += `. 답장은 user${k}@example.com 으로 주세요`;
        out.push({ id: `V${1000 + k}`, date: L.addDays(WEEK.start, day), channel: ["채팅", "이메일", "게시판", "전화 메모"][k % 4], name, text });
      }
    });
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }

  /* ---------- 상태 ---------- */
  const seed = () => ({ items: sample(), links: {}, sent: [], topic: "all", seq: 2000, week: WEEK.start });
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.items) && v.week === WEEK.start) return v; // 주가 바뀌면 샘플을 새로
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let agg = null, rep = null, mode = { kind: "rule", reason: "" }, waiting = false, runToken = 0;
  const names = () => [...new Set(st.items.map((x) => x.name).filter(Boolean))];

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  const tokens = (s) => esc(s).replace(/\[(이름|연락처|이메일|주소|주문번호)\]/g, '<mark class="tok">$&</mark>');

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 왼쪽: 문의 데이터 ---------- */
  function renderData() {
    $("wk").textContent = WEEK.label;
    const cur = st.items.filter((x) => x.date >= WEEK.start && x.date <= WEEK.end);
    const counts = {};
    cur.forEach((x) => { const t = L.topicOf(x.text); counts[t] = (counts[t] || 0) + 1; });
    $("topics").innerHTML = `<button type="button" data-t="all" aria-pressed="${st.topic === "all"}">전체 <i>${cur.length}</i></button>` +
      L.TOPICS.concat(L.ETC).filter((t) => counts[t.id]).map((t) => `<button type="button" data-t="${t.id}" aria-pressed="${st.topic === t.id}">${esc(t.label)} <i>${counts[t.id]}</i></button>`).join("");
    const raw = $("showRaw").checked;
    const ns = names();
    const shown = cur.filter((x) => st.topic === "all" || L.topicOf(x.text) === st.topic);
    $("rows").innerHTML = shown.map((x) => {
      const t = L.topicById(L.topicOf(x.text));
      const pii = L.findPii(x.text, ns).length;
      let body;
      if (raw) {
        body = esc(x.text);
        L.findPii(x.text, ns).forEach((h) => { body = body.split(esc(h.value)).join(`<mark class="raw-pii">${esc(h.value)}</mark>`); });
      } else body = tokens(L.scrub(x.text, ns).text);
      return `<li><div class="r-top"><span class="date">${L.md(x.date)}</span><span class="ch">${esc(x.channel)}</span><span class="tp t-${t.id}">${esc(t.label)}</span><span class="who">${raw ? esc(x.name) : esc(x.name ? x.name[0] + "○○" : "")}</span>${pii ? `<span class="pc" title="이 글에서 지운 개인정보">개인정보 ${pii}</span>` : ""}</div><p>${body}</p></li>`;
    }).join("") || `<li class="none">이 주제의 문의가 없어요.</li>`;
  }

  /* ---------- 오른쪽: 리포트 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 문장을 다듬는 중</span>`;
    if (mode.kind === "ai") return `<span class="mode" data-mode="ai">Claude로 요약 · ${(mode.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 숫자로 문장을 만들었어요">규칙 기반${mode.reason ? ` · ${esc(mode.reason)}` : ""}</span>`;
  }
  function renderReport() {
    const max = Math.max(1, ...agg.rows.map((r) => Math.max(r.count, r.last)));
    const mail = L.buildMail(rep, agg);
    $("paper").innerHTML = `
      <div class="p-head"><span class="p-k">주간 문의 동향 · ${esc(WEEK.label)}</span>${modeChip()}</div>
      <h3 class="headline${waiting ? " waiting" : ""}">${esc(rep.headline)}</h3>
      <ul class="lines${waiting ? " waiting" : ""}">${rep.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <table class="bars"><caption class="sr">주제별 문의 건수</caption>
        <thead><tr><th>주제</th><th>지난주 · 그 전 주</th><th class="n">증감</th></tr></thead>
        <tbody>${agg.rows.map((r) => `<tr class="${r.rising ? "rise" : ""}">
          <th scope="row">${esc(r.label)}${r.rising ? ` <span class="badge">급증</span>` : ""}<small>${esc(r.team)}팀</small></th>
          <td><span class="hb now" style="width:${(r.count / max) * 85}%"><b>${r.count}</b></span><span class="hb was" style="width:${(r.last / max) * 85}%"><b>${r.last}</b></span></td>
          <td class="n ${r.delta > 0 ? "plus" : r.delta < 0 ? "minus" : ""}">${r.delta > 0 ? "+" : ""}${r.delta}</td></tr>`).join("")}</tbody>
      </table>
      ${agg.rows.filter((r) => r.rising).map((r) => `<div class="quote"><b>${esc(r.label)}</b> — 고객이 쓴 말${r.quotes.map((q) => `<q>${tokens(q)}</q>`).join("")}</div>`).join("")}
      <h4>상품팀에 요청</h4>
      <ol class="asks">${rep.asks.map((a) => {
        const row = agg.rows.find((r) => r.label === a.topic);
        const s = (row && st.links[row.id]) || "";
        return `<li><div><b>${esc(a.topic)}</b> ${esc(a.ask)}</div>${row ? `<button type="button" class="link s${L.LINK_STEPS.indexOf(s)}" data-link="${row.id}" aria-label="${esc(a.topic)} 진행 단계 바꾸기">${s ? esc(s) : "전달 전"}</button>` : ""}</li>`;
      }).join("") || `<li class="none">급하게 늘어난 불만이 없어 요청할 일이 없어요.</li>`}</ol>`;
    $("mailOut").textContent = `제목: ${mail.subject}\n\n${mail.body}`;
    const hits = L.piiGate(mail, names());
    $("gate").dataset.ok = String(!hits.length);
    const f = agg.removed;
    $("gate").innerHTML = hits.length
      ? `<b>개인정보 검사: 막힘</b> 메일 본문에 ${hits.map((h) => esc(h.type === "name" ? "이름" : h.type)).join(", ")}이(가) 있어요. 보낼 수 없어요.`
      : `<b>개인정보 검사 통과</b> 지난주 문의 글에서 ${["name", "phone", "email", "address", "order"].filter((k) => f[k]).map((k) => `${{ name: "이름", phone: "연락처", email: "이메일", address: "주소", order: "주문번호" }[k]} ${f[k]}`).join(" · ") || "지울 것 없음"}을 지웠고, 고객 이름·연락처 칸은 리포트에 넣지 않아요.`;
    $("send").disabled = !!hits.length || waiting;
  }
  function renderGoals() {
    $("gTotal").textContent = `${agg.total}건`;
    $("gLast").textContent = `그 전 주 ${agg.lastTotal}건 · ${agg.total >= agg.lastTotal ? "+" : ""}${agg.total - agg.lastTotal}`;
    $("gUp").textContent = `${agg.rows.filter((r) => r.rising).length}건`;
    $("gPii").textContent = `${agg.removedTotal}건`;
    $("gLink").textContent = `${L.linkedCount(st.links)}건`;
    $("nextSend").textContent = `다음 발송 ${L.nextSend(today(), new Date().getHours())}`;
    $("sentLog").textContent = st.sent.length ? `보낸 기록: ${st.sent.slice(-3).map((s) => s.at).join(", ")}` : "";
  }
  function render() { renderData(); renderReport(); renderGoals(); save(); }

  /* ---------- 리포트 만들기 ---------- */
  async function run() {
    const my = ++runToken;
    const ns = names();
    agg = L.aggregate(st.items, WEEK, ns);
    rep = L.ruleSummary(agg);
    mode = { kind: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    render();
    const input = { week: WEEK.label, total: agg.total, lastTotal: agg.lastTotal, topics: agg.rows.map((r) => ({ topic: r.label, team: r.team, count: r.count, last: r.last, rising: r.rising, quotes: r.quotes })) };
    const r = await AI.ask("vocweekly.summary", input);
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeVoc(r.data, agg, ns);
    if (n) { rep = { headline: n.headline, lines: n.lines, asks: n.asks.length ? n.asks : rep.asks }; mode = { kind: "ai", ms: r.ms }; }
    else mode = { kind: "rule", reason: r ? "응답에 개인정보·없는 숫자가 있거나 형식이 틀림" : (AI.status().reason || "") };
    render();
  }

  /* ---------- 이벤트 ---------- */
  $("run").addEventListener("click", () => { run(); toast("지난주 문의로 리포트를 다시 만들었어요"); });
  $("topics").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-t]"); if (!b) return;
    st.topic = b.dataset.t; renderData(); save();
  });
  $("showRaw").addEventListener("change", renderData);
  $("paper").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-link]"); if (!b) return;
    const id = b.dataset.link, before = st.links[id] || "";
    st.links[id] = L.nextLink(before);
    if (!st.links[id]) delete st.links[id];
    render();
    toast(`${L.topicById(id).label}: ${st.links[id] || "전달 전"}`, () => { if (before) st.links[id] = before; else delete st.links[id]; render(); });
  });
  $("copy").addEventListener("click", async () => {
    const mail = L.buildMail(rep, agg);
    if (L.piiGate(mail, names()).length) { toast("개인정보가 있어 복사하지 않았어요"); return; }
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); toast("메일 본문을 복사했어요"); }
    catch (err) { $("mailBox").open = true; toast("아래 미리보기에서 직접 복사해 주세요"); }
  });
  $("send").addEventListener("click", () => {
    const mail = L.buildMail(rep, agg);
    if (L.piiGate(mail, names()).length) { toast("개인정보가 있어 보내지 않았어요"); return; }
    const d = new Date();
    st.sent.push({ at: `${L.md(L.iso(d))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, subject: mail.subject });
    render();
    toast("상품팀·물류팀에 보낸 것으로 기록했어요", () => { st.sent.pop(); render(); });
  });
  $("csv").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.toCsv(agg)], { type: "text/csv;charset=utf-8" }));
    a.download = `같은말-주간문의-${WEEK.start.replace(/-/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("주제별 건수를 내려받았어요 (고객 글·개인정보 없음)");
  });
  // 날짜 고르기: 리포트 주 7일
  $("aDay").innerHTML = Array.from({ length: 7 }, (_, i) => L.addDays(WEEK.start, i)).map((d, i) => `<option value="${d}"${i === 6 ? " selected" : ""}>${L.md(d)}(${L.DAYS[L.d0(d).getDay()]})</option>`).join("");
  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("aText").value.trim(); if (!text) return;
    const item = { id: `V${st.seq++}`, date: $("aDay").value, channel: "채팅", name: $("aName").value.trim(), text };
    st.items.unshift(item);
    $("addForm").reset();
    $("aDay").selectedIndex = 6;
    run();
    const t = L.topicById(L.topicOf(text));
    toast(`‘${t.label}’ 문의로 넣고 리포트를 다시 만들었어요`, () => { st.items = st.items.filter((x) => x.id !== item.id); run(); });
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); run();
    toast("샘플 데이터로 되돌렸어요", () => { st = before; run(); });
  });

  /* ---------- 시작 ---------- */
  AI.probe().then(() => run());
  agg = L.aggregate(st.items, WEEK, names()); rep = L.ruleSummary(agg);
  render();
})();
