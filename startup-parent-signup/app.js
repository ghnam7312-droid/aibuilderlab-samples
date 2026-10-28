/* 자리있음 — 화면 (DOM만 다룬다. 정리·중복·정원·문자는 logic.js, AI 호출은 ai-client.js)
 *
 * '정리하기'를 누르면
 *   1) 규칙으로 메모를 바로 정리해 미리 보여 주고 (기다리지 않게)
 *   2) 전화번호를 [전화1]처럼 가린 메모를 Claude에 보내 다시 정리한다. 돌아오면 덮어쓰고,
 *      형식이 틀리면 1)을 그대로 둔다.
 * '명단에 넣기'에서 전화번호 + 강의 기준으로 중복을 합치고, 정원 순서대로 확정·대기를 매긴다.
 */
(function () {
  "use strict";
  const L = window.Jariisseum;
  const STORE_KEY = "startup-parent-signup-v1";
  const DAYS = "일월화수목금토";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const when = (d, hm) => `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]}) ${hm}`;

  /* ---------- 샘플 (기관·사람·번호 모두 가상) ---------- */
  function sessions() {
    return [
      { id: "s1", org: "햇살어린이집", title: "아이 마음 읽는 대화법", when: when(plus(8), "10:30"), place: "햇살어린이집 2층 강당", cap: 12, keys: ["햇살"] },
      { id: "s2", org: "푸른숲종합복지관", title: "영유아 놀이 코칭", when: when(plus(15), "19:00"), place: "푸른숲종합복지관 3층 프로그램실", cap: 8, keys: ["푸른숲"] },
      { id: "s3", org: "새솔유치원", title: "미디어 사용 약속 만들기", when: when(plus(22), "10:00"), place: "새솔유치원 강당", cap: 15, keys: ["새솔"] },
    ];
  }
  const SAMPLE_MEMO = `문자) 박서윤 어머님 010 3456 7788 햇살어린이집 강의 신청합니다. 아이 4세
전화) 이도현 아버님 010-5521-0934 푸른숲 복지관 놀이 코칭, 30개월
문자) 정민아님 01077810092 새솔 미디어 강의요. 6살 둘째도 데려가도 되나요?
전화) 김하은 010.2345.6789 햇살 강의 신청 (지난주에 폼으로도 했다고 하심)
문자) 최유나 어머님 +82 10-9988-1122 푸른숲 놀이 코칭 신청이요. 아이 18개월
전화) 한 분 더 신청한다고 하심. 번호는 못 받음. 푸른숲
문자) 박서윤 어머님 010-3456-7788 햇살 신청 다시 보내요`;
  function formEntries() {
    const sur = "김이박최정강조윤장임한오서신권황안송류홍";
    const giv = ["지우", "서연", "민준", "하린", "도윤", "수아", "예준", "지아", "시우", "유진", "주원", "다은", "건우", "채원", "우진", "소율", "현우", "나은", "지호", "아린", "은서", "태윤", "서아", "준서"];
    const count = { s1: 11, s2: 7, s3: 6 };
    const kids = ["3세", "4세", "5세", "24개월", "6세", "30개월", "18개월"];
    const out = [];
    let n = 0;
    for (const sid of ["s1", "s2", "s3"]) for (let i = 0; i < count[sid]; i++, n++) {
      const name = sid === "s1" && i === 2 ? "김하은" : sur[(n * 7) % sur.length] + giv[(n * 5) % giv.length];
      const phone = sid === "s1" && i === 2 ? "01023456789" : `010${String(31000000 + (n + 1) * 2718281 % 68000000).slice(0, 8)}`;
      out.push({ id: `f${n}`, name, phone, session: sid, kids: kids[n % kids.length], source: "폼", note: "", at: `${iso(plus(-14 + Math.floor(n / 3)))}-${String(n).padStart(3, "0")}`, times: 1 });
    }
    return out;
  }
  function seed() {
    return { list: formEntries(), memo: SAMPLE_MEMO, sel: "s1", kind: "확정", tpl: { ...L.TEMPLATE }, preview: null, runs: 0 };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.list) && typeof v.memo === "string" && v.tpl) { v.preview = null; return v; }
    } catch (e) { /* 저장소를 못 쓰면 샘플로 */ }
    return seed();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...st, preview: null })); } catch (e) { /* 화면은 계속 동작 */ } };
  const SES = sessions();
  const sesOf = (id) => SES.find((s) => s.id === id);
  let st = load();
  let waiting = false;
  let runToken = 0;

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

  /* ---------- 강의 카드 ---------- */
  function renderSessions() {
    $("sessions").innerHTML = SES.map((s) => {
      const rows = L.seats(st.list, s);
      const ok = rows.filter((r) => r.status === "확정").length, wait = rows.length - ok;
      return `<button type="button" class="ses" data-s="${s.id}" aria-pressed="${st.sel === s.id}">
        <span class="org">${esc(s.org)}</span><b>${esc(s.title)}</b><span class="when">${esc(s.when)}</span>
        <span class="meter" aria-hidden="true"><i style="width:${Math.min(100, (ok / s.cap) * 100)}%"></i></span>
        <span class="cnt"><b>${ok}</b>/${s.cap}명 확정${wait ? ` · <em>대기 ${wait}</em>` : ok >= s.cap ? " · 마감" : ` · ${s.cap - ok}자리 남음`}</span></button>`;
    }).join("");
  }
  $("sessions").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (!b) return; st.sel = b.dataset.s; save(); renderAll(); });

  /* ---------- 새로 들어온 신청 ---------- */
  function badge() {
    const p = st.preview;
    if (!p) return "";
    if (waiting) return `<span class="mode" data-mode="wait"><i></i>Claude가 다시 읽는 중</span>`;
    if (p.mode === "ai") return `<span class="mode" data-mode="ai">Claude로 정리 · ${(p.ms / 1000).toFixed(1)}초</span>`;
    return `<span class="mode" data-mode="rule" title="AI를 쓸 수 없어 번호·강의 이름으로 읽었어요">규칙 기반${p.reason ? ` · ${esc(p.reason)}` : ""}</span>`;
  }
  /** 미리 보기: 각 줄이 명단에 들어가면 어떻게 되는지 */
  function tagsFor(entries) {
    const have = new Set(st.list.map((e) => `${e.phone}|${e.session}`));
    const seen = new Set();
    return entries.map((e) => {
      const k = `${e.phone}|${e.session}`;
      const tag = have.has(k) ? "dup-old" : seen.has(k) ? "dup-memo" : "new";
      seen.add(k);
      return { ...e, tag };
    });
  }
  function renderPreview() {
    $("modeBadge").innerHTML = badge();
    const p = st.preview;
    const box = $("preview");
    if (!p) { box.innerHTML = ""; return; }
    const rows = tagsFor(p.entries);
    const n = rows.filter((r) => r.tag === "new").length;
    const T = { "new": "새 신청", "dup-old": "이미 명단에 있음 → 합침", "dup-memo": "메모 안에서 중복 → 합침" };
    box.innerHTML = `<ul class="pv ${waiting ? "waiting" : ""}">${rows.map((r) => `<li class="${r.tag}">
        <span class="t">${T[r.tag]}</span><b>${esc(r.name)}</b><span class="ph">${L.maskPhone(r.phone)}</span>
        <span class="s">${esc(sesOf(r.session).org)}</span>${r.kids ? `<span class="k">${esc(r.kids)}</span>` : ""}${r.note ? `<span class="q">문의: ${esc(r.note)}</span>` : ""}</li>`).join("")}
      ${p.problems.map((x) => `<li class="prob"><span class="t">확인 필요 · ${esc(x.why)}</span><span class="raw">${x.line}줄: ${esc(x.text.replace(L.PHONE_RE, (m) => L.maskPhone(L.normPhone(m))))}</span></li>`).join("")}</ul>
      <div class="row-btns"><span class="sub">${p.entries.length}건 중 새 신청 ${n}명 · 중복 ${p.entries.length - n}건${p.problems.length ? ` · 확인 필요 ${p.problems.length}줄` : ""}</span>
      <button class="primary" id="commit" type="button" ${n || p.entries.length ? "" : "disabled"}>명단에 넣기 (${n}명)</button></div>`;
  }
  async function parse() {
    const my = ++runToken;
    const memo = $("memo").value;
    st.memo = memo;
    if (!memo.trim()) { toast("메모를 먼저 붙여 넣어 주세요"); return; }
    const rule = L.parseMemo(memo, SES);
    st.preview = { ...rule, mode: "rule", reason: "" };
    waiting = AI.status().enabled !== false;
    renderPreview();
    const masked = L.maskForAi(memo);
    const r = await AI.ask("parentsignup.parse", { memo: masked.text.slice(0, 6000), sessions: SES.map((s) => ({ id: s.id, org: s.org, title: s.title })) });
    if (my !== runToken) return;
    waiting = false;
    const n = r && L.normalizeParse(r.data, masked.map, SES);
    if (n) {
      // Claude가 찾은 사람은 Claude 결과로, 규칙이 '확인 필요'로 둔 줄 중 Claude도 못 찾은 것은 그대로 남긴다
      const found = new Set(n.map((e) => e.line));
      st.preview = { entries: n, problems: rule.problems.filter((x) => !found.has(x.line)), mode: "ai", ms: r.ms };
    } else st.preview.reason = r ? "응답 형식이 맞지 않음" : (AI.status().reason || "AI 응답 없음");
    save(); renderPreview();
  }
  $("parse").addEventListener("click", parse);
  $("memo").addEventListener("input", () => { $("memoInfo").textContent = `${$("memo").value.split(/\n/).filter((l) => l.trim()).length}줄`; });
  $("preview").addEventListener("click", (e) => {
    if (e.target.id !== "commit") return;
    const before = { list: st.list, memo: st.memo };
    const stamp = `${iso(new Date())}-${String(++st.runs).padStart(2, "0")}`;
    const r = L.merge(st.list, st.preview.entries, stamp);
    st.list = r.list;
    const left = st.preview.problems.map((x) => x.text).join("\n");
    st.memo = left; $("memo").value = left; $("memo").dispatchEvent(new Event("input"));
    st.preview = null;
    save(); renderAll();
    toast(`${r.added}명 추가 · 중복 ${r.dupes}건 합침${left ? " · 확인 필요한 줄은 메모에 남겼어요" : ""}`, () => { st.list = before.list; st.memo = before.memo; $("memo").value = st.memo; save(); renderAll(); });
  });

  /* ---------- 명단 ---------- */
  function rows() { return L.seats(st.list, sesOf(st.sel)); }
  function renderRoster() {
    const s = sesOf(st.sel);
    $("rosterH").innerHTML = `명단 <small>${esc(s.org)} · ${esc(s.when)}</small>`;
    const q = $("find").value.trim();
    const all = rows();
    const list = all.filter((r) => !q || r.name.includes(q));
    $("roster").innerHTML = `<thead><tr><th>순번</th><th>이름</th><th>연락처</th><th>아이</th><th>경로</th><th>상태</th><th><span class="sr">지우기</span></th></tr></thead><tbody>` +
      (list.map((r) => `<tr class="${r.status === "대기" ? "wait" : ""}">
        <td class="n">${all.indexOf(r) + 1}</td>
        <td><b>${esc(r.name)}</b>${r.times > 1 ? ` <span class="dup" title="같은 번호로 ${r.times}번 신청해 한 명으로 합쳤어요">${r.times}회 신청 → 1명</span>` : ""}${r.nameDiff ? ` <span class="dup warn" title="같은 번호, 다른 이름">‘${esc(r.nameDiff)}’ 이름 확인</span>` : ""}${r.note ? `<div class="q">문의: ${esc(r.note)}</div>` : ""}</td>
        <td class="ph">${L.maskPhone(r.phone)}</td><td>${esc(r.kids)}</td><td><span class="src">${esc(r.source)}</span></td>
        <td><span class="st ${r.status === "대기" ? "w" : "c"}">${r.status === "대기" ? `대기 ${r.wait}` : "확정"}</span></td>
        <td><button type="button" class="x" data-del="${esc(r.id)}" aria-label="${esc(r.name)} 지우기">×</button></td></tr>`).join("") || `<tr><td colspan="7" class="none">명단이 비어 있어요.</td></tr>`) + "</tbody>";
  }
  $("find").addEventListener("input", renderRoster);
  $("roster").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const before = st.list;
    const who = st.list.find((x) => x.id === b.dataset.del);
    st.list = st.list.filter((x) => x.id !== b.dataset.del);
    save(); renderAll();
    toast(`${who.name}님을 명단에서 뺐어요. 대기 순서가 당겨졌어요`, () => { st.list = before; save(); renderAll(); });
  });
  $("csv").addEventListener("click", () => {
    const s = sesOf(st.sel);
    const blob = new Blob([L.toCsv(rows(), s)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `명단-${s.org}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${s.org} 명단 ${rows().length}명을 내려받았어요 (번호는 가림)`);
  });

  /* ---------- 안내 문자 ---------- */
  function renderMsgs() {
    $("tplKind").innerHTML = ["확정", "대기"].map((k) => `<button type="button" data-k="${k}" aria-pressed="${st.kind === k}">${k} 안내</button>`).join("");
    if (document.activeElement !== $("tpl")) $("tpl").value = st.tpl[st.kind];
    const bad = L.unknownFields(st.tpl[st.kind]);
    $("tplWarn").hidden = !bad.length;
    $("tplWarn").textContent = bad.length ? `모르는 칸이 있어요: ${bad.map((b) => `{${b}}`).join(", ")} — 그대로 보내지면 안 돼요` : "";
    const s = sesOf(st.sel);
    const target = rows().filter((r) => r.status === st.kind);
    $("msgs").innerHTML = target.length ? target.slice(0, 3).map((r) => `<div class="bubble"><span class="to">${esc(r.name)} · ${L.maskPhone(r.phone)}</span>${esc(L.fillMessage(st.tpl[st.kind], r, s)).replace(/\n/g, "<br>")}</div>`).join("") +
      (target.length > 3 ? `<p class="sub">외 ${target.length - 3}명</p>` : "") : `<p class="sub">${st.kind} 상태인 분이 없어요.</p>`;
    $("copyMsg").textContent = `${st.kind} 문자 ${target.length}건 복사`;
    $("copyMsg").disabled = !target.length || bad.length > 0;
  }
  $("tplKind").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; st.kind = b.dataset.k; save(); renderMsgs(); });
  $("tpl").addEventListener("input", (e) => { st.tpl[st.kind] = e.target.value; save(); renderMsgs(); });
  $("copyMsg").addEventListener("click", async () => {
    const s = sesOf(st.sel);
    // 번호는 넣지 않는다: 발송 서비스가 명단의 번호로 보낸다
    const text = rows().filter((r) => r.status === st.kind).map((r) => `■ ${r.name}\n${L.fillMessage(st.tpl[st.kind], r, s)}`).join("\n\n");
    try { await navigator.clipboard.writeText(text); toast("복사했어요"); } catch (err) { toast("복사 권한이 없어 아래에 펼쳐 두었어요"); }
    $("mdBox").hidden = false; $("mdBox").open = true; $("mdOut").textContent = text;
  });

  function renderAll() {
    renderSessions(); renderRoster(); renderMsgs(); renderPreview();
    const total = st.list.reduce((a, e) => a + (e.times || 1), 0);
    $("saved").textContent = `지금 명단: 신청 ${total}건 → ${st.list.length}명 (중복 ${total - st.list.length}건 합침)`;
  }
  $("reset").addEventListener("click", () => {
    const before = st;
    st = seed(); $("memo").value = st.memo; $("memo").dispatchEvent(new Event("input")); save(); renderAll(); parse();
    toast("샘플로 되돌렸어요", () => { st = before; $("memo").value = st.memo; save(); renderAll(); });
  });

  /* ---------- 시작 ---------- */
  $("memo").value = st.memo; $("memo").dispatchEvent(new Event("input"));
  renderAll();
  AI.probe().then(() => { if (st.memo.trim()) parse(); });
})();
