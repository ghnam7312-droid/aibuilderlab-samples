/* 곁눈 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Gyeotnun, Node(테스트)에서는 require('./logic.js').
 * '오늘'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 * 흐름: 시트에서 복사한 표(TSV) → parseSheet → normDate(날짜를 YYYY-MM-DD 하나로)
 *       → buildReport(보고 주만 거르기 · 브랜드별 집계 · 시간순 정렬)
 *       → ruleSummary / normalizeSummary(요약 문장마다 원문 게시물 id가 있어야 통과)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gyeotnun = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DAYS = "일월화수목금토";
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* ---------- 날짜 도우미 ---------- */
  function d0(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); }
  function md(s) { const d = d0(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function withDay(s) { return `${md(s)}(${DAYS[d0(s).getDay()]})`; }
  /** 그 주 월요일 */
  function weekStart(s) { const k = d0(s).getDay(); return addDays(s, -((k + 6) % 7)); }
  function make(y, m, d) {
    const x = new Date(y, m - 1, d);
    return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? iso(x) : "";
  }
  /** 연도가 없으면: 오늘보다 7일 넘게 뒤면 작년으로 본다 */
  function guessYear(today, m, d) {
    const y = d0(today).getFullYear();
    const s = make(y, m, d);
    if (!s) return "";
    return d0(s) - d0(today) > 7 * 86400000 ? make(y - 1, m, d) : s;
  }

  /* ---------- 날짜 맞추기: 섞인 형식 → YYYY-MM-DD ---------- */
  /** → { date, kind }  date가 ""이면 '확인 필요' */
  function normDate(raw, today) {
    const s = String(raw ?? "").trim();
    if (!s) return { date: "", kind: "빈 칸" };
    let m;
    if ((m = s.match(/^(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})\.?(?:\s.*)?$/))) return { date: make(+m[1], +m[2], +m[3]), kind: s.includes("-") ? "ISO" : s.includes("/") ? "빗금" : "점 구분" };
    if ((m = s.match(/^(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/))) return { date: m[1] ? make(+m[1], +m[2], +m[3]) : guessYear(today, +m[2], +m[3]), kind: "한글" };
    if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})\.?(?:\s.*)?$/))) return { date: guessYear(today, +m[1], +m[2]), kind: "월/일" };
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/)) && MON[m[2].toLowerCase()]) return { date: make(+m[3], MON[m[2].toLowerCase()], +m[1]), kind: "영문" };
    if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)) && MON[m[1].toLowerCase()]) return { date: make(+m[3], MON[m[1].toLowerCase()], +m[2]), kind: "영문" };
    if (/^(오늘|방금|\d+\s*(분|시간)\s*전)$/.test(s)) return { date: today, kind: "상대 표현" };
    if (s === "어제") return { date: addDays(today, -1), kind: "상대 표현" };
    if (s === "그저께" || s === "그제") return { date: addDays(today, -2), kind: "상대 표현" };
    if ((m = s.match(/^(\d+)\s*일\s*전$/))) return { date: addDays(today, -m[1]), kind: "상대 표현" };
    if ((m = s.match(/^(\d+)\s*주\s*전$/))) return { date: addDays(today, -7 * m[1]), kind: "상대 표현" };
    // 시트 날짜 칸을 숫자로 복사한 경우 (1899-12-30부터 센 일수)
    if ((m = s.match(/^(\d{5})(?:\.\d+)?$/)) && +m[1] > 40000 && +m[1] < 60000) return { date: addDays("1899-12-30", +m[1]), kind: "시트 숫자" };
    return { date: "", kind: "알 수 없음" };
  }
  /** 고치기 전 방식: 원문 그대로 글자 순 정렬 (비교용) */
  const naiveSort = (rows) => rows.slice().sort((a, b) => String(b.rawDate).localeCompare(String(a.rawDate)));

  /* ---------- 표 읽기 ---------- */
  /** "1.2만", "3.4k", "1,234" → 숫자 */
  function parseCount(v) {
    const s = String(v ?? "").replace(/[,\s]/g, "");
    let m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)만$/))) return Math.round(+m[1] * 10000);
    if ((m = s.match(/^(\d+(?:\.\d+)?)[kK천]$/))) return Math.round(+m[1] * 1000);
    return /^\d+$/.test(s) ? +s : 0;
  }
  const COLS = ["브랜드", "날짜", "채널", "내용", "좋아요", "댓글", "링크"];
  /** 탭으로 나뉜 표 → 게시물 목록. 첫 줄이 머리글이면 건너뛴다 */
  function parseSheet(text, today) {
    const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length && /브랜드/.test(lines[0]) && /날짜/.test(lines[0])) lines.shift();
    return lines.map((line, i) => {
      const c = line.split("\t").map((x) => x.trim());
      const nd = normDate(c[1], today);
      const link = /^https?:\/\/\S+$/.test(c[6] || "") ? c[6] : "";
      return { id: `p${i + 1}`, row: i + 1, brand: c[0] || "", rawDate: c[1] || "", date: nd.date, kind: nd.kind, channel: c[2] || "기타", text: c[3] || "", likes: parseCount(c[4]), comments: parseCount(c[5]), link };
    }).filter((p) => p.brand);
  }

  /** 받침에 맞는 조사: jo("브루잇", "이", "가") → "브루잇이" */
  function jo(word, withB, withoutB) {
    const w = String(word);
    const c = w.charCodeAt(w.length - 1);
    const has = c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 > 0 : false;
    return w + (has ? withB : withoutB);
  }

  /* ---------- 주간 리포트 ---------- */
  const eng = (p) => p.likes + p.comments;
  function buildReport(posts, start) {
    const end = addDays(start, 6);
    const inWeek = posts.filter((p) => p.date && p.date >= start && p.date <= end)
      .sort((a, b) => b.date.localeCompare(a.date) || eng(b) - eng(a));
    const brands = [...new Set(posts.map((p) => p.brand))].map((name) => {
      const l = inWeek.filter((p) => p.brand === name);
      const total = l.reduce((s, p) => s + eng(p), 0);
      const top = l.slice().sort((a, b) => eng(b) - eng(a))[0] || null;
      const ch = {};
      l.forEach((p) => { ch[p.channel] = (ch[p.channel] || 0) + 1; });
      return { name, count: l.length, total, avg: l.length ? Math.round(total / l.length) : 0, top, channels: ch };
    }).sort((a, b) => b.total - a.total);
    return { start, end, posts: inWeek, brands, unknown: posts.filter((p) => !p.date), outside: posts.filter((p) => p.date && (p.date < start || p.date > end)).length };
  }

  const STOP = new Set(["이번", "오늘", "지금", "우리", "여러분", "함께", "그리고", "진짜", "하는", "있는", "없는", "많이", "모두", "드려요", "합니다", "해요", "있어요"]);
  /** 게시물 글에서 여러 브랜드가 함께 쓴 낱말 */
  function sharedWord(posts) {
    const by = new Map();
    for (const p of posts) {
      for (const w of new Set((p.text.match(/[가-힣]{2,}/g) || []).map((x) => x.replace(/(으로|에서|까지|부터|에게|은|는|이|가|을|를|의|와|과|도|로|에)$/, "")))) {
        if (w.length < 2 || STOP.has(w)) continue;
        if (!by.has(w)) by.set(w, { brands: new Set(), ids: [] });
        by.get(w).brands.add(p.brand); by.get(w).ids.push(p.id);
      }
    }
    let best = null;
    by.forEach((v, w) => { if (v.brands.size >= 2 && (!best || v.brands.size > best.n || (v.brands.size === best.n && v.ids.length > best.ids.length))) best = { word: w, n: v.brands.size, ids: v.ids }; });
    return best;
  }
  /** 규칙 요약: 문장마다 근거 게시물 id(refs)를 붙인다 */
  function ruleSummary(r) {
    if (!r.posts.length) return { lines: [], watch: "" };
    const lines = [];
    const most = Math.max(...r.brands.map((b) => b.count));
    const busy = r.brands.filter((b) => b.count === most).map((b) => b.name);
    lines.push({ text: busy.length > 1 ? `${jo(busy.join(", "), "이", "가")} ${most}건씩 올렸어요.` : `${jo(busy[0], "이", "가")} ${most}건으로 가장 많이 올렸어요.`, refs: r.posts.filter((p) => busy.includes(p.brand)).slice(0, 3).map((p) => p.id) });
    const top = r.posts.slice().sort((a, b) => eng(b) - eng(a))[0];
    lines.push({ text: `반응이 가장 컸던 게시물은 ${top.brand} ${top.channel}이에요. 좋아요 ${top.likes.toLocaleString()} · 댓글 ${top.comments.toLocaleString()}.`, refs: [top.id] });
    const ch = {};
    r.posts.forEach((p) => { ch[p.channel] = (ch[p.channel] || []).concat(p); });
    const [chName, chPosts] = Object.entries(ch).sort((a, b) => b[1].length - a[1].length)[0];
    lines.push({ text: `채널은 ${jo(chName, "이", "가")} ${chPosts.length}건(${Math.round((chPosts.length / r.posts.length) * 100)}%)으로 가장 많았어요.`, refs: chPosts.slice().sort((a, b) => eng(b) - eng(a)).slice(0, 2).map((p) => p.id) });
    const w = sharedWord(r.posts);
    if (w) lines.push({ text: `‘${w.word}’${/[가-힣]$/.test(w.word) && (w.word.charCodeAt(w.word.length - 1) - 0xAC00) % 28 ? "이라는" : "라는"} 말을 브랜드 ${w.n}곳이 함께 썼어요.`, refs: w.ids.slice(0, 3) });
    const quiet = r.brands.filter((b) => !b.count).map((b) => b.name);
    return { lines, watch: quiet.length ? `${jo(quiet.join(", "), "은", "는")} 이번 주 게시물이 없어요. 계정 상태를 확인해 보세요.` : "" };
  }
  /** Claude 응답 검사: 원문 게시물 id가 하나도 없는 문장은 버린다 */
  function normalizeSummary(data, r) {
    if (!data || typeof data !== "object" || !Array.isArray(data.lines)) return null;
    const ids = new Set(r.posts.map((p) => p.id));
    let dropped = 0;
    const lines = [];
    for (const l of data.lines.slice(0, 6)) {
      const text = String((l && l.text) || "").trim();
      const refs = [...new Set((Array.isArray(l && l.refs) ? l.refs : []).map(String).filter((id) => ids.has(id)))].slice(0, 4);
      if (!text || text.length > 160 || !refs.length) { dropped++; continue; }
      lines.push({ text, refs });
    }
    if (lines.length < 2) return null;
    return { lines, watch: typeof data.watch === "string" ? data.watch.trim().slice(0, 160) : "", dropped };
  }

  /* ---------- 발행 기록 ---------- */
  /** 연속 발행 주 수 (가장 최근 주부터 거꾸로, 한 주라도 빠지면 끊긴다) */
  function streak(issues) {
    const weeks = [...new Set(issues.map((x) => x.week))].sort().reverse();
    let n = 0;
    for (let i = 0; i < weeks.length; i++) { if (i && addDays(weeks[i], 7) !== weeks[i - 1]) break; n++; }
    return n;
  }
  /** 같은 주는 한 번만 발행. 번호는 이어서 매긴다 */
  function publish(issues, week, at) {
    if (issues.some((x) => x.week === week)) return issues;
    const no = issues.reduce((m, x) => Math.max(m, x.no), 0) + 1;
    return issues.concat({ no, week, at });
  }

  /* ---------- 내보내기 ---------- */
  function toMarkdown(r, sum, no, byId) {
    const link = (id, i) => { const p = byId[id]; return p && p.link ? `[원문${i + 1}](${p.link})` : `(원문 ${id})`; };
    const out = [`## 경쟁 브랜드 SNS 주간 리포트${no ? ` #${no}` : ""} · ${md(r.start)}–${md(r.end)}`, ""];
    out.push("### 요약");
    sum.lines.forEach((l) => out.push(`- ${l.text} ${l.refs.map(link).join(" ")}`));
    if (sum.watch) out.push(`- 확인: ${sum.watch}`);
    out.push("", "### 브랜드별", "| 브랜드 | 게시물 | 반응 합계 | 대표 게시물 |", "|---|---|---|---|");
    r.brands.forEach((b) => out.push(`| ${b.name} | ${b.count} | ${b.total.toLocaleString()} | ${b.top ? (b.top.link ? `[${b.top.text.slice(0, 18)}](${b.top.link})` : b.top.text.slice(0, 18)) : "—"} |`));
    return out.join("\n");
  }

  /* ---------- 샘플: 가상의 음료 브랜드 5곳, 날짜 형식이 섞인 시트 ---------- */
  function sampleSheet(today) {
    const ws = weekStart(today);
    const at = (off) => addDays(ws, off); // 이번 주 월요일 기준
    const f = {
      iso: (s) => s,
      dot: (s) => { const d = d0(s); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; },
      ko: (s) => { const d = d0(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 오후 3:12`; },
      slash: (s) => md(s),
      en: (s) => { const d = d0(s); return `${d.getDate()} ${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[d.getMonth()]} ${d.getFullYear()}`; },
      serial: (s) => String(Math.round((d0(s) - d0("1899-12-30")) / 86400000)),
    };
    const rows = [
      ["브루잇", -6, "dot", "숏폼", "출근길 3초 브루잉, 신메뉴 오트라떼 나왔어요", "1.2만", 342, "brewit/r/7781"],
      ["브루잇", -4, "iso", "피드", "가을 한정 메이플 콜드브루 신메뉴 출시", 4210, 188, "brewit/p/7790"],
      ["브루잇", -2, "en", "스토리", "매장 리뉴얼 오픈 이벤트 안내", 980, 41, "brewit/s/7802"],
      ["탄산공방", -7, "ko", "피드", "제로슈거 자몽 탄산 출시, 시험 기간 응원 이벤트", 3120, 455, "tansan/p/310"],
      ["탄산공방", -5, "slash", "숏폼", "캔 따는 소리 ASMR 챌린지 참여하면 한 박스", "2.3만", 1204, "tansan/r/318"],
      ["탄산공방", -3, "serial", "숏폼", "챌린지 참여작 모음 1편", 8700, 390, "tansan/r/322"],
      ["탄산공방", -1, "dot", "피드", "자몽 다음 맛 투표, 댓글로 골라 주세요", 2650, 1810, "tansan/p/327"],
      ["잔잔티", -6, "ko", "블로그", "카페인 없는 저녁 차 고르는 법", 640, 52, "janjan/b/91"],
      ["잔잔티", -2, "iso", "피드", "시험 기간 밤샘 대신 캐모마일, 신메뉴 허니 블렌드", 1880, 133, "janjan/p/95"],
      ["귀리하루", -5, "en", "피드", "귀리 음료 한 팩으로 아침 대신, 출근길 응원 이벤트", 2240, 301, "oatday/p/52"],
      ["귀리하루", -4, "slash", "숏폼", "편의점 꿀조합 귀리하루 + 그래놀라", "1.6만", 640, "oatday/r/55"],
      ["귀리하루", -1, "serial", "스토리", "주말 팝업스토어 위치 안내", 720, 18, "oatday/s/58"],
      ["물결워터", -3, "dot", "피드", "라벨 없는 생수로 바꿨어요, 분리배출 쉬워져요", 1430, 97, "mulgyeol/p/204"],
      // 이번 주 (다음 리포트에 들어갈 것)
      ["브루잇", 0, "ko", "피드", "월요일 아침 한 잔 쿠폰", 2010, 77, "brewit/p/7811"],
      ["탄산공방", 1, "iso", "숏폼", "자몽 다음 맛 투표 결과 발표", "1.1만", 820, "tansan/r/331"],
      // 지난 주 전 (앞 리포트)
      ["잔잔티", -11, "slash", "피드", "새 블렌드 시음단 모집", 1320, 260, "janjan/p/88"],
      ["물결워터", -12, "iso", "숏폼", "물 마시기 30일 챌린지", 5400, 210, "mulgyeol/r/199"],
      // 확인 필요: 날짜를 읽을 수 없음
      ["귀리하루", null, "bad", "피드", "할인 행사 안내 (날짜 칸이 비어 있음)", 300, 12, "oatday/p/49"],
    ];
    const head = COLS.join("\t");
    return [head].concat(rows.map(([b, off, k, ch, tx, lk, cm, path]) =>
      [b, off === null ? "날짜?" : f[k](at(off)), ch, tx, lk, cm, `https://feed.example/${path}`].join("\t"))).join("\n");
  }

  return { jo, DAYS, d0, iso, addDays, md, withDay, weekStart, make, guessYear, normDate, naiveSort, parseCount, COLS, parseSheet, eng, buildReport, sharedWord, ruleSummary, normalizeSummary, streak, publish, toMarkdown, sampleSheet };
});
