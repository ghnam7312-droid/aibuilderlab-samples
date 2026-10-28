/* 끝까지 — 화면 (DOM 다루기만 한다. 지표·순위·추천 규칙은 logic.js, AI 호출은 ai-client.js)
 *
 * 글 순위는 '클릭 수'와 '완독 반영' 두 기준을 오가며 볼 수 있다. 바꾸면 자리가 몇 칸 움직였는지 보여 준다.
 * '추천 받기'를 누르면
 *   1) 주제별 평균 완독 점수로 고른 규칙 추천을 바로 보여 주고
 *   2) Claude 에게 계산이 끝난 주제별 합계만 보낸다. 형식·주제·숫자 검사를 통과하면 덮어쓴다.
 */
(function () {
  "use strict";
  const L = window.Kkeutkkaji;
  const STORE_KEY = "startup-news-insight-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 상태 ---------- */
  const seed = () => ({ csv: L.CSV_SAMPLE, by: "score", n: 8, title: "택배 단가 인상, 모르면 손해 보는 대응 꿀팁", rec: null });
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.csv === "string" && L.parseCsv(v.csv).rows.length) return { ...seed(), ...v };
    } catch (e) { /* 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let waiting = false;
  let runToken = 0;

  const rows = () => L.parseCsv(st.csv).rows;
  const list = () => L.metrics(L.lastIssues(rows(), st.n));

  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 호별 추이 (SVG 직접 그리기) ---------- */
  function renderChart() {
    const t = L.issueTrend();
    const W = 640, H = 190, pad = { l: 34, r: 34, t: 14, b: 30 };
    const cw = (W - pad.l - pad.r) / t.length;
    const yO = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / 60);
    const yC = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / 4);
    const shown = new Set(L.ISSUES.map((i) => i.no).sort((a, b) => b - a).slice(0, st.n));
    const bars = t.map((x, i) => {
      const x0 = pad.l + i * cw + cw * 0.22, w = cw * 0.56;
      return `<rect x="${x0}" y="${yO(x.openRate)}" width="${w}" height="${yO(0) - yO(x.openRate)}" rx="4" class="bar${shown.has(x.no) ? "" : " dim"}"/>
        <text x="${x0 + w / 2}" y="${yO(x.openRate) - 4}" class="v">${x.openRate}%</text>
        <text x="${x0 + w / 2}" y="${H - 10}" class="ax">${x.no}호</text>`;
    }).join("");
    const pts = t.map((x, i) => [pad.l + i * cw + cw / 2, yC(x.conv)]);
    const line = `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" class="cline"/>` +
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="cdot"/>${i === 0 || i === pts.length - 1 ? `<text x="${p[0]}" y="${i === 0 ? p[1] - 9 : p[1] + 20}" class="cv">${t[i].conv}%</text>` : ""}`).join("");
    const grid = [0, 15, 30, 45, 60].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yO(v)}" y2="${yO(v)}" class="grid"/><text x="${pad.l - 6}" y="${yO(v) + 4}" class="ax l">${v}%</text><text x="${W - pad.r + 6}" y="${yO(v) + 4}" class="ax r">${(v / 15).toFixed(0)}%</text>`).join("");
    $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${bars}${line}</svg>`;
    const first = t[0], last = t[t.length - 1];
    $("chart").setAttribute("aria-label", `열람률 ${first.no}호 ${first.openRate}%에서 ${last.no}호 ${last.openRate}%, 유료 전환율 ${first.conv}%에서 ${last.conv}%`);
    $("nowOpen").textContent = `${last.no}호 실제 ${last.openRate}%`;
    $("nowConv").textContent = `${last.no}호 실제 ${last.conv}%`;
  }

  /* ---------- 글 순위 ---------- */
  function renderRank() {
    document.querySelectorAll("[data-by]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.by === st.by)));
    document.querySelectorAll("[data-n]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === st.n)));
    const ls = list();
    const ranked = L.rank(ls, st.by);
    const shift = L.rankShift(ls);
    const maxScore = Math.max(1, ...ls.map((x) => x.score));
    const baits = ranked.filter((x) => x.bait);
    const clickTop = L.rank(ls, "clicks").slice(0, 3);
    const baitInTop = clickTop.filter((x) => x.bait).length;
    $("rankNote").innerHTML = !ls.length ? "이 기간에는 글이 없어요."
      : st.by === "clicks"
        ? `클릭 수로만 보면 상위 3개 중 <b>${baitInTop}개</b>가 낚시 의심 글이에요. ‘완독 반영’을 눌러 비교해 보세요.`
        : baits.length
          ? `완독을 반영하니 낚시 의심 글 ${baits.length}개가 <b>${baits.map((x) => `${x.rank}위`).join(" · ")}</b>로 내려갔어요.`
          : "이 기간에는 낚시 의심 글이 없어요.";
    $("rank").innerHTML = `<thead><tr><th class="c-r">순위</th><th>글</th><th class="c-n hide-s">클릭</th><th class="c-n hide-s">클릭률</th><th class="c-n">완독률</th><th class="c-bar">완독 점수</th></tr></thead><tbody>` +
      ranked.map((x) => {
        const s = shift[x.id];
        const mv = st.by === "score" && s ? `<span class="shift ${s > 0 ? "up" : "down"}" aria-label="클릭 순위보다 ${Math.abs(s)}칸 ${s > 0 ? "위" : "아래"}">${s > 0 ? "▲" : "▼"}${Math.abs(s)}</span>` : "";
        return `<tr class="${x.bait ? "is-bait" : ""}">
          <td class="c-r"><b>${x.rank}</b>${mv}</td>
          <td><div class="ttl">${esc(x.title)}${x.bait ? ` <span class="flag">낚시 의심</span>` : ""}</div><div class="meta">${x.no}호 · ${esc(x.topic)}</div></td>
          <td class="c-n hide-s">${x.clicks}</td>
          <td class="c-n hide-s">${x.ctr}%</td>
          <td class="c-n ${x.readRate < 30 ? "low" : ""}">${x.readRate}%</td>
          <td class="c-bar"><span class="sbar"><i style="width:${(x.score / maxScore) * 100}%"></i></span><b>${x.score}</b></td>
        </tr>`;
      }).join("") + "</tbody>";
    return ranked;
  }

  /* ---------- 주제·추천 ---------- */
  function renderTopics() {
    const stats = L.topicStats(list());
    $("topics").innerHTML = `<thead><tr><th>주제</th><th class="c-n">글</th><th class="c-n">완독률</th><th class="c-n">점수</th></tr></thead><tbody>` +
      stats.map((s) => `<tr><td>${esc(s.topic)}${s.bait ? ` <span class="flag sm">낚시 ${s.bait}</span>` : ""}</td><td class="c-n">${s.articles}</td><td class="c-n">${s.readRate}%</td><td class="c-n"><b>${s.score}</b></td></tr>`).join("") + "</tbody>";
  }
  function renderRec() {
    const r = st.rec;
    let chip = "";
    if (waiting) chip = `<span class="mode" data-mode="wait"><i></i>Claude가 고르는 중</span>`;
    else if (r && r.mode === "ai") chip = `<span class="mode" data-mode="ai">Claude로 추천 · ${(r.ms / 1000).toFixed(1)}초</span>`;
    else if (r) chip = `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 주제별 평균 완독 점수로 골랐어요">규칙 기반${r.reason ? ` · ${esc(r.reason)}` : ""}</span>`;
    $("modeChip").innerHTML = chip;
    $("recs").classList.toggle("waiting", waiting);
    $("recs").innerHTML = r ? r.topics.map((t, i) => `<li><span class="no">${i + 1}</span><div><b>${esc(t.topic)}</b><p>${esc(t.reason)}</p>${t.titleIdea ? `<p class="idea">제목 아이디어 · ${esc(t.titleIdea)}</p>` : ""}</div></li>`).join("") : `<li class="empty">‘추천 받기’를 누르면 다음 호에 쓸 주제 3개를 골라요.</li>`;
    $("caution").hidden = !(r && r.caution);
    $("caution").textContent = r && r.caution ? `주의 · ${r.caution}` : "";
  }
  function renderVerdict() {
    const words = L.baitWords(st.title);
    const ls = L.metrics(rows());
    const withW = ls.filter((x) => L.baitWords(x.title).length), other = ls.filter((x) => !L.baitWords(x.title).length);
    const avg = (xs, k) => (xs.length ? Math.round((xs.reduce((s, x) => s + x[k], 0) / xs.length) * 10) / 10 : 0);
    const el = $("verdict");
    if (!st.title.trim()) { el.className = "verdict"; el.textContent = "제목을 넣어 보세요."; return; }
    el.className = `verdict ${words.length ? "warn" : "ok"}`;
    el.innerHTML = words.length
      ? `<b>${words.map((w) => `‘${esc(w)}’`).join(", ")}</b> 같은 표현이 든 지난 글 ${withW.length}개는 클릭률 평균 ${avg(withW, "ctr")}%로 높았지만, 완독률은 ${avg(withW, "readRate")}%였어요 (다른 글 ${avg(other, "readRate")}%). 내용이 드러나는 제목을 권해요.`
      : `<b>괜찮아요.</b> 지난 호에서 완독률이 낮았던 표현이 없어요.`;
  }

  function renderAll() { renderChart(); renderRank(); renderTopics(); renderRec(); renderVerdict(); }

  /* ---------- 추천 받기 ---------- */
  async function run(opts) {
    const stats = L.topicStats(list());
    if (!stats.length) { toast("이 기간에는 글이 없어요"); return; }
    const my = ++runToken;
    const prev = st.rec;
    st.rec = { ...L.recommend(stats), mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderRec();
    const r = await AI.ask("newsinsight.recommend", L.aiInput(stats));
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeRecommend(r.data, stats);
    if (n) st.rec = { ...n, mode: "ai", ms: r.ms };
    else st.rec.reason = r ? "응답 형식이 맞지 않음" : (AI.status().reason || "");
    save(); renderRec();
    if (!(opts && opts.quiet)) toast(`${st.rec.mode === "ai" ? "Claude가" : "완독 점수로"} 주제 ${st.rec.topics.length}개를 골랐어요`, prev ? () => { runToken++; st.rec = prev; save(); renderRec(); } : null);
  }

  /* ---------- 이벤트 ---------- */
  document.querySelectorAll("[data-by]").forEach((b) => b.addEventListener("click", () => { st.by = b.dataset.by; save(); renderRank(); }));
  document.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", () => {
    st.n = Number(b.dataset.n); save(); renderChart(); renderRank(); renderTopics();
    run({ quiet: true });
  }));
  $("run").addEventListener("click", () => run());
  $("titleIn").addEventListener("input", (e) => { st.title = e.target.value; save(); renderVerdict(); });
  $("csvApply").addEventListener("click", () => {
    const p = L.parseCsv($("csvIn").value);
    if (!p.rows.length) { $("csvMsg").textContent = `쓸 수 있는 줄이 없어요${p.errors[0] ? ` · ${p.errors[0].line}번째 줄: ${p.errors[0].why}` : ""}`; return; }
    const before = st.csv;
    st.csv = $("csvIn").value;
    save(); renderAll(); run({ quiet: true });
    $("csvMsg").textContent = `${p.rows.length}줄 적용${p.errors.length ? ` · 건너뛴 줄 ${p.errors.length}개 (${p.errors.slice(0, 2).map((e) => `${e.line}번째: ${e.why}`).join(" / ")})` : ""}`;
    toast("데이터를 바꿨어요", () => { st.csv = $("csvIn").value = before; save(); renderAll(); run({ quiet: true }); $("csvMsg").textContent = ""; });
  });
  $("csvOut").addEventListener("click", () => {
    const ranked = L.rank(list(), st.by);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + L.toCsv(ranked)], { type: "text/csv;charset=utf-8" }));
    a.download = `끝까지-글순위-${st.by === "clicks" ? "클릭" : "완독반영"}-${st.n}호.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`글 ${ranked.length}개 순위를 CSV로 내려받았어요`);
  });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); $("csvIn").value = st.csv; $("titleIn").value = st.title;
    save(); renderAll(); run({ quiet: true });
    toast("샘플 데이터로 되돌렸어요", () => { runToken++; waiting = false; st = before; $("csvIn").value = st.csv; $("titleIn").value = st.title; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  $("csvIn").value = st.csv;
  $("titleIn").value = st.title;
  renderAll();
  AI.probe().then(() => { if (!st.rec) run({ quiet: true }); else renderRec(); });
})();
