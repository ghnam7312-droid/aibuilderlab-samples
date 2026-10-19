/* 한마디함 — 행사 익명 피드백 보드
 *
 * 흐름: 참가자가 의견을 쓴다 → 쓰는 즉시 분류(칭찬·개선 요청·질문·기타)와 감정을 보여 준다
 *       → 남기면 벽에 붙고, 요약과 '운영진이 손볼 것'이 바로 다시 계산된다.
 *
 * 이 데모의 'AI 분류'는 단어 사전 규칙으로 브라우저에서 돈다. (실제 버전은 Claude API)
 * 데이터는 브라우저 localStorage 에만 저장한다.
 */

const STORE_KEY = "hanmadi-v2";
const CATS = ["칭찬", "개선 요청", "질문", "기타"];
const CAT_COLOR = { "칭찬": "#FFE27A", "개선 요청": "#FFB59E", "질문": "#AEDCFF", "기타": "#E6E2DA" };

/* ---------- 분류 규칙 ---------- */
// 분류마다 '근거 단어'. 많이 맞은 분류가 이긴다. 동점이면 질문 > 개선 요청 > 칭찬 순.
const RULES = {
  "질문": ["?", "궁금", "언제", "어디서", "어디에", "어떻게", "있나요", "되나요", "인가요", "할까요", "나요", "알려 주", "알려주"],
  "개선 요청": ["아쉬", "부족", "개선", "했으면", "해 주세요", "해주세요", "늘려", "줄여", "불편", "느렸", "짧", "길었", "더웠", "추웠", "안 들", "안들", "힘들", "바꿔", "좁", "늦어", "헷갈", "없었"],
  "칭찬": ["좋았", "최고", "감사", "재밌", "재미있", "유익", "만족", "덕분", "멋", "훌륭", "친절", "도움", "또 오", "알찼", "맛있", "즐거", "인상"],
};
const POS = ["좋", "최고", "감사", "재밌", "재미", "유익", "만족", "덕분", "멋", "훌륭", "친절", "도움", "알찼", "즐거", "맛있", "인상"];
const NEG = ["아쉬", "부족", "불편", "느렸", "힘들", "별로", "지루", "더웠", "추웠", "안 들", "안들", "실망", "좁", "늦어", "헷갈"];
const MOOD_ICON = { "긍정": "😊", "부정": "😕", "중립": "🙂" };

// 개선 요청을 주제로 묶어 '운영진이 손볼 것'을 만든다
const TOPICS = [
  { name: "시간 배분", words: ["시간", "짧", "길었", "늦어", "늘려", "줄여"] },
  { name: "장소·시설", words: ["장소", "자리", "좁", "에어컨", "추웠", "더웠", "주차", "의자"] },
  { name: "음향·화면", words: ["마이크", "소리", "안 들", "안들", "화면", "스크린"] },
  { name: "안내·공지", words: ["안내", "공지", "헷갈", "찾기"] },
  { name: "프로그램 구성", words: ["세션", "초보", "난이도", "구성", "주제"] },
];

function classify(text) {
  const s = text.toLowerCase();
  let cat = "기타", best = 0, hits = [];
  for (const c of ["질문", "개선 요청", "칭찬"]) {
    const h = RULES[c].filter((w) => s.includes(w));
    if (h.length > best) { best = h.length; cat = c; hits = h; }
  }
  const p = POS.filter((w) => s.includes(w)).length;
  const n = NEG.filter((w) => s.includes(w)).length;
  const mood = p > n ? "긍정" : n > p ? "부정" : "중립";
  return { cat, mood, hits };
}

