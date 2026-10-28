/* 당일결과 — 화면
 * 계산·익명 처리는 logic.js(window.Dangil). 이 파일은 그리기와 버튼만 맡는다.
 * 저장: localStorage("startup-training-report-v1") — 설문 원문은 이 브라우저에만 남는다.
 */
(function () {
  "use strict";
  const L = window.Dangil;
  const STORE_KEY = "startup-training-report-v1";
  const TASK = "trainingreport.summary";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  /* ---------- 예시 설문 (가상의 회사·사람) ---------- */
  const SUR = "김이박최정강조윤장임한오서신권황안송류홍";
  const GIV = ["도현", "서연", "준호", "민지", "하늘", "지우", "세린", "예준", "수아", "현우", "지민", "유진", "태윤", "나은", "시우", "다인", "건우", "하린", "은호", "소율", "재원", "가온", "민서", "도윤", "채원", "승현", "윤아", "주원", "서진", "예린", "한결", "지아"];
  const COURSES = {
    a: {
      client: "누리솔루션(가상)", course: "신임 팀장 피드백 리더십", total: 36, seed: 7,
      depts: [["영업1팀", 9], ["영업2팀", 8], ["개발팀", 7], ["인사팀", 3], ["재무팀", 2], ["구매팀", 3]],
      base: [4.6, 4.7, 4.3, 3.4, 4.2], pre: 2.6, post: 4.0,
      pool: ["{N} 팀장님 사례가 우리 팀 얘기 같아서 몰입됐어요", "롤플레이가 제일 좋았어요. 실습 시간이 짧았던 게 아쉬워요", "피드백 대화 순서(상황-행동-영향)를 바로 써먹을 수 있을 것 같아요", "이론 부분이 길었고 실습이 부족했어요", "{G} 님이랑 짝 실습한 게 도움이 됐어요", "워크시트를 파일로도 받고 싶어요. dohyun.k@example.com", "쉬는 시간이 빠듯했어요", "강사님 설명이 구체적이라 이해가 쉬웠어요", "3개월 뒤에 한 번 더 점검하는 시간이 있으면 좋겠어요", "팀에서 바로 1:1 면담에 적용해 볼게요", "사례가 영업 쪽에 치우쳐서 개발팀 상황과는 조금 달랐어요", "자료 받고 싶어요 010-2481-7735로 연락 주세요", "시간이 부족해서 마지막 실습을 못 한 게 아쉬웠어요", "심화 과정도 있으면 신청하고 싶어요"],
    },
    b: {
      client: "바름식품(가상)", course: "고객 응대 커뮤니케이션 실무", total: 24, seed: 3,
      depts: [["고객센터", 12], ["매장운영팀", 6], ["마케팅팀", 3]],
      base: [4.4, 4.6, 3.7, 4.1, 3.8], pre: 2.9, post: 3.9,
      pool: ["까다로운 고객 응대 롤플이 현장과 비슷했어요", "{N} 매니저님 실제 통화 사례 공유가 좋았어요", "매장 상황 사례가 적어서 현업에 적용하기 어려웠어요", "공감 표현 문장 목록을 바로 쓸 수 있을 것 같아요", "자료가 많아서 다 못 봤어요. 요약본이 있으면 좋겠어요", "강사님 진행이 편안했어요", "후속으로 사례 점검 시간이 있으면 좋겠어요", "{G} 님이 고객 역할을 실감 나게 해 줘서 재밌었어요", "문의는 010-3920-4417로 주세요", "실무 사례가 부족해서 아쉬웠어요"],
    },
  };
  function rng(seed) { let a = seed * 2654435761 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function sampleCsv(key) {
    const c = COURSES[key]; const r = rng(c.seed);
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));
    const people = []; c.depts.forEach(([d, n]) => { for (let i = 0; i < n; i++) people.push(d); });
    const names = people.map((_, i) => SUR[(i * 7 + c.seed) % SUR.length] + GIV[(i * 5 + c.seed * 3) % GIV.length]);
    const lines = [L.HEADER.join(",")];
    people.forEach((dept, i) => {
      const q = c.base.map((b) => clamp(b + (r() - .5) * 1.8, 1, 5));
      const pre = clamp(c.pre + (r() - .5) * 1.6, 1, 5), post = clamp(Math.max(pre, c.post + (r() - .5) * 1.4), 1, 5);
      const rec = clamp(5.6 + (q.reduce((x, y) => x + y, 0) / 5 - 3) * 2.6 + (r() - .5) * 2.2, 0, 10);
      let cm = r() < .72 ? c.pool[(i * 5 + c.seed) % c.pool.length] : ""; // 겹치지 않게 차례로
      const other = names[(i + 3) % names.length];
      cm = cm.replace("{N}", other).replace("{G}", other.slice(1));
      lines.push([names[i], dept, ...q, pre, post, rec, cm.includes(",") ? `"${cm}"` : cm].join(","));
    });
    return lines.join("\n");
  }

  /* ---------- 상태 ---------- */
  function seed(course) { const c = COURSES[course || "a"]; return { course: course || "a", csv: sampleCsv(course || "a"), total: c.total, dept: "all", view: "table", ran: false }; }
  function load() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && typeof v.csv === "string" && COURSES[v.course]) return v; } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed("a");
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let R = null;          // 계산 결과 (rows, agg, comments, sum, …)
  let ai = { mode: "rule", reason: "" };
  let waiting = false, runToken = 0, showAll = false;

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg; $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2400);
  }
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });
  const meta = () => { const c = COURSES[st.course]; return { client: c.client, course: c.course, date: todayIso(), total: Number(st.total) || 0 }; };

  /* ---------- 왼쪽: 응답 ---------- */
  function setView(v) {
    st.view = v;
    $("csv").hidden = v !== "csv"; $("tableBox").hidden = v === "csv";
    $("viewTable").setAttribute("aria-pressed", String(v === "table")); $("viewCsv").setAttribute("aria-pressed", String(v === "csv"));
    if (v === "csv") $("csv").focus();
    save();
  }
  function renderSamples() { document.querySelectorAll("[data-course]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.course === st.course))); }
  function renderTable(all) {
    if (!all.length) { $("tableBox").innerHTML = `<p class="empty">응답이 없어요. ‘CSV 고치기’에서 붙여 넣으세요.</p>`; return; }
    $("tableBox").innerHTML = `<table class="resp"><caption class="sr">응답 목록 (이름은 표시하지 않음)</caption><thead><tr><th>응답</th><th>이름</th><th>부서</th><th class="num">평균</th><th class="num">역량</th><th class="num hide-s">추천</th><th class="cm">의견</th></tr></thead><tbody>${all.map((r, i) => {
      const a = (r.q.reduce((x, y) => x + y, 0) / 5).toFixed(1);
      return `<tr><td class="id">${String(i + 1).padStart(2, "0")}</td><td class="nm" title="리포트에 쓰지 않아요">${esc(r.name[0] || "")}○○</td><td>${esc(r.dept)}</td><td class="num">${a}</td><td class="num${r.post > r.pre ? " up" : ""}">${r.pre}→${r.post}</td><td class="num hide-s">${r.rec}</td><td class="cm">${r.comment ? "있음" : "—"}</td></tr>`;
    }).join("")}</tbody></table>`;
  }
  function renderDeptFilter(all) {
    const counts = new Map(); all.forEach((r) => counts.set(r.dept, (counts.get(r.dept) || 0) + 1));
    const ok = [...counts.entries()].filter(([, n]) => n >= L.MIN_GROUP).sort((a, b) => b[1] - a[1]);
    if (st.dept !== "all" && !ok.some(([d]) => d === st.dept)) st.dept = "all";
    $("dept").innerHTML = `<option value="all">전체 ${all.length}명</option>` + ok.map(([d, n]) => `<option value="${esc(d)}"${d === st.dept ? " selected" : ""}>${esc(d)} ${n}명</option>`).join("") + (ok.length < counts.size ? `<option disabled>5명 미만 부서는 따로 보지 않아요</option>` : "");
  }

  /* ---------- 오른쪽: 리포트 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 의견을 읽는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 숫자와 낱말 규칙으로 요약했어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  const markMask = (t) => esc(t).replace(/○○○|\(연락처\)|\(이메일\)/g, (m) => `<mark title="가린 부분">${m}</mark>`);
  function renderPaper() {
    const p = $("paper");
    if (!R || !R.agg.n) { p.innerHTML = `<p class="empty">읽을 수 있는 응답이 없어요.</p>`; return; }
    const { agg, sum, comments, masked } = R; const m = meta(); const f1 = L.f1;
    const rate = m.total ? Math.round((agg.n / m.total) * 100) : null;
    const voices = showAll ? comments : comments.slice(0, 5);
    p.classList.toggle("waiting", waiting);
    p.innerHTML = `
      <div class="r-h"><div><h2>${esc(m.course)} 결과 리포트</h2><p class="who">${esc(m.client)} · 교육일 ${m.date}${st.dept !== "all" ? ` · ${esc(st.dept)}만` : ""}</p></div></div>
      <div class="badges">${modeChip()}<span class="safe" id="safe">이름 노출 검사 중</span><span class="safe">의견 속 이름·연락처 ${masked}곳 가림</span></div>
      <div class="kpis">
        <div class="kpi"><small>전체 만족도</small><b>${f1(agg.overall)}<em>/ 5</em></b><div class="d">응답 ${agg.n}명${rate !== null ? ` · 응답률 ${rate}%` : ""}</div></div>
        <div class="kpi"><small>역량 자가진단</small><b>${f1(agg.pre)}→${f1(agg.post)}</b><div class="d">+${f1(agg.delta)} · 오른 응답 ${agg.improved}%</div></div>
        <div class="kpi"><small>추천 지수(NPS)</small><b>${agg.nps > 0 ? "+" : ""}${agg.nps}</b><div class="d">−100 ~ +100</div></div>
      </div>
      <div class="blk"><h3>문항별 평균 <span class="n">5점 만점 · 4.0 미만은 주황</span></h3><div class="bars">${agg.byQ.map((q) => `<div class="b${q.avg < 4 ? " low" : ""}"><span>${esc(q.label)}</span><span class="t"><i style="width:${(q.avg / 5) * 100}%"></i></span><span class="v">${f1(q.avg)}</span></div>`).join("")}</div></div>
      ${st.dept === "all" ? `<div class="blk"><h3>부서별 <span class="n">응답 ${L.MIN_GROUP}명 이상만</span></h3>${agg.groups.list.length ? `<table class="grp"><thead><tr><th>부서</th><th class="num">응답</th><th class="num">만족도</th><th class="num">역량 변화</th></tr></thead><tbody>${agg.groups.list.map((g) => `<tr${g.merged ? ` class="merged"` : ""}><td>${esc(g.dept)}</td><td class="num">${g.n}명</td><td class="num">${f1(g.overall)}</td><td class="num">+${f1(g.delta)}</td></tr>`).join("")}</tbody></table>` : ""}${agg.groups.hidden ? `<p class="hint">5명 미만이라 합쳐도 짐작될 수 있는 ${agg.groups.hidden}명은 부서 표에서 뺐어요(전체 집계에는 들어 있어요).</p>` : ""}</div>` : ""}
      <div class="blk sum">
        <p class="headline full">${esc(sum.headline)}</p>
        <div class="card good"><h4>잘된 점</h4><ul>${sum.strengths.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>—</li>"}</ul></div>
        <div class="card fix"><h4>보완할 점</h4><ul>${sum.improvements.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>—</li>"}</ul></div>
        <div class="card full"><h4>다음 단계 제안</h4><ul>${sum.nextSteps.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>—</li>"}</ul></div>
      </div>
      <div class="blk"><h3>의견 주제 <span class="n">의견 ${comments.length}건</span></h3><div class="themes">${sum.themes.map((t) => `<span>${esc(t.theme)}<b>${t.count}</b></span>`).join("") || `<span>주제를 찾지 못했어요</span>`}</div></div>
      <div class="blk"><h3>익명 의견 <span class="n">이름·연락처는 가리고 순서를 섞었어요</span></h3>
        <ul class="voices">${voices.map((c) => `<li>${markMask(c.text)}</li>`).join("")}</ul>
        ${comments.length > 5 ? `<button class="more" id="more" type="button" aria-expanded="${showAll}">${showAll ? "접기" : `의견 ${comments.length - 5}건 더 보기`}</button>` : ""}
      </div>`;
    // 마지막 검사: 화면에 그린 리포트 글자 전체에서 응답자 이름을 찾는다
    const leaks = L.leakCheck(p.textContent, R.names);
    const safe = $("safe");
    safe.textContent = leaks.length ? `이름 ${leaks.length}건 남음 — 보내기 전 확인` : "이름 노출 0건";
    safe.classList.toggle("bad", !!leaks.length);
    R.leaks = leaks.length;
    if ($("more")) $("more").onclick = () => { showAll = !showAll; renderPaper(); };
  }

  /* ---------- 실행 ---------- */
  async function run(opts) {
    const my = ++runToken;
    st.csv = $("csv").value; st.total = $("total").value; st.ran = true;
    const parsed = L.parseCsv(st.csv);
    $("errs").hidden = !parsed.errors.length;
    $("errs").innerHTML = parsed.errors.slice(0, 5).map((e) => `<li>${esc(e)}</li>`).join("") + (parsed.errors.length > 5 ? `<li>외 ${parsed.errors.length - 5}건</li>` : "");
    renderTable(parsed.rows); renderDeptFilter(parsed.rows);
    const rows = st.dept === "all" ? parsed.rows : parsed.rows.filter((r) => r.dept === st.dept);
    const names = parsed.rows.map((r) => r.name);
    const an = L.anonymize(rows);
    const agg = L.aggregate(rows);
    R = { rows, names, agg, comments: an.comments, masked: an.masked, sum: L.ruleSummary(agg, an.comments) };
    ai = { mode: "rule", reason: "" };
    const noAi = opts && opts.noAi;
    waiting = !!agg.n && !noAi && AI.status().enabled !== false;
    save(); renderPaper();
    if (!agg.n || noAi) return;

    const r = await AI.ask(TASK, L.buildAiInput(meta(), agg, an.comments));
    if (my !== runToken) return; // 그 사이 다시 만들었으면 버린다
    waiting = false;
    const n = r && L.normalizeSummary(r.data, names);
    if (n) { R.sum = n; ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderPaper();
    if (!(opts && opts.quiet)) toast(`${ai.mode === "ai" ? "Claude가" : "규칙으로"} 응답 ${agg.n}명 리포트를 만들었어요`);
  }

  /* ---------- 버튼 ---------- */
  $("run").addEventListener("click", () => { setView("table"); run(); });
  $("viewTable").addEventListener("click", () => { setView("table"); run(); });
  $("viewCsv").addEventListener("click", () => setView("csv"));
  $("csv").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { setView("table"); run(); } });
  $("total").addEventListener("change", () => run());
  $("dept").addEventListener("change", (e) => { st.dept = e.target.value; showAll = false; run(); });
  document.querySelectorAll("[data-course]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.course === st.course) return;
    const before = { ...st };
    st = seed(b.dataset.course); $("csv").value = st.csv; $("total").value = st.total; showAll = false;
    renderSamples(); setView("table"); run();
    toast(`${COURSES[st.course].course} 설문으로 바꿨어요`, () => { st = before; $("csv").value = st.csv; $("total").value = st.total; renderSamples(); setView(st.view); run(); });
  }));
  $("copy").addEventListener("click", async () => {
    if (!R || !R.agg.n) return toast("리포트를 먼저 만들어 주세요");
    const txt = L.reportText(meta(), R.agg, R.sum);
    if (L.leakCheck(txt, R.names).length) return toast("보고 문구에 이름이 남아 있어 복사하지 않았어요");
    $("mdOut").textContent = txt; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(txt); toast("보고 문구를 복사했어요. 메일·메신저에 붙여 넣으세요"); }
    catch (e) { $("mdBox").open = true; toast("복사 권한이 없어 아래에 펼쳐 두었어요"); }
  });
  $("print").addEventListener("click", () => { if (R && R.leaks) return toast("이름이 남아 있어 인쇄하지 않았어요"); window.print(); });
  $("reset").addEventListener("click", () => {
    const before = { ...st };
    st = seed("a"); $("csv").value = st.csv; $("total").value = st.total; showAll = false;
    renderSamples(); setView("table"); run();
    toast("샘플 설문으로 되돌렸어요", () => { st = before; $("csv").value = st.csv; $("total").value = st.total; renderSamples(); setView(st.view); run(); });
  });

  /* ---------- 시작 ---------- */
  $("csv").value = st.csv; $("total").value = st.total;
  renderSamples(); setView(st.view === "csv" ? "csv" : "table");
  run({ noAi: true }); // 규칙 결과를 바로 보여 주고
  AI.probe().then(() => run({ quiet: true })); // AI 상태를 확인한 뒤 다시 정리한다
})();
