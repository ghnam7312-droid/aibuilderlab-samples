/*
 * report.js — 학부모가 받는 리포트 화면
 *
 * 주소 # 뒤의 문자열을 logic.js 의 decodeReportAny 로 풀어 그린다.
 * 학부모는 '다음 주 계획'을 아이와 함께 체크할 수 있고, 체크 상태는 이 휴대폰에만 남는다.
 */
(() => {
  "use strict";
  const L = window.DaeumLogic;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const { pct, avg } = L;
  const app = $("#app");

  function fail() {
    document.title = "리포트를 열 수 없어요 · 다음주";
    app.innerHTML = `<section class="bad">
      <h1>리포트를 열 수 없어요</h1>
      <p>링크가 중간에 잘렸거나 바뀐 것 같아요. 카카오톡에서 받은 링크를 처음부터 끝까지 그대로 눌러 주세요.</p>
      <p class="sm">계속 안 열리면 학원에 다시 보내 달라고 말씀해 주세요.</p>
    </section>`;
  }

  // 체크 상태: 이 리포트(학원·학생·달)마다 따로 저장
  function store(id) {
    const k = "daeumju-parent-" + id;
    return {
      get() { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } },
      set(v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 화면은 동작 */ } },
    };
  }

  function draw(r) {
    const p = pct(avg(r.units.map((x) => x.r)));
    const tr = r.trend || [];
    const d = tr.length > 1 ? Math.round((tr[tr.length - 1].v - tr[tr.length - 2].v) * 1000) / 10 : null;
    const weak = new Set(r.weak);
    const best = [...r.units].sort((x, y) => y.r - x.r)[0];
    const st = store(L.hash(r.academy + r.student + r.month + r.date));
    const done = new Set(st.get());
    document.title = `${r.student} 학생 ${r.month} 리포트 · ${r.academy}`;

    app.innerHTML = `
      <header class="hd">
        <div class="ac"><span class="ac-mark" aria-hidden="true">${esc(r.academy[0] || "학")}</span><span>${esc(r.academy)}</span></div>
        <p class="when">${esc(r.month)} 학습 리포트${r.date ? ` · ${esc(r.date.replace(/-/g, "."))}` : ""}</p>
        <h1><span>${esc(r.student)}</span> 학생</h1>
        <p class="cls">${esc(r.className)}</p>
      </header>

      ${r.message ? `<p class="hello">${esc(r.message)}</p>` : ""}

      <section class="score-card" aria-label="이번 달 평균">
        <div class="big"><b>${p}</b><span>%</span></div>
        <div class="sc-side">
          <p>이번 달 평균 정답률</p>
          ${d != null ? `<p class="delta ${d >= 0 ? "up" : "down"}">지난달보다 ${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}%p</p>` : ""}
          ${best ? `<p class="best">가장 잘한 단원 · <b>${esc(best.name)}</b></p>` : ""}
        </div>
        ${tr.length ? `<div class="tr" aria-label="월별 평균 ${tr.map((x) => `${x.m} ${pct(x.v)}%`).join(", ")}">${tr.map((x, i) => `<div class="tb${i === tr.length - 1 ? " now" : ""}"><em>${pct(x.v)}</em><i style="--h:${Math.max(12, (pct(x.v) - 40) * 1.4)}px"></i><small>${esc(x.m)}</small></div>`).join("")}</div>` : ""}
      </section>

      <section class="blk">
        <h2>단원별 정답률</h2>
        <p class="lead">형광펜이 칠해진 단원을 다음 주에 보완해요.</p>
        <ul class="units">
          ${r.units.map((x) => `<li class="${weak.has(x.name) ? "weak" : ""}">
            <span class="nm">${weak.has(x.name) ? `<mark>${esc(x.name)}</mark>` : esc(x.name)}</span>
            <span class="bar"><i class="${x.r < 0.6 ? "low" : x.r < 0.75 ? "mid" : ""}" style="--w:${pct(x.r)}%"></i></span>
            <b>${pct(x.r)}%</b></li>`).join("")}
        </ul>
      </section>

      <section class="blk plan">
        <h2>다음 주에는 이렇게 공부해요</h2>
        <p class="lead">아이와 함께 하나씩 체크해 보세요. 체크는 이 휴대폰에만 남아요.</p>
        <ol class="todo">
          ${r.plan.map((l, i) => `<li><label><input type="checkbox" data-i="${i}"${done.has(i) ? " checked" : ""}><span class="box" aria-hidden="true"></span><span class="tx">${esc(l)}</span></label></li>`).join("")}
        </ol>
        <p class="done-msg" id="doneMsg" ${done.size === r.plan.length ? "" : "hidden"}>이번 주 계획을 모두 마쳤어요. 다음 리포트에서 만나요!</p>
        <p class="who-wrote">${r.ai ? "계획 초안은 Claude가 정답률을 보고 쓰고, 선생님이 확인했어요." : "선생님이 정답률을 보고 정한 계획이에요."}</p>
      </section>

      ${r.note ? `<section class="letter"><p>${esc(r.note)}</p><span>${esc(r.teacher)}</span></section>` : ""}

      <section class="ask">
        <p>궁금한 점은 받으신 카카오톡 채팅방으로 편하게 물어봐 주세요.</p>
      </section>`;

    app.addEventListener("change", (e) => {
      const t = e.target; if (t.dataset.i == null) return;
      const i = +t.dataset.i;
      if (t.checked) done.add(i); else done.delete(i);
      st.set([...done]);
      $("#doneMsg").hidden = done.size !== r.plan.length;
    });
  }

  async function boot() {
    const hash = location.hash.slice(1);
    if (!hash) return fail();
    const r = await L.decodeReportAny(hash);
    if (!r) return fail();
    draw(r);
  }
  window.addEventListener("hashchange", boot);
  boot();
})();
