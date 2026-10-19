/* 한마디함 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Hanmadi 로, Node(테스트)에서는 require('./logic.js') 로 쓴다.
 * 여기에는 DOM 이 없다. 분류 규칙, 요약 계산, AI 응답 검증, 방 코드, 실시간 글 합치기만 있다.
 *
 * 분류는 두 단계다.
 *   1) 규칙(단어 사전) — 키를 칠 때마다 즉시. 네트워크가 없어도 된다.
 *   2) Claude — 남길 때 서버(/api/demo/ai, /api/demo/room)가 다시 분류한다. 실패하면 1)을 그대로 쓴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Hanmadi = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const CATS = ["칭찬", "개선 요청", "질문", "기타"];
  const SENTS = ["긍정", "중립", "부정"];

  // 분류마다 '근거 단어'. 많이 맞은 분류가 이긴다. 동점이면 질문 > 개선 요청 > 칭찬.
  const RULES = {
    "질문": ["?", "궁금", "언제", "어디서", "어디에", "어떻게", "있나요", "되나요", "인가요", "할까요", "나요", "알려 주", "알려주"],
    "개선 요청": ["아쉬", "부족", "개선", "했으면", "해 주세요", "해주세요", "늘려", "줄여", "불편", "느렸", "짧", "길었", "더웠", "추웠", "안 들", "안들", "힘들", "바꿔", "좁", "늦어", "헷갈", "없었"],
    "칭찬": ["좋았", "최고", "감사", "재밌", "재미있", "유익", "만족", "덕분", "멋", "훌륭", "친절", "도움", "또 오", "알찼", "맛있", "즐거", "인상"],
  };
  const POS = ["좋", "최고", "감사", "재밌", "재미", "유익", "만족", "덕분", "멋", "훌륭", "친절", "도움", "알찼", "즐거", "맛있", "인상"];
  const NEG = ["아쉬", "부족", "불편", "느렸", "힘들", "별로", "지루", "더웠", "추웠", "안 들", "안들", "실망", "좁", "늦어", "헷갈"];
  // '좋았으면' 처럼 바람을 말하는 표현은 칭찬이 아니다
  const WISH = ["았으면", "었으면", "했으면", "면 좋겠", "주시면"];

  // 개선 요청을 주제로 묶는다. suggestion 은 AI 가 없을 때 쓰는 기본 조치.
  const TOPICS = [
    { name: "시간 배분", words: ["시간", "짧", "길었", "늦어", "늘려", "줄여"], suggestion: "발표 1인 10분 타이머, 질의응답 15분을 고정 순서로 넣기" },
    { name: "장소·시설", words: ["장소", "자리", "좁", "에어컨", "추웠", "더웠", "주차", "의자"], suggestion: "책상 있는 강의실로 예약하고 냉난방 담당 1명 정하기" },
    { name: "음향·화면", words: ["마이크", "소리", "안 들", "안들", "화면", "스크린", "글씨"], suggestion: "무선 마이크 1개 추가, 슬라이드 글자 24pt 이상 안내" },
    { name: "안내·공지", words: ["안내", "공지", "헷갈", "찾기", "입구"], suggestion: "입구 표지판과 단톡방 지도 공지를 행사 하루 전에 올리기" },
    { name: "프로그램 구성", words: ["세션", "초보", "난이도", "구성", "주제"], suggestion: "초보자 트랙을 따로 열고 신청 때 수준을 묻기" },
  ];

  function lower(s) { return String(s || "").toLowerCase(); }

  /** 규칙 분류: {cat, mood, hits, topic} */
  function classify(text) {
    const s = lower(text);
    let cat = "기타", best = 0, hits = [];
    for (const c of ["질문", "개선 요청", "칭찬"]) {
      let h = RULES[c].filter((w) => s.includes(w));
      // 바람 표현이 있으면 칭찬 근거에서 '좋' 계열을 빼고 개선 요청 쪽으로 센다
      if (c === "칭찬" && WISH.some((w) => s.includes(w))) h = h.filter((w) => !w.startsWith("좋"));
      if (h.length > best) { best = h.length; cat = c; hits = h; }
    }
    if (cat !== "개선 요청" && WISH.some((w) => s.includes(w)) && best <= 1 && cat !== "질문") {
      cat = "개선 요청"; hits = WISH.filter((w) => s.includes(w));
    }
    const p = POS.filter((w) => s.includes(w)).length;
    const n = NEG.filter((w) => s.includes(w)).length;
    const mood = p > n ? "긍정" : n > p ? "부정" : "중립";
    return { cat, mood, hits, topic: topicOf(text) };
  }

  /** 개선 요청 주제 하나 (없으면 "") */
  function topicOf(text) {
    const s = lower(text);
    let best = "", score = 0;
    for (const t of TOPICS) {
      const n = t.words.filter((w) => s.includes(w)).length;
      if (n > score) { score = n; best = t.name; }
    }
    return best;
  }

  /** Claude 분류 응답을 믿기 전에 검사한다. 틀린 값이면 null → 규칙으로 */
  function normalizeClassify(d) {
    if (!d || typeof d !== "object") return null;
    if (!CATS.includes(d.category)) return null;
    return {
      cat: d.category,
      mood: SENTS.includes(d.sentiment) ? d.sentiment : "중립",
      topic: typeof d.topic === "string" ? d.topic.slice(0, 20) : "",
      reason: typeof d.reason === "string" ? d.reason.slice(0, 140) : "",
    };
  }

  /** Claude 요약 응답 검사: lines 3개, actions 최대 4개 */
  function normalizeSummary(d) {
    if (!d || !Array.isArray(d.lines)) return null;
    const lines = d.lines.filter((l) => typeof l === "string" && l.trim()).slice(0, 3);
    if (lines.length < 2) return null;
    const actions = (Array.isArray(d.actions) ? d.actions : [])
      .filter((a) => a && typeof a.topic === "string" && typeof a.suggestion === "string")
      .slice(0, 4)
      .map((a) => ({ topic: a.topic.slice(0, 20), count: Math.max(0, Math.round(Number(a.count) || 0)), suggestion: a.suggestion.slice(0, 160) }));
    return { lines, actions };
  }

  /** 규칙 요약: 숫자는 모두 rows 에서 계산한다 */
  function digest(rows) {
    const total = rows.length;
    const by = {};
    CATS.forEach((c) => { by[c] = rows.filter((r) => r.cat === c); });
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    const pos = rows.filter((r) => r.mood === "긍정").length;
    const neg = rows.filter((r) => r.mood === "부정").length;
    const unanswered = by["질문"].filter((r) => !r.reply).length;
    const ranked = ["칭찬", "개선 요청", "질문"].slice().sort((a, b) => by[b].length - by[a].length);

    const lines = total ? [
      `의견 ${total}건 중 긍정 ${pct(pos)}%, 부정 ${pct(neg)}%`,
      `가장 많은 건 ${ranked[0]}(${by[ranked[0]].length}건), 다음은 ${ranked[1]}(${by[ranked[1]].length}건)`,
      unanswered ? `답이 필요한 질문 ${unanswered}건이 남아 있어요` : "모든 질문에 답했어요",
    ] : [];

    const fixes = by["개선 요청"];
    const actions = TOPICS
      .map((t) => ({ topic: t.name, count: fixes.filter((r) => (r.topic || topicOf(r.text)) === t.name).length, suggestion: t.suggestion }))
      .filter((a) => a.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const counts = {};
    CATS.forEach((c) => { counts[c] = by[c].length; });
    return { total, counts, pos: pct(pos), neg: pct(neg), unanswered, lines, actions };
  }

  /** 요약 요청에 보낼 입력 — 너무 길면 최근 80건만 */
  function summaryInput(rows) {
    return { posts: rows.slice(-80).map((r) => ({ category: r.cat, text: String(r.text).slice(0, 200) })) };
  }

  /* ---------- 실시간 방 ---------- */
  const ROOM_RE = /^[a-z0-9]{6,16}$/;
  const ROOM_ABC = "abcdefghjkmnpqrstuvwxyz23456789";

  /** 방 코드 만들기. rand 는 0~1 숫자를 주는 함수 (테스트에서 고정 가능) */
  function newRoomCode(rand, len) {
    const r = rand || Math.random;
    let out = "";
    for (let i = 0; i < (len || 8); i++) out += ROOM_ABC[Math.floor(r() * ROOM_ABC.length) % ROOM_ABC.length];
    return out;
  }
  function validRoom(code) { return ROOM_RE.test(String(code || "")); }

  /** 주소의 ?room=...&join=1 읽기 */
  function parseJoin(search) {
    const q = new URLSearchParams(search || "");
    const room = (q.get("room") || "").toLowerCase();
    return { room: validRoom(room) ? room : "", join: q.get("join") === "1" && validRoom(room) };
  }

  /** 참가자 주소 */
  function joinUrl(base, room) {
    return `${String(base).split("?")[0].split("#")[0]}?room=${room}&join=1`;
  }

  /** 서버 글(row) → 벽 쪽지 */
  function fromRoomPost(p) {
    return {
      id: `r${p.id}`, rid: Number(p.id), text: p.body, at: Date.parse(p.created_at) || Date.now(),
      reply: "", fix: "", live: true,
      ai: { cat: CATS.includes(p.category) ? p.category : "기타", mood: SENTS.includes(p.sentiment) ? p.sentiment : "중립", topic: p.topic || "", reason: p.reason || "", mode: p.mode === "ai" ? "ai" : "rule" },
    };
  }

  /** 이미 있는 쪽지와 겹치지 않게 서버 글을 합친다. 새로 들어온 것만 돌려준다 */
  function mergeRoom(items, posts) {
    const have = new Set(items.filter((x) => x.live).map((x) => x.rid));
    const added = [];
    for (const p of posts || []) {
      if (!p || have.has(Number(p.id))) continue;
      have.add(Number(p.id));
      added.push(fromRoomPost(p));
    }
    return added;
  }

  /** 가장 큰 서버 글 번호 (다음 폴링의 after) */
  function lastRoomId(items) {
    return items.reduce((m, x) => (x.live && x.rid > m ? x.rid : m), 0);
  }

  /** "방금 / 7분 전 / 2시간 전" */
  function ago(t, now) {
    const m = Math.round(((now || Date.now()) - t) / 60000);
    if (m < 1) return "방금";
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
  }

  return { CATS, SENTS, RULES, TOPICS, classify, topicOf, normalizeClassify, normalizeSummary, digest, summaryInput, newRoomCode, validRoom, parseJoin, joinUrl, fromRoomPost, mergeRoom, lastRoomId, ago };
});
