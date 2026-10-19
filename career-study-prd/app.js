/* 하루치 — AI 공부 코치 (기획서 + 동작하는 프로토타입 + 프롬프트 평가표)
 *
 * 프로토타입 흐름
 *  1) 목표·시험일·하루 시간·과목을 넣는다 → 7일 계획을 만든다 (하루 2과목 이하, 7일째는 복습)
 *  2) 할 일을 체크하면 형광펜이 그어지고, 진행률 고리·코치 한마디·스터디 진행률이 바뀐다
 *  3) 지난 날에 못 한 일은 '밀림'으로 표시되고, 버튼 한 번으로 남은 날에 고르게 다시 나눈다
 *
 * 계획 생성·코치 문구는 이 데모에서 규칙으로 만든다. (기획서의 v3 프롬프트를 규칙으로 옮긴 것)
 */

const STORE_KEY = "haruchi-v2";
const WD = "일월화수목금토";
const HOURS = [1, 1.5, 2, 3];

/* ---------- 날짜 ---------- */
const day0 = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = (s) => new Date(s + "T00:00:00");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const label = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const daysLeft = (exam) => Math.round((fromIso(exam) - day0()) / 86400000);

/* ---------- 계획 만들기 (v3 프롬프트의 규칙) ---------- */
// 남은 기간으로 단계를 정하고, 단계마다 활동이 달라진다
function phaseOf(left) { return left <= 7 ? "마무리" : left <= 21 ? "문제 풀이" : "개념 정리"; }
const ACT = {
  "개념 정리": ["핵심 개념 정리", "기출 10문제"],
  "문제 풀이": ["기출 1회분 풀기", "오답 노트"],
  "마무리": ["모의고사", "약점 단원 복습"],
};
function makePlan(start, exam, hrs, subs) {
  const phase = phaseOf(daysLeft(exam));
  const days = [];
  let k = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const items = [];
    if (i === 6) {
      items.push({ sub: "주간 복습", act: "틀린 문제 다시 풀기", h: hrs, done: false });
    } else {
      const per = Math.min(2, subs.length); // 하루 2과목 이하
      const each = Math.round((hrs / per) * 10) / 10;
      for (let j = 0; j < per; j++) {
        const sub = subs[k++ % subs.length];
        items.push({ sub, act: ACT[phase][j % 2], h: each, done: false });
      }
    }
    days.push({ date: iso(d), items });
  }
  return { start: iso(start), phase, days };
}

/* ---------- 상태 ---------- */
function seed() {
  const exam = iso(addDays(day0(), 26));
  const subs = ["소프트웨어 설계", "소프트웨어 개발", "데이터베이스", "프로그래밍 언어", "정보시스템 구축"];
  // 샘플은 이틀 전에 시작한 계획: 첫날 1개, 둘째 날 1개를 못 해서 '밀림'이 보인다
  const plan = makePlan(addDays(day0(), -2), exam, 2, subs);
  plan.days[0].items[0].done = true;
  plan.days[1].items[0].done = true;
  return { tab: "proto", goal: "정보처리기사 필기 합격", exam, hrs: 2, subs, plan, evalPick: 2 };
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v && Array.isArray(v.subs)) return v;
  } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
  return seed();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 무시 */ } }
let st = load();
let arrived = new Set(); // 방금 옮겨 온 할 일 (잠깐 형광 표시)

/* ---------- 공통 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let toastTimer;
function toast(msg, undo) {
  $("toastMsg").textContent = msg;
  $("toastUndo").hidden = !undo;
  $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2200);
}
const snapshot = () => JSON.parse(JSON.stringify(st));

/* ---------- 탭 ---------- */
function showTab(t) {
  st.tab = t; save();
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === t)));
  document.querySelectorAll("[data-p]").forEach((s) => (s.hidden = s.dataset.p !== t));
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) showTab(b.dataset.t); });

