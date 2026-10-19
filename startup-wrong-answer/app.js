/*
 * 오답지도 — 내 반 오답 분석 (AI 빌더랩 1기 목표 모델 예시)
 *
 * 1) 학생이 고른 번호만 입력 → 2) 채점하면 반 전체 '오답 지도'가 칠해진다
 * 3) 오답 유형은 규칙으로 나누고(데모: 브라우저 규칙 기반) 4) 선생님이 검수해 일치율을 잰다
 * 데이터는 localStorage 에만 저장한다.
 */
(() => {
  "use strict";

  const KEY = "odapjido-v2";
  const TYPES = { k: "개념 부족", s: "계산 실수", m: "문제 이해" };
  const TAG2TYPE = { 개념형: "k", 계산형: "s", "서술·활용형": "m" };
  const TIP = { k: "개념 정리 노트를 다시 보고 기본 문제부터", s: "풀이를 한 줄씩 적고 검산하는 습관부터", m: "문제에서 구하는 것에 밑줄 긋는 연습부터" };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => Math.round(x * 100);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ───────── 샘플 데이터 (가상의 반) ───────── */
  function SAMPLE() {
    let seed = 7;
    const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const qs = [
      ["유리수와 순환소수", "개념형", 3, 2], ["유리수와 순환소수", "계산형", 5, 4], ["단항식의 계산", "계산형", 2, 1],
      ["단항식의 계산", "개념형", 4, 5], ["다항식의 계산", "계산형", 1, 3], ["다항식의 계산", "서술·활용형", 3, 2],
      ["일차부등식", "개념형", 2, 4], ["일차부등식", "서술·활용형", 4, 1], ["연립일차방정식", "계산형", 5, 2],
      ["연립일차방정식", "서술·활용형", 1, 4], ["일차함수와 그래프", "개념형", 3, 5], ["일차함수와 그래프", "서술·활용형", 2, 3],
    ].map((q, i) => ({ no: i + 1, unit: q[0], tag: q[1], ans: q[2], trap: q[3] }));
    const fam = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진".split("");
    const giv = ["서연", "도윤", "하은", "지호", "민준", "수아", "예준", "지유", "시우", "하린", "준서", "채원", "은우", "서진", "유나", "건우", "다인", "현우", "소율", "태윤"];
    const students = Array.from({ length: 40 }, (_, i) => {
      const skill = 0.45 + r() * 0.5;
      const ans = qs.map((q) => {
        const hard = q.tag === "서술·활용형" ? 0.15 : q.unit.includes("부등식") ? 0.1 : 0;
        if (r() < skill - hard) return q.ans;
        if (r() < 0.3) return q.trap;
        let o; do { o = 1 + Math.floor(r() * 5); } while (o === q.ans); return o;
      });
      return { name: fam[i % fam.length] + giv[(i * 7) % giv.length], ans };
    });
    // 선생님이 오답 대부분을 이미 검수해 둔 상태 (약 6%는 AI 분류가 틀렸다고 표시)
    const review = {}; let k = 0;
    students.forEach((s, si) => s.ans.forEach((a, qi) => {
      if (a === qs[qi].ans) return;
      k++;
      if (k % 10 === 0) return;               // 10건 중 1건은 아직 미확인
      review[si + "-" + qi] = k % 17 === 3 ? "n" : "y";
    }));
    return { qs, students, review, recent: [], graded: false, focus: null, msgStu: 0 };
  }

  let S = load();
  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.qs && v.students) return v; } catch (e) { /* 저장소를 못 쓰는 환경 */ }
    return SAMPLE();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ } }

  /* ───────── 오답 유형 판단 (규칙) ───────── */
  function classify(q, a) {
    if (a === q.ans) return null;
    if (a === q.trap) return "s";
    return TAG2TYPE[q.tag] || "k";
  }
  function reason(q, a) {
    if (a === q.trap) return `‘계산 실수 보기’인 ${a}번을 골랐어요. 풀이 방향은 맞고 계산에서 틀렸을 가능성이 커요.`;
    return `${q.tag} 문항이라 ‘${TYPES[TAG2TYPE[q.tag] || "k"]}’으로 봤어요.`;
  }

  function stats() {
    const n = S.students.length;
    const qRate = S.qs.map((q, qi) => S.students.filter((s) => s.ans[qi] === q.ans).length / (n || 1));
    const cnt = { k: 0, s: 0, m: 0 };
    const score = S.students.map((s) => s.ans.reduce((ok, a, qi) => { const t = classify(S.qs[qi], a); if (t) cnt[t]++; return ok + (t ? 0 : 1); }, 0));
    return { n, qRate, cnt, score, wrong: cnt.k + cnt.s + cnt.m };
  }

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
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    render();
  }));
  function render() {
    const v = tab();
    ["map", "review", "msg", "ans", "q"].forEach((x) => ($("#v-" + x).hidden = x !== v));
    const st = stats();
    $("#examMeta").textContent = `${S.qs.length}문항 · ${S.students.length}명 · ${S.graded ? "채점 완료" : "채점 전"}`;
    $("#grade").textContent = S.graded ? "다시 채점하기" : "채점하기";
    ({ map: () => renderMap(st), review: renderReview, msg: renderMsg, ans: renderAns, q: renderQ })[v]();
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
    const body = S.students.map((s, si) => `<tr${focusS === si ? ' class="sel"' : ""}><th class="rowh"><button type="button" data-s="${si}" aria-pressed="${focusS === si}">${esc(s.name)}</button></th>${
      s.ans.map((a, qi) => {
        const t = classify(S.qs[qi], a);
        const cls = !g || animate ? "raw" : t || "ok";
        const dim = g && focusQ >= 0 && focusQ !== qi ? " dim" : "";
        return `<td class="c ${cls}${dim}" data-col="${qi}" data-t="${t || "ok"}" title="${esc(s.name)} ${qi + 1}번 · ${a}번 선택${g ? " · " + (t ? TYPES[t] : "정답") : ""}">${a}</td>`;
      }).join("")}<td class="sc">${g ? st.score[si] : ""}</td></tr>`).join("");
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
        if (qi === cols - 1) { renderRail(st); toast(`채점했어요 · 다시 다룰 문항 ${st.qRate.filter((v) => v < 0.6).length}개`); }
      }, step * qi);
    }
  }

  function renderRail(st) {
    const g = S.graded;
    const avgScore = st.score.reduce((x, y) => x + y, 0) / (st.n || 1);
    const low = st.qRate.map((v, i) => ({ v, i })).filter((x) => x.v < 0.6);
    $("#stats").innerHTML = `
      <div><small>평균 점수</small><b>${g ? avgScore.toFixed(1) : "–"}<span>/ ${S.qs.length}</span></b></div>
      <div><small>오답</small><b>${g ? st.wrong : "–"}<span>개</span></b></div>
      <div><small>다시 다룰 문항</small><b>${g ? low.length : "–"}<span>개</span></b></div>`;
    const w = st.wrong || 1;
    $("#typeBar").innerHTML = g ? Object.keys(TYPES).map((k) => `<i style="width:${(st.cnt[k] / w) * 100}%;background:var(--${k})"></i>`).join("") : "";
    $("#typeBar").setAttribute("aria-label", g ? Object.entries(TYPES).map(([k, l]) => `${l} ${st.cnt[k]}개`).join(", ") : "채점 전");
    $("#typeList").innerHTML = Object.entries(TYPES).map(([k, l]) => `<li><span><i class="sw ${k}"></i>${l}</span><b>${g ? st.cnt[k] + "개 · " + pct(st.cnt[k] / w) + "%" : "–"}</b></li>`).join("");
    if (!g) { $("#aiSum").innerHTML = `<span class="tag">AI 해설 · 데모: 브라우저 규칙 기반</span><p>채점하면 이 반에서 가장 많이 나온 오답 유형과 다시 다룰 문항을 알려 드려요.</p>`; $("#focus").innerHTML = `<h2>문항·학생 자세히 보기</h2><p class="note" style="margin:0">채점한 뒤 지도에서 문항 번호나 학생 이름을 눌러 보세요.</p>`; return; }
    const top = Object.entries(st.cnt).sort((a, b) => b[1] - a[1])[0];
    const units = {};
    S.qs.forEach((q, i) => { (units[q.unit] = units[q.unit] || []).push(st.qRate[i]); });
    const weak = Object.entries(units).map(([u, a]) => [u, a.reduce((x, y) => x + y, 0) / a.length]).sort((a, b) => a[1] - b[1])[0];
    $("#aiSum").innerHTML = `<span class="tag">AI 해설 · 데모: 브라우저 규칙 기반</span><p>가장 많은 오답은 <b>${TYPES[top[0]]}</b>(${pct(top[1] / w)}%)예요. 정답률이 가장 낮은 단원은 <b>${esc(weak[0])}</b>(${pct(weak[1])}%)입니다.${low.length ? ` ${low.map((x) => x.i + 1).join(", ")}번은 다음 수업 첫 10분에 다시 풀어 보세요.` : ""}</p>`;
    renderFocus(st);
  }

  function renderFocus(st) {
    const el = $("#focus");
    if (!S.focus) {
      // 처음에는 정답률이 가장 낮은 문항을 보여 준다
      const worst = st.qRate.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)[0];
      S.focus = { t: "q", i: worst.i };
    }
    if (S.focus.t === "q") {
      const qi = S.focus.i; const q = S.qs[qi];
      const counts = [1, 2, 3, 4, 5].map((c) => S.students.filter((s) => s.ans[qi] === c).length);
      const max = Math.max(1, ...counts);
      el.innerHTML = `<h2>${q.no}번 문항 <small>${esc(q.unit)} · ${esc(q.tag)}</small></h2>
        ${counts.map((n, i) => { const c = i + 1; const cls = c === q.ans ? "ans" : c === q.trap ? "trap" : "";
          return `<div class="choice"><span class="ch ${cls}">${c}번</span><span class="b"><i class="${cls}" style="width:${(n / max) * 100}%"></i></span><b>${n}</b></div>`; }).join("")}
        <p class="note">검은색은 정답, 주황은 ‘계산 실수 보기’예요. 정답률 ${pct(st.qRate[qi])}%</p>`;
    } else {
      const si = S.focus.i; const s = S.students[si];
      const wrong = s.ans.map((a, qi) => ({ a, qi, t: classify(S.qs[qi], a) })).filter((x) => x.t);
      el.innerHTML = `<h2>${esc(s.name)} <small>${st.score[si]} / ${S.qs.length}점</small></h2>
        ${wrong.length ? `<ul class="wq">${wrong.map((x) => `<li><span>${x.qi + 1}번 · ${esc(S.qs[x.qi].unit)}</span><span class="t ${x.t}">${TYPES[x.t]}</span></li>`).join("")}</ul>` : `<p class="note" style="margin:0">틀린 문항이 없어요.</p>`}
        <div class="row" style="margin-top:12px"><button type="button" class="btn" data-msg="${si}">학부모 문구 보기</button></div>`;
    }
  }

  $("#map").addEventListener("click", (e) => {
    if (!S.graded) { toast("먼저 ‘채점하기’를 눌러 주세요"); return; }
    const q = e.target.closest("button[data-q]"); const s = e.target.closest("button[data-s]");
    if (q) {
      // 같은 문항을 한 번 더 누르면 강조를 끈다
      const same = S.focus && S.focus.t === "q" && S.focus.i === +q.dataset.q && S.focus.pick;
      S.focus = { t: "q", i: +q.dataset.q, pick: !same };
    } else if (s) S.focus = { t: "s", i: +s.dataset.s, pick: true };
    else return;
    save(); renderMap(stats());
  });
  $("#focus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-msg]"); if (!b) return;
    S.msgStu = +b.dataset.msg; save(); $(".tabs [data-v=msg]").click();
  });
  $("#grade").addEventListener("click", () => {
    S.graded = true; S.focus = null; save();
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.v === "map")));
    ["map", "review", "msg", "ans", "q"].forEach((x) => ($("#v-" + x).hidden = x !== "map"));
    $("#examMeta").textContent = `${S.qs.length}문항 · ${S.students.length}명 · 채점 완료`;
    $("#grade").textContent = "다시 채점하기";
    renderMap(stats(), true);
  });

  /* ═════════ ② AI 분류 검수 ═════════ */
  let skipped = [];   // 이번 방문에서 건너뛴 것 (저장하지 않음)
  function wrongKeys() {
    const out = [];
    S.students.forEach((s, si) => s.ans.forEach((a, qi) => { if (classify(S.qs[qi], a)) out.push(si + "-" + qi); }));
    return out;
  }
  function gateGraded(el) {
    el.innerHTML = `<div class="done-card"><b>아직 채점 전이에요</b><p class="lead">채점해야 검수할 오답이 생겨요.</p><button type="button" class="btn primary" data-grade style="margin-top:10px">채점하기</button></div>`;
  }
  function renderReview() {
    renderGauge();
    const el = $("#queue");
    if (!S.graded) { gateGraded(el); return; }
    const all = wrongKeys();
    const todo = all.filter((k) => !S.review[k] && !skipped.includes(k)).concat(skipped.filter((k) => !S.review[k]));
    const done = all.filter((k) => S.review[k]).length;
    const prog = `<div class="ptxt">검수 ${done} / ${all.length}건</div><div class="pbar"><i style="width:${all.length ? (done / all.length) * 100 : 0}%"></i></div>`;
    if (!todo.length) { el.innerHTML = prog + `<div class="done-card"><b>모든 오답을 검수했어요</b><p class="lead">일치율은 오른쪽에서 확인하세요. 잘못 고른 게 있으면 <kbd>Z</kbd>로 되돌릴 수 있어요.</p></div>`; return; }
    const k = todo[0]; const [si, qi] = k.split("-").map(Number);
    const s = S.students[si]; const q = S.qs[qi]; const a = s.ans[qi]; const t = classify(q, a);
    el.innerHTML = prog + `<div class="qcard" id="qcard" data-k="${k}">
      <div class="who"><span><b>${esc(s.name)}</b> · ${q.no}번 문항</span><span>${esc(q.unit)} · ${esc(q.tag)}</span></div>
      <div class="pick"><div><small>고른 답</small><span class="mine">${a}</span></div><div><small>정답</small><span class="right">${q.ans}</span></div></div>
      <div class="verdict"><span class="t ${t}">${TYPES[t]}</span> AI가 이렇게 나눴어요<small>${esc(reason(q, a))}</small></div>
      <div class="acts">
        <button type="button" class="btn yes" data-v="y">맞음 <kbd>Y</kbd></button>
        <button type="button" class="btn no" data-v="n">틀림 <kbd>N</kbd></button>
        <button type="button" class="btn" data-v="skip">건너뛰기 <kbd>S</kbd></button>
      </div></div>`;
  }
  function renderGauge() {
    let y = 0, n = 0;
    Object.values(S.review).forEach((v) => { if (v === "y") y++; else if (v === "n") n++; });
    const p = y + n ? y / (y + n) : 0;
    // 반원 게이지 (SVG)
    const ang = Math.PI * (1 - p); const x = 100 + 80 * Math.cos(ang); const yy = 100 - 80 * Math.sin(ang);
    $("#gauge").innerHTML = `<svg viewBox="0 0 200 110" aria-hidden="true">
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#EEF1ED" stroke-width="16" stroke-linecap="round"/>
      ${y + n ? `<path d="M20 100 A80 80 0 0 1 ${x.toFixed(1)} ${yy.toFixed(1)}" fill="none" stroke="${p >= 0.9 ? "#2F8A57" : p >= 0.75 ? "#E39B2D" : "#D14468"}" stroke-width="16" stroke-linecap="round"/>` : ""}
    </svg><div class="val">${y + n ? pct(p) + "%" : "–"}</div>`;
    $("#gaugeMeta").innerHTML = `맞음 <b>${y}</b> · 틀림 <b>${n}</b>건 확인`;
    $("#recent").innerHTML = S.recent.slice(0, 6).map((r) => { const [si, qi] = r.k.split("-").map(Number);
      return `<li><span>${esc(S.students[si] ? S.students[si].name : "")} ${qi + 1}번</span><span class="${r.v}">${r.v === "y" ? "맞음" : "틀림"}</span></li>`; }).join("") || `<li><span class="lead" style="margin:0">아직 이번에 검수한 건이 없어요</span></li>`;
  }
  function decide(v) {
    const card = $("#qcard"); if (!card) return;
    const k = card.dataset.k;
    if (v === "skip") { skipped = skipped.filter((x) => x !== k).concat(k); renderReview(); return; }
    S.review[k] = v; S.recent.unshift({ k, v }); S.recent = S.recent.slice(0, 20); save();
    renderReview();
    const next = $("#qcard"); if (next && !reduced()) next.classList.add(v === "y" ? "flash-y" : "flash-n");
  }
  function undoReview() {
    const last = S.recent.shift(); if (!last) { toast("되돌릴 검수가 없어요"); return; }
    delete S.review[last.k]; skipped = skipped.filter((x) => x !== last.k); save(); renderReview(); toast("방금 검수를 취소했어요");
  }
  $("#queue").addEventListener("click", (e) => {
    if (e.target.closest("[data-grade]")) { $("#grade").click(); return; }
    const b = e.target.closest("button[data-v]"); if (b) decide(b.dataset.v);
  });
  document.addEventListener("keydown", (e) => {
    if (tab() !== "review" || e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "y") decide("y"); else if (k === "n") decide("n"); else if (k === "s") decide("skip"); else if (k === "z") undoReview();
  });

  /* ═════════ ③ 학부모 문구 ═════════ */
  function msgText(si) {
    const s = S.students[si]; if (!s) return "";
    const st = stats();
    const wrong = []; const c = { k: 0, s: 0, m: 0 };
    s.ans.forEach((a, qi) => {
      const t = classify(S.qs[qi], a); if (!t) return;
      if (S.review[si + "-" + qi] === "n") return;      // 선생님이 틀렸다고 한 분류는 빼기
      c[t]++; wrong.push(qi);
    });
    const units = [...new Set(wrong.map((qi) => S.qs[qi].unit))];
    const main = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    const classAvg = (st.score.reduce((x, y) => x + y, 0) / st.n).toFixed(1);
    return [
      `[3월 단원 평가] ${s.name} 학생 결과`,
      `점수 ${st.score[si]} / ${S.qs.length}  (반 평균 ${classAvg})`,
      wrong.length ? `틀린 문항 ${wrong.map((q) => q + 1 + "번").join(", ")}` : "틀린 문항이 없어요. 아주 잘했습니다!",
      wrong.length ? `오답 유형 ${Object.entries(c).filter((x) => x[1]).map(([k, v]) => `${TYPES[k]} ${v}개`).join(", ")}` : "",
      units.length ? `보완할 단원 ${units.join(", ")}` : "",
      wrong.length && main[1] ? `다음 주에는 ${TIP[main[0]]} 다시 잡아 보겠습니다.` : "",
    ].filter(Boolean).join("\n");
  }
  function renderMsg() {
    if (!S.graded) { $("#msgText").textContent = "채점하면 학생별 문구가 여기에 만들어져요."; $("#msgStu").innerHTML = ""; $("#msgMini").innerHTML = ""; return; }
    $("#msgStu").innerHTML = S.students.map((s, i) => `<option value="${i}"${i === S.msgStu ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    const s = S.students[S.msgStu];
    $("#msgMini").innerHTML = s.ans.map((a, qi) => { const t = classify(S.qs[qi], a); const x = t && S.review[S.msgStu + "-" + qi] === "n" ? " x" : ""; return `<i class="${t || ""}${x}" title="${qi + 1}번"></i>`; }).join("");
    $("#msgText").textContent = msgText(S.msgStu);
  }
  $("#msgStu").addEventListener("change", (e) => { S.msgStu = +e.target.value; save(); renderMsg(); });
  $("#msgNext").addEventListener("click", () => { S.msgStu = (S.msgStu + 1) % S.students.length; save(); renderMsg(); });
  $("#msgCopy").addEventListener("click", async () => {
    if (!S.graded) { toast("먼저 채점해 주세요"); return; }
    const t = msgText(S.msgStu);
    try { await navigator.clipboard.writeText(t); toast(`${S.students[S.msgStu].name} 학부모 문구를 복사했어요`); }
    catch (err) { window.prompt("아래 문구를 복사해 주세요", t); }
  });

  /* ═════════ ④ 답 입력 ═════════ */
  function renderAns() {
    $("#ansGrid").innerHTML = `<thead><tr><th></th>${S.qs.map((q) => `<th>${q.no}</th>`).join("")}<th>점수</th></tr></thead><tbody>` +
      S.students.map((s, si) => `<tr><td class="n">${esc(s.name)}</td>${s.ans.map((a, qi) => `<td><input inputmode="numeric" maxlength="1" data-s="${si}" data-q="${qi}" value="${a}" class="${a !== S.qs[qi].ans ? "x" : ""}" aria-label="${esc(s.name)} ${qi + 1}번 답"></td>`).join("")}
      <td class="sc">${s.ans.filter((a, qi) => a === S.qs[qi].ans).length}</td></tr>`).join("") + "</tbody>";
    $("#ansMsg").textContent = "빨간 칸은 오답";
  }
  $("#ansGrid").addEventListener("input", (e) => {
    const t = e.target; if (t.dataset.s == null) return;
    const si = +t.dataset.s, qi = +t.dataset.q;
    const v = parseInt(t.value, 10);
    if (!(v >= 1 && v <= 5)) {
      t.classList.remove("bad"); void t.offsetWidth; t.classList.add("bad");
      $("#ansMsg").textContent = "1~5 사이 번호만 넣을 수 있어요";
      t.value = S.students[si].ans[qi]; t.select(); return;
    }
    const before = S.students[si].ans[qi];
    if (before === v) return;
    S.students[si].ans[qi] = v; delete S.review[si + "-" + qi]; save();
    t.classList.toggle("x", v !== S.qs[qi].ans);
    t.closest("tr").querySelector(".sc").textContent = S.students[si].ans.filter((a, i) => a === S.qs[i].ans).length;
    $("#ansMsg").textContent = `${S.students[si].name} ${qi + 1}번 ${before} → ${v} · 다시 채점했어요`;
    // 다음 칸으로 이동
    const next = $(`#ansGrid input[data-s="${si}"][data-q="${qi + 1}"]`) || $(`#ansGrid input[data-s="${si + 1}"][data-q="0"]`);
    if (next) next.focus();
  });
  $("#ansGrid").addEventListener("focusin", (e) => { if (e.target.select) e.target.select(); });
  $("#ansGrid").addEventListener("keydown", (e) => {
    const t = e.target; if (t.dataset.s == null) return;
    const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0], Enter: [1, 0] }[e.key];
    if (!mv) return;
    e.preventDefault();
    const n = $(`#ansGrid input[data-s="${+t.dataset.s + mv[0]}"][data-q="${+t.dataset.q + mv[1]}"]`);
    if (n) n.focus();
  });

  /* ═════════ ⑤ 문항표 ═════════ */
  function renderQ() {
    const opt = (list, cur) => list.map((x) => `<option${String(x) === String(cur) ? " selected" : ""}>${x}</option>`).join("");
    $("#qRows").innerHTML = S.qs.map((q, i) => `<tr><td>${q.no}번</td>
      <td><input data-i="${i}" data-k="unit" value="${esc(q.unit)}" aria-label="${q.no}번 단원"></td>
      <td><select data-i="${i}" data-k="tag" aria-label="${q.no}번 유형 태그">${opt(Object.keys(TAG2TYPE), q.tag)}</select></td>
      <td><select data-i="${i}" data-k="ans" aria-label="${q.no}번 정답">${opt([1, 2, 3, 4, 5], q.ans)}</select></td>
      <td><select data-i="${i}" data-k="trap" aria-label="${q.no}번 계산 실수 보기">${opt([1, 2, 3, 4, 5], q.trap)}</select></td></tr>`).join("");
  }
  $("#qRows").addEventListener("change", (e) => {
    const t = e.target; if (t.dataset.i == null) return;
    const q = S.qs[+t.dataset.i]; const k = t.dataset.k;
    if (k === "unit" && !t.value.trim()) { t.setAttribute("aria-invalid", "true"); toast("단원 이름을 비워 둘 수 없어요"); return; }
    t.removeAttribute("aria-invalid");
    const before = q[k];
    const v = k === "ans" || k === "trap" ? +t.value : t.value.trim();
    if (k === "trap" && v === q.ans) { t.value = before; toast("계산 실수 보기는 정답과 달라야 해요"); return; }
    if (k === "ans" && v === q.trap) { t.value = before; toast("정답이 계산 실수 보기와 같아요. 계산 실수 보기를 먼저 바꿔 주세요"); return; }
    q[k] = v; save();
    toast(`${q.no}번 문항을 고치고 다시 채점했어요`, () => { q[k] = before; save(); renderQ(); });
  });

  /* ───────── 되돌리기 ───────── */
  $("#reset").addEventListener("click", () => {
    const before = S; S = SAMPLE(); skipped = []; save(); render();
    toast("샘플 데이터로 되돌렸어요", () => { S = before; save(); render(); });
  });

  render();
})();
