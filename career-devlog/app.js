/* 커밋일지 — 화면 (DOM 다루기만 한다. 정책·가리기·일지 만들기는 logic.js, AI 호출은 ai-client.js)
 *
 * 주를 고르거나 설정을 바꾸면
 *   1) 규칙으로 바로 일지를 만들고 (기다리지 않게)
 *   2) '내용 포함' 저장소의 가린 줄만 Claude 에게 보내 요약을 받는다. 검사를 통과하면 덮어쓴다.
 * 비공개 저장소의 줄은 Claude 에게도, 마크다운에도 가지 않는다.
 */
(function () {
  "use strict";
  const L = window.Commitilji;
  const STORE_KEY = "career-devlog-v1";
  const AV = { 하늘: "#6A4BD6", 지민: "#0E8F65", 태오: "#D9622B", 유나: "#0B7A99" };
  const avColor = (n) => AV[n] || "#8E8AA0";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => L.iso(new Date());

  /* ---------- 샘플: 캡스톤 팀 4명의 8주 활동 (오늘 기준 날짜로 만든다) ---------- */
  const PLAN = [ // 오래된 주 → 이번 주. [하늘(화면), 지민(API), 태오(화면), 유나(문서·알고리즘)]
    ["프로젝트 초기 설정", "DB 연결 설정", "디자인 토큰 정리", "docs: 회의록 템플릿"],
    ["로그인 화면 마크업", "회원가입 API", "공통 버튼 컴포넌트", "feat: 백준 1260 DFS와 BFS 풀이"],
    ["로그인 폼 검증", "JWT 발급", "헤더·내비게이션", "docs: API 명세 정리"],
    ["출석 목록 화면", "출석 API", "모바일 메뉴", "feat: 백준 1697 숨바꼭질 풀이"],
    ["출석 체크 버튼", "출석 통계 쿼리", "다크 모드", "docs: 배포 방법 정리, 문의는 yuna.k@capstone.dev"],
    ["과제 제출 화면", "파일 업로드 API", "업로드 진행 표시", "feat: 백준 2178 미로 탐색 풀이"],
    ["과제 채점 화면", "채점 API", "접근성 점검", "docs: 중간 발표 자료"],
    ["대시보드 차트", "대시보드 집계 API", "로딩 상태 정리", "test: 출석 시나리오 테스트 작성"],
  ];
  const PRIV = [ // 하늘의 인턴 회사 저장소, 유나의 연구실 메모 — 일지에 섞이면 안 되는 것
    ["intern-dashboard", "하늘", "fix: 거래처 정산 쿼리 수정"], ["lab-notes", "유나", "docs: 교수님 면담 메모"],
    ["intern-dashboard", "하늘", "feat: 매출 리포트 필터 (토큰 ghp_Q8xY2mN4pR7sT1vW9zK3)"], ["lab-notes", "유나", "docs: 실험 데이터 정리"],
  ];
  function sampleText() {
    const t = today(), out = ["# 캡스톤 2팀 깃허브 활동 (샘플)"];
    let pr = 11, issue = 4;
    const ws = L.weeks(t, 8).reverse();
    ws.forEach((w, i) => {
      const [a, b, c, d] = PLAN[i];
      const day = (n) => L.addDays(w.start, n);
      const rows = [
        [0, "capstone-web", "하늘", `feat: ${a}`], [1, "capstone-api", "지민", `feat: ${b}`], [1, "capstone-web", "태오", `feat: ${c}`],
        [2, "capstone-api", "지민", `test: ${b} 테스트`], [2, d.includes("백준") ? "algo-study" : "capstone-web", "유나", d],
        [2, "capstone-web", "하늘", `fix: ${a} 오류 수정`], [3, "capstone-web", "하늘", `PR #${++pr} 병합: ${a}`],
        [3, "capstone-web", "태오", `이슈 #${++issue} 닫음: ${c} 깨짐`], [4, "capstone-api", "지민", `PR #${++pr} 병합: ${b}`],
        [2, PRIV[i % 4][0], PRIV[i % 4][1], PRIV[i % 4][2]],
      ];
      if (i === 7) rows.push([1, "capstone-web", "하늘", "chore: 대시보드 필터 이어서 작업 (WIP)"], [2, "secret-sandbox", "태오", "feat: 개인 실험 저장소 정리"]);
      rows.filter((r) => day(r[0]) <= t).forEach((r) => out.push(`${day(r[0])} ${r[1]} @${r[2]} ${r[3]}`));
    });
    return out.join("\n");
  }
  const REPOS = () => [
    { name: "capstone-web", private: false, policy: "full", note: "팀 프로젝트 화면" },
    { name: "capstone-api", private: false, policy: "full", note: "팀 프로젝트 서버" },
    { name: "algo-study", private: false, policy: "full", note: "알고리즘 스터디" },
    { name: "intern-dashboard", private: true, policy: "count", note: "하늘 · 인턴 회사 저장소" },
    { name: "lab-notes", private: true, policy: "off", note: "유나 · 연구실 메모" },
  ];

  /* ---------- 상태 ---------- */
  function seed() { return { src: sampleText(), repos: REPOS(), week: 0, member: "all", view: "pretty" }; }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.src === "string" && Array.isArray(v.repos)) return v;
    } catch (e) { /* 저장소를 못 쓰면 처음부터 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let parsed = L.parseActivity(st.src);
  let log = null;
  let ai = { mode: "rule", reason: "" };
  let token = 0;
  const cache = {}; // 주+설정별 Claude 결과 (같은 걸 다시 부르지 않는다)

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
  const weekList = () => L.weeks(today(), 8);
  const curWeek = () => weekList()[Math.min(st.week, 7)];

  /* ---------- 저장소 설정 ---------- */
  function renderRepos() {
    const counts = parsed.items.reduce((a, x) => ((a[x.repo] = (a[x.repo] || 0) + 1), a), {});
    const unknown = Object.keys(counts).filter((n) => !st.repos.some((r) => r.name === n));
    $("repos").innerHTML = st.repos.map((r, i) => `<li class="${r.private ? "priv" : ""}">
        <span class="nm">${esc(r.name)}<span class="badge ${r.private ? "priv" : "pub"}">${r.private ? "비공개" : "공개"}</span></span>
        <span class="meta">${esc(r.note || "")} · 8주 ${counts[r.name] || 0}건</span>
        <label class="sr" for="rp${i}">${esc(r.name)} 일지에 넣는 방식</label>
        <select id="rp${i}" data-i="${i}">
          <option value="full" ${r.private ? "disabled" : ""} ${L.policyOf(st.repos, r.name) === "full" ? "selected" : ""}>내용 포함</option>
          <option value="count" ${L.policyOf(st.repos, r.name) === "count" ? "selected" : ""}>건수만</option>
          <option value="off" ${L.policyOf(st.repos, r.name) === "off" ? "selected" : ""}>제외</option>
        </select></li>`).join("")
      + unknown.map((n) => `<li class="priv"><span class="nm">${esc(n)}<span class="badge priv">설정 없음</span></span><span class="meta">목록에 없어 자동 제외 · ${counts[n]}건</span><select disabled aria-label="${esc(n)} 자동 제외"><option>제외</option></select></li>`).join("");
  }
  $("repos").addEventListener("change", (e) => {
    const s = e.target.closest("select[data-i]"); if (!s) return;
    const r = st.repos[+s.dataset.i];
    const prev = r.policy;
    r.policy = s.value;
    save(); write();
    const lab = { full: "내용 포함", count: "건수만", off: "제외" };
    toast(`${r.name}: ${lab[s.value]}`, () => { r.policy = prev; save(); renderRepos(); write(); });
  });

  /* ---------- 주 목록 ---------- */
  function renderWeeks() {
    const ws = weekList();
    const n = ws.map((w) => L.applyPolicy(parsed.items.filter((x) => x.date >= w.start && x.date <= w.end), st.repos).shown.length);
    const max = Math.max(1, ...n);
    $("weekN").textContent = `${ws.filter((_, i) => n[i]).length}주`;
    $("weeks").innerHTML = ws.map((w, i) => `<li><button type="button" data-w="${i}" aria-current="${st.week === i}">
      <span>${i === 0 ? "이번 주" : `${L.md(w.start)} 주`}</span><span class="bar-mini" aria-hidden="true"><i style="width:${(n[i] / max) * 100}%"></i></span><small>${n[i]}건</small></button></li>`).join("");
  }
  $("weeks").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-w]"); if (!b) return;
    st.week = +b.dataset.w; save(); write();
  });

  /* ---------- 일지 ---------- */
  function modeChip() {
    if (ai.mode === "wait") return `<span class="mode" data-mode="wait"><i></i>Claude가 쓰는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 커밋 메시지를 사람별로 묶기만 했어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function markdown() { return L.toMarkdown(log, st.member); }
  function renderGuard() {
    const cnt = Object.entries(log.counted), off = Object.entries(log.off);
    const md = markdown();
    const blocked = L.blockedTerms(parsed.items, st.repos);
    const leak = L.leaks(md, blocked) || L.redact(md).hits > 0;
    const parts = [];
    if (cnt.length) parts.push(`${cnt.map(([n, c]) => `<b>${esc(n)}</b> ${c}건`).join(", ")}은 건수만`);
    if (off.length) parts.push(`${off.map(([n, c]) => `<b>${esc(n)}</b> ${c}건`).join(", ")}은 뺐어요`);
    if (log.redacted) parts.push(`메일·토큰 등 <b>${log.redacted}곳</b>을 가렸어요`);
    $("guard").innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="#9A6400"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#9A6400" stroke-width="1.6"/></svg>
      <span>${parts.length ? `이번 주 일지에서 ${parts.join(" · ")}.` : "이번 주에는 빼거나 가린 것이 없어요."} 이 화면에만 보이고 복사·내려받기에는 들어가지 않아요.
      <span class="chk${leak ? " bad" : ""}">${leak ? "내보낼 내용에 막힌 이름이 있어요" : "✓ 내보낼 내용에 비공개 저장소 이름 0곳"}</span></span>`;
  }
  function renderLog() {
    const w = log.week;
    $("range").innerHTML = `<span>${L.withDay(w.start)} ~ ${L.withDay(w.end)} · 공개 ${log.shownCount}건 / 전체 ${log.total}건</span>${modeChip()}`;
    const names = log.members.map((m) => m.name);
    if (st.member !== "all" && !names.includes(st.member)) st.member = "all";
    $("people").innerHTML = `<button type="button" class="all" data-p="all" aria-pressed="${st.member === "all"}">전체</button>` +
      names.map((n) => `<button type="button" data-p="${esc(n)}" aria-pressed="${st.member === n}"><span class="av" style="background:${avColor(n)}" aria-hidden="true">${esc(n.slice(-1))}</span>${esc(n)}</button>`).join("");
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === st.view)));
    renderGuard();
    const ms = st.member === "all" ? log.members : log.members.filter((m) => m.name === st.member);
    let h;
    if (st.view === "md") h = `<pre class="md">${esc(markdown())}</pre>`;
    else {
      const cnt = Object.values(log.counted).reduce((a, b) => a + b, 0);
      h = `<p class="headline">${esc(log.headline)}</p>
        <div class="members">${ms.map((m) => `<article class="mem"><div class="mem-h"><span class="av" style="background:${avColor(m.name)}" aria-hidden="true">${esc(m.name.slice(-1))}</span><b>${esc(m.name)}</b><span class="cnt">커밋 ${m.commit} · PR ${m.pr} · 이슈 ${m.issue}</span></div>
          <ul>${m.did.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></article>`).join("") || `<p class="mem none">공개하기로 고른 저장소에 이번 주 활동이 없어요.</p>`}</div>
        ${log.next.length ? `<div class="blk"><h3>다음 주</h3><ul>${log.next.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
        <div class="blk"><h3>저장소</h3><div class="repo-row">${log.repos.filter((r) => r.policy === "full").map((r) => `<span class="rp">${esc(r.name)} ${r.n}</span>`).join("")}${cnt ? `<span class="rp count">비공개 작업 ${cnt}건 (내용 비공개)</span>` : ""}</div></div>`;
    }
    $("out").innerHTML = h;
    $("out").classList.toggle("out-wait", ai.mode === "wait");
  }
  function renderStats() {
    const ws = weekList();
    const filled = ws.filter((w) => parsed.items.some((x) => x.date >= w.start && x.date <= w.end)).length;
    const pol = L.applyPolicy(parsed.items, st.repos);
    const hidden = Object.values(pol.counted).concat(Object.values(pol.off)).reduce((a, b) => a + b, 0);
    $("stats").innerHTML = `
      <div class="stat goal"><b>10분</b><span>회고 준비 · 목표 1시간 → 10분</span></div>
      <div class="stat"><b>${filled}주</b><span>자동으로 쌓인 일지 (목표 8주)</span></div>
      <div class="stat lock"><b>${hidden}건</b><span>8주간 일지에서 뺀 비공개 작업</span></div>
      <div class="stat"><b>${pol.redacted}곳</b><span>가린 메일·토큰</span></div>`;
  }

  /** 규칙으로 바로 쓰고, Claude 결과가 오면 덮어쓴다 */
  async function write(force) {
    const my = ++token;
    const w = curWeek();
    const rule = L.buildLog(parsed.items, w, st.repos);
    log = rule;
    const key = JSON.stringify([w.start, st.repos.map((r) => L.policyOf(st.repos, r.name)), rule.shown.map((x) => x.text)]);
    const hit = !force && cache[key];
    if (hit) { log = L.mergeSummary(rule, hit.data); ai = { mode: "ai", ms: hit.ms }; }
    else if (!rule.shown.length) ai = { mode: "rule", reason: "보낼 공개 활동 없음" };
    else ai = { mode: AI.status().enabled === false ? "rule" : "wait", reason: AI.status().reason || "" };
    renderAll();
    if (hit || !rule.shown.length) return;
    // Claude 에게는 '내용 포함' 저장소의, 가린 뒤의 줄만 보낸다
    const input = { week: `${w.start}~${w.end}`, items: rule.shown.map((x) => ({ date: x.date, repo: x.repo, author: x.author, kind: x.kind, type: x.type, ref: x.ref, text: x.text })).slice(0, 80) };
    const r = await AI.ask("devlog.summary", input);
    if (my !== token) return; // 그 사이 주나 설정을 바꿨으면 버린다
    const n = r && L.normalizeSummary(r.data, rule.members.map((m) => m.name), L.blockedTerms(parsed.items, st.repos));
    if (n) { cache[key] = { data: n, ms: r.ms }; log = L.mergeSummary(rule, n); ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답 검사에서 걸러짐" : (AI.status().reason || "") };
    renderLog();
  }

  /* ---------- 버튼 ---------- */
  $("people").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (!b) return; st.member = b.dataset.p; save(); renderLog(); });
  document.querySelector(".seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (!b) return; st.view = b.dataset.view; save(); renderLog(); });
  $("rewrite").addEventListener("click", () => { write(true); toast("이번 설정으로 다시 썼어요"); });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(markdown()); toast("마크다운을 복사했어요. 노션·깃허브 위키에 붙여 넣으세요"); }
    catch (e) { st.view = "md"; renderLog(); toast("아래 마크다운을 직접 복사해 주세요"); }
  });
  $("download").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
    a.download = `devlog-${curWeek().start}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${L.md(curWeek().start)} 주 일지를 내려받았어요`);
  });
  function reread() {
    const before = st.src;
    st.src = $("src").value;
    parsed = L.parseActivity(st.src);
    save(); write();
    toast(`${parsed.items.length}건을 읽었어요${parsed.bad.length ? ` · 형식이 틀린 줄 ${parsed.bad.length}개는 건너뜀` : ""}`, () => { st.src = $("src").value = before; parsed = L.parseActivity(st.src); save(); write(); });
  }
  $("reread").addEventListener("click", reread);
  $("src").addEventListener("input", () => { $("srcInfo").textContent = "고친 뒤 ‘다시 읽기’"; });
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); parsed = L.parseActivity(st.src); $("src").value = st.src;
    save(); write();
    toast("샘플 활동으로 되돌렸어요", () => { st = before; parsed = L.parseActivity(st.src); $("src").value = st.src; save(); write(); });
  });

  function renderAll() {
    renderStats(); renderRepos(); renderWeeks(); renderLog();
    $("srcInfo").textContent = `${parsed.items.length}건${parsed.bad.length ? ` · 형식이 틀린 줄: ${parsed.bad.slice(0, 5).join(", ")}번째` : ""}`;
  }

  /* ---------- 시작 ---------- */
  $("src").value = st.src;
  log = L.buildLog(parsed.items, curWeek(), st.repos);
  renderAll();
  AI.probe().then(() => write());
})();