/* ---------- 샘플 데이터 ---------- */
const SAMPLE = [
  ["발표 내용이 정말 유익했어요. 실제 서비스 만드는 과정을 처음부터 볼 수 있어서 좋았습니다.", 3],
  ["발표 시간이 너무 짧아서 아쉬웠어요. 질의응답 시간을 늘려 주세요.", 5],
  ["다음 밋업은 언제 하나요? 공지는 어디서 보면 되나요?", 9, "11월 15일(토) 학생회관 3층이에요. 동아리 인스타 공지로 먼저 알려 드릴게요!"],
  ["운영진분들 너무 친절하셨어요. 감사합니다!", 12],
  ["마이크 소리가 뒤쪽에서는 잘 안 들렸어요.", 14],
  ["피자 맛있었어요 ㅎㅎ", 18],
  ["팀 매칭 방식이 재밌었어요. 처음 만난 사람이랑도 금방 친해졌어요.", 21],
  ["자리가 좁아서 노트북 펴기가 불편했어요. 장소를 바꿔 주시면 좋겠어요.", 25],
  ["발표 자료를 받을 수 있나요?", 27],
  ["멘토님 피드백이 구체적이라 큰 도움이 됐습니다.", 31],
  ["시작 시간이 30분 늦어져서 뒤 일정이 힘들었어요.", 34],
  ["참가비 환불은 어떻게 신청하나요?", 38],
  ["네트워킹 시간이 알찼어요. 또 오고 싶어요.", 41],
  ["에어컨이 세서 좀 추웠어요.", 44],
  ["다음엔 초보자용 세션도 있었으면 해요.", 47],
  ["사진은 어디에 올라오나요?", 52],
  ["전체적으로 만족스러웠습니다. 최고!", 55],
  ["주차 안내가 부족했어요. 입구 찾기가 헷갈렸어요.", 58],
  ["그냥 들러 봤는데 분위기 좋네요", 61],
  ["데모 시연이 멋졌어요. 저도 만들어 보고 싶어졌어요.", 66],
  ["뒷자리에서는 화면 글씨가 작아서 잘 안 보였어요. 개선해 주세요.", 70],
  ["팀별 발표 순서는 어떻게 정해지나요?", 74],
  ["한 사람 발표가 너무 길었어요. 시간 관리 부탁드려요.", 79],
  ["처음 왔는데 친절하게 설명해 주셔서 인상 깊었어요.", 83],
];

function seed() {
  const now = Date.now();
  // 오래된 것부터 차례로 들어온 것처럼 시간 배치
  return SAMPLE.map(([text, min, reply], i) => ({ id: i + 1, text, at: now - (90 - min) * 60000, reply: reply || "", fix: "" }));
}

/* ---------- 저장 ---------- */
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(v)) return v;
  } catch (e) { /* 저장소를 못 쓰면 샘플로 시작 */ }
  return seed();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (e) { /* 사생활 보호 모드 등: 화면은 계속 동작 */ }
}

let items = load();
let filter = "전체";
let replyingId = null;
let justAddedId = null;

/* ---------- 도우미 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}
// 쪽지마다 살짝 다른 기울기 (id로 고정)
const tilt = (id) => (((id * 37) % 7) - 3) * 0.45;
// 사람이 바로잡은 분류가 있으면 그것을 쓴다
function view(it) {
  const c = classify(it.text);
  return { ...it, ...c, cat: it.fix || c.cat, auto: c.cat };
}

let toastTimer;
function toast(msg, undo) {
  $("toastMsg").textContent = msg;
  const b = $("toastUndo");
  b.hidden = !undo;
  b.onclick = () => { undo(); $("toast").classList.remove("on"); };
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 5000 : 2200);
}

/* ---------- 쓰기: 실시간 분류 미리보기 ---------- */
const ta = $("text");
function renderLive() {
  const t = ta.value.trim();
  $("count").textContent = `${ta.value.length}/300`;
  const live = $("live");
  if (!t) {
    live.dataset.cat = "기타";
    $("liveCat").textContent = "아직 비어 있어요";
    $("why").textContent = "단어를 보고 칭찬·개선 요청·질문 중 하나로 나눠요.";
    return;
  }
  const c = classify(t);
  live.dataset.cat = c.cat;
  $("liveCat").textContent = `${c.cat} ${MOOD_ICON[c.mood]}`;
  $("why").innerHTML = c.hits.length
    ? `근거: ${c.hits.map((w) => `<mark>${esc(w)}</mark>`).join(" ")} → <b>${c.cat}</b>`
    : "맞는 단어가 아직 없어 <b>기타</b>로 분류하고 있어요.";
  $("err").hidden = true;
}
ta.addEventListener("input", renderLive);
ta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("form").requestSubmit();
});

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = ta.value.trim();
  if (t.length < 5) {
    $("err").textContent = t ? "조금만 더 써 주세요. 5자 이상이면 남길 수 있어요." : "의견을 먼저 써 주세요.";
    $("err").hidden = false;
    ta.focus();
    return;
  }
  const it = { id: Date.now(), text: t, at: Date.now(), reply: "", fix: "" };
  items.push(it);
  save();
  justAddedId = it.id;
  const c = classify(t);
  if (filter !== "전체" && filter !== c.cat) filter = "전체";
  ta.value = "";
  renderLive();
  render();
  toast(`'${c.cat}' 쪽지로 붙였어요`);
});