/* ---------- 프로토타입: 입력 ---------- */
function renderForm() {
  $("goal").value = st.goal;
  $("exam").value = st.exam;
  $("hrs").innerHTML = HOURS.map((h) => `<button type="button" role="radio" aria-checked="${st.hrs === h}" data-h="${h}">${h}시간</button>`).join("");
  $("subs").innerHTML = st.subs.map((s, i) => `<span>${esc(s)}<button type="button" data-i="${i}" aria-label="${esc(s)} 빼기">×</button></span>`).join("");
}
$("hrs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-h]"); if (!b) return;
  st.hrs = Number(b.dataset.h); save(); renderForm();
  $("hrs").querySelector(`[data-h="${b.dataset.h}"]`).focus();
});
$("subs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  st.subs.splice(Number(b.dataset.i), 1); save(); renderForm(); $("subIn").focus();
});
$("subIn").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  const v = e.target.value.trim();
  if (!v) return;
  if (st.subs.includes(v)) { toast("이미 있는 과목이에요"); return; }
  if (st.subs.length >= 8) { toast("과목은 8개까지 넣을 수 있어요"); return; }
  st.subs.push(v); e.target.value = ""; save(); renderForm();
});
function fail(msg, el) {
  $("err").textContent = msg; $("err").hidden = false;
  if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); }
}
$("pf").addEventListener("submit", (e) => {
  e.preventDefault();
  ["goal", "exam", "subIn"].forEach((id) => $(id).removeAttribute("aria-invalid"));
  $("err").hidden = true;
  const goal = $("goal").value.trim();
  const exam = $("exam").value;
  if (!goal) return fail("목표를 써 주세요. 예) 토익 800점", $("goal"));
  if (!exam) return fail("시험일을 골라 주세요.", $("exam"));
  if (daysLeft(exam) < 1) return fail("시험일은 내일 이후여야 해요.", $("exam"));
  if (!st.subs.length) return fail("과목을 하나 이상 넣어 주세요.", $("subIn"));
  const before = snapshot();
  st.goal = goal; st.exam = exam;
  st.plan = makePlan(day0(), exam, st.hrs, st.subs);
  save(); renderProto();
  toast("이번 주 계획을 만들었어요", () => { st = before; save(); renderForm(); renderProto(); });
});

