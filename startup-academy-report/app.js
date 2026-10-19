/*
 * 다음주 — 학원 학부모 리포트 (AI 빌더랩 1기 목표 모델 예시)
 *
 * 화면 4개: 리포트 작업대 · 원장 대시보드 · 교재 단원표 · 요금제
 * 데이터는 브라우저 localStorage 에만 저장한다. 서버·외부 API 없음.
 * 'AI 분석'은 데모에서 브라우저 규칙(정답률 낮은 단원 3개 → 정해진 계획 틀)으로 동작한다.
 */
(() => {
  "use strict";

  const KEY = "daeumju-report-v2";
  const MONTH = "10월";
  const NOTE_MAX = 120;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => Math.round(x * 100);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  /* ───────── 샘플 데이터 ───────── */
  // 학원·학생·교재는 모두 가상이다.
  const SAMPLE = () => ({
    acad: "a1",
    academies: [
      {
        id: "a1", name: "하늘수학학원", teacher: "정다은 선생님",
        classes: ["중2 A반", "중2 B반", "중3 심화반"],
        units: [["개념원리 중2-1", "유리수와 순환소수"], ["개념원리 중2-1", "단항식의 계산"], ["개념원리 중2-1", "다항식의 계산"], ["개념원리 중2-1", "일차부등식"], ["개념원리 중2-1", "연립일차방정식"], ["개념원리 중2-1", "일차함수와 그래프"]],
        students: ["김서윤", "이도현", "박지우", "최하준", "정민서", "강예린", "조우진", "윤서아", "장시우", "임하율", "한지호", "오채원", "서지안", "문태오", "백하람"],
      },
      {
        id: "a2", name: "바른영어학원", teacher: "에밀리 한 선생님",
        classes: ["초6 기초반", "중1 문법반"],
        units: [["Grammar Up 1", "be동사와 일반동사"], ["Grammar Up 1", "현재진행형"], ["Grammar Up 1", "과거시제"], ["Grammar Up 1", "조동사 can·will"], ["Grammar Up 1", "비교급과 최상급"]],
        students: ["문가온", "배하린", "신유찬", "권나은", "황도윤", "송다인", "유준서", "안소율"],
      },
      {
        id: "a3", name: "새봄국어논술", teacher: "윤슬기 선생님",
        classes: ["중1 독해반", "중3 문학반"],
        units: [["독해력 완성 1", "중심 문장 찾기"], ["독해력 완성 1", "글의 구조"], ["독해력 완성 1", "어휘와 문맥"], ["독해력 완성 1", "추론하기"], ["독해력 완성 1", "비판적 읽기"]],
        students: ["홍지안", "양서진", "노은우", "구하늘", "서윤호", "전아린", "남궁별", "백시현", "허지민", "탁유나"],
      },
    ],
    notes: { "a1|김서윤": "질문이 많아져서 반가워요. 부등식만 잡으면 다음 달엔 90점대가 보여요." },   // 강사 한마디 (학원id|학생)
    plans: {},   // 고친 다음 주 계획
    made: {},    // 리포트를 만든 학생
    sent: {},    // 문구를 복사해 보낸 학생
    sel: {},     // 학원별로 마지막에 본 학생
    cls: "all",
  });

  let S = load();
  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.academies) return v; } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
    return SAMPLE();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시: 화면은 그대로 동작 */ } }

  /* ───────── 점수 계산 (샘플용) ─────────
     이름·단원이 같으면 늘 같은 정답률이 나오도록 해시로 만든다. */
  function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rnd(seed) { let x = hash(seed) || 1; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }
  function rate(a, name, unit) {
    const base = 0.55 + rnd(a.id + name) * 0.35;          // 학생 실력
    const diff = (rnd(a.id + unit[1]) - 0.5) * 0.3;        // 단원 난이도
    const noise = (rnd(name + unit[1]) - 0.5) * 0.45;      // 개인 편차
    return Math.max(0.15, Math.min(1, base + diff + noise));
  }
  const A = () => S.academies.find((a) => a.id === S.acad) || S.academies[0];
  const clsOf = (a, name) => a.classes[a.students.indexOf(name) % a.classes.length];
  const rates = (a, name) => a.units.map((u) => ({ name: u[1], r: rate(a, name, u) }));
  const key = (a, name) => a.id + "|" + name;

  /* ───────── 'AI 분석' (규칙 기반) ─────────
     정답률이 낮은 단원 3개를 고르고, 정해진 틀에 넣어 다음 주 계획 3줄을 만든다. */
  function weakUnits(rs) { return [...rs].sort((x, y) => x.r - y.r).slice(0, 3); }
  function autoPlan(weak) {
    const w = weak.map((x) => x.name);
    return [
      w[0] ? `월·수 ${w[0]} 개념 복습, 기본 문제 10문항` : "월·수 이번 주 단원 복습",
      w[1] ? `목 ${w[1]} 틀린 유형만 8문항` : "목 오답 다시 풀기",
      w[2] ? `토 ${w[2]} 포함 누적 테스트 15분` : "토 누적 테스트 15분",
    ];
  }
  const planOf = (a, name) => S.plans[key(a, name)] || autoPlan(weakUnits(rates(a, name)));

  /* ───────── 알림 (되돌리기 지원) ───────── */
  let undoFn = null, toastT = 0;
  function toast(msg, undo) {
    $("#toastMsg").textContent = msg;
    undoFn = undo || null;
    $("#toastUndo").hidden = !undo;
    $("#toast").classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => { $("#toast").classList.remove("on"); undoFn = null; }, undo ? 5000 : 2200);
  }
  $("#toastUndo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  /* ───────── 화면 전환 ───────── */
  function view() { return $(".nav [aria-selected=true]").dataset.view; }
  $$(".nav button").forEach((b) => b.addEventListener("click", () => {
    $$(".nav button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    render();
  }));
  // 탭 목록은 화살표 키로도 옮겨 다닌다
  $(".nav").addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const bs = $$(".nav button"); const i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = bs[(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
    n.focus(); n.click();
  });

  function render() {
    const v = view();
    ["report", "dash", "units", "plan"].forEach((x) => ($("#v-" + x).hidden = x !== v));
    $("#acad").innerHTML = S.academies.map((a) => `<option value="${a.id}"${a.id === S.acad ? " selected" : ""}>${esc(a.name)}</option>`).join("");
    if (v === "report") renderReport();
    if (v === "dash") renderDash();
    if (v === "units") renderUnits();
    if (v === "plan") renderPlans();
  }

  /* ═════════ ① 리포트 작업대 ═════════ */
  function sentCount(a) { return a.students.filter((n) => S.sent[key(a, n)]).length; }

  function renderReport() {
    const a = A();
    $("#rTitle").textContent = `${MONTH} 학부모 리포트`;
    $("#rSub").textContent = `${a.name} · ${a.units[0] ? a.units[0][0] : "교재 미등록"} · 학생 ${a.students.length}명`;
    const sent = sentCount(a);
    $("#sentTxt").innerHTML = `보냄 <b>${sent}</b> / ${a.students.length}명`;
    $("#sentBar").style.width = (a.students.length ? (sent / a.students.length) * 100 : 0) + "%";
    $("#chatName").textContent = a.name;

    if (S.cls !== "all" && !a.classes.includes(S.cls)) S.cls = "all";
    $("#clsChips").innerHTML = ["all", ...a.classes].map((c) => `<button type="button" data-c="${esc(c)}" aria-pressed="${S.cls === c}">${c === "all" ? "전체" : esc(c)}</button>`).join("");

    if (!a.students.includes(S.sel[a.id])) S.sel[a.id] = a.students[0];
    renderRoster();
    renderBench();
    renderPhone(false);
  }

  function renderRoster() {
    const a = A(); const q = $("#q").value.trim();
    const sel = S.sel[a.id];
    const list = a.students.filter((n) => (S.cls === "all" || clsOf(a, n) === S.cls) && (!q || n.includes(q)));
    $("#stuList").innerHTML = list.map((n) => {
      const k = key(a, n);
      const st = S.sent[k] ? `<span class="st sent">보냄</span>` : S.made[k] ? `<span class="st made">만듦</span>` : `<span class="st">대기</span>`;
      return `<li><button type="button" class="stu" data-n="${esc(n)}" aria-current="${n === sel}">
        <span class="nm">${esc(n)}</span><span class="avg">${a.units.length ? pct(avg(rates(a, n).map((x) => x.r))) + "%" : "-"}</span>
        <span class="cl">${esc(clsOf(a, n))}</span>${st}</button></li>`;
    }).join("") || `<li class="empty">${q ? `‘${esc(q)}’ 학생이 없어요` : "이 반에 학생이 없어요"}</li>`;
  }

  function renderBench() {
    const a = A(); const n = S.sel[a.id];
    const el = $("#bench");
    if (!n) { el.innerHTML = `<p class="empty">학생을 고르면 리포트 재료가 여기 모여요.</p>`; return; }
    if (!a.units.length) {
      el.innerHTML = `<p class="empty">교재 단원표가 비어 있어요.<br><button type="button" class="btn ghost" data-go="units" style="margin-top:12px">단원표 채우러 가기</button></p>`;
      return;
    }
    const k = key(a, n);
    const rs = rates(a, n);
    const weak = weakUnits(rs);
    const weakSet = new Set(weak.map((w) => w.name));
    const plan = planOf(a, n);
    const note = S.notes[k] || "";
    const p = pct(avg(rs.map((x) => x.r)));

    el.innerHTML = `
      <div class="b-top">
        <div><h2>${esc(n)}</h2><div class="meta">${esc(clsOf(a, n))} · ${MONTH} 단원 평가 · ${esc(a.teacher)}</div></div>
        <div class="ring" style="--p:${p}" role="img" aria-label="평균 정답률 ${p}%"><span><span><b>${p}%</b><small>평균</small></span></span></div>
      </div>
      <div class="b-sec">
        <h3>단원별 정답률 <span class="note">형광펜은 보완할 단원</span></h3>
        ${rs.map((x) => `<div class="ur"><span class="nm">${weakSet.has(x.name) ? `<mark>${esc(x.name)}</mark>` : esc(x.name)}</span>
          <span class="track"><i class="${x.r < 0.6 ? "low" : x.r < 0.75 ? "mid" : ""}" style="width:${pct(x.r)}%"></i></span><b>${pct(x.r)}%</b></div>`).join("")}
      </div>
      <div class="b-sec">
        <h3>다음 주 계획</h3>
        <p class="rule">AI 분석 · 데모에서는 브라우저 규칙 기반 — 정답률이 낮은 단원 3개로 계획을 짭니다. 문장은 고쳐 쓸 수 있어요.</p>
        <div class="plan-ed" style="margin-top:10px">
          ${plan.map((l, i) => `<label><span class="no">${i + 1}</span><input class="field" data-plan="${i}" value="${esc(l)}" aria-label="다음 주 계획 ${i + 1}번째 줄" maxlength="70"></label>`).join("")}
        </div>
        <p class="err" id="planErr" hidden>비어 있는 계획 줄이 있어요. 세 줄을 모두 채워 주세요.</p>
        ${S.plans[k] ? `<button type="button" class="link" id="planReset" style="color:var(--sub);margin-top:6px">AI 계획으로 다시 채우기</button>` : ""}
      </div>
      <div class="b-sec">
        <h3><label for="note">선생님 한마디</label></h3>
        <textarea class="field" id="note" placeholder="예: 수업 태도가 많이 좋아졌어요. 부등식만 잡으면 다음 달엔 90점대가 보여요." aria-describedby="noteCount">${esc(note)}</textarea>
        <div class="count" id="noteCount">${note.length} / ${NOTE_MAX}자</div>
      </div>
      <div class="actions">
        <button type="button" class="btn hi" id="make">${S.made[k] ? "리포트 다시 만들기" : "리포트 만들기"}</button>
        <button type="button" class="btn" id="copy"${S.made[k] ? "" : " disabled"}>카톡 문구 복사</button>
        <span class="state${S.sent[k] ? " sent" : ""}">${S.sent[k] ? "학부모에게 보냄" : S.made[k] ? "만들었어요 · 아직 안 보냄" : "아직 만들지 않았어요"}</span>
      </div>`;
  }

  // 휴대폰 미리보기. animate=true 일 때만 리포트가 차례로 채워지는 동작을 보여 준다.
  function renderPhone(animate) {
    const a = A(); const n = S.sel[a.id]; const chat = $("#chat");
    const k = n && key(a, n);
    if (!n || !S.made[k] || !a.units.length) {
      chat.innerHTML = `<div class="empty-chat"><b>아직 보낸 리포트가 없어요</b>‘리포트 만들기’를 누르면<br>학부모가 받을 화면이 여기에 만들어져요.</div>`;
      return;
    }
    const rs = rates(a, n); const weak = weakUnits(rs); const plan = planOf(a, n);
    const note = (S.notes[k] || "").trim();
    chat.innerHTML = `
      <div class="from">
        <span class="pf" aria-hidden="true">${esc(a.name[0])}</span>
        <div><p class="who">${esc(a.name)}</p>
          <div class="card${animate ? " gen" : ""}">
            <div class="ch"><small>${MONTH} 학습 리포트 · ${esc(clsOf(a, n))}</small><b>${esc(n)} 학생</b></div>
            <div class="cb">
              <div class="score"><b>${pct(avg(rs.map((x) => x.r)))}%</b><span>평균 정답률</span></div>
              <div class="mini">${rs.map((x) => `<div class="r"><span class="t">${esc(x.name)}</span><span class="track"><i class="${x.r < 0.6 ? "low" : x.r < 0.75 ? "mid" : ""}" style="width:${pct(x.r)}%"></i></span><em>${pct(x.r)}</em></div>`).join("")}</div>
              <h4>이번에 보완할 단원</h4>
              <div class="weak-list">${weak.map((w) => `<span>${esc(w.name)}</span>`).join("")}</div>
              <h4>다음 주에는 이렇게 공부해요</h4>
              <ol>${plan.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
              ${note ? `<div class="letter">${esc(note)}<small>${esc(a.teacher)}</small></div>` : ""}
            </div>
            <div class="cf">궁금한 점은 이 채팅방으로 편하게 물어봐 주세요</div>
          </div>
        </div>
      </div>
      <span class="time">${S.sent[k] ? "보냄" : "미리보기"}</span>`;
  }

  function shareText(a, n) {
    const k = key(a, n); const rs = rates(a, n); const weak = weakUnits(rs);
    const note = (S.notes[k] || "").trim();
    return [
      `[${a.name}] ${n} 학생 ${MONTH} 학습 리포트`,
      ``,
      `평균 정답률 ${pct(avg(rs.map((x) => x.r)))}%`,
      `보완할 단원: ${weak.map((w) => `${w.name}(${pct(w.r)}%)`).join(", ")}`,
      ``,
      `다음 주에는 이렇게 공부해요`,
      ...planOf(a, n).map((l, i) => `${i + 1}. ${l}`),
      note ? `\n선생님 한마디: ${note}\n- ${a.teacher}` : "",
    ].join("\n").trim();
  }

  // 작업대의 입력·버튼 (이벤트 위임)
  $("#bench").addEventListener("input", (e) => {
    const a = A(); const n = S.sel[a.id]; const k = key(a, n);
    if (e.target.id === "note") {
      let v = e.target.value;
      const over = v.length > NOTE_MAX;
      $("#noteCount").textContent = `${v.length} / ${NOTE_MAX}자${over ? " · 너무 길어요" : ""}`;
      $("#noteCount").classList.toggle("over", over);
      e.target.setAttribute("aria-invalid", String(over));
      if (!over) { S.notes[k] = v; save(); if (S.made[k]) renderPhone(false); }
    }
    if (e.target.dataset.plan != null) {
      const plan = [...planOf(a, n)];
      plan[+e.target.dataset.plan] = e.target.value;
      S.plans[k] = plan; save();
      e.target.setAttribute("aria-invalid", String(!e.target.value.trim()));
      if (e.target.value.trim()) $("#planErr").hidden = $$("[data-plan]").some((x) => !x.value.trim()) ? false : true;
      if (S.made[k]) renderPhone(false);
    }
  });

  $("#bench").addEventListener("click", async (e) => {
    const a = A(); const n = S.sel[a.id]; const k = key(a, n);
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.go) { $(`.nav [data-view=${t.dataset.go}]`).click(); return; }
    if (t.id === "planReset") { delete S.plans[k]; save(); renderBench(); if (S.made[k]) renderPhone(false); toast("AI 계획으로 다시 채웠어요"); return; }
    if (t.id === "make") {
      // 빈 줄 / 너무 긴 한마디가 있으면 만들지 않는다
      const empty = $$("[data-plan]").filter((x) => !x.value.trim());
      empty.forEach((x) => x.setAttribute("aria-invalid", "true"));
      $("#planErr").hidden = !empty.length;
      if (empty.length) { empty[0].focus(); return; }
      if ((S.notes[k] || "").length > NOTE_MAX || $("#note").value.length > NOTE_MAX) { $("#note").focus(); return; }
      S.made[k] = true; save();
      renderBench(); renderRoster(); renderPhone(true);
      if (window.matchMedia("(max-width: 1240px)").matches) $(".preview").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (t.id === "copy") {
      const txt = shareText(a, n);
      let ok = true;
      try { await navigator.clipboard.writeText(txt); } catch (err) { ok = false; }
      if (!ok) window.prompt("아래 문구를 복사해 카카오톡에 붙여 넣어 주세요", txt);
      const was = !!S.sent[k];
      S.sent[k] = true; save();
      renderReport();
      toast(ok ? `${n} 학부모용 문구를 복사했어요` : "문구를 띄웠어요", was ? null : () => { delete S.sent[k]; save(); renderReport(); });
    }
  });

  $("#stuList").addEventListener("click", (e) => {
    const b = e.target.closest(".stu"); if (!b) return;
    S.sel[A().id] = b.dataset.n; save();
    renderRoster(); renderBench(); renderPhone(false);
  });
  $("#clsChips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]"); if (!b) return;
    S.cls = b.dataset.c; save(); renderReport();
  });
  $("#q").addEventListener("input", renderRoster);

  /* ═════════ ② 원장 대시보드 ═════════ */
  function renderDash() {
    const a = A();
    const all = a.students.map((n) => ({ n, c: clsOf(a, n), avg: avg(rates(a, n).map((x) => x.r)) }));
    const sent = sentCount(a);
    const made = a.students.filter((n) => S.made[key(a, n)]).length;
    $("#dSub").textContent = `${a.name} · ${MONTH} 기준`;
    $("#stats").innerHTML = `
      <div class="stat"><small>학생</small><b>${all.length}<span>명</span></b></div>
      <div class="stat"><small>전체 평균 정답률</small><b>${pct(avg(all.map((s) => s.avg)))}<span>%</span></b></div>
      <div class="stat"><small>리포트 만든 학생</small><b>${made}<span>/ ${all.length}</span></b></div>
      <div class="stat"><small>학부모에게 보냄</small><b>${sent}<span>/ ${all.length}</span></b></div>`;
    $("#clsAvg").innerHTML = a.classes.map((c) => {
      const v = avg(all.filter((s) => s.c === c).map((s) => s.avg));
      const kids = a.students.filter((n) => clsOf(a, n) === c);
      const wu = a.units.map((u) => ({ u: u[1], v: avg(kids.map((n) => rate(a, n, u))) })).sort((x, y) => x.v - y.v)[0];
      return `<div class="cr"><span>${esc(c)}</span><span class="track"><i class="${v < 0.6 ? "low" : v < 0.75 ? "mid" : ""}" style="width:${pct(v)}%"></i></span><b>${pct(v)}%</b></div>` +
        (wu ? `<p class="cr-w">${kids.length}명 · 가장 약한 단원 <mark>${esc(wu.u)}</mark> ${pct(wu.v)}%</p>` : "");
    }).join("");
    const pend = all.filter((s) => !S.sent[key(a, s.n)]);
    $("#pending").innerHTML = pend.length
      ? pend.map((s) => `<li><span>${esc(s.n)} <small>${esc(s.c)}</small></span><button type="button" data-open="${esc(s.n)}">작업대에서 열기</button></li>`).join("")
      : `<li class="done">이번 달 리포트를 모두 보냈어요</li>`;
    // 단원 × 반: 정답률이 낮을수록 진한 빨강
    const cell = (v) => {
      const t = Math.max(0, Math.min(1, (0.9 - v) / 0.4));
      const bg = `rgba(229, 83, 75, ${0.08 + t * 0.75})`;
      return `<td style="background:${bg};color:${t > 0.55 ? "#fff" : "var(--ink)"}">${pct(v)}%</td>`;
    };
    $("#heat").innerHTML = `<thead><tr><th>단원</th>${a.classes.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
      a.units.map((u) => `<tr><th>${esc(u[1])}</th>${a.classes.map((c) => cell(avg(a.students.filter((n) => clsOf(a, n) === c).map((n) => rate(a, n, u))))).join("")}</tr>`).join("") + "</tbody>";
  }
  $("#pending").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-open]"); if (!b) return;
    S.sel[A().id] = b.dataset.open; S.cls = "all"; save();
    $(".nav [data-view=report]").click();
  });

  /* ═════════ ③ 교재 단원표 ═════════ */
  const TRASH = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12 M8 6V4h4v2 M6 6l1 10h6l1-10"/></svg>`;
  function renderUnits() {
    const a = A();
    $("#unitRows").innerHTML = a.units.map((u, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td><input data-i="${i}" data-k="0" value="${esc(u[0])}" aria-label="${i + 1}번 교재 이름"></td>
      <td><input data-i="${i}" data-k="1" value="${esc(u[1])}" aria-label="${i + 1}번 단원명"></td>
      <td class="n"><button type="button" class="del" data-del="${i}" aria-label="${esc(u[1])} 삭제">${TRASH}</button></td></tr>`).join("")
      || `<tr><td colspan="4" class="empty">단원이 없어요. ‘단원 추가’나 CSV로 채워 주세요.</td></tr>`;
  }
  $("#unitRows").addEventListener("change", (e) => {
    const t = e.target; if (t.dataset.i == null) return;
    const v = t.value.trim();
    if (!v) { t.setAttribute("aria-invalid", "true"); toast("빈 칸은 저장하지 않았어요. 이름을 적어 주세요"); return; }
    t.removeAttribute("aria-invalid");
    A().units[+t.dataset.i][+t.dataset.k] = v; save(); toast("단원표를 저장했어요");
  });
  $("#unitRows").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const a = A(); const i = +b.dataset.del; const removed = a.units.splice(i, 1)[0];
    save(); renderUnits();
    toast(`‘${removed[1]}’ 단원을 지웠어요`, () => { a.units.splice(i, 0, removed); save(); renderUnits(); });
  });
  $("#addUnit").addEventListener("click", () => {
    const a = A(); a.units.push([a.units[0] ? a.units[0][0] : "새 교재", ""]); save(); renderUnits();
    const ins = $$("#unitRows input[data-k='1']"); const last = ins[ins.length - 1];
    if (last) { last.placeholder = "단원명을 적어 주세요"; last.focus(); }
  });
  $("#csv").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    const rows = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.split(",").map((s) => s.trim().replace(/^"|"$/g, ""))).filter((r) => r.length >= 2 && r[1]);
    const body = rows[0] && /교재|book/i.test(rows[0][0]) ? rows.slice(1) : rows;
    e.target.value = "";
    if (!body.length) { toast("읽을 수 있는 줄이 없어요. ‘교재,단원명’ 형식인지 확인해 주세요"); return; }
    const a = A(); const before = a.units;
    a.units = body.map((r) => [r[0], r[1]]); save(); renderUnits();
    toast(`단원 ${body.length}개를 불러왔어요`, () => { a.units = before; save(); renderUnits(); });
  });
  $("#csvSample").addEventListener("click", () => {
    const csv = "교재,단원명\n" + A().units.map((u) => u.join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    link.download = "다음주_단원표_예시.csv"; link.click(); URL.revokeObjectURL(link.href);
  });

  /* ═════════ ④ 요금제 (예시 가격) ═════════ */
  function renderPlans() {
    const n = A().students.length;
    const plans = [
      { nm: "스몰", cap: 30, price: "49,000", items: ["학생 30명까지", "월 리포트 무제한", "단원표 1개"] },
      { nm: "베이직", cap: 80, price: "99,000", items: ["학생 80명까지", "월 리포트 무제한", "단원표 5개", "원장 대시보드"] },
      { nm: "프로", cap: 200, price: "190,000", items: ["학생 200명까지", "단원표 무제한", "강사 계정 10개", "반별 비교 리포트"] },
    ];
    const cur = plans.findIndex((p) => n <= p.cap);
    $("#plans").innerHTML = plans.map((p, i) => `<article class="plan${i === cur ? " cur" : ""}">
      <div class="nm">${p.nm}${i === cur ? `<span class="badge">지금 학원에 맞아요</span>` : ""}</div>
      <div class="pr">월 ${p.price}<small>원</small></div>
      <div class="ex">예시 가격 · ${A().name} 학생 ${n}명 기준 ${i === cur ? "추천" : ""}</div>
      <ul>${p.items.map((x) => `<li>${x}</li>`).join("")}</ul></article>`).join("");
  }

  /* ───────── 공통 ───────── */
  $("#acad").addEventListener("change", (e) => { S.acad = e.target.value; S.cls = "all"; $("#q").value = ""; save(); render(); });
  $$("[data-reset]").concat([$("#reset")]).forEach((b) => b && b.addEventListener("click", () => {
    const before = S; S = SAMPLE(); save(); $("#q").value = ""; render();
    toast("샘플 데이터로 되돌렸어요", () => { S = before; save(); render(); });
  }));

  render();
})();
