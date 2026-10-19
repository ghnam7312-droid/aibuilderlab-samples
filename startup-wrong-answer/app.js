/*
 * app.js — 오답지도 화면 (AI 빌더랩 1기 목표 모델 예시)
 *
 * 1) 학생이 고른 번호만 입력 → 2) 채점하면 반 전체 '오답 지도'가 칠해진다
 * 3) 문항 단위 오답 유형은 규칙(logic.js)으로 나누고, 4) 선생님이 검수해 일치율을 잰다
 * 5) 학생 단위 진단·학부모 코멘트는 Claude(wrong.coach)가 쓰고, 연결이 안 되면 규칙으로 쓴다
 * 데이터는 localStorage 에만 저장한다.
 */
(() => {
  "use strict";

  const L = window.OdapLogic;
  const KEY = "odapjido-v3";
  const EXAM = "3월 단원 평가";
  const EXAM_SHORT = "3월";
  const CLASS = "중2 B반";
  const { TYPES, pct } = L;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ───────── 샘플 상태 ───────── */
  function SAMPLE() {
    const { qs, students } = L.makeSample();
    // 선생님이 오답 대부분을 이미 검수해 둔 상태 (약 6%는 규칙 분류가 틀렸다고 표시하고 진짜 유형을 골라 둠)
    const review = {}; const fix = {}; let k = 0;
    students.forEach((s, si) => s.ans.forEach((a, qi) => {
      const t = L.classify(qs[qi], a); if (!t) return;
      k++;
      if (k % 10 === 0) return;                 // 10건 중 1건은 아직 미확인
      if (k % 17 === 3) { review[si + "-" + qi] = "n"; fix[si + "-" + qi] = t === "s" ? "k" : "s"; }
      else review[si + "-" + qi] = "y";
    }));
    return { qs, students, review, fix, coach: {}, recent: [], graded: false, focus: null, msgStu: 0 };
  }

  let S = load();
  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.qs && v.students) return { fix: {}, coach: {}, ...v }; } catch (e) { /* 저장소를 못 쓰는 환경 */ }
    return SAMPLE();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ } }
  const stats = () => L.stats(S.qs, S.students);

  /** 학생 한 명의 오답 라벨 (선생님이 '틀림'으로 고친 건 고친 유형으로) */
  function labelsOf(si) {
    const s = S.students[si];
    return s.ans.map((a, qi) => {
      const rt = L.classify(S.qs[qi], a); if (!rt) return null;
      const k = si + "-" + qi;
      return S.review[k] === "n" ? (S.fix[k] || rt) : rt;
    });
  }
  /** 선생님 검수로 확정된 학생별 주 유형 (검수한 오답이 하나라도 있는 학생) */
  function teacherMains() {
    const out = {};
    S.students.forEach((s, si) => {
      const ls = s.ans.map((a, qi) => L.teacherType(S.review, S.fix, si + "-" + qi, L.classify(S.qs[qi], a))).filter(Boolean);
      const m = L.mainType(ls); if (m) out[si] = m;
    });
    return out;
  }

  /* ───────── 알림 ───────── */
  let undoFn = null, toastT = 0;
  function toast(msg, undo) {
    $("#toastMsg").textContent = msg; undoFn = undo || null; $("#toastUndo").hidden = !undo;
    $("#toast").classList.add("on"); clearTimeout(toastT);
    toastT = setTimeout(() => { $("#toast").classList.remove("on"); undoFn = null; }, undo ? 5000 : 2400);
  }
  $("#toastUndo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 아래 방법 */ }
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; } ta.remove(); return ok;
  }

  /* ───────── Claude 연결 ───────── */
  const REASON = { "AI 키 미설정": "AI 키 미설정", "서버에 연결할 수 없음": "서버 연결 안 됨", "사용량 한도": "사용량 한도" };
  function chip(c, waiting) {
    if (waiting) return `<span class="ai-chip wait"><i></i>Claude가 쓰는 중…</span>`;
    if (!c) return "";
    if (c.mode === "ai") return `<span class="ai-chip ai"><i></i>Claude로 분석 · ${(c.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="ai-chip rule" title="${esc(c.reason || "")}"><i></i>규칙 기반 · ${esc(REASON[c.reason] || c.reason || "AI 미사용")}</span>`;
  }
  AI.onChange((st) => {
    const el = $("#aiStatus");
    el.className = "ai-status " + (st.enabled === true ? "on" : st.enabled === false ? "off" : "");
    el.querySelector("span").textContent = st.enabled === true ? "Claude 연결됨" : st.enabled === false ? `규칙 모드 · ${REASON[st.reason] || st.reason || "AI 꺼짐"}` : "AI 확인 중…";
  });
  AI.probe();

  const coaching = new Set();
  /** 학생 한 명의 진단·학부모 코멘트를 Claude에 맡긴다. 실패하면 규칙으로 */
  async function coach(si) {
    if (coaching.has(si)) return;
    coaching.add(si); refreshCoach(si);
    const st = stats(); const s = S.students[si];
    const input = L.coachInput(S.qs, s, st.score[si], st.avgScore, S.review, S.fix, si);
    const res = await AI.ask("wrong.coach", input);
    const norm = res && L.normalizeCoach(res.data);
    const ls = labelsOf(si).filter(Boolean);
    const units = [...new Set(s.ans.map((a, qi) => (a !== S.qs[qi].ans ? S.qs[qi].unit : null)).filter(Boolean))];
    S.coach[si] = norm
      ? { mode: "ai", ms: res.ms, ...norm }
      : { mode: "rule", reason: res ? "응답 형식 오류" : AI.status().reason || "AI 미사용", ...L.ruleCoach(s.name, ls, units, st.score[si], S.qs.length) };
    coaching.delete(si); save(); refreshCoach(si);
  }
  function refreshCoach(si) {
    if (tab() === "msg" && S.msgStu === si) renderMsg();
    if (tab() === "map" && S.focus && S.focus.t === "s" && S.focus.i === si) renderFocus(stats());
    if (tab() === "review") renderGauge();
  }

  /* ───────── 탭 ───────── */
  const VIEWS = ["map", "trend", "review", "msg", "ans", "q"];
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
    const st = stats();
    $("#examMeta").textContent = `${S.qs.length}문항 · ${S.students.length}명 · ${S.graded ? "채점 완료" : "채점 전"}`;
    $("#grade").textContent = S.graded ? "다시 채점하기" : "채점하기";
    ({ map: () => renderMap(st), trend: () => renderTrend(st), review: renderReview, msg: renderMsg, ans: renderAns, q: renderQ })[v]();
  }

  /* ═════════ ① 오답 지도 ═════════ */
  function renderMap(st, animate) {
    const g = S.graded;
    $("#mapLead").innerHTML = g
      ? `가로는 문항, 세로는 학생이에요. 칸 안 숫자는 학생이 고른 보기예요.`
      : `<b>채점 전</b>이에요. 위의 ‘채점하기’를 누르면 ${S.students.length}명의 답이 지도에 칠해져요.`;
    const focusQ = S.focus && S.focus.t === "q" && S.focus.pick ? S.focus.i : -1;
    const focusS = S.focus && S.focus.t === "s" ? S.focus.i : -1;
    const head = `<thead><tr><th></th>${S.qs.map((q, qi) => {
      const v = st.qRate[qi]; const low = g && v < 0.6;
      return `<th class="colh${low ? " low" : ""}"><button type="button" data-q="${qi}" aria-pressed="${focusQ === qi}" aria-label="${q.no}번 문항 정답률 ${g ? pct(v) + "%" : "채점 전"}">
        <span class="pc">${g ? pct(v) : "·"}</span><span class="bar"><i style="height:${g && !animate ? pct(v) : 0}%"></i></span>
        <span class="no">${q.no}</span><span class="again"${low ? "" : ' aria-hidden="true" style="visibility:hidden"'}>다시</span></button></th>`;
    }).join("")}<th></th></tr></thead>`;
    const body = S.students.map((s, si) => {
      const ls = labelsOf(si);
      return `<tr${focusS === si ? ' class="sel"' : ""}><th class="rowh"><button type="button" data-s="${si}" aria-pressed="${focusS === si}">${esc(s.name)}</button></th>${
        s.ans.map((a, qi) => {
          const t = ls[qi];
          const cls = !g || animate ? "raw" : t || "ok";
          const dim = g && focusQ >= 0 && focusQ !== qi ? " dim" : "";
          const fixed = g && S.review[si + "-" + qi] === "n" ? " fixed" : "";
          return `<td class="c ${cls}${dim}${fixed}" data-col="${qi}" data-t="${t || "ok"}" title="${esc(s.name)} ${qi + 1}번 · ${a}번 선택${g ? " · " + (t ? TYPES[t] : "정답") + (fixed ? " (선생님이 고침)" : "") : ""}">${a}</td>`;
        }).join("")}<td class="sc">${g ? st.score[si] : ""}</td></tr>`;
    }).join("");
    $("#map").innerHTML = head + "<tbody>" + body + "</tbody>";
    renderRail(st);
    if (animate) sweep(st);
  }

  // 채점 순간: 문항 한 줄씩 차례로 칠하고, 위쪽 정답률 막대를 올린다
  function sweep(st) {
    const cols = S.qs.length; const step = reduced() ? 0 : 110;
    for (let qi = 0; qi < cols; qi++) {
      setTimeout(() => {
        $$(`#map td[data-col="${qi}"]`).forEach((td) => { td.classList.remove("raw"); td.classList.add(td.dataset.t); });
        const bar = $(`#map .colh button[data-q="${qi}"] .bar i`); if (bar) bar.style.height = pct(st.qRate[qi]) + "%";
        if (qi === cols - 1) { renderRail(st); toast(`채점했어요 · 다시 다룰 문항 ${L.retestItems(st.qRate).length}개`); }
      }, step * qi);
    }
  }

  function renderRail(st) {
    const g = S.graded;
    const low = L.retestItems(st.qRate);
    // 선생님이 고친 라벨까지 반영한 유형 수
    const cnt = { k: 0, s: 0, m: 0 };
    if (g) S.students.forEach((s, si) => labelsOf(si).forEach((t) => { if (t) cnt[t]++; }));
    const w = st.wrong || 1;
    $("#stats").innerHTML = `
      <div><small>평균 점수</small><b>${g ? st.avgScore.toFixed(1) : "–"}<span>/ ${S.qs.length}</span></b></div>
      <div><small>오답</small><b>${g ? st.wrong : "–"}<span>개</span></b></div>
      <div><small>다시 다룰 문항</small><b>${g ? low.length : "–"}<span>개</span></b></div>`;
    $("#typeBar").innerHTML = g ? Object.keys(TYPES).map((k) => `<i style="width:${(cnt[k] / w) * 100}%;background:var(--${k})"></i>`).join("") : "";
    $("#typeBar").setAttribute("aria-label", g ? Object.entries(TYPES).map(([k, l]) => `${l} ${cnt[k]}개`).join(", ") : "채점 전");
    $("#typeList").innerHTML = Object.entries(TYPES).map(([k, l]) => `<li><span><i class="sw ${k}"></i>${l}</span><b>${g ? cnt[k] + "개 · " + pct(cnt[k] / w) + "%" : "–"}</b></li>`).join("");
    if (!g) {
      $("#aiSum").innerHTML = `<p>채점하면 이 반에서 가장 많이 나온 오답 유형과 다시 다룰 문항을 알려 드려요.</p>`;
      $("#focus").innerHTML = `<h2>문항·학생 자세히 보기</h2><p class="note" style="margin:0">채점한 뒤 지도에서 문항 번호나 학생 이름을 눌러 보세요.</p>`;
      return;
    }
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    const weak = L.unitRates(S.qs, st.qRate)[0];
    $("#aiSum").innerHTML = `<p>가장 많은 오답은 <b>${TYPES[top[0]]}</b>(${pct(top[1] / w)}%)예요. 정답률이 가장 낮은 단원은 <b>${esc(weak.unit)}</b>(${pct(weak.v)}%)입니다.${low.length ? ` ${low.map((x) => x.i + 1).join(", ")}번은 다음 수업 첫 10분에 다시 풀어 보세요.` : ""}</p>
      <p class="sm">문항별 유형은 문항표의 태그와 ‘계산 실수 보기’로 나눠요. 학생별 진단은 학생 이름을 누르면 Claude가 써요.</p>`;
    renderFocus(st);
  }

  function renderFocus(st) {
    const el = $("#focus");
    if (!S.focus) { const worst = st.qRate.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)[0]; S.focus = { t: "q", i: worst.i }; }
    if (S.focus.t === "q") {
      const qi = S.focus.i; const q = S.qs[qi];
      const counts = [1, 2, 3, 4, 5].map((c) => S.students.filter((s) => s.ans[qi] === c).length);
      const max = Math.max(1, ...counts);
      el.innerHTML = `<h2>${q.no}번 문항 <small>${esc(q.unit)} · ${esc(q.tag)}</small></h2>
        ${counts.map((n, i) => { const c = i + 1; const cls = c === q.ans ? "ans" : c === q.trap ? "trap" : "";
          return `<div class="choice"><span class="ch ${cls}">${c}번</span><span class="b"><i class="${cls}" style="width:${(n / max) * 100}%"></i></span><b>${n}</b></div>`; }).join("")}
        <p class="note">검은색은 정답, 주황은 ‘계산 실수 보기’예요. 정답률 ${pct(st.qRate[qi])}%</p>`;
    } else {
      const si = S.focus.i; const s = S.students[si]; const ls = labelsOf(si);
      const wrong = s.ans.map((a, qi) => ({ a, qi, t: ls[qi] })).filter((x) => x.t);
      const c = S.coach[si]; const waiting = coaching.has(si);
      el.innerHTML = `<h2>${esc(s.name)} <small>${st.score[si]} / ${S.qs.length}점</small></h2>
        ${wrong.length ? `<ul class="wq">${wrong.map((x) => `<li><span>${x.qi + 1}번 · ${esc(S.qs[x.qi].unit)}</span><span class="t ${x.t}">${TYPES[x.t]}</span></li>`).join("")}</ul>` : `<p class="note" style="margin:0">틀린 문항이 없어요.</p>`}
        <div class="coach${waiting ? " shimmer" : ""}">
          <div class="coach-h"><b>학생 진단</b>${chip(c, waiting)}</div>
          ${c ? `<p>${c.main ? `<span class="t ${c.main}">${TYPES[c.main]}</span> ` : ""}${esc(c.comment)}</p><p class="rx">처방 · ${esc(c.prescription)}</p>`
            : `<p class="sm">${waiting ? "Claude가 오답 목록을 읽고 있어요…" : "아직 진단하지 않았어요."}</p>`}
        </div>
        <div class="row" style="margin-top:12px">
          <button type="button" class="btn" data-coach="${si}"${waiting ? " disabled" : ""}>${c ? "Claude로 다시 진단" : "Claude로 진단하기"}</button>
          <button type="button" class="btn primary" data-msg="${si}">학부모 문구·오답 노트</button>
        </div>`;
    }
  }

  $("#map").addEventListener("click", (e) => {
    if (!S.graded) { toast("먼저 ‘채점하기’를 눌러 주세요"); return; }
    const q = e.target.closest("button[data-q]"); const s = e.target.closest("button[data-s]");
    if (q) { const same = S.focus && S.focus.t === "q" && S.focus.i === +q.dataset.q && S.focus.pick; S.focus = { t: "q", i: +q.dataset.q, pick: !same }; }
    else if (s) { S.focus = { t: "s", i: +s.dataset.s, pick: true }; if (!S.coach[+s.dataset.s]) coach(+s.dataset.s); }
    else return;
    save(); renderMap(stats());
    if (s && window.matchMedia("(max-width: 1000px)").matches) $("#focus").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  });
  $("#focus").addEventListener("click", (e) => {
    const m = e.target.closest("[data-msg]"); if (m) { S.msgStu = +m.dataset.msg; save(); go("msg"); return; }
    const c = e.target.closest("[data-coach]"); if (c) coach(+c.dataset.coach);
  });
  $("#grade").addEventListener("click", () => {
    S.graded = true; S.focus = null; save();
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.v === "map")));
    VIEWS.forEach((x) => ($("#v-" + x).hidden = x !== "map"));
    $("#examMeta").textContent = `${S.qs.length}문항 · ${S.students.length}명 · 채점 완료`;
    $("#grade").textContent = "다시 채점하기";
    renderMap(stats(), true);
  });

  /* ═════════ ② 추이 (3회 시험) ═════════ */
  function gate(el, what) {
    el.innerHTML = `<div class="done-card"><b>아직 채점 전이에요</b><p class="lead">채점해야 ${what}.</p><button type="button" class="btn primary" data-grade style="margin-top:10px">채점하기</button></div>`;
  }
  function renderTrend(st) {
    if (!S.graded) { gate($("#trendBody"), "이번 평가가 추이에 들어가요"); return; }
    const tr = L.classTrend(S.qs, S.students, st, EXAM_SHORT);
    const mv = L.movers(S.students, st, S.qs.length);
    const total = S.qs.length;
    // 반 평균 선 그래프
    const W = 520, H = 220, P = { l: 36, r: 24, t: 28, b: 32 };
    const lo = Math.max(0, Math.floor(Math.min(...tr.map((x) => x.avg)) - 1)), hi = Math.min(total, Math.ceil(Math.max(...tr.map((x) => x.avg)) + 1));
    const x = (i) => P.l + 44 + (i * (W - P.l - P.r - 88)) / (tr.length - 1);   // 양 끝 점이 축 숫자와 겹치지 않게 안쪽으로
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
    const ticks = []; for (let v = lo; v <= hi; v++) ticks.push(v);
    const d = tr.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join("");
    const gain = tr[2].avg - tr[1].avg;
    $("#trendBody").innerHTML = `
      <div class="trend-grid">
        <section class="sheet">
          <div class="sheet-h"><div><h2>반 평균 점수</h2><p class="lead">${CLASS} · 세 번의 평가 (12문항 만점)</p></div>
            <span class="big-delta ${gain >= 0 ? "up" : "down"}">${gain >= 0 ? "▲" : "▼"} ${Math.abs(gain).toFixed(1)}점<small>2월보다</small></span></div>
          <svg class="tline" viewBox="0 0 ${W} ${H}" role="img" aria-label="반 평균 ${tr.map((p) => `${p.short} ${p.avg.toFixed(1)}점`).join(", ")}">
            ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end" class="tk">${v}</text>`).join("")}
            <path d="${d}" class="ln"/>
            ${tr.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.avg)}" r="${i === 2 ? 7 : 5}" class="pt${i === 2 ? " now" : ""}"/><text x="${x(i)}" y="${y(p.avg) - 14}" text-anchor="middle" class="v${i === 2 ? " now" : ""}">${p.avg.toFixed(1)}</text><text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="tk${i === 2 ? " now" : ""}">${esc(p.name)}</text>`).join("")}
          </svg>
        </section>
        <section class="sheet">
          <h2>오답 유형 비율</h2>
          <p class="lead">계산 실수가 줄고 있는지, 다른 유형으로 옮겨 갔는지 봐요.</p>
          <div class="shares">${tr.map((p) => `<div class="sh"><span class="lab">${esc(p.short)}</span><span class="stack">${Object.keys(TYPES).map((k) => `<i style="width:${p.share[k] * 100}%;background:var(--${k})" title="${TYPES[k]} ${pct(p.share[k])}%">${p.share[k] > 0.12 ? pct(p.share[k]) + "%" : ""}</i>`).join("")}</span></div>`).join("")}</div>
          <ul class="legend">${Object.entries(TYPES).map(([k, l]) => `<li><i class="sw ${k}"></i>${l}</li>`).join("")}</ul>
        </section>
        <section class="sheet">
          <h2>2월보다 많이 오른 학생</h2>
          <ul class="mv">${mv.up.map((r) => `<li><button type="button" data-s="${r.i}">${esc(r.name)}</button><span>${r.prev} → <b>${r.now}</b></span><em class="up">+${r.d}</em></li>`).join("") || `<li class="sm">없어요</li>`}</ul>
        </section>
        <section class="sheet">
          <h2>살펴볼 학생</h2>
          <ul class="mv">${mv.down.map((r) => `<li><button type="button" data-s="${r.i}">${esc(r.name)}</button><span>${r.prev} → <b>${r.now}</b></span><em class="down">${r.d}</em></li>`).join("") || `<li class="sm">점수가 떨어진 학생이 없어요</li>`}</ul>
          <p class="sm">이름을 누르면 오답 지도에서 그 학생을 보여 줘요.</p>
        </section>
      </div>
      <p class="sm">1월·2월 기록은 샘플이에요. 실제 버전은 시험을 볼 때마다 기록이 쌓입니다.</p>`;
  }
  $("#trendBody").addEventListener("click", (e) => {
    if (e.target.closest("[data-grade]")) { $("#grade").click(); return; }
    const b = e.target.closest("button[data-s]"); if (!b) return;
    S.focus = { t: "s", i: +b.dataset.s, pick: true }; save(); go("map");
    if (!S.coach[+b.dataset.s]) coach(+b.dataset.s);
  });

  /* ═════════ ③ 검수 ═════════ */
  let skipped = [];   // 이번 방문에서 건너뛴 것 (저장하지 않음)
  let picking = null; // '틀림'을 누른 뒤 진짜 유형을 고르는 중인 건
  function wrongKeys() {
    const out = [];
    S.students.forEach((s, si) => s.ans.forEach((a, qi) => { if (L.classify(S.qs[qi], a)) out.push(si + "-" + qi); }));
    return out;
  }
  function renderReview() {
    renderGauge();
    const el = $("#queue");
    if (!S.graded) { gate(el, "검수할 오답이 생겨요"); return; }
    const all = wrongKeys();
    const todo = all.filter((k) => !S.review[k] && !skipped.includes(k)).concat(skipped.filter((k) => !S.review[k]));
    const done = all.filter((k) => S.review[k]).length;
    const prog = `<div class="ptxt">검수 ${done} / ${all.length}건</div><div class="pbar"><i style="width:${all.length ? (done / all.length) * 100 : 0}%"></i></div>`;
    if (!todo.length) { el.innerHTML = prog + `<div class="done-card"><b>모든 오답을 검수했어요</b><p class="lead">일치율은 오른쪽에서 확인하세요. 잘못 고른 게 있으면 <kbd>Z</kbd>로 되돌릴 수 있어요.</p></div>`; return; }
    const k = todo[0]; const [si, qi] = k.split("-").map(Number);
    const s = S.students[si]; const q = S.qs[qi]; const a = s.ans[qi]; const t = L.classify(q, a);
    const pick = picking === k;
    el.innerHTML = prog + `<div class="qcard" id="qcard" data-k="${k}">
      <div class="who"><span><b>${esc(s.name)}</b> · ${q.no}번 문항</span><span>${esc(q.unit)} · ${esc(q.tag)}</span></div>
      <div class="pick"><div><small>고른 답</small><span class="mine">${a}</span></div><div><small>정답</small><span class="right">${q.ans}</span></div>${q.trap === a ? `<div class="trapnote">계산 실수 보기</div>` : ""}</div>
      <div class="verdict"><span class="t ${t}">${TYPES[t]}</span> 규칙이 이렇게 나눴어요<small>${esc(L.reason(q, a))}</small></div>
      ${pick ? `<div class="fixer" role="group" aria-label="진짜 오답 유형 고르기"><p>그럼 어떤 유형인가요?</p>${Object.entries(TYPES).filter(([x]) => x !== t).map(([x, l], i) => `<button type="button" class="btn tt ${x}" data-fix="${x}">${l} <kbd>${i + 1}</kbd></button>`).join("")}<button type="button" class="btn" data-fix="cancel">취소 <kbd>Esc</kbd></button></div>`
        : `<div class="acts">
        <button type="button" class="btn yes" data-v="y">맞음 <kbd>Y</kbd></button>
        <button type="button" class="btn no" data-v="n">틀림 <kbd>N</kbd></button>
        <button type="button" class="btn" data-v="skip">건너뛰기 <kbd>S</kbd></button>
      </div>`}</div>`;
    if (pick) { const f = $("#qcard [data-fix]"); if (f) f.focus(); }
  }
  function renderGauge() {
    const ag = L.agreement(S.review);
    const p = ag.rate || 0;
    const ang = Math.PI * (1 - p); const x = 100 + 80 * Math.cos(ang); const yy = 100 - 80 * Math.sin(ang);
    $("#gauge").innerHTML = `<svg viewBox="0 0 200 110" aria-hidden="true">
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#EEF1ED" stroke-width="16" stroke-linecap="round"/>
      ${ag.total ? `<path d="M20 100 A80 80 0 0 1 ${x.toFixed(1)} ${yy.toFixed(1)}" fill="none" stroke="${p >= 0.9 ? "#2F8A57" : p >= 0.75 ? "#E39B2D" : "#D14468"}" stroke-width="16" stroke-linecap="round"/>` : ""}
    </svg><div class="val">${ag.total ? pct(p) + "%" : "–"}</div>`;
    $("#gaugeMeta").innerHTML = `규칙 분류 · 문항 단위<br>맞음 <b>${ag.y}</b> · 틀림 <b>${ag.n}</b>건 확인`;
    // Claude 진단(학생 단위) vs 선생님 검수
    const ca = L.coachAgreement(S.coach, teacherMains());
    const aiN = Object.values(S.coach).filter((c) => c && c.mode === "ai").length;
    $("#coachAgree").innerHTML = ca.total
      ? `<div class="ca-top"><b>${pct(ca.rate)}%</b><span>${ca.same} / ${ca.total}명 일치</span></div><div class="ca-bar"><i style="width:${pct(ca.rate)}%"></i></div><p class="sm">Claude가 진단한 학생의 ‘가장 큰 오답 유형’과 선생님 검수 결과를 비교해요.</p>`
      : `<p class="sm">${aiN ? "선생님 검수 결과와 비교할 수 있는 학생이 아직 없어요." : "오답 지도에서 학생 이름을 눌러 Claude 진단을 받으면, 선생님 검수 결과와 비교해 여기에 일치율이 나와요."}${AI.status().enabled === false ? " 지금은 Claude에 연결할 수 없어 규칙으로 진단하고 있어요." : ""}</p>`;
    $("#recent").innerHTML = S.recent.slice(0, 6).map((r) => { const [si, qi] = r.k.split("-").map(Number);
      return `<li><span>${esc(S.students[si] ? S.students[si].name : "")} ${qi + 1}번</span><span class="${r.v}">${r.v === "y" ? "맞음" : `틀림 → ${TYPES[S.fix[r.k]] || "?"}`}</span></li>`; }).join("") || `<li><span class="lead" style="margin:0">아직 이번에 검수한 건이 없어요</span></li>`;
  }
  function decide(v) {
    const card = $("#qcard"); if (!card) return;
    const k = card.dataset.k;
    if (v === "skip") { picking = null; skipped = skipped.filter((x) => x !== k).concat(k); renderReview(); return; }
    if (v === "n") { picking = k; renderReview(); return; }
    S.review[k] = "y"; delete S.fix[k]; S.recent.unshift({ k, v: "y" }); S.recent = S.recent.slice(0, 20); save();
    renderReview();
    const next = $("#qcard"); if (next && !reduced()) next.classList.add("flash-y");
  }
  function fixAs(t) {
    const card = $("#qcard"); if (!card || !picking) return;
    const k = card.dataset.k;
    if (t === "cancel") { picking = null; renderReview(); return; }
    S.review[k] = "n"; S.fix[k] = t; picking = null;
    S.recent.unshift({ k, v: "n" }); S.recent = S.recent.slice(0, 20); save();
    renderReview();
    const next = $("#qcard"); if (next && !reduced()) next.classList.add("flash-n");
  }
  function undoReview() {
    const last = S.recent.shift(); if (!last) { toast("되돌릴 검수가 없어요"); return; }
    delete S.review[last.k]; delete S.fix[last.k]; picking = null; skipped = skipped.filter((x) => x !== last.k); save(); renderReview(); toast("방금 검수를 취소했어요");
  }
  $("#queue").addEventListener("click", (e) => {
    if (e.target.closest("[data-grade]")) { $("#grade").click(); return; }
    const f = e.target.closest("button[data-fix]"); if (f) { fixAs(f.dataset.fix); return; }
    const b = e.target.closest("button[data-v]"); if (b) decide(b.dataset.v);
  });
  $("#v-trend").addEventListener("click", (e) => { if (e.target.closest("[data-grade]")) $("#grade").click(); });
  document.addEventListener("keydown", (e) => {
    if (tab() !== "review" || e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (picking) {
      if (k === "escape") fixAs("cancel");
      else if (["1", "2"].includes(k)) { const bs = $$("#qcard [data-fix]").filter((b) => b.dataset.fix !== "cancel"); if (bs[+k - 1]) fixAs(bs[+k - 1].dataset.fix); }
      return;
    }
    if (k === "y") decide("y"); else if (k === "n") decide("n"); else if (k === "s") decide("skip"); else if (k === "z") undoReview();
  });

  /* ═════════ ④ 학부모 문구 · 오답 노트 ═════════ */
  function msgFor(si) {
    const s = S.students[si]; const st = stats(); const ls = labelsOf(si);
    const counts = { k: 0, s: 0, m: 0 }; const wrongNos = [];
    ls.forEach((t, qi) => { if (t) { counts[t]++; wrongNos.push(qi + 1); } });
    const units = [...new Set(wrongNos.map((n) => S.qs[n - 1].unit))];
    return L.msgText({ exam: EXAM, name: s.name, score: st.score[si], total: S.qs.length, classAvg: st.avgScore, wrongNos, counts, units, coach: S.coach[si] });
  }
  function renderMsg() {
    if (!S.graded) { $("#msgText").textContent = "채점하면 학생별 문구가 여기에 만들어져요."; $("#msgStu").innerHTML = ""; $("#msgMini").innerHTML = ""; $("#msgCoach").innerHTML = ""; return; }
    $("#msgStu").innerHTML = S.students.map((s, i) => `<option value="${i}"${i === S.msgStu ? " selected" : ""}>${esc(s.name)}${S.coach[i] ? (S.coach[i].mode === "ai" ? " · Claude" : " · 규칙") : ""}</option>`).join("");
    const s = S.students[S.msgStu]; const ls = labelsOf(S.msgStu);
    $("#msgMini").innerHTML = s.ans.map((a, qi) => { const t = ls[qi]; const x = t && S.review[S.msgStu + "-" + qi] === "n" ? " x" : ""; return `<i class="${t || ""}${x}" title="${qi + 1}번"></i>`; }).join("");
    const c = S.coach[S.msgStu]; const waiting = coaching.has(S.msgStu);
    $("#msgCoach").innerHTML = `<div class="coach${waiting ? " shimmer" : ""}"><div class="coach-h"><b>학생 진단</b>${chip(c, waiting)}</div>
      ${c ? `<p>${c.main ? `<span class="t ${c.main}">${TYPES[c.main]}</span> ` : ""}${esc(c.comment)}</p><p class="rx">처방 · ${esc(c.prescription)}</p>` : `<p class="sm">${waiting ? "Claude가 오답 목록을 읽고 있어요…" : "진단을 붙이면 문구가 더 구체적이 돼요."}</p>`}
      <button type="button" class="btn sm" id="coachBtn"${waiting ? " disabled" : ""}>${c ? "Claude로 다시 쓰기" : "Claude로 진단 쓰기"}</button></div>`;
    $("#msgText").textContent = msgFor(S.msgStu);
    if (!c && !waiting) coach(S.msgStu);   // 처음 여는 학생은 자동으로 진단
  }
  $("#msgStu").addEventListener("change", (e) => { S.msgStu = +e.target.value; save(); renderMsg(); });
  $("#msgNext").addEventListener("click", () => { S.msgStu = (S.msgStu + 1) % S.students.length; save(); renderMsg(); });
  $("#msgCoach").addEventListener("click", (e) => { if (e.target.closest("#coachBtn")) coach(S.msgStu); });
  $("#msgCopy").addEventListener("click", async () => {
    if (!S.graded) { toast("먼저 채점해 주세요"); return; }
    const ok = await copy(msgFor(S.msgStu));
    toast(ok ? `${S.students[S.msgStu].name} 학부모 문구를 복사했어요` : "복사하지 못했어요. 문구를 직접 선택해 주세요");
  });

  // 인쇄용 오답 노트: 학생 한 명 또는 반 전체 (학생마다 한 장)
  function noteHtml(si) {
    const s = S.students[si]; const st = stats(); const ls = labelsOf(si); const c = S.coach[si];
    const wrong = s.ans.map((a, qi) => ({ a, qi, t: ls[qi] })).filter((x) => x.t);
    return `<article class="pnote">
      <header><div><small>${CLASS} · ${EXAM}</small><h1>${esc(s.name)} 오답 노트</h1></div>
        <div class="psc"><b>${st.score[si]}</b><span>/ ${S.qs.length}점</span><small>반 평균 ${st.avgScore.toFixed(1)}</small></div></header>
      ${c ? `<section class="pc"><b>진단</b>${c.main ? ` · ${TYPES[c.main]}` : ""} <small>(${c.mode === "ai" ? "Claude 초안 · 선생님 확인" : "오답 유형 규칙"})</small><p>${esc(c.comment)}</p><p><b>다음 수업</b> · ${esc(c.prescription)}</p></section>` : ""}
      ${wrong.length ? `<table><thead><tr><th>문항</th><th>단원</th><th>고른 답</th><th>정답</th><th>오답 유형</th></tr></thead><tbody>
        ${wrong.map((x) => `<tr><td>${x.qi + 1}번</td><td>${esc(S.qs[x.qi].unit)}</td><td>${x.a}</td><td>${S.qs[x.qi].ans}</td><td>${TYPES[x.t]}</td></tr>`).join("")}</tbody></table>
        <h2>다시 풀기</h2><div class="redo">${wrong.map((x) => `<div class="rbox"><b>${x.qi + 1}번</b><span>${esc(S.qs[x.qi].unit)} · 왜 틀렸는지 한 줄</span><i></i><i></i><i></i></div>`).join("")}</div>`
        : `<p class="perfect">이번 평가는 모두 맞혔어요. 다음 단원 예습 문제로 넘어가요.</p>`}
      <footer><span>학생 확인 ________</span><span>학부모 확인 ________</span><span>오답지도</span></footer>
    </article>`;
  }
  function printNotes(list) {
    if (!S.graded) { toast("먼저 채점해 주세요"); return; }
    $("#print").innerHTML = list.map(noteHtml).join("");
    document.body.classList.add("printing");
    const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => { window.print(); setTimeout(done, 500); }, 50);
  }
  $("#printOne").addEventListener("click", () => printNotes([S.msgStu]));
  $("#printAll").addEventListener("click", () => printNotes(S.students.map((_, i) => i)));

  /* ═════════ ⑤ 답 입력 ═════════ */
  function renderAns() {
    $("#ansGrid").innerHTML = `<thead><tr><th></th>${S.qs.map((q) => `<th>${q.no}</th>`).join("")}<th>점수</th></tr></thead><tbody>` +
      S.students.map((s, si) => `<tr><td class="n">${esc(s.name)}</td>${s.ans.map((a, qi) => `<td><input inputmode="numeric" maxlength="1" data-s="${si}" data-q="${qi}" value="${a}" class="${a !== S.qs[qi].ans ? "x" : ""}" aria-label="${esc(s.name)} ${qi + 1}번 답"></td>`).join("")}
      <td class="sc">${s.ans.filter((a, qi) => a === S.qs[qi].ans).length}</td></tr>`).join("") + "</tbody>";
    $("#ansMsg").textContent = "빨간 칸은 오답";
  }
  function setAnswer(si, qi, v) {
    S.students[si].ans[qi] = v; delete S.review[si + "-" + qi]; delete S.fix[si + "-" + qi]; delete S.coach[si];
  }
  $("#ansGrid").addEventListener("input", (e) => {
    const t = e.target; if (t.dataset.s == null) return;
    const si = +t.dataset.s, qi = +t.dataset.q; const v = parseInt(t.value, 10);
    if (!(v >= 1 && v <= 5)) {
      t.classList.remove("bad"); void t.offsetWidth; t.classList.add("bad");
      $("#ansMsg").textContent = "1~5 사이 번호만 넣을 수 있어요"; t.value = S.students[si].ans[qi]; t.select(); return;
    }
    const before = S.students[si].ans[qi]; if (before === v) return;
    setAnswer(si, qi, v); save();
    t.classList.toggle("x", v !== S.qs[qi].ans);
    t.closest("tr").querySelector(".sc").textContent = S.students[si].ans.filter((a, i) => a === S.qs[i].ans).length;
    $("#ansMsg").textContent = `${S.students[si].name} ${qi + 1}번 ${before} → ${v} · 다시 채점했어요`;
    const next = $(`#ansGrid input[data-s="${si}"][data-q="${qi + 1}"]`) || $(`#ansGrid input[data-s="${si + 1}"][data-q="0"]`);
    if (next) next.focus();
  });
  $("#ansGrid").addEventListener("focusin", (e) => { if (e.target.select) e.target.select(); });
  $("#ansGrid").addEventListener("keydown", (e) => {
    const t = e.target; if (t.dataset.s == null) return;
    const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0], Enter: [1, 0] }[e.key];
    if (!mv) return; e.preventDefault();
    const n = $(`#ansGrid input[data-s="${+t.dataset.s + mv[0]}"][data-q="${+t.dataset.q + mv[1]}"]`); if (n) n.focus();
  });
  // 엑셀·메모에서 한꺼번에 붙여 넣기
  $("#pasteApply").addEventListener("click", () => {
    const r = L.parseAnswerPaste($("#pasteBox").value, S.qs.length);
    const err = $("#pasteErr");
    if (!r.rows.length) { err.hidden = false; err.textContent = r.bad.length ? `${r.bad.join(", ")}번째 줄을 읽지 못했어요. ‘이름 3 5 2 …’처럼 ${S.qs.length}개 번호를 적어 주세요.` : "붙여 넣을 답안이 없어요."; return; }
    const before = JSON.stringify(S);
    const idx = new Map(S.students.map((s, i) => [s.name, i]));
    let upd = 0; const unknown = [];
    r.rows.forEach((row) => {
      const si = idx.get(row.name); if (si == null) { unknown.push(row.name); return; }
      row.ans.forEach((v, qi) => { if (S.students[si].ans[qi] !== v) setAnswer(si, qi, v); }); upd++;
    });
    save(); renderAns();
    err.hidden = !(r.bad.length || unknown.length);
    err.textContent = [r.bad.length ? `${r.bad.join(", ")}번째 줄은 형식이 맞지 않아 건너뛰었어요.` : "", unknown.length ? `명단에 없는 이름: ${unknown.join(", ")}` : ""].filter(Boolean).join(" ");
    toast(`${upd}명의 답을 바꾸고 다시 채점했어요`, () => { S = JSON.parse(before); save(); renderAns(); });
  });

  /* ═════════ ⑥ 문항표 ═════════ */
  function renderQ() {
    const opt = (list, cur) => list.map((x) => `<option${String(x) === String(cur) ? " selected" : ""}>${x}</option>`).join("");
    $("#qRows").innerHTML = S.qs.map((q, i) => `<tr><td>${q.no}번</td>
      <td><input data-i="${i}" data-k="unit" value="${esc(q.unit)}" aria-label="${q.no}번 단원"></td>
      <td><select data-i="${i}" data-k="tag" aria-label="${q.no}번 유형 태그">${opt(Object.keys(L.TAG2TYPE), q.tag)}</select></td>
      <td><select data-i="${i}" data-k="ans" aria-label="${q.no}번 정답">${opt([1, 2, 3, 4, 5], q.ans)}</select></td>
      <td><select data-i="${i}" data-k="trap" aria-label="${q.no}번 계산 실수 보기">${opt([1, 2, 3, 4, 5], q.trap)}</select></td></tr>`).join("");
  }
  $("#qRows").addEventListener("change", (e) => {
    const t = e.target; if (t.dataset.i == null) return;
    const q = S.qs[+t.dataset.i]; const k = t.dataset.k;
    if (k === "unit" && !t.value.trim()) { t.setAttribute("aria-invalid", "true"); toast("단원 이름을 비워 둘 수 없어요"); return; }
    t.removeAttribute("aria-invalid");
    const before = q[k]; const v = k === "ans" || k === "trap" ? +t.value : t.value.trim();
    if (k === "trap" && v === q.ans) { t.value = before; toast("계산 실수 보기는 정답과 달라야 해요"); return; }
    if (k === "ans" && v === q.trap) { t.value = before; toast("정답이 계산 실수 보기와 같아요. 계산 실수 보기를 먼저 바꿔 주세요"); return; }
    q[k] = v; S.coach = {}; save();
    toast(`${q.no}번 문항을 고치고 다시 채점했어요`, () => { q[k] = before; save(); renderQ(); });
  });

  /* ───────── 되돌리기 ───────── */
  $("#reset").addEventListener("click", () => {
    const before = S; S = SAMPLE(); skipped = []; picking = null; save(); render();
    toast("샘플 데이터로 되돌렸어요", () => { S = before; save(); render(); });
  });

  render();
})();