/* ---------- 프로토타입: 계획 ---------- */
function stats() {
  const all = st.plan ? st.plan.days.flatMap((d) => d.items) : [];
  const done = all.filter((x) => x.done).length;
  const today = iso(day0());
  const missed = st.plan ? st.plan.days.filter((d) => d.date < today).flatMap((d) => d.items).filter((x) => !x.done).length : 0;
  const todayDay = st.plan?.days.find((d) => d.date === today);
  return { total: all.length, done, pct: all.length ? Math.round((done / all.length) * 100) : 0, missed, todayDay };
}
function renderDday(s) {
  const left = daysLeft(st.exam);
  const C = 2 * Math.PI * 42;
  $("dday").innerHTML = `
    <div class="ring" role="img" aria-label="이번 주 ${s.pct}% 완료">
      <svg viewBox="0 0 104 104"><circle class="track" cx="52" cy="52" r="42"/><circle class="val" cx="52" cy="52" r="42" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - s.pct / 100)}"/></svg>
      <div class="in"><div><b>${s.pct}%</b><br><small>이번 주</small></div></div>
    </div>
    <div><p class="goal-t">${esc(st.goal || "목표를 정해 주세요")}</p><p class="left">시험까지 <b>${left > 0 ? left : 0}</b>일</p></div>`;
}
function coachLine(s) {
  if (!st.plan) return "목표와 시험일을 넣으면 이번 주 몫을 나눠 드릴게요.";
  const t = s.todayDay;
  const todayLeft = t ? t.items.filter((x) => !x.done) : [];
  if (s.missed) return `지난 날에 못 한 일이 <b>${s.missed}개</b> 있어요. 몰아서 하지 말고 '밀린 일 다시 나누기'로 남은 날에 나눠요.`;
  if (t && !todayLeft.length) return `오늘 몫 끝! 이번 주 <b>${s.pct}%</b>예요. 내일은 ${esc(st.plan.days.find((d) => d.date > t.date)?.items[0]?.sub ?? "복습")}부터 시작해요.`;
  if (s.pct >= 60) return `이번 주 <b>${s.pct}%</b> — 목표(60%)를 넘었어요. 이대로면 충분해요.`;
  if (t) return `오늘은 <b>${esc(todayLeft[0].sub)}</b>부터. ${todayLeft.length}개, 합쳐서 ${todayLeft.reduce((a, x) => a + x.h, 0)}시간이면 끝나요.`;
  return "계획한 주가 지났어요. 새 계획을 만들어 주세요.";
}
function renderProto() {
  const s = stats();
  renderDday(s);
  $("phase").textContent = st.plan ? `${st.plan.phase} 단계 · 하루 ${st.hrs}시간 · 하루 2과목 이하, 7일째는 복습` : "";
  $("coach").innerHTML = `<span class="face" aria-hidden="true">코치</span><p>${coachLine(s)}<small>코치 한마디 · 브라우저 규칙 기반 데모</small></p>`;
  const rp = $("replan");
  rp.textContent = s.missed ? `밀린 일 ${s.missed}개 다시 나누기` : "밀린 일 다시 나누기";
  rp.classList.toggle("warn", !!s.missed);

  if (!st.plan) {
    $("week").className = "week empty-week";
    $("week").innerHTML = `<b>아직 계획이 없어요</b>왼쪽에서 목표를 넣고 '이번 주 계획 만들기'를 눌러 주세요.`;
  } else {
    const today = iso(day0());
    $("week").className = "week";
    $("week").innerHTML = st.plan.days.map((d, di) => {
      const dt = fromIso(d.date);
      const past = d.date < today, isToday = d.date === today;
      const dn = d.items.filter((x) => x.done).length;
      return `<div class="day${isToday ? " today" : ""}${past ? " past" : ""}">
        <div class="day-h"><b>${WD[dt.getDay()]} ${label(dt)}</b><span class="${isToday ? "today-tag" : ""}">${isToday ? "오늘" : `${dn}/${d.items.length}`}</span></div>
        <div class="items">${d.items.map((x, ii) => {
          const key = `${di}-${ii}`;
          const cls = ["item", x.done ? "done" : "", past && !x.done ? "missed" : "", arrived.has(key) ? "arrived" : ""].join(" ");
          return `<label class="${cls}"><input type="checkbox" data-d="${di}" data-i="${ii}" ${x.done ? "checked" : ""}>
            <span class="txt">${x.moved ? `<span class="moved">옮김</span>` : ""}<span class="mk">${esc(x.sub)}</span><em>${esc(x.act)} · ${x.h}시간</em></span></label>`;
        }).join("")}</div></div>`;
    }).join("");
  }
  arrived = new Set();
  renderCrew(s);
}
$("week").addEventListener("change", (e) => {
  const c = e.target; if (!c.dataset.d) return;
  st.plan.days[+c.dataset.d].items[+c.dataset.i].done = c.checked;
  save();
  // 전체를 다시 그리지 않고 이 줄만 바꿔서 형광펜이 그어지는 모습이 보이게 한다
  c.closest(".item").classList.toggle("done", c.checked);
  const s = stats();
  if (c.checked) c.closest(".item").classList.remove("missed");
  else if (st.plan.days[+c.dataset.d].date < iso(day0())) c.closest(".item").classList.add("missed");
  renderDday(s);
  $("coach").innerHTML = `<span class="face" aria-hidden="true">코치</span><p>${coachLine(s)}<small>코치 한마디 · 브라우저 규칙 기반 데모</small></p>`;
  $("replan").textContent = s.missed ? `밀린 일 ${s.missed}개 다시 나누기` : "밀린 일 다시 나누기";
  $("replan").classList.toggle("warn", !!s.missed);
  const day = c.closest(".day");
  const d = st.plan.days[+c.dataset.d];
  const span = day.querySelector(".day-h span");
  if (!span.classList.contains("today-tag")) span.textContent = `${d.items.filter((x) => x.done).length}/${d.items.length}`;
  renderCrew(s);
});

