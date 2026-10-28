/* 빠짐없이 — 화면 (DOM 다루기만 한다. 묶기·요약·소수 의견 지키기는 logic.js, AI 호출은 ai-client.js)
 *
 * '요약하기'를 누르면
 *   1) 규칙으로 의견 묶음을 바로 만들고 (기준 이상은 모두 '주요 의견', 그 아래는 '기타 의견')
 *   2) 가린 응답을 Claude 에게 보내 묶음과 요약 문장을 다시 받는다.
 *      Claude 가 기준 이상 의견을 빠뜨리면 규칙 묶음을 되살리고 노란색으로 표시한다.
 * 검수표에서 묶음마다 원문을 확인하고 체크한다. 개선 항목은 '다음 교육 반영'으로 고른다.
 */
(function () {
  "use strict";
  const L = window.Ppajim;
  const STORE_KEY = "ax-survey-summary-v1";
  const OLD_TOP_N = 5; // 예전 요약처럼 많은 순 5개만 남겼다면
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 샘플: 가상의 회사 온결물산 'AI 활용 실무 과정 3기' 만족도 응답 36건 ---------- */
  const SAMPLE = `점수\t의견
5\t강사님 설명이 쉽고 명확해서 좋았습니다. 다만 실습 시간이 너무 짧았어요.
4\t실습을 따라 하다 보면 다음 내용으로 넘어가 있어서 아쉬웠습니다.
5\t우리 팀 업무에 바로 쓸 수 있는 예제라서 유익했어요.
4\t진행 속도가 조금 빨라서 중간에 놓쳤습니다.
5\t질문에 답을 끝까지 해 주셔서 감사했습니다.
3\t실습 시간이 부족했어요. 직접 해 볼 시간이 더 있었으면 좋겠습니다.
4\t엑셀 보고서 자동화 예제가 실무에 도움이 많이 됐습니다.
3\t교육장 모니터가 작아서 뒤쪽에서는 화면 글씨가 잘 안 보였어요.
4\t금요일 오후라 집중이 잘 안 됐습니다. 오전 시간대면 좋겠어요.
5\t설명이 친절하고 이해가 잘 됐습니다.
4\t실습이 짧아서 집에서 다시 해 봐야 할 것 같아요. 교안을 미리 주시면 좋겠습니다.
2\t속도가 빨라서 따라가기 힘들었습니다. 실습도 부족했고요.
5\t사례 중심이라 재미있었고 바로 써 볼 생각입니다.
4\t강사님 강의력 최고입니다.
3\t녹화본이 있으면 복습할 때 좋을 것 같아요.
4\t뒷자리라 모니터 화면이 잘 안 보였습니다.
5\t실무 예제가 많아서 만족합니다.
3\t진도가 빠르고 실습 시간이 짧았어요.
4\t쉬는 시간이 없어서 오후에 조금 힘들었어요.
5\t설명을 쉽게 해 주셔서 처음 하는 사람도 따라갈 수 있었어요.
4\t자료를 나중에 다시 볼 수 있게 공유해 주세요.
3\t금요일 오후 교육은 퇴근 전이라 마음이 급했습니다.
4\t예제가 우리 업무에 맞아서 좋았습니다. 다만 실습 시간을 늘려 주세요.
5\t특별히 없습니다. 수고하셨습니다.
4\t진행이 빨랐어요. 천천히 한 번 더 짚어 주시면 좋겠습니다.
5\t강사님 설명이 명확했습니다.
3\t교육장 의자가 불편하고 모니터가 작았어요.
4\t조별로 옆 사람과 같이 해 보는 시간이 재미있었습니다.
4\t실습 시간이 짧아 끝까지 못 만들었어요.
5\t업무에 바로 써먹을 수 있는 사례가 좋았습니다.
3\t교안 파일을 받을 수 있으면 010-2345-6789로 연락 부탁드립니다.
4\t오후 시간대라 졸렸어요. 일정 조정이 필요해 보입니다.
4\t쉬는 시간이 조금 더 있었으면 합니다.
5\t설명이 친절하고 질문에 답을 잘 해 주셨어요.
4\t속도가 빨라서 메모할 틈이 없었습니다.
4\t전반적으로 만족합니다.`;

  function seed() {
    return { src: SAMPLE, course: "AI 활용 실무 과정 3기", minCount: 3, mode: "list", review: { checked: {}, adopt: {} } };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && typeof v.src === "string" && v.review && v.review.checked && v.review.adopt) return Object.assign(seed(), v);
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  let st = load();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };

  let responses = [];
  let sum = null;      // 지금 보여 주는 요약
  let rule = null;     // 규칙 요약 (비교용)
  let ai = { mode: "rule", reason: "" };
  let waiting = false;
  let token = 0;
  let filter = null;   // { label, ids }

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
  AI.onChange((s) => {
    const el = $("aiState");
    if (s.enabled === null) { el.dataset.on = "wait"; el.lastElementChild.textContent = "AI 연결 확인 중"; return; }
    el.dataset.on = s.enabled ? "on" : "off";
    el.lastElementChild.textContent = s.enabled ? "Claude 연결됨" : `규칙 모드 · ${s.reason || "AI 꺼짐"}`;
  });

  /* ---------- 위: 점수 ---------- */
  function renderStat() {
    const s = L.scoreStats(responses);
    const max = Math.max(1, ...s.dist);
    $("stat").innerHTML = `<div><b>${s.n}</b>응답</div><div><b>${s.avg || "-"}</b>평균 점수</div>
      <div><div class="dist" role="img" aria-label="점수 분포 ${s.dist.map((n, i) => `${i + 1}점 ${n}명`).join(", ")}">${s.dist.map((n) => `<span class="${n === max ? "hi" : ""}" style="height:${Math.max(2, Math.round((n / max) * 34))}px"></span>`).join("")}</div>
      <div class="dist-l" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<i>${n}</i>`).join("")}</div></div>`;
    $("nResp").textContent = `${s.n}건`;
  }

  /* ---------- 왼쪽: 응답 원문 ---------- */
  function renderList() {
    const list = filter ? responses.filter((r) => filter.ids.includes(r.id)) : responses;
    $("filterOn").hidden = !filter;
    if (filter) $("filterOn").innerHTML = `‘${esc(filter.label)}’ 원문 ${list.length}건만 보는 중<button type="button" id="clearFilter">전체 보기</button>`;
    $("list").innerHTML = list.map((r) => {
      const tags = L.tagResponse(r.text);
      return `<li class="${filter ? "lit" : ""}"><span class="sc s${r.score || 0}" aria-label="${r.score ? `${r.score}점` : "점수 없음"}">${r.score || "–"}</span>
        <div>${esc(r.text)}<div class="tags">${tags.map((t) => `<span class="tag ${t.tone}">${esc(L.labelOf(t.topic))} · ${t.tone}</span>`).join("") || `<span class="tag none">분류 안 됨</span>`}</div></div></li>`;
    }).join("") || `<li><span></span><span>응답이 없어요. '붙여 넣기'에서 넣어 주세요.</span></li>`;
  }
  $("filterOn").addEventListener("click", (e) => { if (e.target.id === "clearFilter") { filter = null; renderList(); renderOut(); } });

  function setMode(m) {
    st.mode = m;
    $("list").hidden = m !== "list";
    $("src").hidden = m !== "edit";
    $("modeList").setAttribute("aria-pressed", String(m === "list"));
    $("modeEdit").setAttribute("aria-pressed", String(m === "edit"));
    if (m === "edit") { filter = null; $("filterOn").hidden = true; $("src").focus(); }
    save();
  }

  /* ---------- 오른쪽: 요약 · 검수표 ---------- */
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 읽는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 주제 사전으로 묶었어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function guardNote() {
    const mc = st.minCount;
    if (ai.mode === "ai") {
      return sum.restored
        ? `<div class="callout"><b>Claude 요약에서 빠진 ${mc}명 이상 의견 ${sum.restored}개를 되살렸어요.</b> 노란 줄이 되살린 의견입니다.</div>`
        : `<div class="callout ok"><b>${mc}명 이상 나온 의견이 모두 Claude 요약에 들어 있어요.</b></div>`;
    }
    const lost = L.droppedByTopN(rule.themes, mc, OLD_TOP_N);
    return lost.length
      ? `<div class="callout">많은 순 ${OLD_TOP_N}개만 남겼다면 <b>${lost.map((g) => `${esc(g.label)}(${g.count}명)`).join(", ")}</b>이 빠졌을 거예요. 기준(${mc}명 이상)으로 모두 남겼습니다.</div>`
      : `<div class="callout ok"><b>${mc}명 이상 나온 의견 ${sum.themes.length}개를 모두 남겼어요.</b></div>`;
  }
  function renderOut() {
    if (!sum) return;
    const max = Math.max(1, ...sum.themes.map((t) => t.count));
    const reviewed = sum.themes.filter((t) => st.review.checked[L.key(t)]).length;
    const adopted = sum.improvements.filter((x) => st.review.adopt[x]).length;
    const isOn = (ids) => filter && filter.ids.join() === ids.join();
    $("out").innerHTML = `
      <div class="pane-h"><h2>${esc(st.course || "교육")} 요약</h2>${modeChip()}</div>
      <div class="${waiting ? "waiting" : ""}">
      <ol class="lines">${sum.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
      ${guardNote()}
      <h3 class="sub">주요 의견 · 검수표 <span class="n">검수 ${reviewed}/${sum.themes.length}</span></h3>
      <table class="check">
        <thead><tr><th>의견</th><th class="cnt">인원</th><th class="ok-c">검수</th></tr></thead>
        <tbody>${sum.themes.map((t, i) => {
          const k = L.key(t), done = !!st.review.checked[k];
          return `<tr class="${t.restored ? "restored" : ""}${done ? " done" : ""}">
            <td><span class="tl"><span class="tone ${t.tone}">${t.tone}</span>${esc(t.label)}${t.restored ? `<span class="rest">되살림</span>` : ""}</span>
              ${t.summary ? `<span class="sm">${esc(t.summary)}</span>` : ""}
              <button type="button" class="src-btn" data-ids="${t.ids.join(",")}" data-label="${esc(t.label)} · ${t.tone}" aria-pressed="${isOn(t.ids)}">원문 ${t.count}건 보기</button></td>
            <td class="cnt"><span class="bar-n ${t.tone}" style="width:${Math.round((t.count / max) * 44)}px"></span>${t.count}명</td>
            <td class="ok-c"><input type="checkbox" data-check="${esc(k)}" ${done ? "checked" : ""} aria-label="${esc(t.label)} ${t.tone} 원문 확인함"></td>
          </tr>`;
        }).join("") || `<tr><td colspan="3">기준 이상 나온 의견이 없어요.</td></tr>`}</tbody>
      </table>
      ${sum.minor.length || sum.unclassified.length ? `<details class="minor"><summary>기타 의견 ${sum.minor.length}개 · 분류 안 된 응답 ${sum.unclassified.length}건 (지우지 않고 모아 둠)</summary><ul>
        ${sum.minor.map((t) => `<li><span class="tone ${t.tone}">${t.tone}</span>${esc(t.label)} ${t.count}명 <button type="button" class="src-btn" data-ids="${t.ids.join(",")}" data-label="${esc(t.label)} · ${t.tone}">원문</button></li>`).join("")}
        ${sum.unclassified.length ? `<li>분류 안 됨 ${sum.unclassified.length}건 <button type="button" class="src-btn" data-ids="${sum.unclassified.join(",")}" data-label="분류 안 됨">직접 읽기</button></li>` : ""}
      </ul></details>` : ""}
      <h3 class="sub">다음 교육 개선 항목 <span class="goalbar">반영 <b>${adopted}</b> / 목표 3건</span></h3>
      <ul class="imp">${sum.improvements.map((x) => `<li><label><input type="checkbox" data-adopt="${esc(x)}" ${st.review.adopt[x] ? "checked" : ""}>${esc(x)}</label></li>`).join("") || "<li>아쉬움 의견이 기준 이상 나오지 않았어요.</li>"}</ul>
      </div>
      <div class="out-foot">
        <button type="button" class="dark" id="copy">보고서 복사</button>
        <button type="button" class="ghost-btn" id="clearReview">검수 표시 지우기</button>
      </div>
      <details class="md" id="reportBox" hidden><summary>복사한 보고서 보기</summary><pre id="reportOut"></pre></details>
      <p class="priv">응답 속 전화번호·메일·사번은 화면과 AI에 보내기 전에 가립니다. 요약은 응답을 줄인 것이며, 원문 확인(검수)은 담당자가 합니다.</p>`;
  }

  $("out").addEventListener("click", async (e) => {
    const sb = e.target.closest("button.src-btn");
    if (sb) {
      const ids = sb.dataset.ids.split(",").map(Number);
      filter = filter && filter.ids.join() === ids.join() ? null : { label: sb.dataset.label, ids };
      if (st.mode !== "list") setMode("list");
      renderList(); renderOut();
      if (filter && matchMedia("(max-width: 900px)").matches) $("list").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (e.target.id === "copy") {
      const text = L.toReport(st.course, L.scoreStats(responses), sum, st.review, st.minCount);
      $("reportOut").textContent = text; $("reportBox").hidden = false;
      const left = sum.themes.filter((t) => !st.review.checked[L.key(t)]).length;
      try { await navigator.clipboard.writeText(text); toast(left ? `복사했어요. 검수하지 않은 의견 ${left}개는 '미검수'로 표시돼요` : "보고서를 복사했어요"); }
      catch (err) { $("reportBox").open = true; toast("아래 보고서를 직접 복사해 주세요"); }
      return;
    }
    if (e.target.id === "clearReview") {
      const before = JSON.parse(JSON.stringify(st.review));
      st.review.checked = {}; save(); renderOut();
      toast("검수 표시를 지웠어요", () => { st.review = before; save(); renderOut(); });
    }
  });
  $("out").addEventListener("change", (e) => {
    const c = e.target.closest("input[data-check]");
    if (c) { if (c.checked) st.review.checked[c.dataset.check] = true; else delete st.review.checked[c.dataset.check]; save(); renderOut(); $("out").querySelector(`input[data-check="${CSS.escape(c.dataset.check)}"]`)?.focus(); return; }
    const a = e.target.closest("input[data-adopt]");
    if (a) {
      if (a.checked) st.review.adopt[a.dataset.adopt] = true; else delete st.review.adopt[a.dataset.adopt];
      save(); renderOut(); $("out").querySelector(`input[data-adopt="${CSS.escape(a.dataset.adopt)}"]`)?.focus();
      const n = sum.improvements.filter((x) => st.review.adopt[x]).length;
      if (a.checked && n === 3) toast("개선 3건을 다음 교육에 반영해요 (목표치 도달)");
    }
  });

  /* ---------- 요약하기 ---------- */
  async function run(quiet) {
    st.src = $("src").value;
    responses = L.parseResponses(st.src);
    rule = L.ruleSummary(responses, st.minCount);
    sum = { ...rule, restored: 0 };
    ai = { mode: "rule", reason: "" };
    const my = ++token;
    waiting = responses.length > 0 && AI.status().enabled !== false;
    filter = null;
    save(); renderStat(); renderList(); renderOut();
    if (!responses.length) { waiting = false; renderOut(); toast("응답을 먼저 붙여 넣어 주세요"); return; }
    const r = await AI.ask("survey.summary", L.aiInput(st.course, responses, st.minCount));
    if (my !== token) return; // 그 사이 다시 눌렀으면 버린다
    waiting = false;
    const n = r && L.normalizeSummary(r.data, responses);
    if (n) { sum = L.ensureKept(n, rule, responses, st.minCount); ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않음" : (AI.status().reason || "") };
    renderOut();
    if (!quiet) toast(`${responses.length}건 → 주요 의견 ${sum.themes.length}개 · 기타 ${sum.minor.length}개`);
  }

  $("run").addEventListener("click", () => { setMode("list"); run(); });
  $("modeList").addEventListener("click", () => { if ($("src").value !== st.src) { setMode("list"); run(); } else setMode("list"); });
  $("modeEdit").addEventListener("click", () => setMode("edit"));
  $("src").addEventListener("input", () => { $("srcInfo").textContent = `${$("src").value.split(/\n/).filter((l) => l.trim()).length}줄 · 고친 뒤 '요약하기'`; });
  $("src").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { setMode("list"); run(); } });
  $("course").addEventListener("change", (e) => { st.course = e.target.value.trim() || "교육"; save(); renderOut(); });
  $("minCount").addEventListener("change", (e) => {
    const before = st.minCount;
    st.minCount = Number(e.target.value);
    run(true).then(() => toast(`${st.minCount}명 이상 의견은 요약에 반드시 남겨요`, () => { st.minCount = before; $("minCount").value = String(before); run(true); }));
  });
  $("reset").addEventListener("click", () => {
    const before = JSON.parse(JSON.stringify(st));
    st = seed();
    $("src").value = st.src; $("course").value = st.course; $("minCount").value = String(st.minCount); setMode("list");
    run(true);
    toast("샘플 응답으로 되돌렸어요", () => { st = before; $("src").value = st.src; $("course").value = st.course; $("minCount").value = String(st.minCount); setMode(st.mode); run(true); });
  });

  /* ---------- 시작 ---------- */
  $("src").value = st.src;
  $("course").value = st.course;
  $("minCount").value = String(st.minCount);
  setMode(st.mode);
  responses = L.parseResponses(st.src);
  rule = L.ruleSummary(responses, st.minCount);
  sum = { ...rule, restored: 0 };
  renderStat(); renderList(); renderOut();
  AI.probe().then(() => run(true));
})();
