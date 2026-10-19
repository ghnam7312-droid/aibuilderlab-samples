/*
 * app.js — 다음주 화면 (AI 빌더랩 1기 목표 모델 예시)
 *
 * 화면 5개: 시작하기 · 리포트 작업대 · 원장 대시보드 · 교재 단원표 · 요금제
 * - 계산 규칙은 logic.js(DaeumLogic), Claude 호출은 ai-client.js(AI)에 있다. 이 파일은 화면만 그린다.
 * - 다음 주 계획은 Claude가 쓰고, 연결이 안 되면 규칙으로 쓴다. 어느 쪽인지 늘 화면에 표시한다.
 * - 데이터는 브라우저 localStorage 에만 저장한다.
 */
(() => {
  "use strict";

  const L = window.DaeumLogic;
  const KEY = "daeumju-report-v3";
  const MONTH = "10월";
  const NOTE_MAX = 120;
  const MSG_MAX = 140;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const { pct, avg } = L;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ───────── 샘플 데이터 (학원·학생·교재는 모두 가상) ───────── */
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
    notes: { "a1|김서윤": "질문이 많아져서 반가워요. 부등식만 잡으면 다음 달엔 90점대가 보여요." },
    plans: {},   // 다음 주 계획 3줄 (학원id|학생)
    msgs: {},    // 학부모 첫 인사
    ai: {},      // 계획을 누가 썼는지 { mode: "ai"|"rule", ms, reason, weak }
    made: {},    // 리포트를 만든 학생
    sent: {},    // 학부모에게 보낸 학생
    sel: {},     // 학원별로 마지막에 본 학생
    cls: "all",
    cycle: "m",  // 요금제 결제 주기
    focus: null, // 대시보드 추이에서 강조한 반
  });

  let S = load();
  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.academies) return { ...SAMPLE(), ...v }; } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
    return SAMPLE();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시: 화면은 그대로 동작 */ } }

  const A = () => S.academies.find((a) => a.id === S.acad) || S.academies[0];
  const clsOf = (a, name) => a.classes[Math.max(0, a.students.indexOf(name)) % a.classes.length] || "";
  const key = (a, name) => a.id + "|" + name;
  const rates = (a, n) => L.rates(a, n);
  const ruleWeak = (a, n) => L.weakUnits(rates(a, n));

  /** 지금 화면에 쓸 계획·보완 단원·첫 인사 (저장된 것 > 규칙) */
  function current(a, n) {
    const k = key(a, n); const rs = rates(a, n);
    const info = S.ai[k];
    const byName = new Map(rs.map((x) => [x.name, x]));
    const weakNames = info && info.weak && info.weak.length ? info.weak : ruleWeak(a, n).map((x) => x.name);
    return {
      rs,
      weak: weakNames.map((nm) => byName.get(nm)).filter(Boolean),
      plan: S.plans[k] || L.rulePlan(ruleWeak(a, n)),
      message: S.msgs[k] ?? L.ruleMessage(n, rs),
      info,
    };
  }

  /* ───────── 알림 (되돌리기 지원) ───────── */
  let undoFn = null, toastT = 0;
  function toast(msg, undo) {
    $("#toastMsg").textContent = msg;
    undoFn = undo || null;
    $("#toastUndo").hidden = !undo;
    $("#toast").classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => { $("#toast").classList.remove("on"); undoFn = null; }, undo ? 5000 : 2400);
  }
  $("#toastUndo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("#toast").classList.remove("on"); });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 아래 방법으로 */ }
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove(); return ok;
  }

  /* ───────── Claude 연결 표시 ───────── */
  const REASON = { "AI 키 미설정": "AI 키 미설정", "서버에 연결할 수 없음": "서버 연결 안 됨", "사용량 한도": "사용량 한도" };
  function chipHtml(info, waiting) {
    if (waiting) return `<span class="ai-chip wait"><i></i>Claude가 쓰는 중…</span>`;
    if (!info) return "";
    if (info.mode === "ai") return `<span class="ai-chip ai" title="${esc(info.model || "Claude")}"><i></i>Claude로 분석 · ${(info.ms / 1000).toFixed(1)}초</span>`;
    if (info.mode === "edit") return `<span class="ai-chip edit"><i></i>선생님이 고침</span>`;
    return `<span class="ai-chip rule" title="${esc(info.reason || "")}"><i></i>규칙 기반 · ${esc(REASON[info.reason] || info.reason || "AI 미사용")}</span>`;
  }
  AI.onChange((st) => {
    const el = $("#aiStatus");
    el.className = "ai-status " + (st.enabled === true ? "on" : st.enabled === false ? "off" : "");
    el.querySelector("span").textContent =
      st.enabled === true ? "Claude 연결됨" : st.enabled === false ? `규칙 모드 · ${REASON[st.reason] || st.reason || "AI 꺼짐"}` : "AI 확인 중…";
    el.title = st.enabled === false ? "Claude에 연결할 수 없을 때는 정답률이 낮은 단원 3개로 계획을 만듭니다" : "";
  });
  AI.probe();

  /** 학생 한 명의 다음 주 계획을 Claude에 맡긴다. 실패하면 규칙으로. */
  const pending = new Set();
  async function generate(a, n) {
    const k = key(a, n);
    if (pending.has(k)) return;
    pending.add(k);
    if (S.sel[a.id] === n && view() === "report") renderBench();
    const rs = rates(a, n);
    const input = {
      student: n, className: clsOfAny(a, n), month: MONTH, academy: a.name,
      units: rs.map((x) => ({ name: x.name, rate: pct(x.r) })),
      teacherNote: S.notes[k] || "",
    };
    const res = await AI.ask("academy.plan", input);
    const norm = res && L.normalizeAiPlan(res.data, rs.map((x) => x.name));
    if (norm) {
      S.plans[k] = norm.plan;
      S.msgs[k] = norm.message || L.ruleMessage(n, rs);
      S.ai[k] = { mode: "ai", ms: res.ms, model: res.model, weak: norm.weak.length ? norm.weak : ruleWeak(a, n).map((x) => x.name) };
    } else {
      S.plans[k] = L.rulePlan(ruleWeak(a, n));
      S.msgs[k] = L.ruleMessage(n, rs);
      S.ai[k] = { mode: "rule", reason: res ? "응답 형식 오류" : AI.status().reason || "AI 미사용", weak: ruleWeak(a, n).map((x) => x.name) };
    }
    pending.delete(k);
    save();
  }

  /* ───────── 화면 전환 ───────── */
  function view() { return $(".nav [aria-selected=true]").dataset.view; }
  function go(v) { const b = $(`.nav [data-view=${v}]`); if (b) b.click(); }
  $$(".nav button").forEach((b) => b.addEventListener("click", () => {
    $$(".nav button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    render();
    window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
  }));
  $(".nav").addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const bs = $$(".nav button"); const i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const nx = bs[(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
    nx.focus(); nx.click();
  });

  function render() {
    const v = view();
    ["start", "report", "dash", "units", "plan"].forEach((x) => ($("#v-" + x).hidden = x !== v));
    $("#acad").innerHTML = S.academies.map((a) => `<option value="${a.id}"${a.id === S.acad ? " selected" : ""}>${esc(a.name)}</option>`).join("");
    const ob = L.onboarding(A(), S.made, S.sent);
    $("#obBadge").textContent = ob.done < ob.total ? `${ob.done}/${ob.total}` : "";
    if (v === "start") renderStart();
    if (v === "report") renderReport();
    if (v === "dash") renderDash();
    if (v === "units") renderUnits();
    if (v === "plan") renderPlans();
  }

  /* ═════════ ⓪ 시작하기 ═════════ */
  function renderStart() {
    const a = A(); const ob = L.onboarding(a, S.made, S.sent);
    $("#obTitle").textContent = ob.done === ob.total ? `${a.name}, 준비가 끝났어요` : `${a.name} 시작하기`;
    $("#obSub").textContent = ob.done === ob.total ? "이제 매달 학생을 고르고 리포트만 보내면 됩니다." : "네 단계면 첫 학부모 리포트를 보낼 수 있어요. 보통 10분이면 끝나요.";
    $("#obProgress").innerHTML = `<div class="obp-bar"><i style="width:${(ob.done / ob.total) * 100}%"></i></div><b>${ob.done} / ${ob.total}</b>`;
    const firstOpen = ob.steps.findIndex((s) => !s.done);
    const body = {
      units: () => `<p>교재 단원표가 있어야 단원별 정답률을 그 순서대로 보여 줄 수 있어요. 지금 <b>${a.units.length}개</b> 단원이 있어요.</p>
        <div class="row"><button type="button" class="btn" data-go="units">단원표 열기</button><label class="btn ghost" for="csv">CSV 올리기</label></div>`,
      students: () => `<p>학생 이름을 한 줄에 한 명씩 적어 주세요. 데모에서는 단원 평가 점수를 샘플로 채워요.</p>
        <div class="reg">
          <textarea class="field" id="regNames" placeholder="김하늘&#10;박바다&#10;이숲" aria-label="등록할 학생 이름"></textarea>
          <div class="row"><select class="field" id="regCls" aria-label="반">${a.classes.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
          <button type="button" class="btn" id="regBtn">학생 등록</button></div>
          <p class="err" id="regErr" hidden></p>
        </div>
        ${a.students.length ? `<p class="reg-list">등록된 학생 ${a.students.length}명 · ${a.students.slice(0, 8).map(esc).join(", ")}${a.students.length > 8 ? " …" : ""}</p>` : ""}`,
      report: () => `<p>학생을 고르고 ‘리포트 만들기’를 누르면 Claude가 다음 주 계획 초안을 써요. 선생님은 고쳐서 보내기만 하면 됩니다.</p>
        <button type="button" class="btn" data-go="report" ${a.students.length && a.units.length ? "" : "disabled"}>리포트 작업대로</button>`,
      send: () => `<p>‘학부모 링크’를 누르면 QR과 링크가 나와요. 카톡 문구를 복사해 학부모 채팅방에 붙여 넣으면 끝이에요.</p>
        <button type="button" class="btn" data-go="report" ${a.students.some((n) => S.made[key(a, n)]) ? "" : "disabled"}>링크 보내러 가기</button>`,
    };
    $("#obSteps").innerHTML = ob.steps.map((s, i) => `
      <li class="ob-step${s.done ? " done" : ""}${i === firstOpen ? " open" : ""}">
        <div class="ob-h"><span class="ob-no" aria-hidden="true">${s.done ? "✓" : i + 1}</span><div><b>${s.label}</b><small>${s.done ? "완료" : s.hint}</small></div></div>
        ${i === firstOpen || (!s.done && s.id === "students") ? `<div class="ob-b">${body[s.id]()}</div>` : ""}
      </li>`).join("");
  }
  $("#obSteps").addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.go) { go(t.dataset.go); return; }
    if (t.id === "regBtn") {
      const a = A(); const r = L.parseStudents($("#regNames").value, a.students);
      const err = $("#regErr");
      if (!r.added.length) { err.hidden = false; err.textContent = r.dup.length ? `이미 있는 이름이에요: ${r.dup.join(", ")}` : "이름을 한 명 이상 적어 주세요."; $("#regNames").focus(); return; }
      const cls = $("#regCls").value;
      // 반 배정은 이름 순서로 정해지므로, 고른 반에 들어가도록 자리를 맞춰 넣는다
      r.added.forEach((n) => { a.students.push(n); a.cmap = a.cmap || {}; a.cmap[n] = cls; });
      save(); render();
      toast(`${r.added.length}명을 ${cls}에 등록했어요${r.dup.length ? ` · 중복 ${r.dup.length}명은 건너뛰었어요` : ""}`, () => {
        a.students = a.students.filter((n) => !r.added.includes(n)); save(); render();
      });
    }
  });
  $("#newAcad").addEventListener("click", () => {
    const before = JSON.stringify(S);
    const id = "n" + Date.now().toString(36);
    S.academies.push({ id, name: "우리 학원", teacher: "담당 선생님", classes: ["1반", "2반"], units: [], students: [] });
    S.acad = id; save(); render();
    toast("빈 학원을 만들었어요. 단원표부터 채워 보세요", () => { S = JSON.parse(before); save(); render(); });
  });

  // 반 배정: 등록할 때 고른 반이 있으면 그 반
  const _clsOf = clsOf;
  function clsOfAny(a, n) { return (a.cmap && a.cmap[n]) || _clsOf(a, n); }

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
    renderRoster(); renderBench(); renderPhone(false);
  }

  function renderRoster() {
    const a = A(); const q = $("#q").value.trim(); const sel = S.sel[a.id];
    const list = a.students.filter((n) => (S.cls === "all" || clsOfAny(a, n) === S.cls) && (!q || n.includes(q)));
    $("#stuList").innerHTML = list.map((n) => {
      const k = key(a, n);
      const st = S.sent[k] ? `<span class="st sent">보냄</span>` : S.made[k] ? `<span class="st made">만듦</span>` : `<span class="st">대기</span>`;
      return `<li><button type="button" class="stu" data-n="${esc(n)}" aria-current="${n === sel}">
        <span class="nm">${esc(n)}</span><span class="avg">${a.units.length ? pct(avg(rates(a, n).map((x) => x.r))) + "%" : "-"}</span>
        <span class="cl">${esc(clsOfAny(a, n))}</span>${st}</button></li>`;
    }).join("") || `<li class="empty">${q ? `‘${esc(q)}’ 학생이 없어요` : a.students.length ? "이 반에 학생이 없어요" : `아직 학생이 없어요<br><button type="button" class="btn ghost sm" data-go="start">학생 등록하러 가기</button>`}</li>`;
  }

  function renderBench() {
    const a = A(); const n = S.sel[a.id]; const el = $("#bench");
    if (!n) { el.innerHTML = `<p class="empty">학생을 고르면 리포트 재료가 여기 모여요.</p>`; return; }
    if (!a.units.length) {
      el.innerHTML = `<p class="empty">교재 단원표가 비어 있어요.<br><button type="button" class="btn ghost" data-go="units" style="margin-top:12px">단원표 채우러 가기</button></p>`;
      return;
    }
    const k = key(a, n); const c = current(a, n);
    const weakSet = new Set(c.weak.map((w) => w.name));
    const note = S.notes[k] || "";
    const p = pct(avg(c.rs.map((x) => x.r)));
    const tr = L.trend(a, n, 3); const d = L.deltaPoint(tr);
    const waiting = pending.has(k);

    el.innerHTML = `
      <div class="b-top">
        <div><h2>${esc(n)}</h2><div class="meta">${esc(clsOfAny(a, n))} · ${MONTH} 단원 평가 · ${esc(a.teacher)}</div>
          <div class="spark" aria-label="최근 3개월 평균 ${tr.map((x) => `${x.m} ${pct(x.v)}%`).join(", ")}">${tr.map((x) => `<span><i style="height:${Math.max(8, pct(x.v) - 40)}px"></i><small>${x.m}</small></span>`).join("")}
            <em class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}%p</em></div>
        </div>
        <div class="ring" style="--p:${p}" role="img" aria-label="평균 정답률 ${p}%"><span><span><b>${p}%</b><small>평균</small></span></span></div>
      </div>
      <div class="b-sec">
        <h3>단원별 정답률 <span class="note">형광펜은 보완할 단원</span></h3>
        ${c.rs.map((x) => `<div class="ur"><span class="nm">${weakSet.has(x.name) ? `<mark>${esc(x.name)}</mark>` : esc(x.name)}</span>
          <span class="track"><i class="${x.r < 0.6 ? "low" : x.r < 0.75 ? "mid" : ""}" style="width:${pct(x.r)}%"></i></span><b>${pct(x.r)}%</b></div>`).join("")}
      </div>
      <div class="b-sec">
        <h3>다음 주 계획 ${chipHtml(c.info, waiting)}</h3>
        <div class="plan-ed${waiting ? " shimmer" : ""}" aria-busy="${waiting}">
          ${c.plan.map((l, i) => `<label><span class="no">${i + 1}</span><textarea class="field grow" rows="1" data-plan="${i}" aria-label="다음 주 계획 ${i + 1}번째 줄" maxlength="70"${waiting ? " disabled" : ""}>${esc(l)}</textarea></label>`).join("")}
        </div>
        <p class="err" id="planErr" hidden>비어 있는 계획 줄이 있어요. 세 줄을 모두 채워 주세요.</p>
        <div class="row plan-tools">
          <button type="button" class="btn ghost sm" id="regen"${waiting ? " disabled" : ""}>${c.info ? "Claude로 다시 쓰기" : "Claude로 계획 쓰기"}</button>
          <span class="hint-inline">Claude가 정답률을 읽고 요일·문항 수가 들어간 초안을 써요. 고쳐 쓰면 그대로 보내져요.</span>
        </div>
      </div>
      <div class="b-sec">
        <h3><label for="msg">학부모 첫 인사</label></h3>
        <textarea class="field grow" rows="1" id="msg" maxlength="${MSG_MAX}"${waiting ? " disabled" : ""}>${esc(c.message)}</textarea>
      </div>
      <div class="b-sec">
        <h3><label for="note">선생님 한마디</label></h3>
        <textarea class="field" id="note" placeholder="예: 수업 태도가 많이 좋아졌어요. 부등식만 잡으면 다음 달엔 90점대가 보여요." aria-describedby="noteCount">${esc(note)}</textarea>
        <div class="count" id="noteCount">${note.length} / ${NOTE_MAX}자</div>
      </div>
      <div class="actions">
        <button type="button" class="btn hi" id="make"${waiting ? " disabled" : ""}>${waiting ? "Claude가 계획을 쓰는 중…" : S.made[k] ? "리포트 다시 만들기" : "리포트 만들기"}</button>
        <button type="button" class="btn" id="link"${S.made[k] && !waiting ? "" : " disabled"}>학부모 링크 · QR</button>
        <span class="state${S.sent[k] ? " sent" : ""}">${S.sent[k] ? "학부모에게 보냄" : S.made[k] ? "만들었어요 · 아직 안 보냄" : "아직 만들지 않았어요"}</span>
      </div>`;
  }

  // 글상자 높이를 내용에 맞춘다 (계획 줄이 잘려 보이지 않게)
  function fit(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }
  const fitAll = () => $$("#bench textarea.grow").forEach(fit);
  new MutationObserver(fitAll).observe($("#bench"), { childList: true });
  window.addEventListener("resize", fitAll);

  /** 지금 학생의 리포트 묶음 (미리보기·링크·카톡 문구가 같은 내용을 쓰게) */
  function reportOf(a, n) {
    const k = key(a, n); const c = current(a, n);
    return {
      academy: a.name, teacher: a.teacher, className: clsOfAny(a, n), student: n, month: MONTH,
      units: c.rs, weak: c.weak.map((w) => w.name), plan: c.plan, message: c.message,
      note: (S.notes[k] || "").trim(), trend: L.trend(a, n, 3), ai: !!(c.info && c.info.mode === "ai"),
      date: new Date().toISOString().slice(0, 10),
    };
  }

  // 휴대폰 미리보기. animate=true 일 때만 리포트가 차례로 채워진다.
  function renderPhone(animate) {
    const a = A(); const n = S.sel[a.id]; const chat = $("#chat"); const k = n && key(a, n);
    if (!n || !S.made[k] || !a.units.length) {
      chat.innerHTML = `<div class="empty-chat"><b>아직 보낸 리포트가 없어요</b>‘리포트 만들기’를 누르면<br>학부모가 받을 화면이 여기에 만들어져요.</div>`;
      return;
    }
    const r = reportOf(a, n); const c = current(a, n);
    chat.innerHTML = `
      <div class="from">
        <span class="pf" aria-hidden="true">${esc(a.name[0])}</span>
        <div><p class="who">${esc(a.name)}</p>
          ${r.message ? `<div class="bubble${animate ? " gen0" : ""}">${esc(r.message)}</div>` : ""}
          <div class="card${animate ? " gen" : ""}">
            <div class="ch"><small>${MONTH} 학습 리포트 · ${esc(r.className)}</small><b>${esc(n)} 학생</b></div>
            <div class="cb">
              <div class="score"><b>${pct(avg(r.units.map((x) => x.r)))}%</b><span>평균 정답률</span></div>
              <div class="mini">${r.units.map((x) => `<div class="r"><span class="t">${esc(x.name)}</span><span class="track"><i class="${x.r < 0.6 ? "low" : x.r < 0.75 ? "mid" : ""}" style="width:${pct(x.r)}%"></i></span><em>${pct(x.r)}</em></div>`).join("")}</div>
              <h4>이번에 보완할 단원</h4>
              <div class="weak-list">${c.weak.map((w) => `<span>${esc(w.name)}</span>`).join("")}</div>
              <h4>다음 주에는 이렇게 공부해요</h4>
              <ol>${r.plan.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
              ${r.note ? `<div class="letter">${esc(r.note)}<small>${esc(a.teacher)}</small></div>` : ""}
            </div>
            <div class="cf">리포트 자세히 보기 ›</div>
          </div>
        </div>
      </div>
      <span class="time">${S.sent[k] ? "보냄" : "미리보기"}</span>`;
  }

  // 작업대 입력 (이벤트 위임)
  $("#bench").addEventListener("input", (e) => {
    const a = A(); const n = S.sel[a.id]; const k = key(a, n);
    if (e.target.classList.contains("grow")) fit(e.target);
    if (e.target.id === "note") {
      const v = e.target.value; const over = v.length > NOTE_MAX;
      $("#noteCount").textContent = `${v.length} / ${NOTE_MAX}자${over ? " · 너무 길어요" : ""}`;
      $("#noteCount").classList.toggle("over", over);
      e.target.setAttribute("aria-invalid", String(over));
      if (!over) { S.notes[k] = v; save(); if (S.made[k]) renderPhone(false); }
    }
    if (e.target.id === "msg") { S.msgs[k] = e.target.value; save(); if (S.made[k]) renderPhone(false); }
    if (e.target.dataset.plan != null) {
      const plan = [...current(a, n).plan];
      plan[+e.target.dataset.plan] = e.target.value;
      S.plans[k] = plan;
      if (S.ai[k] && S.ai[k].mode !== "edit") S.ai[k] = { ...S.ai[k], mode: "edit", was: S.ai[k].mode };
      save();
      e.target.setAttribute("aria-invalid", String(!e.target.value.trim()));
      $("#planErr").hidden = !$$("[data-plan]").some((x) => !x.value.trim());
      if (S.made[k]) renderPhone(false);
    }
  });
  // 계획을 고치면 칩이 '선생님이 고침'으로 바뀐다 (입력 중에는 다시 그리지 않고, 포커스가 빠질 때만)
  $("#bench").addEventListener("focusout", (e) => {
    if (e.target.dataset && e.target.dataset.plan != null) {
      const h = $("#bench .b-sec h3 .ai-chip"); const a = A(); const k = key(a, S.sel[a.id]);
      if (h && S.ai[k]) h.outerHTML = chipHtml(S.ai[k], false);
    }
  });

  $("#bench").addEventListener("click", async (e) => {
    const a = A(); const n = S.sel[a.id]; const k = key(a, n);
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.go) { go(t.dataset.go); return; }
    if (t.id === "regen") {
      const before = { plan: S.plans[k], msg: S.msgs[k], ai: S.ai[k] };
      await generate(a, n);
      if (S.sel[A().id] !== n) return;
      renderBench(); if (S.made[k]) renderPhone(true);
      toast(S.ai[k].mode === "ai" ? "Claude가 계획을 새로 썼어요" : "AI에 연결할 수 없어 규칙으로 계획을 썼어요", () => {
        S.plans[k] = before.plan; S.msgs[k] = before.msg; S.ai[k] = before.ai;
        if (!before.plan) delete S.plans[k]; if (before.msg == null) delete S.msgs[k]; if (!before.ai) delete S.ai[k];
        save(); renderBench(); renderPhone(false);
      });
      return;
    }
    if (t.id === "make") {
      const empty = $$("[data-plan]").filter((x) => !x.value.trim());
      empty.forEach((x) => x.setAttribute("aria-invalid", "true"));
      $("#planErr").hidden = !empty.length;
      if (empty.length) { empty[0].focus(); return; }
      if ($("#note").value.length > NOTE_MAX) { $("#note").focus(); return; }
      if (!S.ai[k]) await generate(a, n);           // 처음이면 Claude가 먼저 초안을 쓴다
      S.made[k] = true; save();
      if (S.sel[A().id] !== n) return;
      renderBench(); renderRoster(); renderPhone(true);
      if (window.matchMedia("(max-width: 1240px)").matches) $(".preview").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
      return;
    }
    if (t.id === "link") openShare(a, n);
  });

  $("#stuList").addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
    const b = e.target.closest(".stu"); if (!b) return;
    S.sel[A().id] = b.dataset.n; save();
    renderRoster(); renderBench(); renderPhone(false);
  });
  $("#clsChips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]"); if (!b) return;
    S.cls = b.dataset.c; save(); renderReport();
  });
  $("#q").addEventListener("input", renderRoster);

  /* ───────── 학부모 링크 · QR ───────── */
  let qrLib = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrLib) return qrLib;
    qrLib = new Promise((res) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
      s.onload = () => res(window.qrcode || null);
      s.onerror = () => { qrLib = null; res(null); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  let shareFor = null;
  async function openShare(a, n) {
    const r = reportOf(a, n);
    const code = await L.encodeReportZ(r);
    const url = new URL("report.html", location.href).href.split("#")[0] + "#" + code;
    shareFor = { a, n, url, r };
    $("#shareSub").textContent = `${n} 학생 · ${r.className} · ${MONTH}`;
    $("#shareUrl").value = url;
    $("#openLink").href = url;
    $("#qr").innerHTML = `<div class="qr-wait">QR 만드는 중…</div>`;
    const dlg = $("#share");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    const q = await loadQr();
    if (!q) { $("#qr").innerHTML = `<div class="qr-wait">QR을 불러오지 못했어요.<br>아래 링크를 복사해 보내 주세요.</div>`; return; }
    try {
      const qr = q(0, "L"); qr.addData(url, "Byte"); qr.make();
      $("#qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      const svg = $("#qr svg"); if (svg) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${n} 학생 리포트로 가는 QR 코드`); }
    } catch (e) {
      $("#qr").innerHTML = `<div class="qr-wait">리포트가 길어 QR에 다 담지 못했어요.<br>링크로 보내 주세요.</div>`;
    }
  }
  function markSent() {
    if (!shareFor) return;
    const k = key(shareFor.a, shareFor.n); const was = !!S.sent[k];
    S.sent[k] = true; save(); render();
    return was ? null : () => { delete S.sent[k]; save(); render(); };
  }
  $("#copyLink").addEventListener("click", async () => {
    const ok = await copy($("#shareUrl").value); const undo = markSent();
    toast(ok ? "학부모 링크를 복사했어요" : "링크를 선택해 직접 복사해 주세요", undo);
    if (!ok) $("#shareUrl").select();
  });
  $("#copyKakao").addEventListener("click", async () => {
    const ok = await copy(L.shareText(shareFor.r, shareFor.url)); const undo = markSent();
    toast(ok ? `${shareFor.n} 학부모용 카톡 문구를 복사했어요` : "복사하지 못했어요. 링크를 직접 복사해 주세요", undo);
  });
  $("#openLink").addEventListener("click", () => { markSent(); });

  /* ═════════ ② 원장 대시보드 ═════════ */
  function renderDash() {
    const a = A();
    if (!a.students.length || !a.units.length) {
      $("#dSub").textContent = `${a.name} · ${MONTH} 기준`;
      $("#stats").innerHTML = ""; $("#trendChart").innerHTML = `<p class="empty">학생과 단원표를 채우면 추이가 그려져요. <button type="button" class="btn ghost sm" data-go="start">시작하기</button></p>`;
      $("#trendLegend").innerHTML = ""; $("#clsAvg").innerHTML = ""; $("#pending").innerHTML = ""; $("#heat").innerHTML = "";
      return;
    }
    const all = a.students.map((n) => ({ n, c: clsOfAny(a, n), avg: avg(rates(a, n).map((x) => x.r)) }));
    const sent = sentCount(a);
    const series = L.academyTrend(a, (n) => clsOfAny(a, n)).filter((s) => s.name === "전체" || a.students.some((n) => clsOfAny(a, n) === s.name));
    const d = L.deltaPoint(series[0].points);
    const unitAvg = a.units.map((u) => ({ u: u[1], v: avg(a.students.map((n) => L.rate(a.id, n, u[1]))) })).sort((x, y) => x.v - y.v);
    $("#dSub").textContent = `${a.name} · ${MONTH} 기준`;
    $("#stats").innerHTML = `
      <div class="stat"><small>학생</small><b>${all.length}<span>명</span></b><em>반 ${a.classes.length}개</em></div>
      <div class="stat"><small>전체 평균 정답률</small><b>${pct(avg(all.map((s) => s.avg)))}<span>%</span></b><em class="${d >= 0 ? "up" : "down"}">지난달보다 ${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}%p</em></div>
      <div class="stat"><small>리포트 발송률</small><b>${pct(sent / all.length)}<span>%</span></b><em>${sent} / ${all.length}명 보냄</em></div>
      <div class="stat"><small>학원 전체 가장 약한 단원</small><b class="sm">${esc(unitAvg[0].u)}</b><em>평균 ${pct(unitAvg[0].v)}%</em></div>`;
    drawTrend(series);
    $("#clsAvg").innerHTML = a.classes.map((c) => {
      const kids = a.students.filter((n) => clsOfAny(a, n) === c);
      if (!kids.length) return "";
      const v = avg(kids.map((n) => avg(rates(a, n).map((x) => x.r))));
      const wu = a.units.map((u) => ({ u: u[1], v: avg(kids.map((n) => L.rate(a.id, n, u[1]))) })).sort((x, y) => x.v - y.v)[0];
      return `<div class="cr"><span>${esc(c)}</span><span class="track"><i class="${v < 0.6 ? "low" : v < 0.75 ? "mid" : ""}" style="width:${pct(v)}%"></i></span><b>${pct(v)}%</b></div>` +
        (wu ? `<p class="cr-w">${kids.length}명 · 가장 약한 단원 <mark>${esc(wu.u)}</mark> ${pct(wu.v)}%</p>` : "");
    }).join("");
    const pend = all.filter((s) => !S.sent[key(a, s.n)]);
    $("#pending").innerHTML = pend.length
      ? pend.map((s) => `<li><span>${esc(s.n)} <small>${esc(s.c)}${S.made[key(a, s.n)] ? " · 만듦" : ""}</small></span><button type="button" data-open="${esc(s.n)}">작업대에서 열기</button></li>`).join("")
      : `<li class="done">이번 달 리포트를 모두 보냈어요</li>`;
    const cell = (v) => {
      const t = Math.max(0, Math.min(1, (0.9 - v) / 0.4));
      return `<td style="background:rgba(229, 83, 75, ${0.08 + t * 0.75});color:${t > 0.55 ? "#fff" : "var(--ink)"}">${pct(v)}%</td>`;
    };
    const cls = a.classes.filter((c) => a.students.some((n) => clsOfAny(a, n) === c));
    $("#heat").innerHTML = `<thead><tr><th>단원</th>${cls.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
      a.units.map((u) => `<tr><th>${esc(u[1])}</th>${cls.map((c) => cell(avg(a.students.filter((n) => clsOfAny(a, n) === c).map((n) => L.rate(a.id, n, u[1]))))).join("")}</tr>`).join("") + "</tbody>";
  }

  // 6개월 추이: 직접 그리는 SVG 선 그래프
  const COLORS = ["#17213B", "#3B6FE0", "#E79A2B", "#1F9D7A", "#B44FD0"];
  function drawTrend(series) {
    const W = 760, H = 240, P = { l: 40, r: 58, t: 16, b: 30 };
    const vals = series.flatMap((s) => s.points.map((p) => p.v));
    const lo = Math.floor(Math.min(...vals) * 20) / 20 - 0.05, hi = Math.ceil(Math.max(...vals) * 20) / 20 + 0.02;
    const x = (i) => P.l + (i * (W - P.l - P.r)) / (L.MONTHS.length - 1);
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const ticks = []; for (let v = Math.ceil(lo * 20) / 20; v <= hi + 1e-9; v += 0.05) ticks.push(v);
    const focus = S.focus && series.some((s) => s.name === S.focus) ? S.focus : null;
    // 오른쪽 끝 숫자 라벨: 위에서부터 14px 이상 떨어지게 밀어 겹치지 않게
    const labY = {};
    series.map((s) => ({ name: s.name, y: y(s.points[s.points.length - 1].v) + 4 }))
      .filter((o) => !focus || o.name === focus || o.name === "전체")
      .sort((p, q) => p.y - q.y)
      .forEach((o, i, arr) => { labY[o.name] = i && o.y - labY[arr[i - 1].name] < 15 ? labY[arr[i - 1].name] + 15 : o.y; });
    const line = (s, i) => {
      const on = !focus || focus === s.name; const main = s.name === "전체";
      const d = s.points.map((p, j) => `${j ? "L" : "M"}${x(j).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
      const last = s.points[s.points.length - 1];
      return `<g class="ln${on ? "" : " dim"}">
        <path d="${d}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="${main ? 3 : 2}" ${main ? "" : 'stroke-dasharray="1 0"'} stroke-linecap="round" stroke-linejoin="round"/>
        ${s.points.map((p, j) => `<circle cx="${x(j).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${main ? 4 : 3}" fill="#fff" stroke="${COLORS[i % COLORS.length]}" stroke-width="2"><title>${esc(s.name)} ${p.m} ${pct(p.v)}%</title></circle>`).join("")}
        ${labY[s.name] != null ? `<text x="${x(s.points.length - 1) + 10}" y="${labY[s.name]}" text-anchor="start" class="lab" fill="${COLORS[i % COLORS.length]}">${pct(last.v)}%</text>` : ""}
      </g>`;
    };
    $("#trendChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 평균 정답률 ${series.map((s) => `${s.name} ${pct(s.points[0].v)}%에서 ${pct(s.points[s.points.length - 1].v)}%`).join(", ")}">
      ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${pct(v)}%</text>`).join("")}
      ${L.MONTHS.map((m, j) => `<text x="${x(j)}" y="${H - 8}" text-anchor="middle" class="tick${j === L.MONTHS.length - 1 ? " now" : ""}">${m}</text>`).join("")}
      ${series.map((s, i) => (s.name === "전체" ? "" : line(s, i))).join("")}${line(series[0], 0)}
    </svg>`;
    $("#trendLegend").innerHTML = series.map((s, i) => `<button type="button" data-f="${esc(s.name)}" aria-pressed="${focus === s.name}"><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(s.name)}</button>`).join("");
  }
  $("#trendLegend").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    S.focus = S.focus === b.dataset.f || b.dataset.f === "전체" ? null : b.dataset.f; save(); renderDash();
  });
  $("#v-dash").addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go); });
  $("#pending").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-open]"); if (!b) return;
    S.sel[A().id] = b.dataset.open; S.cls = "all"; save(); go("report");
  });

  /* ═════════ ③ 교재 단원표 ═════════ */
  const TRASH = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12 M8 6V4h4v2 M6 6l1 10h6l1-10"/></svg>`;
  function renderUnits() {
    const a = A();
    $("#unitRows").innerHTML = a.units.map((u, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td><input data-i="${i}" data-k="0" value="${esc(u[0])}" aria-label="${i + 1}번 교재 이름"></td>
      <td><input data-i="${i}" data-k="1" value="${esc(u[1])}" aria-label="${i + 1}번 단원명" placeholder="단원명을 적어 주세요"></td>
      <td class="n"><button type="button" class="del" data-del="${i}" aria-label="${esc(u[1] || "빈")} 단원 삭제">${TRASH}</button></td></tr>`).join("")
      || `<tr><td colspan="4" class="empty">단원이 없어요. ‘단원 추가’나 CSV로 채워 주세요. 파일을 여기로 끌어다 놓아도 돼요.</td></tr>`;
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
    save(); renderUnits(); render();
    toast(`‘${removed[1] || "빈"}’ 단원을 지웠어요`, () => { a.units.splice(i, 0, removed); save(); render(); });
  });
  $("#addUnit").addEventListener("click", () => {
    const a = A(); a.units.push([a.units[0] ? a.units[0][0] : "새 교재", ""]); save(); renderUnits();
    const ins = $$("#unitRows input[data-k='1']"); const last = ins[ins.length - 1];
    if (last) last.focus();
  });
  async function importCsv(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") { toast("CSV 파일만 올릴 수 있어요"); return; }
    const r = L.parseUnitCsv(await file.text());
    if (!r.units.length) { toast("읽을 수 있는 줄이 없어요. ‘교재,단원명’ 형식인지 확인해 주세요"); return; }
    const a = A(); const before = a.units;
    a.units = r.units; save(); render();
    toast(`단원 ${r.units.length}개를 불러왔어요${r.skipped.length ? ` · ${r.skipped.join(", ")}번째 줄은 칸이 비어 건너뛰었어요` : ""}`, () => { a.units = before; save(); render(); });
  }
  $("#csv").addEventListener("change", async (e) => { await importCsv(e.target.files[0]); e.target.value = ""; });
  const drop = $("#unitDrop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); importCsv(e.dataTransfer.files[0]); });
  $("#csvSample").addEventListener("click", () => {
    const a = A();
    const csv = "교재,단원명\n" + (a.units.length ? a.units : SAMPLE().academies[0].units).map((u) => u.map((x) => (/[,"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    link.download = "다음주_단원표_예시.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500);
  });

  /* ═════════ ④ 요금제 (예시 가격) ═════════ */
  const won = (n) => n.toLocaleString("ko-KR");
  function renderPlans() {
    const a = A(); const n = a.students.length; const yearly = S.cycle === "y";
    const rec = L.recommendPlan(n);
    $$("[data-cycle]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cycle === S.cycle)));
    $("#planSub").textContent = `${a.name} 학생 ${n}명 기준으로 추천해요. 아래 가격은 예시입니다.`;
    $("#plans").innerHTML = L.PLANS.map((p) => `<article class="plan${p.id === rec.id ? " cur" : ""}">
      <div class="nm">${p.nm}${p.id === rec.id ? `<span class="badge">지금 학원에 맞아요</span>` : ""}</div>
      <div class="pr">월 ${won(L.priceOf(p, yearly))}<small>원</small>${yearly ? `<s>${won(p.month)}원</s>` : ""}</div>
      <div class="ex">예시 가격 · ${n && n <= p.cap ? `학생 1명당 월 ${won(L.perStudent(p, n, yearly))}원` : `학생 ${p.cap}명까지`}${yearly ? " · 연 결제" : ""}</div>
      <ul>${p.items.map((x) => `<li>${x}</li>`).join("")}</ul>
      <button type="button" class="btn${p.id === rec.id ? " hi" : " ghost"}" data-trial="${p.nm}">14일 무료로 써 보기</button></article>`).join("");
    const rows = [
      ["학생 수", "30명", "80명", "200명"], ["월 리포트", "무제한", "무제한", "무제한"], ["학부모 링크·QR", "✓", "✓", "✓"],
      ["Claude 다음 주 계획", "규칙 기반", "✓", "✓"], ["원장 대시보드", "—", "✓", "✓"], ["강사 계정", "1개", "3개", "10개"],
      ["카카오 알림톡 자동 발송", "—", "—", "✓"],
    ];
    $("#cmp").innerHTML = `<thead><tr><th></th>${L.PLANS.map((p) => `<th${p.id === rec.id ? ' class="cur"' : ""}>${p.nm}</th>`).join("")}</tr></thead><tbody>` +
      rows.map((r) => `<tr><th>${r[0]}</th>${r.slice(1).map((v, i) => `<td${L.PLANS[i].id === rec.id ? ' class="cur"' : ""}>${v}</td>`).join("")}</tr>`).join("") + "</tbody>";
  }
  $$("[data-cycle]").forEach((b) => b.addEventListener("click", () => { S.cycle = b.dataset.cycle; save(); renderPlans(); }));
  $("#plans").addEventListener("click", (e) => {
    const b = e.target.closest("[data-trial]"); if (!b) return;
    toast(`예시 서비스라 결제는 연결돼 있지 않아요 · ${b.dataset.trial} 요금제`);
  });

  /* ───────── 공통 ───────── */
  $("#acad").addEventListener("change", (e) => { S.acad = e.target.value; S.cls = "all"; $("#q").value = ""; save(); render(); });
  $$("[data-reset]").concat([$("#reset")]).forEach((b) => b && b.addEventListener("click", () => {
    const before = S; S = SAMPLE(); save(); $("#q").value = ""; render();
    toast("샘플 데이터로 되돌렸어요", () => { S = before; save(); render(); });
  }));

  render();
})();