/* ---------- 요약 ---------- */
function renderDigest(rows) {
  const total = rows.length;
  const by = Object.fromEntries(CATS.map((c) => [c, rows.filter((r) => r.cat === c)]));
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  // 비율 막대
  $("dist").innerHTML = total
    ? CATS.filter((c) => by[c].length).map((c) =>
        `<button type="button" data-f="${c}" aria-pressed="${filter === c}" style="flex:${by[c].length};background:${CAT_COLOR[c]}" title="${c} ${by[c].length}건">${c} ${pct(by[c].length)}%</button>`).join("")
    : "";

  const pos = rows.filter((r) => r.mood === "긍정").length;
  const neg = rows.filter((r) => r.mood === "부정").length;
  const unanswered = by["질문"].filter((r) => !r.reply).length;
  const ranked = ["칭찬", "개선 요청", "질문"].sort((a, b) => by[b].length - by[a].length);
  const lines = total ? [
    `의견 <b>${total}건</b> · 긍정 <b>${pct(pos)}%</b>, 부정 <b>${pct(neg)}%</b>`,
    `가장 많은 건 <b>${ranked[0]}</b>(${by[ranked[0]].length}건), 다음은 <b>${ranked[1]}</b>(${by[ranked[1]].length}건)`,
    unanswered ? `답이 필요한 질문 <b>${unanswered}건</b> — 질문 쪽지에서 바로 답할 수 있어요` : "모든 질문에 답했어요",
  ] : ["아직 들어온 의견이 없어요. 참가자 링크를 단톡방에 공유해 보세요."];
  $("lines").innerHTML = lines.map((l) => `<li>${l}</li>`).join("");

  // 개선 요청 → 주제별 묶기
  const fixes = by["개선 요청"];
  const topics = TOPICS.map((t) => ({ ...t, n: fixes.filter((r) => t.words.some((w) => r.text.includes(w))).length }))
    .filter((t) => t.n).sort((a, b) => b.n - a.n).slice(0, 3);
  const max = topics[0]?.n || 1;
  $("topics").innerHTML = topics.length
    ? topics.map((t) => `<li><span>${t.name}</span><em>${t.n}건</em><div class="meter"><i style="width:${(t.n / max) * 100}%"></i></div></li>`).join("")
    : `<li class="none">개선 요청이 들어오면 주제별로 묶어 보여 드려요.</li>`;
}

/* ---------- 벽 ---------- */
function noteHtml(r) {
  const isAsk = r.cat === "질문";
  const reply = r.reply ? `<div class="reply"><b>운영진 답변</b>${esc(r.reply)}</div>` : "";
  const form = replyingId === r.id ? `
    <form class="reply-form" data-reply="${r.id}">
      <label class="sr" for="rp${r.id}">답변</label>
      <textarea id="rp${r.id}" rows="2" placeholder="답변을 써 주세요">${esc(r.reply)}</textarea>
      <div><button type="button" class="cancel" data-cancel>취소</button><button type="submit">답변 저장</button></div>
    </form>` : "";
  return `
  <article class="note${r.id === justAddedId ? " landed" : ""}" data-id="${r.id}" style="--tilt:${tilt(r.id)}deg">
    <div class="slip" data-cat="${r.cat}">
      <p>${esc(r.text)}</p>
      <div class="meta">
        <span class="mood" title="${r.mood}">${MOOD_ICON[r.mood]}</span>
        <span>${ago(r.at)}</span>
        ${r.fix ? `<span class="fixed" title="자동 분류: ${r.auto}">사람이 고침</span>` : ""}
        <span class="acts">
          ${isAsk ? `<button type="button" data-act="reply">${r.reply ? "답변 고치기" : "답하기"}</button>` : ""}
          <label class="sr" for="fx${r.id}">분류 바꾸기</label>
          <select id="fx${r.id}" data-act="fix" title="분류 바로잡기">${CATS.map((c) => `<option ${c === r.cat ? "selected" : ""}>${c}</option>`).join("")}</select>
          <button type="button" data-act="hide" aria-label="이 의견 숨기기">숨기기</button>
        </span>
      </div>
      ${reply}${form}
    </div>
  </article>`;
}

