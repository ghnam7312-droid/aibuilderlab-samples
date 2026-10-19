/* 금요보고 · app.js — 화면만 다룬다. 계산은 logic.js(WR), AI 호출은 ai-client.js(AI).
 *
 * 흐름
 *  1. 금요일 오후, 지난 금요일~어제(목) 7일 숫자를 넣는다 (입력 즉시 검증)
 *  2. '보고서 만들기' → 핵심 숫자·차트·상품 순위를 바로 그리고,
 *     요약 문장은 Claude(report.summary)가 쓴다. 안 되면 규칙 문장
 *  3. 검산 — 요약 문장 속 숫자를 하나하나 데이터와 맞춰 본다. 없는 숫자가 있으면 빨간 표시 + 발송 전 경고
 *  4. 메일 미리 보기 → 발송(데모: 기록만), A4 PDF 저장
 */
(() => {
  "use strict";

  const STORE_KEY = "geumyobogo:v3";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { dayOf, label, holiday, stats, pct, n0, man } = WR;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sec = (ms) => `${(ms / 1000).toFixed(1)}초`;
  const METRIC = { sales: { name: "매출", unit: "원", short: (v) => (v ? `${Math.round(v / 10000)}만` : "0") }, orders: { name: "주문", unit: "건", short: (v) => n0(v) }, visits: { name: "방문", unit: "명", short: (v) => n0(v) } };

  /* ───────── 상태 ───────── */
  function sample() {
    return { ...WR.sample(), to: ["sales-team@daon.example", "ceo@daon.example"], sched: false, log: [], generated: false, summary: null };
  }
  let st = load() || sample();
  let wk = "now";          // 입력 표에서 보는 주
  let metric = "sales";    // 차트 지표
  let writing = false;     // Claude가 요약을 쓰는 중
  function load() { try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch { /* 저장 실패해도 화면은 동작 */ } }
  const snapshot = () => JSON.parse(JSON.stringify(st));

  /* ───────── AI 연결 표시 ───────── */
  AI.onChange((s) => {
    const ind = $("#ai-ind");
    ind.dataset.on = s.enabled === true ? "on" : s.enabled === false ? "off" : "wait";
    $("#ai-ind-t").textContent = s.enabled === true ? "Claude 연결됨" : s.enabled === false ? "규칙 모드" : "AI 확인 중";
    ind.title = s.enabled === false ? `요약 문장을 규칙으로 씁니다 (${s.reason})` : "요약 문장을 Claude가 씁니다. 숫자는 금요보고가 검산합니다";
  });

  /* ───────── 입력 표 ───────── */
  function renderData() {
    $$(".wk-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.wk === wk)));
    const rows = st.weeks[wk];
    let h = `<thead><tr><th>날짜</th><th>매출(원)</th><th>주문</th><th>방문</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      const hol = holiday(wk, i);
      h += `<tr><td class="d">${label(dayOf(wk, i))}${hol ? `<small>${hol}</small>` : ""}</td>` +
        ["sales", "orders", "visits"].map((f) => `<td><input inputmode="numeric" data-i="${i}" data-f="${f}" value="${n0(r[f])}" aria-label="${label(dayOf(wk, i))} ${METRIC[f].name}"></td>`).join("") + `</tr>`;
    });
    const s = stats(rows);
    h += `</tbody><tfoot><tr><td>합계</td><td>${n0(s.S)}</td><td>${n0(s.O)}</td><td>${n0(s.V)}</td></tr></tfoot>`;
    $("#data").innerHTML = h;
  }
  $("#data").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-f]");
    if (!inp) return;
    const i = Number(inp.dataset.i), f = inp.dataset.f, row = st.weeks[wk][i];
    const r = WR.parseCell(inp.value, { field: f, visits: row.visits, orders: row.orders });
    if (!r.ok) {
      inp.classList.add("bad");
      $("#data-err").textContent = `${label(dayOf(wk, i))} ${METRIC[f].name}: ${r.msg} 고칠 때까지 보고서는 이전 숫자로 둡니다.`;
      $("#data-err").hidden = false;
      return;
    }
    inp.classList.remove("bad");
    if (!$$("#data input.bad").length) $("#data-err").hidden = true;
    if (row[f] === r.value) { inp.value = n0(r.value); return; }
    row[f] = r.value;
    // 규칙 문장은 숫자를 따라 다시 쓰고, Claude 문장은 그대로 두고 검산만 다시 한다 (틀린 숫자가 빨갛게 보인다)
    if (st.summary && st.summary.mode === "rule") st.summary.lines = WR.ruleSummary(st.weeks, st.top);
    if (st.summary && st.summary.mode === "ai") st.summary.stale = true;
    save();
    renderData();
    if (st.generated) renderReport(false);
  });
  $("#data").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const inp = e.target.closest("input"); if (!inp) return;
    e.preventDefault(); inp.dispatchEvent(new Event("change", { bubbles: true }));
    const next = $(`#data input[data-i="${Number(inp.dataset.i) + 1}"][data-f="${inp.dataset.f}"]`);
    if (next) { next.focus(); next.select(); }
  });

  /* ───────── 차트 (SVG 직접 그리기) ───────── */
  function chartSVG({ compact = false } = {}) {
    const W = 760, H = compact ? 240 : 300, P = { l: 56, r: 50, t: 30, b: 40 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const L = st.weeks.last, N = st.weeks.now;
    const raw = Math.max(...L.map((r) => r[metric]), ...N.map((r) => r[metric]), 1);
    const max = WR.niceStep((raw * 1.05) / 4) * 4; // 눈금 4칸
    const rates = N.map((r) => (r.visits ? (r.orders / r.visits) * 100 : 0));
    const rmin = Math.floor((Math.min(...rates) - 0.2) * 2) / 2, rmax = Math.ceil((Math.max(...rates) + 0.2) * 2) / 2;
    const gw = iw / 7, bw = Math.min(26, gw / 3.2);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="일별 ${METRIC[metric].name} 막대(지난주·이번 주)와 이번 주 전환율 선">`;
    for (let g = 0; g <= 4; g++) {
      const y = P.t + ih - (ih * g) / 4;
      s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="${g ? "#EEF0F5" : "#1B2340"}" stroke-width="${g ? 1 : 1.2}"/>`;
      s += `<text x="${P.l - 10}" y="${y + 4}" text-anchor="end" font-size="11.5" fill="#8790A8">${METRIC[metric].short((max * g) / 4)}</text>`;
      s += `<text x="${W - P.r + 10}" y="${y + 4}" font-size="11.5" fill="#12825A">${(rmin + ((rmax - rmin) * g) / 4).toFixed(2).replace(/0$/, "")}%</text>`;
    }
    const pts = [];
    for (let i = 0; i < 7; i++) {
      const cx = P.l + gw * i + gw / 2;
      const h1 = (L[i][metric] / max) * ih, h2 = (N[i][metric] / max) * ih;
      const hol = holiday("now", i);
      if (hol) s += `<rect x="${P.l + gw * i + 3}" y="${P.t - 22}" width="${gw - 6}" height="${ih + 22}" rx="6" fill="#FDF0DC" opacity=".55"/><text x="${cx}" y="${P.t - 8}" text-anchor="middle" font-size="11" font-weight="700" fill="#C97A0E">${hol}</text>`;
      s += `<rect class="b" x="${cx - bw - 2}" y="${P.t + ih - h1}" width="${bw}" height="${h1}" rx="3" fill="#B9C1D2" style="animation-delay:${200 + i * 60}ms"/>`;
      s += `<rect class="b" x="${cx + 2}" y="${P.t + ih - h2}" width="${bw}" height="${h2}" rx="3" fill="#F2A33A" style="animation-delay:${260 + i * 60}ms"/>`;
      s += `<text x="${cx}" y="${H - 14}" text-anchor="middle" font-size="12" fill="#4B5370" font-weight="${hol ? 700 : 500}">${label(dayOf("now", i))}</text>`;
      if (!compact) s += `<rect class="bar-hit" data-i="${i}" x="${P.l + gw * i}" y="${P.t}" width="${gw}" height="${ih}" fill="transparent"/>`;
      pts.push([cx, P.t + ih - ((rates[i] - rmin) / (rmax - rmin)) * ih]);
    }
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    s += `<path class="line" d="${d}" fill="none" stroke="#12825A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" style="--len:${Math.ceil(len)};animation-delay:700ms" pointer-events="none"/>`;
    pts.forEach((p, i) => { s += `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#12825A" stroke-width="2" style="animation-delay:${1200 + i * 50}ms" pointer-events="none"/>`; });
    return s + `</svg>`;
  }

  /* ───────── 요약 + 검산 ───────── */
  const FACTS = () => WR.facts(st.weeks, st.top);
  /** 문장 하나를 HTML로: **굵게** + 숫자마다 검산 표시 */
  function lineHTML(line, facts) {
    const c = WR.checkNumbers(line, facts);
    let html = esc(line).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    // 같은 숫자 문자열이 여러 번 나와도 순서대로 하나씩 감싼다
    let from = 0;
    c.items.forEach((it) => {
      const raw = esc(it.raw);
      const at = html.indexOf(raw, from);
      if (at < 0) return;
      const tag = `<span class="nm ${it.ok ? "ok" : "bad"}" title="${esc(it.ok ? `데이터: ${it.note}` : "데이터에 없는 숫자예요")}">${raw}</span>`;
      html = html.slice(0, at) + tag + html.slice(at + raw.length);
      from = at + tag.length;
    });
    return { html, check: c };
  }
  function verifyAll() {
    const f = FACTS();
    const res = (st.summary?.lines || []).map((l) => lineHTML(l, f));
    const total = res.reduce((a, r) => a + r.check.total, 0);
    const bad = res.reduce((a, r) => a + (r.check.total - r.check.matched), 0);
    return { res, total, bad };
  }
  function summarySection() {
    if (writing) {
      return `<div class="r-sec-h"><h3>이번 주 요약</h3><span class="mode ai busy">Claude가 쓰는 중</span></div>
        <div class="shimmer" aria-label="요약을 쓰는 중"><i></i><i></i><i></i><i></i></div>`;
    }
    const s = st.summary;
    if (!s) return "";
    const v = verifyAll();
    const chip = s.mode === "ai"
      ? `<span class="mode ai">Claude로 작성 · ${sec(s.ms || 0)}</span>`
      : `<span class="mode rule">규칙으로 작성${s.reason ? ` · ${esc(s.reason)}` : ""}</span>`;
    const verdict = v.bad
      ? `<div class="verify bad" role="alert"><b>숫자 검산 · ${v.total}개 중 ${v.bad}개가 데이터에 없어요</b><span>빨간 숫자를 확인한 뒤 보내세요.${s.stale ? " 숫자를 고친 뒤라 요약을 다시 써야 해요." : ""}</span><span class="v-act">${s.mode === "ai" ? `<button type="button" class="btn sm" data-rewrite>요약 다시 쓰기</button>` : ""}<button type="button" class="btn sm ghost" data-rule>규칙 문장으로 바꾸기</button></span></div>`
      : `<div class="verify ok"><b>숫자 검산 통과 · ${v.total}개 모두 데이터와 일치</b><span>문장 속 숫자를 하나하나 입력 표·상품 순위와 맞춰 봤어요. 숫자에 마우스를 올리면 출처가 보여요.</span></div>`;
    return `<div class="r-sec-h"><h3>이번 주 요약</h3>${chip}</div>
      <ol class="summary">${v.res.map((r) => `<li>${r.html}</li>`).join("")}</ol>
      ${verdict}`;
  }
  async function writeSummary() {
    writing = true;
    renderSummaryOnly();
    const r = await AI.ask("report.summary", WR.aiInput(st.weeks, st.top));
    const lines = r && WR.fromAi(r.data);
    st.summary = lines
      ? { mode: "ai", lines, ms: r.ms }
      : { mode: "rule", lines: WR.ruleSummary(st.weeks, st.top), reason: AI.status().reason || "" };
    writing = false;
    save();
    if (st.generated) { renderSummaryOnly(); renderMail(); }
    const v = verifyAll();
    toast(v.bad ? `요약에 데이터에 없는 숫자 ${v.bad}개가 있어요 · 빨간 표시를 확인하세요` : `요약을 썼어요 · 숫자 ${v.total}개 검산 통과`);
  }
  function renderSummaryOnly() {
    const el = $("#sum-sec");
    if (el) el.innerHTML = summarySection();
    const f = $("#foot-v");
    if (f) f.textContent = footV();
  }
  function footV() {
    if (writing || !st.summary) return "요약 작성 중";
    const v = verifyAll();
    return v.bad ? `요약 숫자 검산 ${v.bad}개 확인 필요` : `요약 숫자 검산 통과 (${v.total}개)`;
  }

  /* ───────── 보고서 ───────── */
  const delta = (v, unit = "%", fx = 1) => `<span class="delta ${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(fx)}${unit}</span>`;
  function renderReport(assemble) {
    const L = st.weeks.last, N = st.weeks.now, a = stats(L), b = stats(N);
    const range = WR.weekRange("now");
    const lastRank = Object.fromEntries(st.top.last.map(([n], i) => [n, i]));
    const kpi = (k, v, unit, d, key) => `<div class="kpi"><small>${k}</small><b data-count="${key}" data-to="${v}">${n0(v)}<em>${unit}</em></b>${d}</div>`;
    $("#report").innerHTML = `
      <header class="r-head">
        <div>
          <div class="r-org">다온오피스 온라인몰 · 영업기획팀</div>
          <h2 class="r-title">10월 9일–15일 주간 성과 보고</h2>
          <div class="r-range">${range} · 지난주 ${WR.weekRange("last")}과 비교</div>
        </div>
        <div class="r-meta">작성 <b>엑셀탈출</b><br>자동 생성 10/16(금) 17:00<br>금요보고 v1.0</div>
      </header>
      <div class="kpis">
        ${kpi("매출", b.S / 10000, "만 원", delta(pct(b.S, a.S)), "man")}
        ${kpi("주문", b.O, "건", delta(pct(b.O, a.O)), "n")}
        ${kpi("방문", b.V, "명", delta(pct(b.V, a.V)), "n")}
        <div class="kpi"><small>전환율</small><b>${b.R.toFixed(2)}<em>%</em></b>${delta(b.R - a.R, "%p", 2)}</div>
        ${kpi("객단가", b.A, "원", delta(pct(b.A, a.A)), "n")}
      </div>
      <section class="r-sec" style="animation-delay:150ms">
        <div class="r-sec-h">
          <h3>일별 흐름</h3>
          <div class="metric" role="group" aria-label="차트 지표">${Object.keys(METRIC).map((k) => `<button type="button" data-metric="${k}" aria-pressed="${k === metric}">${METRIC[k].name}</button>`).join("")}</div>
        </div>
        <div class="chart" id="chart">${chartSVG()}</div>
        <div class="legend">${legend()}</div>
      </section>
      <section class="r-sec" id="sum-sec" style="animation-delay:900ms">${summarySection()}</section>
      <section class="r-sec" style="animation-delay:1100ms">
        <div class="r-sec-h"><h3>많이 팔린 상품</h3></div>
        <table class="top5"><thead><tr><th>순위</th><th>상품</th><th class="n">수량</th><th class="n">매출</th><th class="n">지난주</th></tr></thead><tbody>
          ${st.top.now.map(([name, q, s], i) => {
            const was = lastRank[name];
            const mv = was === undefined ? `<span class="mv new">새로 진입</span>` : was > i ? `<span class="mv up">▲ ${was - i}</span>` : was < i ? `<span class="mv down">▼ ${i - was}</span>` : `<span class="mv">–</span>`;
            return `<tr><td class="rk">${i + 1}</td><td>${esc(name)}</td><td class="n">${n0(q)}</td><td class="n">${man(s)}</td><td class="n">${mv}</td></tr>`;
          }).join("")}
        </tbody></table>
      </section>
      <section class="r-sec no-print" style="animation-delay:1250ms">
        <div class="r-sec-h"><h3>메일 본문</h3><button type="button" class="btn sm ghost" data-preview>메일로 미리 보기</button></div>
        <div class="mailbox" id="mail"></div>
      </section>
      <footer class="r-foot"><span>다온오피스 온라인몰 영업기획팀 · 내부용</span><span>숫자 출처: 판매 시스템 일별 집계 (KST) · <span id="foot-v">${footV()}</span></span></footer>`;
    renderMail();
    $("#blank").hidden = true;
    $("#report").hidden = false;
    $("#copy").disabled = false;
    $("#print").disabled = false;
    $("#gen").textContent = "보고서 다시 만들기";

    const rep = $("#report");
    if (assemble && !reduceMotion) {
      rep.classList.remove("assembling"); void rep.offsetWidth; rep.classList.add("assembling");
      $$(".kpi", rep).forEach((k, i) => { k.style.animationDelay = `${80 + i * 70}ms`; });
      countUp(rep);
      clearTimeout(renderReport.t);
      renderReport.t = setTimeout(() => rep.classList.remove("assembling"), 2400);
    } else {
      rep.classList.remove("assembling");
    }
  }
  const legend = () => `<span><i style="background:#B9C1D2"></i>지난주 ${METRIC[metric].name}</span><span><i style="background:#F2A33A"></i>이번 주 ${METRIC[metric].name}</span><span><i class="ln" style="background:#12825A"></i>이번 주 전환율</span>`;
  function countUp(root) {
    $$("[data-count]", root).forEach((el) => {
      const to = Number(el.dataset.to), unit = el.querySelector("em").outerHTML;
      const t0 = performance.now(), dur = 900;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.innerHTML = n0(to * e) + unit;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  const plain = (l) => String(l).replace(/\*\*/g, "");
  function mailText() {
    const a = stats(st.weeks.last), b = stats(st.weeks.now);
    const lines = st.summary?.lines || [];
    return `제목: [주간 성과] 10월 9일–15일 (${WR.weekRange("now")})

팀 여러분, 이번 주 성과를 공유드립니다.

■ 핵심 숫자
- 매출 ${n0(b.S)}원 (지난주 대비 ${pct(b.S, a.S) >= 0 ? "+" : ""}${pct(b.S, a.S).toFixed(1)}%)
- 주문 ${n0(b.O)}건 · 방문 ${n0(b.V)}명
- 전환율 ${b.R.toFixed(2)}% (${b.R - a.R >= 0 ? "+" : ""}${(b.R - a.R).toFixed(2)}%p) · 객단가 ${n0(b.A)}원

■ 요약
${lines.length ? lines.map((l, i) => `${i + 1}. ${plain(l)}`).join("\n") : "(요약을 쓰는 중입니다)"}

일별 차트와 상품 순위는 첨부한 보고서(PDF)에서 확인해 주세요.
영업기획팀 드림`;
  }
  function renderMail() { const m = $("#mail"); if (m) m.textContent = mailText(); }

  /* ───────── 메일 미리 보기 (실제 메일처럼) ───────── */
  function openPreview() {
    if (!st.generated) { toast("먼저 ‘보고서 만들기’를 눌러 주세요"); return; }
    const a = stats(st.weeks.last), b = stats(st.weeks.now);
    const v = verifyAll();
    const now = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(st.sched ? WR.nextFriday(new Date()) : new Date());
    const row = (k, v1, d) => `<tr><td>${k}</td><td class="n">${v1}</td><td class="n">${d}</td></tr>`;
    $("#pv-body").innerHTML = `
      <div class="em-head">
        <div class="em-row"><span>보낸 사람</span><b>금요보고 &lt;weekly@daon.example&gt;</b></div>
        <div class="em-row"><span>받는 사람</span><b>${st.to.map(esc).join(", ") || "(없음)"}</b></div>
        <div class="em-row"><span>${st.sched ? "예약" : "보낼 때"}</span><b>${esc(now)}</b></div>
        <h3 class="em-subj">[주간 성과] 10월 9일–15일 · 매출 ${man(b.S)} (${pct(b.S, a.S) >= 0 ? "+" : ""}${pct(b.S, a.S).toFixed(1)}%)</h3>
      </div>
      ${v.bad ? `<div class="verify bad em-warn"><b>잠깐 · 요약에 데이터에 없는 숫자 ${v.bad}개</b><span>보고서의 빨간 숫자를 먼저 확인하세요. 그래도 보내면 기록에 ‘검산 경고’로 남습니다.</span></div>` : ""}
      <div class="em-letter">
        <p>팀 여러분, 이번 주 성과를 공유드립니다.</p>
        <table class="em-kpi"><thead><tr><th>지표</th><th class="n">이번 주</th><th class="n">지난주 대비</th></tr></thead><tbody>
          ${row("매출", `${n0(b.S)}원`, `${pct(b.S, a.S) >= 0 ? "+" : ""}${pct(b.S, a.S).toFixed(1)}%`)}
          ${row("주문", `${n0(b.O)}건`, `${pct(b.O, a.O) >= 0 ? "+" : ""}${pct(b.O, a.O).toFixed(1)}%`)}
          ${row("방문", `${n0(b.V)}명`, `${pct(b.V, a.V) >= 0 ? "+" : ""}${pct(b.V, a.V).toFixed(1)}%`)}
          ${row("전환율", `${b.R.toFixed(2)}%`, `${b.R - a.R >= 0 ? "+" : ""}${(b.R - a.R).toFixed(2)}%p`)}
          ${row("객단가", `${n0(b.A)}원`, `${pct(b.A, a.A) >= 0 ? "+" : ""}${pct(b.A, a.A).toFixed(1)}%`)}
        </tbody></table>
        <div class="em-chart">${chartSVG({ compact: true })}</div>
        <ol>${v.res.map((r) => `<li>${r.html}</li>`).join("")}</ol>
        <p>일별 흐름과 상품 순위는 첨부한 보고서에서 확인해 주세요.<br>영업기획팀 드림</p>
      </div>
      <div class="em-att"><span class="pdf">PDF</span><div><b>주간성과_1009-1015.pdf</b><small>A4 1쪽 · 보고서 그대로</small></div></div>`;
    $("#pv-send").textContent = v.bad ? "확인했고 보내기" : `${st.to.length}명에게 보내기`;
    $("#pv-send").classList.toggle("warn", !!v.bad);
    $("#preview").hidden = false; $("#scrim").hidden = false;
    $("#pv-close").focus();
  }
  function closePreview() { $("#preview").hidden = true; $("#scrim").hidden = true; }
  function sendNow() {
    if (!st.to.length) { closePreview(); showTab("send"); showToErr("받는 사람을 먼저 넣어 주세요."); return; }
    const v = verifyAll();
    const k = new Date(Date.now() + 9 * 3600000), p2 = (n) => String(n).padStart(2, "0");
    const at = `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}`;
    st.log.unshift({ title: "10월 9일–15일 주간 성과 보고", n: st.to.length, at, warn: v.bad > 0, by: st.summary?.mode || "rule" });
    save(); renderSend(); closePreview();
    toast(`${st.to.length}명에게 보낸 것으로 기록했어요 (데모: 실제 메일은 나가지 않아요)`);
  }

  /* ───────── 차트 말풍선 · 지표 바꾸기 · 요약 버튼 ───────── */
  const tip = $("#tip");
  $("#report").addEventListener("mousemove", (e) => {
    const hit = e.target.closest(".bar-hit");
    if (!hit) { tip.hidden = true; return; }
    const i = Number(hit.dataset.i), L = st.weeks.last[i], N = st.weeks.now[i];
    const m = METRIC[metric];
    const fmtV = (v) => (metric === "sales" ? man(v) : `${n0(v)}${m.unit}`);
    const g = pct(N[metric], L[metric]);
    tip.innerHTML = `<b>${label(dayOf("now", i))}</b>${holiday("now", i) ? ` · ${holiday("now", i)}` : ""}<br>이번 주 ${fmtV(N[metric])}<br>지난주 ${label(dayOf("last", i))} ${fmtV(L[metric])} (${g >= 0 ? "+" : ""}${g.toFixed(1)}%)<br>전환율 ${((N.orders / N.visits) * 100).toFixed(2)}%`;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 14}px`;
  });
  $("#report").addEventListener("mouseleave", () => { tip.hidden = true; });
  $("#report").addEventListener("click", (e) => {
    const b = e.target.closest("[data-metric]");
    if (b) {
      metric = b.dataset.metric;
      $$("[data-metric]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.metric === metric)));
      $("#chart").innerHTML = chartSVG();
      $(".legend").innerHTML = legend();
      return;
    }
    if (e.target.closest("[data-rewrite]")) { writeSummary(); return; }
    if (e.target.closest("[data-rule]")) {
      const before = snapshot();
      st.summary = { mode: "rule", lines: WR.ruleSummary(st.weeks, st.top), reason: "직접 바꿈" };
      save(); renderReport(false);
      toast("규칙 문장으로 바꿨어요", () => { st = before; save(); renderReport(false); });
      return;
    }
    if (e.target.closest("[data-preview]")) openPreview();
  });

  /* ───────── 발송 설정 ───────── */
  const fmtFull = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  function renderSend() {
    $("#sw").setAttribute("aria-checked", String(st.sched));
    $("#sched-next").textContent = st.sched ? `다음 발송 ${fmtFull.format(WR.nextFriday(new Date()))} · ${st.to.length}명` : "꺼져 있어요";
    $("#chips").innerHTML = st.to.length
      ? st.to.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-rm="${i}" aria-label="${esc(t)} 빼기">✕</button></span>`).join("")
      : `<span class="sim" style="margin:0">받는 사람이 없어요. 아래에서 추가하세요.</span>`;
    $("#log").innerHTML = st.log.length
      ? st.log.slice(0, 6).map((l) => `<li><span><b>${esc(l.title)}</b> · ${l.n}명${l.warn ? ` <em class="lw">검산 경고</em>` : ""}${l.by === "ai" ? ` <em class="lb">Claude 요약</em>` : ""}</span><span>${esc(l.at)}</span></li>`).join("")
      : `<li class="empty">아직 보낸 기록이 없어요</li>`;
  }
  $("#sw").addEventListener("click", () => {
    if (!st.sched && !st.to.length) { showToErr("받는 사람을 먼저 한 명 이상 넣어 주세요."); return; }
    st.sched = !st.sched; save(); renderSend();
    toast(st.sched ? "자동 발송을 켰어요 (데모: 실제로 보내지 않음)" : "자동 발송을 껐어요");
  });
  function showToErr(m) { $("#to-err").textContent = m; $("#to-err").hidden = false; $("#to-in").classList.add("bad"); $("#to-in").focus(); }
  $("#to-in").addEventListener("input", () => { $("#to-err").hidden = true; $("#to-in").classList.remove("bad"); });
  $("#to-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#to-in").value.trim();
    if (!v) return showToErr("이메일 주소를 적어 주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return showToErr(`“${v}”는 이메일 주소 형식이 아니에요. 예: team@company.com`);
    if (st.to.includes(v)) return showToErr("이미 들어 있는 주소예요.");
    st.to.push(v); save(); renderSend(); $("#to-in").value = "";
    toast(`${v}를 받는 사람에 넣었어요`);
  });
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    const before = snapshot(); const who = st.to[Number(b.dataset.rm)];
    st.to.splice(Number(b.dataset.rm), 1);
    if (!st.to.length) st.sched = false;
    save(); renderSend();
    toast(`${who}를 뺐어요`, () => { st = before; save(); renderSend(); });
  });
  $("#send-now").addEventListener("click", openPreview);
  $("#pv-send").addEventListener("click", sendNow);
  $("#pv-close").addEventListener("click", closePreview);
  $("#scrim").addEventListener("click", closePreview);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#preview").hidden) closePreview(); });

  /* ───────── 패널 탭 ───────── */
  const TABS = ["data", "send", "guide"];
  function showTab(k) {
    TABS.forEach((t) => { $(`#pt-${t}`).setAttribute("aria-selected", String(t === k)); $(`#pp-${t}`).hidden = t !== k; });
  }
  TABS.forEach((t) => $(`#pt-${t}`).addEventListener("click", () => showTab(t)));
  $(".ptabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const cur = TABS.findIndex((t) => $(`#pt-${t}`).getAttribute("aria-selected") === "true");
    const nx = TABS[(cur + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    showTab(nx); $(`#pt-${nx}`).focus();
  });
  $$(".wk-switch button").forEach((b) => b.addEventListener("click", () => { wk = b.dataset.wk; $("#data-err").hidden = true; renderData(); }));

  /* ───────── 알림 ───────── */
  let toastTimer = null, undoFn = null;
  function toast(msg, undo) {
    $("#toast-t").textContent = msg; undoFn = undo || null; $("#toast-undo").hidden = !undo;
    $("#toast").classList.add("on"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  $("#toast-undo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  /* ───────── 버튼 ───────── */
  $("#gen").addEventListener("click", () => {
    if ($$("#data input.bad").length) { toast("빨간 칸을 먼저 고쳐 주세요"); return; }
    st.generated = true; st.summary = null; save();
    writing = true;
    renderReport(true);
    if (matchMedia("(max-width: 900px)").matches) $("#page").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // 차트가 그려지는 동안 요약을 쓴다
    writeSummary();
  });
  $("#copy").addEventListener("click", async () => {
    const txt = mailText();
    try { await navigator.clipboard.writeText(txt); toast("메일 본문을 복사했어요"); }
    catch { const r = document.createRange(); r.selectNodeContents($("#mail")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("본문을 선택했어요. Ctrl+C로 복사하세요"); }
  });
  $("#print").addEventListener("click", () => window.print());
  $("#reset").addEventListener("click", () => {
    const before = snapshot();
    st = sample(); wk = "now"; metric = "sales"; writing = false; save();
    $("#data-err").hidden = true;
    renderData(); renderSend();
    $("#report").hidden = true; $("#blank").hidden = false; $("#copy").disabled = true; $("#print").disabled = true; $("#gen").textContent = "보고서 만들기";
    toast("샘플 데이터로 되돌렸어요", () => { st = before; save(); renderData(); renderSend(); if (st.generated) renderReport(false); });
  });

  renderData();
  renderSend();
  if (st.generated) {
    if (!st.summary) st.summary = { mode: "rule", lines: WR.ruleSummary(st.weeks, st.top), reason: "" };
    renderReport(false);
  }
  AI.probe();
})();