// 밀린 일 다시 나누기: 지난 날의 못 한 일을 오늘부터 남은 날에 하나씩 돌려 담는다
$("replan").addEventListener("click", () => {
  if (!st.plan) { toast("먼저 계획을 만들어 주세요"); return; }
  const today = iso(day0());
  const pastIdx = st.plan.days.map((d, i) => (d.date < today ? i : -1)).filter((i) => i >= 0);
  const futureIdx = st.plan.days.map((d, i) => (d.date >= today ? i : -1)).filter((i) => i >= 0);
  const missed = pastIdx.flatMap((i) => st.plan.days[i].items.filter((x) => !x.done));
  if (!missed.length) { toast("밀린 일이 없어요. 잘하고 있어요"); return; }
  if (!futureIdx.length) { toast("남은 날이 없어요. 새 계획을 만들어 주세요"); return; }
  const before = snapshot();
  pastIdx.forEach((i) => (st.plan.days[i].items = st.plan.days[i].items.filter((x) => x.done)));
  missed.forEach((x, n) => {
    const di = futureIdx[n % futureIdx.length];
    const items = st.plan.days[di].items;
    items.push({ ...x, moved: true });
    arrived.add(`${di}-${items.length - 1}`);
  });
  save(); renderProto();
  toast(`밀린 일 ${missed.length}개를 남은 날에 나눴어요`, () => { st = before; save(); renderProto(); });
});

/* 스터디 진행률 (다른 스터디원은 샘플 값) */
const CREW = [["하은", 72], ["지호", 58], ["수아", 41]];
function renderCrew(s) {
  const rows = [...CREW.map(([n, p]) => ({ n, p })), { n: "나", p: s.pct, me: true }].sort((a, b) => b.p - a.p);
  $("crew").innerHTML = rows.map((r) => `<li class="${r.me ? "me" : ""}"><span>${r.n}</span><span class="bar"><i style="width:${r.p}%"></i></span><span class="pct">${r.p}%</span></li>`).join("");
}

$("reset").addEventListener("click", () => {
  const before = snapshot();
  const tab = st.tab;
  st = seed(); st.tab = tab;
  save(); renderForm(); renderProto(); renderEval();
  toast("샘플 계획으로 되돌렸어요", () => { st = before; save(); renderForm(); renderProto(); renderEval(); });
});

/* ---------- 기획서: 화면 흐름 (와이어프레임) ---------- */
const SCREENS = [
  ["시작 · 목표 입력", "h i i i b"],
  ["주간 계획", "h g i i g i"],
  ["오늘 할 몫", "h g g i b"],
  ["밀린 일 다시 나누기", "h i i b"],
  ["스터디 진행률", "h g i g i"],
  ["코치 한마디", "h i i"],
  ["설정", "h i i i"],
];
$("flow").innerHTML = SCREENS.map(([name, wf], i) =>
  `<li><div class="wf" aria-hidden="true">${wf.split(" ").map((c) => `<i class="${c}"></i>`).join("")}</div><b>S${i + 1}</b>${name}</li>`).join("");