function render() {
  const rows = items.map(view);
  const by = Object.fromEntries(CATS.map((c) => [c, rows.filter((r) => r.cat === c)]));
  $("total").textContent = rows.length;
  $("filters").innerHTML = ["전체", ...CATS].map((c) =>
    `<button type="button" data-f="${c}" aria-pressed="${filter === c}">${c === "전체" ? "" : `<i style="background:${CAT_COLOR[c]}"></i>`}${c} <small>${c === "전체" ? rows.length : by[c].length}</small></button>`).join("");

  const shown = (filter === "전체" ? rows : by[filter]).slice().sort((a, b) => b.at - a.at);
  $("wall").innerHTML = shown.length
    ? shown.map(noteHtml).join("")
    : `<div class="empty-wall"><b>${filter === "전체" ? "아직 쪽지가 없어요" : `'${filter}' 쪽지가 없어요`}</b>${filter === "전체" ? "왼쪽에서 첫 의견을 남겨 보세요." : "다른 분류를 골라 보세요."}</div>`;
  renderDigest(rows);
  justAddedId = null;
  const ta2 = replyingId && document.querySelector(`[data-reply="${replyingId}"] textarea`);
  if (ta2) ta2.focus();
}

// 분류 고르기 (위 칩, 요약 막대 둘 다)
function onFilter(e) {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  filter = filter === b.dataset.f && b.dataset.f !== "전체" ? "전체" : b.dataset.f;
  render();
}
$("filters").addEventListener("click", onFilter);
$("dist").addEventListener("click", onFilter);

// 쪽지 안의 동작: 답하기 · 숨기기 · 분류 바로잡기
$("wall").addEventListener("click", (e) => {
  const note = e.target.closest(".note");
  if (!note) return;
  const id = Number(note.dataset.id);
  if (e.target.closest("[data-cancel]")) { replyingId = null; render(); return; }
  const act = e.target.closest("button[data-act]")?.dataset.act;
  if (act === "reply") { replyingId = id; render(); }
  if (act === "hide") {
    const idx = items.findIndex((x) => x.id === id);
    const [removed] = items.splice(idx, 1);
    note.classList.add("leaving");
    save();
    setTimeout(render, 200);
    toast("의견을 숨겼어요", () => { items.splice(idx, 0, removed); save(); render(); });
  }
});
$("wall").addEventListener("change", (e) => {
  if (e.target.dataset.act !== "fix") return;
  const id = Number(e.target.closest(".note").dataset.id);
  const it = items.find((x) => x.id === id);
  const auto = classify(it.text).cat;
  it.fix = e.target.value === auto ? "" : e.target.value;
  save();
  render();
  toast(it.fix ? `'${it.fix}'(으)로 바로잡았어요` : "자동 분류로 되돌렸어요");
});
$("wall").addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-reply]");
  if (!f) return;
  e.preventDefault();
  const it = items.find((x) => x.id === Number(f.dataset.reply));
  it.reply = f.querySelector("textarea").value.trim();
  replyingId = null;
  save();
  render();
  toast(it.reply ? "답변을 저장했어요" : "답변을 지웠어요");
});

/* ---------- 머리글 버튼 ---------- */
$("reset").addEventListener("click", () => {
  const before = items;
  items = seed();
  filter = "전체";
  replyingId = null;
  save();
  render();
  toast("샘플 의견 24건으로 되돌렸어요", () => { items = before; save(); render(); });
});
$("share").addEventListener("click", async () => {
  const url = location.href.split("#")[0];
  try { await navigator.clipboard.writeText(url); toast("참가자 링크를 복사했어요"); }
  catch (e) { toast(url); }
});

renderLive();
render();
