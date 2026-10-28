/* 이수함 — 화면 (DOM 다루기만 한다. 합치기·집계·검산·내보내기는 logic.js, AI 호출은 ai-client.js)
 *
 * '사번 기준으로 취합'을 누르면
 *   1) 신청 목록과 출석 기록을 사번으로 합쳐 이수 현황 표와 규칙 보고 문장을 바로 보여 주고
 *   2) 집계 숫자(이름·사번 없음)를 Claude 에게 보내 보고 문장을 다시 쓴다.
 *      문장 속 숫자가 입력에 없는 값이면 버리고 규칙 문장을 그대로 둔다.
 * '확인 필요'(사번 없는 출석 + 동명이인)는 사람이 직접 고른다. 자동으로 합치지 않는다.
 */
(function () {
  "use strict";
  const L = window.Isuham;
  const STORE_KEY = "ax-training-attend-v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MARK = { O: ["○", "출석"], L: ["△", "지각"], "": ["·", "결석"] };

  /* ---------- 샘플 (가상의 회사 온결물산) ---------- */
  const SAMPLE_APP = `사번,이름,부서
M19022,김민준,영업1팀
M23107,김민준,재무팀
M20311,이서윤,인사팀
M21045,박지호,영업1팀
M22118,최유진,마케팅팀
M18007,정하은,재무팀
M24003,강도윤,개발팀
M21290,윤서현,개발팀
M20876,장민서,마케팅팀
M23344,임지우,영업2팀
M19560,한예준,영업2팀
M22401,오수아,인사팀
M24112,서지안,개발팀
M21733,신하준,재무팀
M20098,권나연,마케팅팀
M23520,황시우,영업1팀
M22967,송채원,영업2팀
M21045,박지호,영업1팀`;
  const SAMPLE_ATT = `회차,사번,이름,입실
1,M19022,김민준,13:58
1,M23107,김민준,13:53
1,M20311,이서윤,13:48
1,M21045,박지호,13:55
1,M22118,최유진,13:50
1,M18007,정하운,13:57
1,M24003,강도윤,13:52
1,M21290,윤서현,13:59
1,M20876,장민서,13:54
1,M23344,임지우,13:49
1,M19560,한예준,13:56
1,M22401,오수아,13:51
1,M21733,신하준,13:58
1,M20098,권나연,13:53
1,M23520,황시우,14:22
1,M22967,송채원,13:55
2,M19022,김민준,13:49
2,M23107,김민준,13:56
2,M20311,이서윤,13:51
2,m21-045,박지호,13:58
2,M22118,최유진,13:53
2,M22118,최유진,13:58
2,M18007,정하은,13:48
2,M24003,강도윤,14:16
2,M21290,윤서현,13:50
2,M22401,오수아,13:57
2,M24112,서지안,13:52
2,M21733,신하준,13:59
2,M20098,권나연,13:54
2,M23520,황시우,13:49
2,M22967,송채원,13:56
3,M19022,김민준,13:52
3,,이서윤,13:59
3,M21045,박지호,13:54
3,M22118,최유진,13:49
3,M18007,정하은,13:56
3,M21290,윤서현,13:51
3,M20876,장민서,14:13
3,M23344,임지우,13:53
3,M22401,오수아,13:48
3,M24112,서지안,13:55
3,M21733,신하준,13:50
3,M20098,권나연,13:57
3,M22050,박도현,13:53
4,M19022,김민준,13:55
4,M20311,이서윤,13:50
4,M21045,박지호,13:57
4,M22118,최유진,14:11
4,M18007,정하은,13:59
4,M24003,강도윤,13:54
4,M21290,윤서현,13:49
4,M20876,장민서,13:56
4,M22401,오수아,13:51
4,M24112,서지안,13:58
4,M20098,권나연,13:53
4,M23520,황시우,13:48
4,M22050,박도현,13:54
4,,김민준,14:02`;
  const TIPS = {
    app: "신청 폼 응답 시트에서 사번·이름·부서 세 칸을 복사해 붙여 넣으세요. 같은 사번이 두 번 있으면 한 명으로 셉니다.",
    att: "QR 출석 시트의 회차·사번·이름·입실 시각을 붙여 넣으세요. 사번이 빈 줄은 이름으로 찾되, 같은 이름이 둘 이상이면 '확인 필요'로 남깁니다.",
  };

  function seed() {
    return { app: SAMPLE_APP, att: SAMPLE_ATT, tab: "app", course: "AI 활용 실무 과정", sessions: 4, passRate: 75, start: "14:00", links: {}, filter: "all" };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.app === "string" && typeof v.att === "string" && v.links && typeof v.links === "object") return Object.assign(seed(), v);
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };

  // 계산 결과 (저장하지 않는다)
  let res = null;     // { apps, att, m, s, report, byName }
  let ai = { mode: "rule", reason: "" };
  let waiting = false;
  let token = 0;

  /* ---------- 공통 ---------- */
  let toastTimer;
  function toast(msg, undo) {
    $("toastMsg").textContent = msg;
    $("toastUndo").hidden = !undo;
    $("toastUndo").onclick = () => { undo(); $("toast").classList.remove("on"); };
    $("toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2600);
  }
  async function copy(text, box, out) {
    out.textContent = text; box.hidden = false;
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { box.open = true; return false; }
  }

  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 원본 ---------- */
  const src = $("src");
  function setTab(t) {
    st[st.tab] = src.value;
    st.tab = t;
    src.value = st[t];
    $("tabApp").setAttribute("aria-selected", String(t === "app"));
    $("tabAtt").setAttribute("aria-selected", String(t === "att"));
    $("tip").textContent = TIPS[t];
    countRows(); save();
  }
  function countRows() {
    const cur = { ...st, [st.tab]: src.value };
    $("nApp").textContent = L.rows(cur.app).length;
    $("nAtt").textContent = L.rows(cur.att).length;
  }

  /* ---------- 취합 ---------- */
  function compute() {
    st[st.tab] = src.value;
    const apps = L.parseApplicants(st.app);
    const att = L.parseAttendance(st.att, st.sessions);
    const m = L.merge(apps.list, att.list, { sessions: st.sessions, passRate: st.passRate, start: st.start, links: st.links });
    const s = L.stats(m);
    res = { apps, att, m, s, report: L.ruleReport(st.course, s), byName: L.countByName(apps.list) };
  }
  async function run(quiet) {
    compute();
    const my = ++token;
    ai = { mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    save(); renderOut(); renderRoster();
    const input = L.aiInput(st.course, res.s);
    const r = await AI.ask("trainattend.report", input);
    if (my !== token) return; // 그 사이 다시 취합했으면 버린다
    waiting = false;
    const n = r && L.normalizeReport(r.data, input);
    if (n) { res.report = n; ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답 숫자가 집계와 다름" : (AI.status().reason || "") };
    renderOut();
    if (!quiet) toast(`${res.s.applied}명 취합 · 이수 ${res.s.pass}명 · 확인 필요 ${res.s.unresolved}건`);
  }

  /* ---------- 결과 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 문장 쓰는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 정해진 문장 틀로 썼어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function renderOut() {
    if (!res) return;
    const { s, m, apps, att, byName } = res;
    const errs = [...apps.errors.map((e) => `신청 ${e.line}줄: ${e.why}`), ...att.errors.map((e) => `출석 ${e.line}줄: ${e.why}`)];
    $("out").innerHTML = `
      <div class="out-h"><h2>${esc(st.course || "교육")} · ${st.sessions}회</h2><span class="mode" data-mode="rule">${s.passPct}% 이수</span></div>
      <div class="kpis">
        <div class="kpi"><b>${s.applied}</b><span>신청 (중복 ${apps.dupes} 합침)</span></div>
        <div class="kpi ok"><b>${s.pass}</b><span>이수</span></div>
        <div class="kpi bad"><b>${s.fail}</b><span>미이수</span></div>
        <div class="kpi warn"><b>${s.unresolved}</b><span>확인 필요</span></div>
      </div>
      ${m.homonyms.length ? `<div class="callout same">동명이인 <b>${m.homonyms.map((h) => `${esc(h.name)} ${h.ids.length}명`).join(", ")}</b>을 사번으로 나눠 셌어요. 이름으로 합쳤다면 신청자를 <b>${byName}명</b>으로 셌을 것을 사번으로 <b>${s.applied}명</b>으로 셌습니다.</div>` : ""}
      ${m.unresolved.length ? `<div class="callout need"><b>확인 필요 ${m.unresolved.length}건 — 자동으로 합치지 않았어요</b>
        ${m.unresolved.map((u) => `<div class="fix"><span class="what">${u.session}회차 · ${esc(u.name || "이름 없음")} · ${esc(u.time)} · 사번 없음${u.candidates.length ? ` (같은 이름 ${u.candidates.length}명)` : " (신청자 중 없음)"}</span>
          ${u.candidates.length ? `<label class="sr" for="pick-${u.key}">${u.session}회차 ${esc(u.name)} 연결할 사람</label><select id="pick-${u.key}" data-key="${u.key}">${u.candidates.map((c) => `<option value="${esc(c.id)}">${esc(c.dept)} · ${esc(L.maskId(c.id))}${c.already ? " (이 회차 이미 출석)" : ""}</option>`).join("")}</select>
          <button type="button" class="ghost-btn sm" data-link="${u.key}">이 사람으로 연결</button>` : ""}</div>`).join("")}
      </div>` : ""}
      ${errs.length ? `<div class="callout need"><b>읽지 못한 줄 ${errs.length}개</b>${errs.slice(0, 4).map(esc).join("<br>")}</div>` : ""}
      <div class="report${waiting ? " waiting" : ""}">
        <h3>결과 보고 ${modeChip()}</h3>
        <ol>${res.report.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
        ${res.report.followups.length ? `<ul class="follow" aria-label="후속 조치">${res.report.followups.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        <p class="priv">AI에는 이름·사번 없이 집계 숫자만 보냅니다. Claude 문장에 집계에 없는 숫자가 있으면 버리고 규칙 문장을 씁니다.</p>
        <button type="button" class="ghost-btn" id="copyReport">보고 문장 복사</button>
        ${Object.keys(st.links).length ? `<button type="button" class="link-btn" id="unlink">직접 연결 ${Object.keys(st.links).length}건 풀기</button>` : ""}
      </div>`;
  }

  $("out").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-link]");
    if (b) {
      const key = b.dataset.link;
      const id = document.querySelector(`select[data-key="${key}"]`).value;
      const before = { ...st.links };
      st.links[key] = id;
      await run(true);
      toast("출석 1건을 연결했어요", () => { st.links = before; run(true); });
      return;
    }
    if (e.target.id === "unlink") {
      const before = { ...st.links };
      st.links = {};
      await run(true);
      toast("직접 연결을 모두 풀었어요", () => { st.links = before; run(true); });
      return;
    }
    if (e.target.id === "copyReport") {
      const text = res.report.lines.join("\n") + (res.report.followups.length ? `\n\n후속 조치\n${res.report.followups.map((f) => `- ${f}`).join("\n")}` : "");
      try { await navigator.clipboard.writeText(text); toast("보고 문장을 복사했어요"); } catch (err) { toast("복사할 수 없는 환경이에요. 문장을 직접 선택해 주세요"); }
    }
  });

  /* ---------- 이수 현황 표 ---------- */
  function renderRoster() {
    if (!res) return;
    const { m } = res;
    const homo = new Set(m.homonyms.map((h) => h.name));
    const list = m.roster.filter((p) => st.filter === "all" || (st.filter === "fail" ? p.applied && !p.pass : p.flags.length));
    document.querySelectorAll("#filter button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === st.filter)));
    const head = `<thead><tr><th class="dept">부서</th><th>이름</th><th class="id">사번</th>${Array.from({ length: m.sessions }, (_, i) => `<th class="c">${i + 1}회</th>`).join("")}<th>출석률</th><th>이수</th><th>확인 사항</th></tr></thead>`;
    const body = list.map((p) => `<tr class="${p.flags.length ? "hit" : ""}">
        <td class="dept">${esc(p.dept)}</td>
        <td class="nm">${esc(p.name)}${homo.has(p.name) ? `<span class="homo" title="같은 이름이 있어요. 사번으로 구분했어요">동명</span>` : ""}<span class="dp">${esc(p.dept)}</span></td>
        <td class="id">${esc(L.maskId(p.id))}</td>
        ${p.marks.map((x, i) => `<td class="c ${x || "X"}" aria-label="${i + 1}회 ${MARK[x][1]}">${MARK[x][0]}</td>`).join("")}
        <td class="rate"><span class="bar-mini" aria-hidden="true"><i style="width:${p.rate}%"></i></span>${p.rate}%</td>
        <td>${p.applied ? `<span class="badge ${p.pass ? "pass" : "fail"}">${p.pass ? "이수" : "미이수"}</span>` : `<span class="badge fail">신청 필요</span>`}</td>
        <td>${p.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("") || ""}</td>
      </tr>`).join("") || `<tr class="empty-row"><td colspan="${m.sessions + 6}">해당하는 사람이 없어요.</td></tr>`;
    $("roster").innerHTML = head + `<tbody>${body}</tbody>`;
  }
  $("filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    st.filter = b.dataset.f; save(); renderRoster();
  });

  /* ---------- 내보내기 ---------- */
  $("csv").addEventListener("click", () => {
    if (!res) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.toCsv(res.m)], { type: "text/csv;charset=utf-8" }));
    a.download = `이수현황-${st.sessions}회.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${res.m.roster.length}명 이수 현황을 CSV로 내려받았어요 (사번 가림)`);
  });
  $("notice").addEventListener("click", async () => {
    if (!res) return;
    const fails = res.m.roster.filter((p) => p.applied && !p.pass);
    if (!fails.length) { toast("미이수자가 없어요"); return; }
    const text = fails.map((p) => L.notice(st.course, p, st.sessions, st.passRate)).join("\n\n");
    const ok = await copy(text, $("noticeBox"), $("noticeOut"));
    toast(ok ? `미이수 ${fails.length}명 안내 문구를 복사했어요` : "아래 안내 문구를 직접 복사해 주세요");
  });

  /* ---------- 설정 · 입력 ---------- */
  function bindSettings() {
    $("course").value = st.course;
    $("sessions").value = String(st.sessions);
    $("passRate").value = String(st.passRate);
    $("start").value = st.start;
  }
  $("course").addEventListener("change", (e) => { st.course = e.target.value.trim() || "교육"; run(true); });
  $("sessions").addEventListener("change", (e) => { st.sessions = Number(e.target.value); run(); });
  $("passRate").addEventListener("change", (e) => { st.passRate = Number(e.target.value); run(); });
  $("start").addEventListener("change", (e) => { st.start = e.target.value || "14:00"; run(true); });
  $("tabApp").addEventListener("click", () => setTab("app"));
  $("tabAtt").addEventListener("click", () => setTab("att"));
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { setTab(st.tab === "app" ? "att" : "app"); $(st.tab === "app" ? "tabApp" : "tabAtt").focus(); }
  });
  src.addEventListener("input", () => { countRows(); $("srcInfo").textContent = "고친 뒤 '취합'을 누르세요"; });
  src.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
  $("run").addEventListener("click", () => { $("srcInfo").textContent = ""; run(); });
  $("reset").addEventListener("click", () => {
    const before = { ...st, links: { ...st.links } };
    st = seed();
    src.value = st.app; bindSettings(); setTab("app"); run(true);
    toast("샘플 자료로 되돌렸어요", () => { st = before; src.value = st[st.tab]; bindSettings(); setTab(st.tab); run(true); });
  });

  /* ---------- 시작 ---------- */
  src.value = st[st.tab];
  bindSettings();
  $("tabApp").setAttribute("aria-selected", String(st.tab === "app"));
  $("tabAtt").setAttribute("aria-selected", String(st.tab === "att"));
  $("tip").textContent = TIPS[st.tab];
  countRows();
  compute(); renderOut(); renderRoster();
  AI.probe().then(() => run(true));
})();