/* ---------- 프롬프트 평가표 ---------- */
const CRIT = ["정확성", "구체성", "실행 가능성", "개인화", "말투"];
const VERS = [
  {
    name: "v1 · 한 줄 요청", s: [3, 2, 2, 1, 3],
    why: "과목만 나열했고, 하루 시간과 시험일을 반영하지 못했어요.",
    prompt: "정보처리기사 공부 계획 짜 줘.",
    answer: "1. 소프트웨어 설계를 공부합니다.\n2. 소프트웨어 개발을 공부합니다.\n3. 데이터베이스를 공부합니다.\n…\n꾸준히 하면 합격할 수 있습니다!",
  },
  {
    name: "v2 · 조건 추가", s: [4, 4, 3, 3, 3],
    why: "시간 배분은 맞지만 하루에 4~5과목을 넣어 지키기 어려웠어요.",
    prompt: "시험 4주 전, 하루 2시간. 정보처리기사 필기 5과목으로 7일 계획을 표로 만들어 줘.",
    answer: "| 요일 | 할 일 |\n| 월 | 설계 30분, 개발 30분, DB 30분, 언어 30분 |\n| 화 | 구축 40분, 설계 40분, 개발 40분 |\n…",
  },
  {
    name: "v3 · 역할·규칙·형식", s: [5, 5, 5, 4, 5],
    why: "하루 2과목 제한과 7일째 복습 규칙으로 실행 가능성이 크게 올랐어요. 이 버전을 채택했어요.",
    prompt: "너는 대학생 스터디 코치야.\n상황: 시험 4주 전, 하루 2시간, 5과목.\n규칙:\n- 하루 2과목 이하\n- 7일째는 복습만\n- 남은 기간에 따라 '개념 정리 → 문제 풀이 → 마무리'로 활동을 바꿔\n형식: '과목 · 활동 (시간)'\n마지막에 한 줄 격려.",
    answer: "월  소프트웨어 설계 · 기출 1회분 (1시간)\n    소프트웨어 개발 · 오답 노트 (1시간)\n화  데이터베이스 · 기출 1회분 (1시간)\n    프로그래밍 언어 · 오답 노트 (1시간)\n…\n일  주간 복습 · 틀린 문제 다시 풀기 (2시간)\n\n이번 주는 ‘두 과목만’ 지키면 충분해요.",
  },
];
const dots = (n) => `<span class="dots" aria-label="${n}점">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
function renderEval() {
  const p = st.evalPick ?? 2;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  $("scoreTable").innerHTML = `<table class="st">
    <thead><tr><th>기준 (5점)</th>${VERS.map((v, i) => `<th><button type="button" data-v="${i}" aria-pressed="${i === p}">${v.name.split(" · ")[0]}</button></th>`).join("")}</tr></thead>
    <tbody>${CRIT.map((c, ci) => `<tr><td class="crit">${c}</td>${VERS.map((v, i) => `<td class="${i === p ? "col-sel" : ""}">${dots(v.s[ci])}</td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr><td>합계 (25점)</td>${VERS.map((v, i) => `<td class="${i === p ? "col-sel" : ""}">${sum(v.s)}</td>`).join("")}</tr></tfoot>
  </table>`;
  const v = VERS[p];
  $("ver").innerHTML = `<h2>${v.name}${p === 2 ? `<span class="pick">채택</span>` : ""}</h2><p class="why">${v.why}</p>
    <h3>프롬프트</h3><pre>${esc(v.prompt)}</pre><h3>받은 답 (일부)</h3><p class="answer">${esc(v.answer)}</p>`;
}
$("scoreTable").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  st.evalPick = Number(b.dataset.v); save(); renderEval();
  $("scoreTable").querySelector(`[data-v="${b.dataset.v}"]`).focus();
});

// 좁은 화면에서 입력 폼 펼치기·접기
$("editToggle").addEventListener("click", (e) => {
  const card = e.currentTarget.closest(".goal-card");
  const open = card.classList.toggle("open");
  e.currentTarget.setAttribute("aria-expanded", String(open));
  e.currentTarget.textContent = open ? "접기" : "목표·과목 고치기";
  if (open) $("goal").focus();
});

/* ---------- 시작 ---------- */
showTab(st.tab || "proto");
renderForm();
renderProto();
renderEval();
