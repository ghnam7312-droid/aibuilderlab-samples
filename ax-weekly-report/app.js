/* 금요보고 — 주간 성과 보고서 자동 생성
 *
 * 금요일 오후, 지난 금요일~어제(목) 7일 숫자를 넣으면
 * 핵심 숫자 · 일별 차트 · 요약 문장 · 메일 본문을 만든다.
 * 요약 문장은 정해 둔 규칙(증감률, 최고/최저 요일, 휴일, 전환율)으로 쓴다. 실제 AI 호출은 없다.
 * 날짜는 모두 한국 시간(KST) 기준으로 계산한다.
 */
(() => {
  "use strict";

  const STORE_KEY = "geumyobogo:v2";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ───────── 날짜 (KST) ───────── */
  const DAY = 86400000;
  const WEEK_START = { last: "2026-10-02", now: "2026-10-09" }; // 둘 다 금요일
  const HOLIDAYS = { "2026-10-03": "개천절", "2026-10-09": "한글날" };
  const kstDate = (iso) => new Date(`${iso}T00:00:00+09:00`);
  const fmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short" });
  const isoKST = (d) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  function dayOf(wk, i) { return new Date(kstDate(WEEK_START[wk]).getTime() + i * DAY); }
  function label(d) { const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])); return `${p.month}/${p.day}(${p.weekday})`; }
  const holiday = (wk, i) => HOLIDAYS[isoKST(dayOf(wk, i))] || "";

  /* ───────── 샘플 데이터 (가상의 다온오피스 온라인몰) ───────── */
  function sample() {
    const mk = (rows) => rows.map(([sales, orders, visits]) => ({ sales, orders, visits }));
    return {
      weeks: {
        last: mk([[4120000, 61, 1820], [5480000, 80, 2310], [4960000, 72, 2150], [3980000, 58, 1760], [4550000, 66, 1910], [4700000, 70, 2010], [4390000, 64, 1880]]),
        now: mk([[6120000, 92, 2480], [5890000, 86, 2390], [5150000, 75, 2210], [4310000, 63, 1840], [4880000, 72, 1990], [5020000, 76, 2050], [4750000, 71, 1930]]),
      },
      top: {
        now: [["무선 키보드", 186, 7254000], ["A4 용지(박스)", 240, 6240000], ["노트북 거치대", 152, 4864000], ["프린터 토너", 88, 4224000], ["모니터암", 41, 3239000]],
        last: [["A4 용지(박스)", 228, 5928000], ["무선 키보드", 141, 5499000], ["프린터 토너", 95, 4560000], ["노트북 거치대", 120, 3840000], ["사무용 의자", 18, 2862000]],
      },
      to: ["sales-team@daon.example", "ceo@daon.example"],
      sched: false,
      log: [],
      generated: false,
    };
  }
  let st = load() || sample();
  let wk = "now";          // 입력 표에서 보는 주
  let metric = "sales";    // 차트 지표
  function load() { try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch { /* 저장 실패해도 화면은 동작 */ } }
  const snapshot = () => JSON.parse(JSON.stringify(st));

  /* ───────── 숫자 도우미 ───────── */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n0 = (v) => Math.round(v).toLocaleString("ko-KR");
  const man = (v) => `${(v / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만 원`;
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const sum = (w, f) => w.reduce((s, r) => s + r[f], 0);
  const METRIC = { sales: { name: "매출", unit: "원", short: (v) => (v ? `${Math.round(v / 10000)}만` : "0") }, orders: { name: "주문", unit: "건", short: (v) => n0(v) }, visits: { name: "방문", unit: "명", short: (v) => n0(v) } };

  function stats(w) {
    const S = sum(w, "sales"), O = sum(w, "orders"), V = sum(w, "visits");
    return { S, O, V, R: V ? (O / V) * 100 : 0, A: O ? S / O : 0 };
  }

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
  // 입력 검증: 0 이상의 정수만. 틀리면 저장하지 않고 이유를 보여 준다.
  $("#data").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-f]");
    if (!inp) return;
    const raw = inp.value.trim();
    const clean = raw.replace(/[,\s원건명]/g, "");
    const i = Number(inp.dataset.i), f = inp.dataset.f;
    const where = `${label(dayOf(wk, i))} ${METRIC[f].name}`;
    let msg = "";
    if (!clean) msg = `${where} 칸이 비어 있어요. 0이라도 적어 주세요.`;
    else if (!/^\d+$/.test(clean)) msg = `${where}에 숫자가 아닌 글자가 있어요: “${raw}”`;
    if (!msg && f === "orders" && Number(clean) > st.weeks[wk][i].visits) msg = `${where} ${n0(Number(clean))}건이 방문 ${n0(st.weeks[wk][i].visits)}명보다 많아요. 숫자를 다시 확인해 주세요.`;
    if (msg) {
      inp.classList.add("bad");
      $("#data-err").textContent = `${msg} 고칠 때까지 보고서는 이전 숫자로 둡니다.`;
      $("#data-err").hidden = false;
      return;
    }
    inp.classList.remove("bad");
    if (!$$("#data input.bad").length) $("#data-err").hidden = true;
    st.weeks[wk][i][f] = Number(clean);
    save();
    renderData();
    if (st.generated) renderReport(false);
  });
  $("#data").addEventListener("keydown", (e) => {
    // Enter: 아래 칸으로
    if (e.key !== "Enter") return;
    const inp = e.target.closest("input"); if (!inp) return;
    e.preventDefault(); inp.dispatchEvent(new Event("change", { bubbles: true }));
    const next = $(`#data input[data-i="${Number(inp.dataset.i) + 1}"][data-f="${inp.dataset.f}"]`);
    if (next) { next.focus(); next.select(); }
  });

  /* ───────── 차트 (SVG 직접 그리기) ───────── */
  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function chartSVG() {
    const W = 760, H = 300, P = { l: 56, r: 50, t: 30, b: 40 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const L = st.weeks.last, N = st.weeks.now;
    // 눈금이 깔끔하게 떨어지도록 최댓값을 1·2·2.5·5 × 10ⁿ 단위로 올린다
    const raw = Math.max(...L.map((r) => r[metric]), ...N.map((r) => r[metric]), 1);
    const max = niceStep((raw * 1.05) / 4) * 4; // 눈금 4칸
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
      s += `<rect class="bar-hit" data-i="${i}" x="${P.l + gw * i}" y="${P.t}" width="${gw}" height="${ih}" fill="transparent"/>`;
      pts.push([cx, P.t + ih - ((rates[i] - rmin) / (rmax - rmin)) * ih]);
    }
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    s += `<path class="line" d="${d}" fill="none" stroke="#12825A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" style="--len:${Math.ceil(len)};animation-delay:700ms" pointer-events="none"/>`;
    pts.forEach((p, i) => { s += `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#12825A" stroke-width="2" style="animation-delay:${1200 + i * 50}ms" pointer-events="none"/>`; });
    return s + `</svg>`;
  }

  /* ───────── 요약 문장 (규칙 기반) ───────── */
  function summaryLines() {
    const L = st.weeks.last, N = st.weeks.now, a = stats(L), b = stats(N);
    const best = N.reduce((m, r, i) => (r.sales > N[m].sales ? i : m), 0);
    const worst = N.reduce((m, r, i) => (r.sales < N[m].sales ? i : m), 0);
    const grow = N.map((r, i) => pct(r.sales, L[i].sales));
    const gi = grow.reduce((m, v, i) => (v > grow[m] ? i : m), 0);
    const dS = pct(b.S, a.S), dR = b.R - a.R, dA = pct(b.A, a.A);
    const hol = holiday("now", best);
    const lines = [
      `이번 주 매출은 <b>${man(b.S)}</b>으로 지난주보다 <b>${Math.abs(dS).toFixed(1)}% ${dS >= 0 ? "늘었습니다" : "줄었습니다"}</b>. 주문은 ${n0(b.O)}건(${b.O - a.O >= 0 ? "+" : ""}${n0(b.O - a.O)}건)입니다.`,
      `매출이 가장 높은 날은 <b>${label(dayOf("now", best))}</b>${hol ? `(${hol} 휴일)` : ""} ${man(N[best].sales)}, 가장 낮은 날은 ${label(dayOf("now", worst))} ${man(N[worst].sales)}입니다. 지난주 같은 요일보다 가장 많이 오른 날은 ${label(dayOf("now", gi))}(${grow[gi] >= 0 ? "+" : ""}${grow[gi].toFixed(1)}%)입니다.`,
      `전환율은 <b>${b.R.toFixed(2)}%</b>로 ${Math.abs(dR).toFixed(2)}%p ${dR >= 0 ? "올랐고" : "내렸고"}, 객단가는 ${n0(b.A)}원(${dA >= 0 ? "+" : ""}${dA.toFixed(1)}%)입니다. ${dR >= 0 ? "방문이 늘어난 만큼 주문으로 이어지고 있습니다." : "방문 대비 주문이 줄어 상세 페이지 점검이 필요합니다."}`,
    ];
    const t1 = st.top.now[0][0], l1 = st.top.last[0][0];
    if (t1 !== l1) lines.push(`상품 1위가 바뀌었습니다. <b>${esc(t1)}</b>가 ${esc(l1)}를 제치고 가장 많이 팔렸습니다.`);
    return lines;
  }

  /* ───────── 보고서 ───────── */
  function renderReport(assemble) {
    const L = st.weeks.last, N = st.weeks.now, a = stats(L), b = stats(N);
    const delta = (v, unit = "%", fx = 1) => `<span class="delta ${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(fx)}${unit}</span>`;
    const range = `${label(dayOf("now", 0))} – ${label(dayOf("now", 6))}`;
    const lastRank = Object.fromEntries(st.top.last.map(([n], i) => [n, i]));
    const kpi = (k, v, unit, d, key) => `<div class="kpi"><small>${k}</small><b data-count="${key}" data-to="${v}">${n0(v)}<em>${unit}</em></b>${d}</div>`;
    const lines = summaryLines();
    $("#report").innerHTML = `
      <header class="r-head">
        <div>
          <div class="r-org">다온오피스 온라인몰 · 영업기획팀</div>
          <h2 class="r-title">10월 9일–15일 주간 성과 보고</h2>
          <div class="r-range">${range} · 지난주 ${label(dayOf("last", 0))} – ${label(dayOf("last", 6))}과 비교</div>
        </div>
        <div class="r-meta">작성 <b>엑셀탈출</b><br>자동 생성 10/16(금) 17:00<br>금요보고 v2</div>
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
        <div class="legend"><span><i style="background:#B9C1D2"></i>지난주 ${METRIC[metric].name}</span><span><i style="background:#F2A33A"></i>이번 주 ${METRIC[metric].name}</span><span><i class="ln" style="background:#12825A"></i>이번 주 전환율</span></div>
      </section>
      <section class="r-sec" style="animation-delay:900ms">
        <div class="r-sec-h"><h3>이번 주 요약</h3><span class="ai-tag">자동 작성 · 데모: 브라우저 규칙 기반</span></div>
        <ol class="summary">${lines.map((l) => `<li>${l}</li>`).join("")}</ol>
      </section>
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
      <section class="r-sec" style="animation-delay:1250ms">
        <div class="r-sec-h"><h3>메일 본문</h3></div>
        <div class="mailbox" id="mail">${esc(mailText(lines, range, a, b))}</div>
      </section>
      <footer class="r-foot"><span>다온오피스 온라인몰 영업기획팀 · 내부용</span><span>숫자 출처: 판매 시스템 일별 집계 (KST)</span></footer>`;
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
  // 핵심 숫자가 0부터 올라가는 효과 (보고서를 만들 때 한 번)
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
  function mailText(lines, range, a, b) {
    const plain = (h) => h.replace(/<[^>]+>/g, "");
    return `제목: [주간 성과] 10월 9일–15일 (${range})

팀 여러분, 이번 주 성과를 공유드립니다.

■ 핵심 숫자
- 매출 ${n0(b.S)}원 (지난주 대비 ${pct(b.S, a.S) >= 0 ? "+" : ""}${pct(b.S, a.S).toFixed(1)}%)
- 주문 ${n0(b.O)}건 · 방문 ${n0(b.V)}명
- 전환율 ${b.R.toFixed(2)}% (${b.R - a.R >= 0 ? "+" : ""}${(b.R - a.R).toFixed(2)}%p) · 객단가 ${n0(b.A)}원

■ 요약
${lines.map((l, i) => `${i + 1}. ${plain(l)}`).join("\n")}

일별 차트와 상품 순위는 첨부한 보고서(PDF)에서 확인해 주세요.
영업기획팀 드림`;
  }

  /* ───────── 차트 말풍선 ───────── */
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
    if (!b) return;
    metric = b.dataset.metric;
    $$("[data-metric]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.metric === metric)));
    $("#chart").innerHTML = chartSVG();
    $(".legend").innerHTML = `<span><i style="background:#B9C1D2"></i>지난주 ${METRIC[metric].name}</span><span><i style="background:#F2A33A"></i>이번 주 ${METRIC[metric].name}</span><span><i class="ln" style="background:#12825A"></i>이번 주 전환율</span>`;
  });

  /* ───────── 발송 설정 ───────── */
  function nextFriday() {
    const now = Date.now();
    const k = new Date(now + 9 * 3600000);
    let add = (5 - k.getUTCDay() + 7) % 7;
    let at = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + add, 17) - 9 * 3600000;
    if (at <= now) at += 7 * DAY;
    return new Date(at);
  }
  const fmtFull = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  function renderSend() {
    $("#sw").setAttribute("aria-checked", String(st.sched));
    $("#sched-next").textContent = st.sched ? `다음 발송 ${fmtFull.format(nextFriday())} · ${st.to.length}명` : "꺼져 있어요";
    $("#chips").innerHTML = st.to.length
      ? st.to.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-rm="${i}" aria-label="${esc(t)} 빼기">✕</button></span>`).join("")
      : `<span class="sim" style="margin:0">받는 사람이 없어요. 아래에서 추가하세요.</span>`;
    $("#log").innerHTML = st.log.length
      ? st.log.slice(0, 6).map((l) => `<li><span><b>${esc(l.title)}</b> · ${l.n}명</span><span>${esc(l.at)}</span></li>`).join("")
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
  $("#send-now").addEventListener("click", () => {
    if (!st.generated) { toast("먼저 ‘보고서 만들기’를 눌러 주세요"); return; }
    if (!st.to.length) { showToErr("받는 사람을 먼저 넣어 주세요."); return; }
    const at = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    st.log.unshift({ title: "10월 9일–15일 주간 성과 보고", n: st.to.length, at });
    save(); renderSend();
    toast(`${st.to.length}명에게 보낸 것으로 기록했어요 (데모)`);
  });

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
    toastTimer = setTimeout(() => $("#toast").classList.remove("on"), undo ? 5000 : 2200);
  }
  $("#toast-undo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  /* ───────── 버튼 ───────── */
  $("#gen").addEventListener("click", () => {
    if ($$("#data input.bad").length) { toast("빨간 칸을 먼저 고쳐 주세요"); return; }
    st.generated = true; save();
    renderReport(true);
    if (matchMedia("(max-width: 900px)").matches) $("#page").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    toast("보고서를 만들었어요");
  });
  $("#copy").addEventListener("click", async () => {
    const txt = $("#mail").textContent;
    try { await navigator.clipboard.writeText(txt); toast("메일 본문을 복사했어요"); }
    catch { const r = document.createRange(); r.selectNodeContents($("#mail")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("본문을 선택했어요. Ctrl+C로 복사하세요"); }
  });
  $("#print").addEventListener("click", () => window.print());
  $("#reset").addEventListener("click", () => {
    const before = snapshot();
    st = sample(); wk = "now"; metric = "sales"; save();
    $("#data-err").hidden = true;
    renderData(); renderSend();
    $("#report").hidden = true; $("#blank").hidden = false; $("#copy").disabled = true; $("#print").disabled = true; $("#gen").textContent = "보고서 만들기";
    toast("샘플 데이터로 되돌렸어요", () => { st = before; save(); renderData(); renderSend(); if (st.generated) renderReport(false); });
  });

  renderData();
  renderSend();
  if (st.generated) renderReport(false);
})();
