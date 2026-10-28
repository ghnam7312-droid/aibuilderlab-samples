/* 이어감 — 화면
 * 요약·가격·문구 검사는 logic.js(window.Ieogam). 이 파일은 그리기와 버튼만 맡는다.
 * 저장: localStorage("startup-training-followup-v1")
 */
(function () {
  "use strict";
  const L = window.Ieogam;
  const STORE_KEY = "startup-training-followup-v1";
  const TASK = "trainingfollowup.copy";
  const CLIENT = "누리솔루션(가상)";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 가상의 담당자 인터뷰 8건 (회사 이름 대신 업종) ---------- */
  const IVS = [
    { who: "담당자 A", org: "제조 · HRD", needs: ["report", "apply"], budget: 30000, q: "윗선은 ‘그래서 뭐가 달라졌냐’만 물어요." },
    { who: "담당자 B", org: "IT · 피플팀", needs: ["remind", "refresh"], budget: 20000, q: "교육 끝나고 2주면 다들 잊어버려요." },
    { who: "담당자 C", org: "물류 · 교육", needs: ["coach", "apply"], budget: 40000, q: "팀장이 과제를 안 챙기니 흐지부지돼요." },
    { who: "담당자 D", org: "금융 · HRD", needs: ["report"], budget: 50000, q: "‘효과 보장’ 같은 말은 오히려 결재가 안 나요. 어떻게 잴지가 중요해요." },
    { who: "담당자 E", org: "유통 · 인사", needs: ["remind", "apply"], budget: 25000, q: "매장 직원이라 짧게 자주 닿는 게 좋아요." },
    { who: "담당자 F", org: "제약 · 교육", needs: ["report", "coach"], budget: 40000, q: "팀장 의견이 들어간 결과면 설득이 쉬워요." },
    { who: "담당자 G", org: "스타트업 · 운영", needs: ["refresh", "remind"], budget: 15000, q: "예산이 적어서 꼭 필요한 것만 사고 싶어요." },
    { who: "담당자 H", org: "공공 위탁 · 교육", needs: ["report", "apply"], budget: 30000, q: "연말 성과 보고서에 숫자로 넣을 수 있어야 해요." },
  ];
  const DRAFT = "3개월 후속 관리로 교육 효과를 보장합니다. 수료 후 팀 성과가 반드시 오릅니다. 매주 리마인드 퀴즈와 90일 효과 리포트를 드립니다.";

  /* ---------- 상태 ---------- */
  const seed = () => ({ selected: ["remind", "task", "report"], hc: 40, draft: DRAFT, reviewed: false });
  function load() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && Array.isArray(v.selected) && typeof v.draft === "string") return v; } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* 화면은 계속 동작 */ } };
  let st = load();
  let copy = null, ai = { mode: "rule", reason: "" }, waiting = false, runToken = 0;
  const sum = () => L.needSummary(IVS);
  const pr = () => L.price(st.selected, st.hc);

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

  /* ---------- ① 인터뷰 ---------- */
  function renderIvs() {
    const s = sum();
    const have = new Set(st.selected.map((k) => (L.MODULES.find((m) => m.key === k) || {}).need));
    $("ivMeta").textContent = `${s.n}명 · 1인 예산 중앙값 ${L.fmt(s.budgetMedian)}원`;
    $("needs").innerHTML = s.counts.map((c) => `<div class="need" title="${esc(c.label)}: ${c.count}명"><span>${esc(c.label)}</span>${IVS.map((iv) => `<i class="d${iv.needs.includes(c.key) ? " on" : ""}" aria-hidden="true"></i>`).join("")}<span class="v">${c.count}명</span></div>`).join("");
    $("ivs").innerHTML = IVS.map((iv) => `<div class="iv" role="listitem"><b>${esc(iv.who)}</b><small>${esc(iv.org)} · 1인 ${L.fmt(iv.budget)}원</small><q>${esc(iv.q)}</q><div class="tags">${iv.needs.map((n) => `<span class="${have.has(n) ? "" : "miss"}" title="${have.has(n) ? "지금 구성에 있음" : "지금 구성에 없음"}">${esc(L.NEEDS[n])}</span>`).join("")}</div></div>`).join("");
  }

  /* ---------- ② 구성 · 가격 ---------- */
  function renderPkg() {
    $("mods").innerHTML = L.MODULES.map((m) => {
      const on = st.selected.includes(m.key);
      const cost = m.perPerson ? `1인 ${L.fmt(m.perPerson)}원` : `고정 ${L.fmt(m.fixed)}원`;
      return `<li class="mod${on ? " on" : ""}"><label><input type="checkbox" data-mod="${m.key}"${on ? " checked" : ""}><span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><span class="m">측정: ${esc(m.m.metric)} · ${esc(m.m.timing)}</span></span><span class="pr">${cost}</span></label></li>`;
    }).join("");
    const c = L.coverage(IVS, st.selected);
    $("cov").innerHTML = `담당자 ${c.n}명 중 <b>${c.full}명</b>의 요구를 모두 채워요.${c.missing.length ? ` 빠진 요구: ${c.missing.map((m) => `${esc(m.label)} ${m.count}명`).join(", ")}` : " 빠진 요구가 없어요."}`;
    const p = pr();
    $("price").innerHTML = `<div><small>3개월 합계</small><b>${L.fmt(p.total)}원</b></div><div><small>월</small><b>${L.fmt(p.monthly)}</b></div><div><small>1인</small><b>${L.fmt(p.perHead)}</b></div>
      <p class="note">${p.headcount}명 기준 예시 가격 · 부가세 별도${p.rate ? ` · ${Math.round(p.rate * 100)}% 할인 반영` : " · 50명 이상 10%, 100명 이상 15% 할인"}</p>`;
  }

  /* ---------- ③ 문구 ---------- */
  function renderFlags() {
    const f = L.checkCopy(st.draft);
    $("flags").innerHTML = f.length ? f.map((x) => `<li><mark>${esc(x.phrase)}</mark><span class="why">${esc(x.reason)}</span></li>`).join("") : `<li><span class="ok">걸린 표현이 없어요.</span></li>`;
    $("cpMeta").textContent = f.length ? `걸린 표현 ${f.length}건` : "걸린 표현 0건";
  }
  function modeChip() {
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 문구를 다듬는 중</span>`;
    if (ai.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 작성 · ${(ai.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 구성에서 측정 약속을 바로 만들었어요">규칙 기반${ai.reason ? ` · ${esc(ai.reason)}` : ""}</span>`;
  }
  function finalText() { return copy ? [copy.headline, copy.pitch, ...copy.promises.map((p) => `${p.metric} ${p.method} ${p.timing}`)].join("\n") : ""; }
  function renderCopy() {
    if (!copy) { $("copy").innerHTML = ""; return; }
    const bad = L.checkCopy(finalText()).length;
    const pc = L.promiseCheck(finalText(), st.selected);
    $("copy").innerHTML = `<div class="result${waiting ? " waiting" : ""}">
      <div class="top">${modeChip()}<span class="chk${bad ? " bad" : ""}">보장·단정 표현 ${bad}건</span><span class="chk${pc.named < pc.total ? " bad" : ""}">측정 약속 ${pc.named}/${pc.total}</span></div>
      <h3>${esc(copy.headline)}</h3><p>${esc(copy.pitch)}</p>
      <table class="pt"><caption class="sr">측정 약속</caption><thead><tr><th>지표</th><th>방법</th><th>시점</th></tr></thead><tbody>${copy.promises.map((p) => `<tr><td>${esc(p.metric)}</td><td>${esc(p.method)}</td><td>${esc(p.timing)}</td></tr>`).join("")}</tbody></table>
      ${copy.flags && copy.flags.length ? `<p class="aiflags">Claude가 짚은 표현: ${copy.flags.map((f) => `‘${esc(f.phrase)}’${f.rewrite ? ` → ${esc(f.rewrite)}` : ""}`).join(" · ")}</p>` : ""}
    </div>`;
    const ready = st.reviewed && !bad;
    $("copyBtn").setAttribute("aria-disabled", String(!ready));
  }
  const renderAll = () => { renderIvs(); renderPkg(); renderFlags(); renderCopy(); };

  /* ---------- 실행 ---------- */
  async function run(opts) {
    const my = ++runToken;
    const s = sum(), p = pr();
    const base = L.ruleCopy(st.selected, s, p);
    const fixed = L.fixCopy(st.draft, st.selected).trim();
    copy = { ...base, pitch: fixed ? `${base.pitch} ${fixed}` : base.pitch, flags: [] };
    ai = { mode: "rule", reason: "" };
    st.reviewed = false; $("reviewed").checked = false; save(); // 문구가 바뀌면 다시 확인
    const noAi = opts && opts.noAi;
    waiting = !noAi && AI.status().enabled !== false;
    renderCopy();
    if (noAi) return;
    const r = await AI.ask(TASK, {
      draft: st.draft.slice(0, 1500),
      modules: st.selected.map((k) => L.MODULES.find((m) => m.key === k)).filter(Boolean).map((m) => ({ name: m.name, desc: m.desc, metric: m.m.metric, method: m.m.method, timing: m.m.timing })),
      interviews: { n: s.n, needs: s.counts.map((c) => ({ label: c.label, count: c.count })), quotes: IVS.map((iv) => iv.q) },
      price: { headcount: p.headcount, monthly: p.monthly, note: "예시 가격, 부가세 별도" },
    });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeCopy(r.data);
    if (n) { copy = n; ai = { mode: "ai", ms: r.ms }; }
    else ai = { mode: "rule", reason: r ? "응답 형식이 맞지 않거나 보장 표현이 있음" : (AI.status().reason || "") };
    renderCopy();
    if (!(opts && opts.quiet)) toast(`${ai.mode === "ai" ? "Claude가" : "규칙으로"} 측정 약속 ${copy.promises.length}개를 담은 문구를 만들었어요`);
  }

  /* ---------- 버튼 ---------- */
  $("mods").addEventListener("change", (e) => {
    const k = e.target.dataset.mod; if (!k) return;
    st.selected = L.MODULES.map((m) => m.key).filter((x) => (x === k ? e.target.checked : st.selected.includes(x)));
    save(); renderIvs(); renderPkg(); run({ noAi: true });
  });
  $("hc").addEventListener("input", () => { st.hc = Math.min(999, Math.max(0, Number($("hc").value) || 0)); save(); renderPkg(); });
  $("hc").addEventListener("change", () => run({ noAi: true }));
  $("draft").addEventListener("input", () => { st.draft = $("draft").value; save(); renderFlags(); });
  $("fix").addEventListener("click", () => {
    const before = st.draft;
    const n = L.checkCopy(before).length;
    if (!n) return toast("고칠 표현이 없어요");
    st.draft = $("draft").value = L.fixCopy(before, st.selected); save(); renderFlags();
    toast(`${n}건을 측정 약속으로 바꿨어요`, () => { st.draft = $("draft").value = before; save(); renderFlags(); });
  });
  $("run").addEventListener("click", () => run());
  $("reviewed").addEventListener("change", (e) => { st.reviewed = e.target.checked; save(); renderCopy(); });
  $("copyBtn").addEventListener("click", async () => {
    if (!copy) return;
    if (L.checkCopy(finalText()).length) return toast("보장·단정 표현이 남아 있어 복사하지 않았어요");
    if (!st.reviewed) return toast("사람이 최종 문구를 확인한 뒤 복사할 수 있어요");
    const txt = L.proposalText(CLIENT, copy, st.selected, pr());
    $("mdOut").textContent = txt; $("mdBox").hidden = false;
    try { await navigator.clipboard.writeText(txt); toast("제안서를 복사했어요"); }
    catch (e) { $("mdBox").open = true; toast("복사 권한이 없어 아래에 펼쳐 두었어요"); }
  });
  $("print").addEventListener("click", () => window.print());
  $("reset").addEventListener("click", () => {
    const before = { ...st, selected: [...st.selected] };
    st = seed(); $("hc").value = st.hc; $("draft").value = st.draft; save(); renderAll(); run({ quiet: true });
    toast("샘플 구성과 초안으로 되돌렸어요", () => { st = before; $("hc").value = st.hc; $("draft").value = st.draft; save(); renderAll(); run({ quiet: true }); });
  });

  /* ---------- 시작 ---------- */
  $("hc").value = st.hc; $("draft").value = st.draft; $("reviewed").checked = !!st.reviewed;
  renderAll();
  run({ noAi: true });
  AI.probe().then(() => run({ quiet: true }));
})();
