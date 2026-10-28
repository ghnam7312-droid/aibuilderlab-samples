/* 끝까지 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Kkeutkkaji, Node(테스트)에서는 require('./logic.js').
 *
 * 처음에는 클릭 수로만 글 순위를 매겼더니 낚시성 제목이 1등이 됐다.
 * 그래서 '끝까지 읽은 비율'을 함께 본다.
 *   클릭률     = 클릭 / 그 호 열람자
 *   완독률     = 끝까지 읽은 사람 / 클릭
 *   완독 점수  = 끝까지 읽은 사람 / 그 호 열람자 × 100  (= 클릭률 × 완독률, 열람자 100명당)
 * 클릭률은 높은데 완독률이 낮은 글은 '낚시 의심'으로 표시한다.
 * 구독자 한 명 한 명의 기록은 쓰지 않고, 글마다 합계만 쓴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Kkeutkkaji = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 샘플 (가상의 뉴스레터 41~48호) ---------- */
  const ISSUES = [
    { no: 41, date: "09-02", sent: 1063, opens: 404, paid: 5 },
    { no: 42, date: "09-09", sent: 1080, opens: 432, paid: 6 },
    { no: 43, date: "09-16", sent: 1103, opens: 452, paid: 8 },
    { no: 44, date: "09-23", sent: 1131, opens: 498, paid: 10 },
    { no: 45, date: "09-30", sent: 1160, opens: 534, paid: 12 },
    { no: 46, date: "10-07", sent: 1188, opens: 558, paid: 16 },
    { no: 47, date: "10-14", sent: 1215, opens: 595, paid: 18 },
    { no: 48, date: "10-21", sent: 1228, opens: 626, paid: 21 },
  ];
  const TOPICS = ["택배·라스트마일", "해운·항만", "창고·풀필먼트", "물류 테크", "운임·비용", "투자·스타트업"];
  const CSV_SAMPLE = `호,제목,주제,클릭,끝까지읽음
41,택배사 3곳 단가표 한눈에 비교,운임·비용,96,61
41,환적 물동량이 늘면 내 화물은 늦어질까,해운·항만,58,30
41,물류 스타트업 투자 이번 주 3건,투자·스타트업,44,15
42,이 회사가 택배비를 절반으로 줄인 비밀 (충격),택배·라스트마일,168,18
42,냉동창고 임대료 지역별 정리,창고·풀필먼트,71,49
42,TMS 고를 때 묻는 질문 5개,물류 테크,63,41
43,운임 협상 전에 꼭 챙길 숫자 7가지,운임·비용,118,84
43,새벽배송 야간 인력 구하기 현장 이야기,택배·라스트마일,77,46
43,로봇 피킹 비용 회수 계산법,물류 테크,69,47
44,모르면 손해 보는 물류 꿀팁 대방출,택배·라스트마일,182,22
44,반품 대행 맡길 때 계약서에서 볼 곳,창고·풀필먼트,88,60
44,항공화물 운임 3주 하락 왜,해운·항만,52,26
45,화주가 운임표를 다시 짜는 이유,운임·비용,131,92
45,풀필먼트 센터 견학 메모,창고·풀필먼트,84,55
45,물류 투자 시장 한 줄 요약,투자·스타트업,50,14
46,택배 단가 인상 내 계약에는 언제부터,운임·비용,142,101
46,편의점 택배 접수가 늘어난 진짜 이유,택배·라스트마일,90,48
46,AMR 도입 실패 사례 3가지,물류 테크,81,58
47,창고 공실률 최저 지금 계약해야 할까,창고·풀필먼트,109,77
47,업계가 숨기는 운임의 진실 (클릭 주의),운임·비용,205,25
47,컨테이너 반출입 예약제 바뀌는 점,해운·항만,61,35
48,중소 물류사 TMS 도입 비용 실제 견적,물류 테크,121,88
48,택배 단가 인상 대응 체크리스트,운임·비용,150,112
48,화물 매칭 스타트업이 정산을 자동화한 방법,투자·스타트업,72,40`;

  /* ---------- CSV ---------- */
  /** 글별 합계 CSV → {rows, errors}. 틀린 줄은 몇 번째 줄인지와 이유를 남기고 건너뛴다 */
  function parseCsv(text, issues) {
    const known = new Set((issues || ISSUES).map((i) => i.no));
    const rows = [], errors = [];
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      if (i === 0 && /^호\s*,/.test(line)) return;
      const c = line.split(",").map((x) => x.trim());
      const n = i + 1;
      if (c.length !== 5) { errors.push({ line: n, why: "칸이 5개가 아니에요 (호,제목,주제,클릭,끝까지읽음)" }); return; }
      const [no, title, topic, clicks, reads] = [Number(c[0]), c[1], c[2], Number(c[3]), Number(c[4])];
      if (!known.has(no)) { errors.push({ line: n, why: `${c[0]}호 열람 기록이 없어요` }); return; }
      if (!title) { errors.push({ line: n, why: "제목이 비었어요" }); return; }
      if (!Number.isInteger(clicks) || !Number.isInteger(reads) || clicks < 0 || reads < 0) { errors.push({ line: n, why: "클릭·끝까지읽음은 0 이상의 정수여야 해요" }); return; }
      if (reads > clicks) { errors.push({ line: n, why: "끝까지 읽은 사람이 클릭보다 많아요" }); return; }
      rows.push({ id: `r${n}`, no, title: title.slice(0, 80), topic: topic || "기타", clicks, reads });
    });
    return { rows, errors };
  }

  /* ---------- 지표 ---------- */
  const r1 = (x) => Math.round(x * 10) / 10;
  const pct = (a, b) => (b ? r1((a / b) * 100) : 0);
  function median(xs) {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  /** 글마다 클릭률·완독률·완독 점수·낚시 의심 */
  function metrics(rows, issues) {
    const by = new Map((issues || ISSUES).map((i) => [i.no, i]));
    const list = rows.filter((r) => by.has(r.no)).map((r) => {
      const opens = by.get(r.no).opens;
      return { ...r, ctr: pct(r.clicks, opens), readRate: pct(r.reads, r.clicks), score: pct(r.reads, opens) };
    });
    const medCtr = median(list.map((x) => x.ctr));
    list.forEach((x) => { x.bait = x.ctr >= medCtr * 1.3 && x.readRate < 30; });
    return list;
  }
  /** 순위: by='clicks' 이면 클릭 수, 'score' 이면 완독 점수. 같으면 클릭 수 → 호 번호 */
  function rank(list, by) {
    const key = by === "clicks" ? (x) => x.clicks : (x) => x.score;
    return list.slice().sort((a, b) => key(b) - key(a) || b.clicks - a.clicks || b.no - a.no).map((x, i) => ({ ...x, rank: i + 1 }));
  }
  /** 두 순위 사이 자리 변화: +는 올라감 */
  function rankShift(list) {
    const a = new Map(rank(list, "clicks").map((x) => [x.id, x.rank]));
    const b = new Map(rank(list, "score").map((x) => [x.id, x.rank]));
    return Object.fromEntries(list.map((x) => [x.id, a.get(x.id) - b.get(x.id)]));
  }
  /** 최근 n호만 */
  function lastIssues(rows, n, issues) {
    const nos = (issues || ISSUES).map((i) => i.no).sort((a, b) => b - a).slice(0, n);
    return rows.filter((r) => nos.includes(r.no));
  }
  /** 호별 열람률·전환율 (전환율 = 그 호로 유료 전환한 사람 / 열람자) */
  function issueTrend(issues) {
    return (issues || ISSUES).map((i) => ({ no: i.no, date: i.date, openRate: pct(i.opens, i.sent), conv: pct(i.paid, i.opens) }));
  }
  /** 주제별 평균 */
  function topicStats(list) {
    const g = {};
    list.forEach((x) => { (g[x.topic] = g[x.topic] || []).push(x); });
    return Object.entries(g).map(([topic, xs]) => ({
      topic, articles: xs.length,
      clickRate: r1(xs.reduce((s, x) => s + x.ctr, 0) / xs.length),
      readRate: r1(xs.reduce((s, x) => s + x.readRate, 0) / xs.length),
      score: r1(xs.reduce((s, x) => s + x.score, 0) / xs.length),
      bait: xs.filter((x) => x.bait).length,
      best: xs.slice().sort((a, b) => b.score - a.score)[0].title,
    })).sort((a, b) => b.score - a.score);
  }

  /* ---------- 제목 점검 ---------- */
  const BAIT_WORDS = ["충격", "비밀", "경악", "대방출", "꿀팁", "모르면 손해", "숨기는", "진실", "클릭 주의", "절대", "역대급"];
  function baitWords(title) { return BAIT_WORDS.filter((w) => String(title || "").includes(w)); }

  /* ---------- 다음 호 주제 추천 (규칙) ---------- */
  /** 글이 2개 이상인 주제를 먼저, 완독 점수 높은 3개 (모자라면 글 1개인 주제로 채움).
   *  제목 아이디어는 그 주제에서 가장 잘 읽힌 글의 후속 */
  function recommend(stats) {
    const pool = stats.filter((s) => s.articles >= 2).concat(stats.filter((s) => s.articles < 2));
    const topics = pool.slice(0, 3).map((s) => ({
      topic: s.topic,
      reason: `글 ${s.articles}개 평균 완독률 ${s.readRate}%, 열람자 100명당 ${s.score}명이 끝까지 읽었어요.`,
      titleIdea: `‘${s.best}’ 후속편`,
    }));
    const baity = stats.filter((s) => s.bait).sort((a, b) => b.bait - a.bait)[0];
    const caution = baity ? `${baity.topic}에서 낚시 의심 글이 ${baity.bait}개 나왔어요. 클릭은 많아도 끝까지 읽지 않았어요.` : "";
    return { topics, caution };
  }
  /** Claude 에게 보낼 입력: 계산이 끝난 합계만 */
  function aiInput(stats) {
    return { topics: stats.map((s) => ({ topic: s.topic, articles: s.articles, clickRate: s.clickRate, readRate: s.readRate, per100: s.score, bait: s.bait, bestTitle: s.best })) };
  }

  /* ---------- Claude 응답 검사 ---------- */
  function numsIn(text) { return (String(text).match(/\d+(?:\.\d+)?/g) || []).map(Number); }
  /** 주제는 input 에 있는 것만, 이유 속 숫자는 input 에 있는 숫자만, 제목 아이디어에 낚시 표현이 있으면 비운다 */
  function normalizeRecommend(d, stats) {
    if (!d || typeof d !== "object" || !Array.isArray(d.topics)) return null;
    const known = new Map(stats.map((s) => [s.topic, s]));
    const allowed = new Set(numsIn(JSON.stringify(aiInput(stats))));
    const seen = new Set();
    const topics = [];
    d.topics.forEach((t) => {
      if (!t || typeof t.topic !== "string" || !known.has(t.topic.trim()) || seen.has(t.topic.trim()) || topics.length >= 3) return;
      const topic = t.topic.trim();
      seen.add(topic);
      let reason = typeof t.reason === "string" ? t.reason.trim().slice(0, 160) : "";
      if (numsIn(reason).some((n) => !allowed.has(n))) reason = "";
      let titleIdea = typeof t.titleIdea === "string" ? t.titleIdea.trim().slice(0, 60) : "";
      if (baitWords(titleIdea).length) titleIdea = "";
      const s = known.get(topic);
      topics.push({ topic, reason: reason || `글 ${s.articles}개 평균 완독률 ${s.readRate}%.`, titleIdea });
    });
    if (!topics.length) return null;
    const caution = typeof d.caution === "string" && !numsIn(d.caution).some((n) => !allowed.has(n)) ? d.caution.trim().slice(0, 160) : "";
    return { topics, caution };
  }

  /* ---------- 내보내기 ---------- */
  function toCsv(ranked) {
    const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    const head = "순위,호,제목,주제,클릭,끝까지읽음,클릭률(%),완독률(%),완독점수,낚시의심";
    return [head].concat(ranked.map((x) => [x.rank, x.no, x.title, x.topic, x.clicks, x.reads, x.ctr, x.readRate, x.score, x.bait ? "예" : ""].map(q).join(","))).join("\n") + "\n";
  }

  return { ISSUES, TOPICS, CSV_SAMPLE, parseCsv, pct, median, metrics, rank, rankShift, lastIssues, issueTrend, topicStats, BAIT_WORDS, baitWords, recommend, aiInput, normalizeRecommend, toCsv };
});
