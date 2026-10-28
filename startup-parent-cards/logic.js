/* 집으로 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Jibeuro, Node(테스트)에서는 require('./logic.js').
 *
 * 강사가 넣은 강의 원고를 문장 단위로 번호를 매기고, 부모가 집에서 해 볼 '가정 실천 카드'를 만든다.
 *   말 한마디(say) · 해 볼 행동(do) · 돌아보기 질문(ask) · 강사 한 줄(tip, 유료판)
 * 카드는 두 가지 길로 만든다.
 *   규칙: 원고 문장에서 고른다 (항상 근거가 있다).
 *   Claude: 같은 원고로 문장을 다듬어 준다.
 * 어느 쪽이든 마지막에 ground()가 문장마다 근거(원고 문장 번호)를 확인하고, 근거 없는 문장은 버린다.
 * 이 장치가 이 서비스의 핵심이다 — AI가 잠자리 강의 카드에 '멜라토닌'을 덧붙인 일이 있었다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Jibeuro = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SLOTS = [
    { id: "say", label: "오늘 해 볼 말 한마디" },
    { id: "do", label: "해 볼 행동 1개" },
    { id: "ask", label: "돌아보기 질문" },
    { id: "tip", label: "강사 한 줄" },
  ];
  const PRICE = 4900;

  /* ---------- 샘플 강의 원고 (이 서비스용으로 새로 쓴 가상의 원고) ---------- */
  const LECTURES = [
    { id: "sibling", title: "형제 다툼 대화법", place: "해오름종합사회복지관 · 부모 교육 3회차", text:
`형제가 다툴 때 부모가 먼저 판사가 되지 않는 것이 출발점입니다. 누가 먼저 했는지 묻기보다 각자의 마음을 한 문장씩 말로 옮겨 주세요. 예를 들어 “너는 블록을 지키고 싶었구나, 동생은 같이 하고 싶었고” 하고 말해 볼 수 있습니다. 다툼이 커지면 잠깐 떨어져 앉는 쉬는 자리를 미리 정해 두면 좋습니다. 쉬는 자리는 벌이 아니라 마음을 가라앉히는 곳이라고 평소에 알려 주세요.
마음이 가라앉으면 아이들이 직접 해결 방법을 하나씩 내 보게 합니다. 부모는 방법을 고르지 않고, 두 사람이 모두 괜찮은지 물어봐 주는 역할을 합니다. 큰아이에게만 양보를 바라면 형제 사이가 더 멀어질 수 있습니다. 하루에 한 번은 아이 한 명과만 보내는 짧은 시간을 만들어 보세요. 때리거나 물건을 던지는 행동은 마음과 상관없이 바로 멈추게 합니다. 저녁에는 “오늘 나는 누구 편도 들지 않고 두 아이 말을 끝까지 들었나?” 하고 스스로 물어보세요.` },
    { id: "phone", title: "스마트폰 사용 약속 정하기", place: "꿈나무어린이집 · 학부모 저녁 강의", text:
`스마트폰 약속은 부모가 정해 알려 주기보다 아이와 함께 정할 때 더 잘 지켜집니다. 약속은 언제, 어디서, 무엇을 볼지 세 가지로 나누어 정해 보세요. 정한 약속은 종이에 적어 가족 모두가 보는 곳에 붙여 둡니다. 끝낼 때가 다가오면 “영상 하나만 더 보고 끄자” 하고 미리 알려 주세요. 갑자기 빼앗으면 약속이 아니라 싸움으로 기억되기 쉽습니다.
부모도 식사 시간에는 휴대폰을 내려놓는 모습을 보여 주세요. 약속을 지킨 날에는 “스스로 껐네, 약속을 지켰구나” 하고 구체적으로 말해 줍니다. 약속을 못 지킨 날은 혼내기보다 다음 날 약속을 다시 확인합니다. 한 달에 한 번 가족 회의에서 약속이 잘 맞는지 함께 고쳐 봅니다. 이번 주에는 “나는 아이에게 바라는 약속을 나도 지키고 있나?” 하고 스스로 물어보세요.` },
    { id: "sleep", title: "잠자리 루틴 만들기", place: "별빛유치원 · 부모 교육 2회차", text:
`잠자리 루틴은 매일 같은 순서로 하루를 닫는 작은 의식입니다. 씻기, 잠옷 입기, 책 읽기처럼 순서를 정해 그림으로 붙여 두면 아이가 다음 할 일을 스스로 압니다. 잠들기 전에는 집 안 불빛을 조금씩 낮춰 보세요. 마지막에는 “오늘 제일 좋았던 일은 뭐였어?” 하고 하루를 함께 돌아봅니다. 아이가 더 놀고 싶다고 하면 “내일 또 하자, 지금은 잘 시간이야” 하고 짧게 말해 주세요.
루틴은 길게 하기보다 매일 지킬 수 있는 만큼만 정하는 것이 좋습니다. 주말에도 순서는 그대로 두면 아이가 덜 헷갈립니다. 부모가 지친 날에는 순서를 줄여도 마지막 인사만은 지켜 주세요. 잠을 이루기 어려운 날이 이어지면 혼자 판단하지 말고 소아청소년과나 전문가와 상담하세요. 오늘 밤에는 “나는 잠자리에서 아이 이야기를 서두르지 않고 들었나?” 하고 스스로 물어보세요.` },
  ];

  /* ---------- 문장 나누기 ----------
   * 마침표·물음표·느낌표 뒤 공백(또는 줄바꿈)에서 자른다. 따옴표 “ ” 안의 물음표에서는 자르지 않는다. */
  function splitSentences(text) {
    const out = [];
    let buf = "", depth = 0;
    const s = String(text || "").replace(/\r/g, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "“") depth++;
      else if (c === "”") depth = Math.max(0, depth - 1);
      if (c === "\n") { if (buf.trim()) out.push(buf.trim()); buf = ""; continue; }
      buf += c;
      const next = s[i + 1];
      if (depth === 0 && /[.?!]/.test(c) && (next === undefined || /\s/.test(next))) { if (buf.trim()) out.push(buf.trim()); buf = ""; }
      else if (depth === 0 && c === "”" && /[?!.]/.test(s[i - 1] || "") && next === undefined) { out.push(buf.trim()); buf = ""; }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter((t) => /[가-힣A-Za-z]/.test(t)).map((t, i) => ({ no: i + 1, text: t }));
  }

  /* ---------- 낱말 찾기 (조사가 붙어도 같은 낱말: '약을', '약이' — '약속'은 아님) ---------- */
  const JOSA = ["", "을", "를", "이", "가", "은", "는", "도", "만", "과", "와", "로", "으로", "에", "에서", "이나", "나", "처럼", "들", "부터", "까지", "의"];
  const tokens = (s) => String(s || "").split(/[^가-힣A-Za-z0-9]+/).filter(Boolean);
  function hasWord(text, word) {
    if (word.includes(" ")) return String(text).replace(/\s+/g, " ").includes(word);
    return tokens(text).some((t) => t.startsWith(word) && JOSA.includes(t.slice(word.length)));
  }
  const findWord = (text, words) => words.find((w) => hasWord(text, w)) || "";

  /* ---------- 의학·발달·약·진단 낱말 ----------
   * 카드 문장에 이 낱말이 있는데 근거 원고 문장에는 없으면, 강의에 없는 조언으로 보고 버린다. */
  const MED = ["약", "약물", "복용", "처방", "진단", "치료", "증상", "질환", "장애", "지연", "정상 발달", "발달 단계", "발달", "성장", "호르몬", "멜라토닌", "수면제", "영양제", "유산균", "한약", "병원", "검사", "ADHD", "자폐", "틱", "우울", "불안장애"];
  /** 원고에 없는 숫자 기준("하루 1시간", "36개월이면")도 지어낸 기준으로 본다 */
  const NUM_RULE = /\d+\s*(개월|살|세|시간|분|회|번|mg|ml|%)/g;

  /* ---------- 근거 검사 (이 서비스의 핵심) ----------
   * line: {text, refs:[원고 문장 번호]}  sentences: splitSentences 결과
   * → {ok, reason, score}  score = 카드 문장 글자쌍 중 근거 문장에 있는 비율 */
  function bigrams(s) {
    const h = String(s || "").replace(/[^가-힣A-Za-z0-9]/g, "");
    const set = new Set();
    for (let i = 0; i < h.length - 1; i++) set.add(h.slice(i, i + 2));
    return set;
  }
  function overlap(a, b) {
    const A = bigrams(a), B = bigrams(b);
    if (!A.size) return 0;
    let n = 0; for (const x of A) if (B.has(x)) n++;
    return n / A.size;
  }
  const MIN_SCORE = 0.6;
  function ground(line, sentences) {
    const text = String((line && line.text) || "").trim();
    const refs = Array.isArray(line && line.refs) ? line.refs.map(Number).filter(Number.isInteger) : [];
    if (!text) return { ok: false, reason: "빈 문장", score: 0 };
    if (!refs.length) return { ok: false, reason: "근거 문장 번호가 없음", score: 0 };
    const cited = refs.map((n) => sentences.find((s) => s.no === n)).filter(Boolean);
    if (cited.length !== refs.length) return { ok: false, reason: `원고에 없는 문장 번호(${refs.filter((n) => !sentences.some((s) => s.no === n)).join(", ")})`, score: 0 };
    const src = cited.map((s) => s.text).join(" ");
    const med = MED.find((w) => hasWord(text, w) && !hasWord(src, w));
    if (med) return { ok: false, reason: `의학·발달 조언(‘${med}’) — 원고에 없음`, score: 0, med };
    const nums = (text.match(NUM_RULE) || []).filter((m) => !src.replace(/\s/g, "").includes(m.replace(/\s/g, "")));
    if (nums.length) return { ok: false, reason: `원고에 없는 숫자 기준(‘${nums[0]}’)`, score: 0, med: nums[0] };
    const score = overlap(text, src);
    if (score < MIN_SCORE) return { ok: false, reason: `원고 문장과 달라요 (일치 ${Math.round(score * 100)}%)`, score };
    return { ok: true, reason: "", score };
  }

  /* ---------- 부모 질문 분류 ----------
   * 건강·발달·안전 낱말이 있으면 카드를 만들지 않고 사람에게 넘긴다. AI에도 보내지 않는다. */
  const URGENT = ["삼켰", "삼킨", "숨을 못", "숨을 안", "경련", "의식이", "피가", "화상", "떨어졌", "머리를 부딪", "다쳤", "죽고 싶", "자해"];
  const CONSULT = ["발달", "지연", "말이 늦", "자폐", "ADHD", "진단", "치료", "병원", "약", "열이", "아파", "토해", "토했", "틱", "우울", "불안장애", "잠을 못", "밤마다 깨", "몸무게", "키가", "성장", "멜라토닌", "영양제"];
  function triage(question) {
    const t = String(question || "");
    const hit = (w) => (w.length === 1 ? hasWord(t, w) : t.includes(w));
    const u = URGENT.find(hit);
    if (u) return { level: "urgent", word: u };
    const c = CONSULT.find(hit);
    if (c) return { level: "consult", word: c };
    return { level: "none", word: "" };
  }

  /* ---------- 개인정보 가리기 (AI·내보내기 전에) ---------- */
  function scrub(text) {
    return String(text || "")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[메일]")
      .replace(/(\+82[\s-]?|0)1[016789][\s-]?\d{3,4}[\s-]?\d{4}/g, "[전화]")
      .replace(/[가-힣]{2,4}\s?(어머님|아버님|어머니|아버지|엄마|아빠)/g, "[보호자]")
      .replace(/우리\s?[가-힣]{1,3}(이|가)?(는|가|를|랑|이랑|이가)?(?=\s)/g, "우리 아이")
      .replace(/\d+\s?(개월|살|세)/g, "[나이]");
  }

  /* ---------- 규칙 카드 ---------- */
  const quoteOf = (s) => { const m = s.match(/“([^”]+)”/); return m ? m[1].trim() : ""; };
  const isAsk = (s) => /물어보세요/.test(s.text) && quoteOf(s.text);
  const isSay = (s) => !isAsk(s) && quoteOf(s.text);
  const isReferral = (s) => !!findWord(s.text, MED) || /상담하세요/.test(s.text);
  const isDo = (s) => !quoteOf(s.text) && !isReferral(s) && /(세요|주세요|둡니다|합니다|봅니다|좋습니다)\.$/.test(s.text);
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** 질문과 가까운 문장이 먼저, 같으면 seed로 순서를 바꾼다 ('다른 문장으로') */
  function rank(list, question, seed) {
    return list.map((s) => ({ s, k: question ? overlap(question, s.text) : 0 }))
      .sort((a, b) => (b.k - a.k) || (hash(a.s.no + ":" + seed) - hash(b.s.no + ":" + seed))).map((x) => x.s);
  }

  /** 규칙 카드: 원고 문장만 고른다. → {lines:{say,do,ask,tip}, dropped:[], missing:[slot]} */
  function buildCard(sentences, question, seed) {
    const q = String(question || "");
    // seed만큼 돌려서 고른다: 0이면 질문과 가장 가까운 문장, 1이면 그다음 …
    const turn = (list) => { const n = list.length, k = n ? (seed || 0) % n : 0; return [...list.slice(k), ...list.slice(0, k)]; };
    const say = turn(rank(sentences.filter(isSay), q, 0))[0];
    const dos = turn(rank(sentences.filter(isDo), q, 0));
    const ask = turn(rank(sentences.filter(isAsk), q, 0))[0];
    const lines = {};
    if (say) lines.say = { text: quoteOf(say.text), refs: [say.no], by: "rule" };
    if (dos[0]) lines.do = { text: dos[0].text, refs: [dos[0].no], by: "rule" };
    if (ask) lines.ask = { text: quoteOf(ask.text), refs: [ask.no], by: "rule" };
    if (dos[1]) lines.tip = { text: dos[1].text, refs: [dos[1].no], by: "rule" };
    for (const k of Object.keys(lines)) lines[k].check = ground(lines[k], sentences);
    return { lines, dropped: [], missing: ["say", "do", "ask"].filter((k) => !lines[k]) };
  }

  /* ---------- Claude 응답 검사 ---------- */
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  /** Claude 응답 → 카드. 형식이 틀리면 null, 근거가 모자라면 usable:false (규칙 결과 유지) */
  function normalizeCard(data, sentences) {
    if (!data || !Array.isArray(data.lines)) return null;
    const rows = data.lines.slice(0, 10).map((l) => {
      if (!l || typeof l !== "object") return null;
      const slot = SLOTS.some((s) => s.id === l.slot) ? l.slot : "";
      const text = str(l.text, 160);
      if (!slot || !text) return null;
      const refs = Array.isArray(l.refs) ? l.refs.map(Number).filter(Number.isInteger).slice(0, 3) : [];
      return { slot, text, refs, by: "ai" };
    }).filter(Boolean);
    if (!rows.length) return null;
    const lines = {}, dropped = [];
    for (const r of rows) {
      const check = ground(r, sentences);
      if (check.ok && !lines[r.slot]) lines[r.slot] = { ...r, check };
      else if (!check.ok) dropped.push({ ...r, check });
    }
    const missing = ["say", "do", "ask"].filter((k) => !lines[k]);
    return { lines, dropped, missing, usable: missing.length === 0 };
  }

  /** Claude에게 보내는 입력. 질문은 개인정보를 가리고, 원고는 번호 붙은 문장으로 */
  function aiInput(lecture, sentences, question) {
    return { lecture: lecture.title, sentences: sentences.map((s) => ({ no: s.no, text: s.text })), question: scrub(question).slice(0, 300) };
  }

  /* ---------- 주간 메일 · 발송함 · 구독 ---------- */
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  /** ISO 주 번호 '2026-W44' */
  function weekKey(isoStr) {
    const [y, m, d] = isoStr.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
  }
  const refTag = (l) => `[원고 ${l.refs.join(", ")}]`;
  /** 구독 메일 미리보기. 받는 사람 이름 없이 '보호자님' */
  function buildMail(card, lecture, sentences, tier, week) {
    const L = card.lines;
    const subject = `[집으로] ${week.replace("-W", "년 ")}주차 한 걸음 — ${lecture.title}`;
    const parts = ["보호자님, 이번 주에 집에서 해 볼 한 걸음이에요.", ""];
    if (L.say) parts.push(`■ 오늘 해 볼 말 한마디`, `“${L.say.text}”`, "");
    if (L.do) parts.push(`■ 해 볼 행동 1개`, L.do.text, "");
    if (tier === "paid") {
      if (L.ask) parts.push(`■ 돌아보기 질문`, L.ask.text, "");
      if (L.tip) parts.push(`■ 강사 한 줄`, L.tip.text, "");
      const used = [...new Set(Object.values(L).flatMap((l) => l.refs))].sort((a, b) => a - b);
      parts.push(`■ 이 카드의 근거 (강의 원고 ‘${lecture.title}’)`, ...used.map((n) => `${n}. ${(sentences.find((s) => s.no === n) || {}).text || ""}`), "");
    } else {
      parts.push("유료판에서는 돌아보기 질문, 강사 한 줄, 근거가 된 강의 원문이 함께 갑니다 (월 4,900원).", "");
    }
    parts.push("이 카드는 강의 원고 문장만으로 만들었어요. 아이의 건강·발달 고민은 소아청소년과나 전문가와 상담해 주세요.");
    return { subject, body: parts.join("\n") };
  }
  /** 같은 주에 같은 강의 카드는 한 장만 (새로 담으면 바꿔 끼운다) */
  function addToQueue(queue, item) {
    const rest = (queue || []).filter((q) => !(q.week === item.week && q.lectureId === item.lectureId));
    return { queue: [...rest, item], replaced: rest.length !== (queue || []).length };
  }
  /** 구독 숫자 → 유료 비율·월 구독료 합계 */
  function subStats(total, paid, price) {
    const p = price || PRICE;
    return { total, paid, free: Math.max(0, total - paid), rate: total ? Math.round((paid / total) * 1000) / 10 : 0, monthly: paid * p };
  }
  const won = (n) => `${n.toLocaleString("ko-KR")}원`;

  return { SLOTS, PRICE, LECTURES, splitSentences, JOSA, tokens, hasWord, MED, overlap, MIN_SCORE, ground, triage, scrub, quoteOf, isSay, isDo, isAsk, rank, buildCard, normalizeCard, aiInput, iso, weekKey, refTag, buildMail, addToQueue, subStats, won };
});
