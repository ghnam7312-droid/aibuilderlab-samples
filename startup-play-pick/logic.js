/* 오늘놀이 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Oneulnori, Node(테스트)에서는 require('./logic.js').
 *
 * 추천은 두 가지 길이 있다.
 *   규칙: 강사가 정리한 놀이 목록에서 월령·시간·장소·집에 있는 재료로 고른다.
 *   Claude: 같은 조건으로 놀이를 지어 준다.
 * 어느 쪽이든 마지막에 screen()이 '안전 기준 목록'으로 한 번 더 거른다.
 * 이 장치가 이 서비스의 핵심이다 — AI가 18개월 아이에게 콩 옮기기를 추천한 일이 있었다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Oneulnori = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const AREAS = ["대근육", "소근육", "언어", "감각", "정서·사회"];
  const MATERIALS = ["종이", "크레파스", "수건", "상자", "컵", "공", "그릇·냄비", "테이프", "그림책", "페트병", "쌀·콩", "끈·리본", "풍선", "비닐봉지", "가위"];

  /* ---------- 안전 기준 목록 (강사 검토본 · 서비스 자체 기준) ----------
   * under: 이 월령 미만이면 추천에서 뺀다. 0이면 빼지 않고 주의만 붙인다. always: 월령과 상관없이 뺀다.
   * 법적 기준이 아니라 '의심되면 뺀다'는 보수적인 기준이다. */
  const SAFETY = [
    { id: "small", label: "작은 부품", under: 36, words: ["콩", "강낭콩", "쌀", "구슬", "비즈", "단추", "동전", "자석", "건전지", "병뚜껑", "클립", "씨앗", "사탕", "견과", "작은 블록"],
      why: "입에 넣으면 숨이 막힐 수 있는 작은 물건(휴지심 구멍을 통과하는 크기)", care: "놀이가 끝나면 개수를 세어 모두 치워요" },
    { id: "cord", label: "끈·줄", under: 36, words: ["끈", "리본", "털실", "실", "고무줄", "줄넘기", "긴 줄"],
      why: "목이나 손가락에 감길 수 있음", care: "목에 두르지 않게 하고, 놀이 뒤 바로 치워요" },
    { id: "balloon", label: "풍선", under: 96, words: ["풍선"],
      why: "터진 조각을 삼키면 기도를 막을 수 있음", care: "어른이 불고, 터진 조각은 바로 치워요" },
    { id: "bag", label: "비닐", under: 36, words: ["비닐", "비닐봉지", "비닐봉투", "랩"],
      why: "얼굴을 덮으면 숨을 막을 수 있음", care: "머리에 쓰지 않게 해요" },
    { id: "sharp", label: "날카로운 도구", under: 48, words: ["가위", "칼", "이쑤시개", "압정", "바늘", "꼬치"],
      why: "베이거나 찔릴 수 있음", care: "유아용 안전 가위만, 어른 옆에서 써요" },
    { id: "heat", label: "불·열", always: true, words: ["촛불", "성냥", "라이터", "다리미", "가스레인지", "전자레인지", "뜨거운"],
      why: "화상 위험 — 아이 놀이에 넣지 않음" },
    { id: "water", label: "물", under: 0, words: ["물", "물놀이", "대야", "욕조", "분무기"],
      why: "", care: "물이 얕아도 어른이 손 닿는 곳에 있어요. 놀이 뒤 물은 바로 비워요" },
    { id: "height", label: "높은 곳", under: 0, words: ["의자 위", "계단", "식탁 위", "소파 위"],
      why: "", care: "떨어져도 다치지 않게 바닥에 이불을 깔아요" },
  ];

  /* ---------- 강사 놀이 목록 (월령 범위는 발달 기준, 안전은 screen()이 따로 본다) ---------- */
  const P = (id, title, min, max, minutes, place, area, materials, steps, tip) => ({ id, title, min, max, minutes, place, area, materials, steps, tip });
  const CATALOG = [
    P("peek", "수건 까꿍", 6, 24, 5, "실내", "정서·사회", ["수건"], ["수건으로 어른 얼굴을 가렸다가 '까꿍!' 하며 내려요", "아이 손에 수건을 쥐여 주고 스스로 내리게 해요", "인형을 수건 밑에 숨겨 찾게 해요"], "아이가 웃는 타이밍에 한 번 더. 같은 반복이 즐거운 시기예요."),
    P("tunnel", "상자 터널 기어가기", 8, 36, 10, "실내", "대근육", ["상자"], ["상자 양쪽을 열어 터널을 만들어요", "건너편에서 이름을 부르며 기어 오게 해요", "나오면 크게 안아 주며 칭찬해요"], "상자 모서리 스테이플러 심은 미리 떼어 두세요."),
    P("cups", "컵 쌓고 무너뜨리기", 10, 36, 10, "어디서나", "소근육", ["컵"], ["플라스틱 컵을 2~3개 쌓아 보여 줘요", "아이가 무너뜨리면 같이 '와르르!' 해요", "이번엔 아이가 쌓게 기다려 줘요"], "무너뜨리는 것도 놀이예요. 끝까지 쌓으라고 하지 않아도 돼요."),
    P("roll", "공 굴려 주고받기", 10, 48, 10, "어디서나", "대근육", ["공"], ["마주 앉아 다리를 벌리고 공을 굴려 줘요", "'간다~' 하고 신호를 주고 굴려요", "익숙해지면 조금씩 멀리 앉아요"], "주고받기가 차례 지키기의 시작이에요."),
    P("drum", "냄비 북 두드리기", 9, 36, 10, "실내", "감각", ["그릇·냄비"], ["냄비와 그릇을 엎어 놓고 나무 숟가락을 줘요", "크게·작게, 빠르게·느리게 따라 해요", "노래에 맞춰 박자를 쳐요"], "시끄러운 시간이 괜찮은 때를 고르세요."),
    P("book", "그림책 따라 말하기", 12, 72, 10, "어디서나", "언어", ["그림책"], ["그림을 가리키며 '이건 뭐지?' 물어요", "아이가 한 말을 한 낱말 늘려 다시 말해 줘요 (멍멍 → 멍멍이 달려)", "마지막 장은 아이가 이야기하게 해요"], "정답을 고쳐 주기보다 늘려 말해 주는 게 좋아요."),
    P("scribble", "크레파스 마음대로 끄적이기", 15, 48, 15, "실내", "소근육", ["종이", "크레파스"], ["큰 종이를 바닥에 테이프 없이 펼쳐요", "어른도 옆에서 동그라미·선을 그려요", "그린 것에 이름을 붙여 줘요"], "굵은 크레파스가 쥐기 쉬워요."),
    P("snow", "종이 찢어 눈 내리기", 12, 48, 15, "실내", "감각", ["종이"], ["이면지를 길게 찢는 걸 보여 줘요", "아이가 찢은 조각을 모아 위로 뿌려요", "다 같이 주워 상자에 담으며 정리해요"], "종이를 입에 넣는지 곁에서 봐 주세요."),
    P("tapeline", "테이프 길 따라 걷기", 15, 48, 15, "실내", "대근육", ["테이프"], ["바닥에 테이프로 직선·곡선 길을 만들어요", "길 위로만 걸어서 끝까지 가요", "토끼처럼, 거북이처럼 바꿔 걸어요"], "끝나면 테이프는 어른이 떼어 주세요."),
    P("bowling", "페트병 볼링", 24, 72, 20, "어디서나", "대근육", ["페트병", "공"], ["빈 페트병 6개를 세워요", "선 뒤에서 공을 굴려 쓰러뜨려요", "쓰러진 개수를 같이 세요"], "숫자 세기까지 이어지는 놀이예요."),
    P("beans", "숟가락으로 콩 옮기기", 18, 60, 15, "실내", "소근육", ["쌀·콩", "컵"], ["그릇에 콩을 담아요", "숟가락으로 콩을 떠서 컵으로 옮겨요", "다 옮기면 개수를 세요"], "손 조절 연습이 돼요."),
    P("maracas", "쌀 페트병 마라카스", 12, 48, 15, "실내", "감각", ["페트병", "쌀·콩"], ["작은 페트병에 쌀을 조금 넣어요", "뚜껑을 닫고 흔들어 소리를 들어요", "노래에 맞춰 흔들어요"], "소리 크기를 비교해 봐요."),
    P("ribbon", "리본 따라 춤추기", 18, 60, 10, "어디서나", "대근육", ["끈·리본"], ["리본을 막대에 묶어요", "음악에 맞춰 리본을 흔들며 걸어요", "동그라미·물결을 그려요"], "넓은 곳에서 해요."),
    P("balloon", "풍선 떨어뜨리지 않기", 24, 84, 10, "실내", "대근육", ["풍선"], ["풍선을 불어 묶어요", "손바닥으로 쳐서 바닥에 안 떨어지게 해요", "몇 번 쳤는지 세요"], "실내에서 땀 나게 놀 수 있어요."),
    P("car", "상자 자동차 만들기", 30, 72, 30, "실내", "정서·사회", ["상자", "크레파스", "테이프"], ["상자에 바퀴와 창문을 그려요", "인형을 태우고 '어디 가요?' 물어요", "집 안 '정류장'을 돌아요"], "이야기를 지어내는 시간이 길수록 좋아요."),
    P("scissors", "종이 잘라 꾸미기", 36, 72, 20, "실내", "소근육", ["종이", "가위"], ["종이에 굵은 선을 그어요", "가위로 선을 따라 잘라요", "자른 조각을 붙여 그림을 만들어요"], "곧은 선 → 곡선 순서로 어렵게 해요."),
    P("animal", "동물 소리 흉내 놀이", 15, 48, 10, "어디서나", "언어", [], ["'강아지는 어떻게 울지?' 물어요", "아이가 낸 소리를 따라 해 줘요", "동물 흉내를 내며 같이 걸어요"], "준비물이 없어 차 안·병원 대기실에서도 돼요."),
    P("colors", "산책하며 색깔 찾기", 18, 72, 20, "실외", "언어", [], ["오늘의 색을 하나 정해요", "산책하며 그 색을 찾으면 '찾았다!' 말해요", "집에 와서 본 것을 다시 말해 봐요"], "찾은 것을 사진으로 남겨도 좋아요."),
    P("shadow", "그림자 밟기", 24, 72, 15, "실외", "대근육", [], ["해가 있는 날 서로의 그림자를 찾아요", "그림자를 밟으려 쫓고 피해요", "그림자로 동물 모양을 만들어요"], "차가 다니지 않는 넓은 곳에서 해요."),
    P("sled", "수건 썰매", 12, 48, 10, "실내", "정서·사회", ["수건"], ["큰 수건 위에 아이를 앉혀요", "천천히 끌며 '출발!' 해요", "멈출 때마다 '어디 도착했어요?' 물어요"], "미끄러운 바닥에서는 아주 천천히."),
    P("pour", "컵으로 물 옮기기", 18, 60, 15, "어디서나", "감각", ["컵", "그릇·냄비"], ["그릇 두 개 중 하나에 물을 조금 담아요", "컵으로 떠서 다른 그릇으로 옮겨요", "흘린 물은 수건으로 같이 닦아요"], "욕실이나 베란다에서 하면 편해요."),
    P("shop", "그릇 가게 역할놀이", 30, 72, 20, "실내", "정서·사회", ["컵", "그릇·냄비"], ["그릇과 컵을 늘어놓고 가게를 열어요", "'얼마예요?' '주세요' 말을 주고받아요", "역할을 바꿔 아이가 손님이 돼요"], "인사말·차례 기다리기를 자연스럽게 연습해요."),
    P("feel", "수건 속 물건 맞히기", 24, 72, 15, "실내", "감각", ["수건", "컵"], ["수건 밑에 컵·숟가락·양말을 숨겨요", "손만 넣어 만져 보고 무엇인지 말해요", "맞히면 역할을 바꿔요"], "아이 주먹보다 큰 물건만 숨기세요."),
    P("story", "그림책 뒷이야기 만들기", 36, 72, 15, "어디서나", "언어", ["그림책"], ["읽은 그림책의 마지막 장을 펴요", "'그다음엔 어떻게 됐을까?' 물어요", "아이 이야기를 종이에 적어 줘요"], "말한 그대로 적어 주면 아주 좋아해요."),
  ];

  /* 낱말 뒤에 붙어도 같은 낱말로 보는 조사 ("콩을", "끈으로") */
  const JOSA = ["", "을", "를", "이", "가", "은", "는", "도", "만", "과", "와", "로", "으로", "에", "에서", "이나", "나", "처럼", "들", "들을", "알", "알을", "같은"];
  const tokens = (s) => String(s || "").split(/[^가-힣A-Za-z0-9]+/).filter(Boolean);
  /** 글에 낱말이 들어 있는가. '콩콩 뛰기'·'실내'·'물감'은 걸리지 않는다 */
  function hasWord(text, word) {
    if (word.includes(" ")) return String(text).replace(/\s+/g, " ").includes(word);
    return tokens(text).some((t) => t.startsWith(word) && JOSA.includes(t.slice(word.length)));
  }

  /** 글에서 가장 먼저 나오는 기준 낱말 (제목 → 순서 → 재료 순으로 읽는다) */
  function firstWord(text, words) {
    for (const t of tokens(text)) { const w = words.find((x) => !x.includes(" ") && t.startsWith(x) && JOSA.includes(t.slice(x.length))); if (w) return w; }
    return words.find((x) => x.includes(" ") && hasWord(text, x)) || "";
  }

  /** 놀이 하나를 안전 기준으로 검사 → {ok, blocked:[{rule, word}], cautions:[{rule, word}]} */
  function screen(play, months) {
    const text = [play.title, ...(play.steps || []), ...(play.materials || [])].join(" ");
    const blocked = [], cautions = [];
    for (const r of SAFETY) {
      const word = firstWord(text, r.words);
      if (!word) continue;
      if (r.always || months < r.under) blocked.push({ id: r.id, label: r.label, word, why: r.why, under: r.under, always: !!r.always });
      else cautions.push({ id: r.id, label: r.label, word, care: r.care });
    }
    return { ok: blocked.length === 0, blocked, cautions };
  }
  /** 사람이 읽는 걸러낸 이유 */
  function blockReason(b) {
    return b.always ? `${b.label}(${b.word}) — ${b.why}` : `${b.label}(${b.word}) — ${monthsLabel(b.under)} 미만은 ${b.why}`;
  }
  function monthsLabel(m) { return m >= 24 && m % 12 === 0 ? `${m / 12}세(${m}개월)` : `${m}개월`; }

  /* ---------- 사람에게 넘기기 ----------
   * 걱정 메모에 건강·발달 이야기가 있으면 놀이 추천이 판단하지 않는다. AI에도 보내지 않는다. */
  const URGENT = ["삼켰", "삼킨", "숨을 못", "숨을 안", "경련", "의식", "피가", "화상", "떨어졌", "머리를 부딪"];
  const CONSULT = ["말이 늦", "말을 안", "걷지 못", "못 걸", "눈을 안 맞", "눈맞춤", "발달", "지연", "열이", "아파", "토해", "토했", "설사", "안 먹", "잠을 못", "자폐", "검사"];
  function triage(note) {
    const t = String(note || "");
    const u = URGENT.find((w) => t.includes(w));
    if (u) return { level: "urgent", word: u };
    const c = CONSULT.find((w) => t.includes(w));
    if (c) return { level: "consult", word: c };
    return { level: "none", word: "" };
  }

  /* ---------- 규칙 추천 ---------- */
  function placeOk(playPlace, want) { return want === "상관없음" || playPlace === "어디서나" || playPlace === want; }
  /** 같은 조건이면 같은 순서 (seed로 '다른 놀이 보기') */
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** 이번 주 영역별 횟수 → 덜 한 영역에 가점 */
  function weekAreas(log, today) {
    const out = Object.fromEntries(AREAS.map((a) => [a, 0]));
    for (const e of log || []) if (e.date >= addDays(today, -6) && e.date <= today && out[e.area] !== undefined) out[e.area]++;
    return out;
  }

  /**
   * 규칙 추천. 조건에 맞는 놀이를 고르고, 안전 기준으로 거른 뒤 영역이 겹치지 않게 3개.
   * exclude: 방금 보여 준 놀이 제목 ('다른 놀이 보기'). 남은 게 모자라면 다시 쓴다.
   * @returns {picks:[play+check], screened:[play+check], pool:number}
   */
  function recommend(catalog, q, seed, log, today, exclude) {
    const wa = weekAreas(log, today || "2026-01-01");
    const fit = catalog.filter((p) => q.months >= p.min && q.months <= p.max && placeOk(p.place, q.place) && p.minutes <= q.minutes
      && p.materials.every((m) => (q.materials || []).includes(m)));
    const checked = fit.map((p) => ({ ...p, check: screen(p, q.months) }));
    const safe = checked.filter((p) => p.check.ok);
    const screened = checked.filter((p) => !p.check.ok);
    safe.sort((a, b) => (wa[a.area] - wa[b.area]) || (hash(a.id + seed) - hash(b.id + seed)));
    const ex = new Set(exclude || []);
    const fresh = safe.filter((p) => !ex.has(p.title));
    const picks = [];
    for (const p of fresh) if (picks.length < 3 && !picks.some((x) => x.area === p.area)) picks.push(p);
    for (const p of [...fresh, ...safe]) if (picks.length < 3 && !picks.includes(p)) picks.push(p);
    return { picks, screened, pool: fit.length };
  }

  /* ---------- Claude 응답 검사 ---------- */
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  /** Claude 응답 → 놀이 배열. 형식이 틀리면 null (규칙 결과를 그대로 둔다) */
  function normalizePlays(data) {
    if (!data || !Array.isArray(data.plays)) return null;
    const plays = data.plays.slice(0, 5).map((p, i) => {
      if (!p || typeof p !== "object") return null;
      const title = str(p.title, 40);
      const steps = Array.isArray(p.steps) ? p.steps.map((s) => str(s, 120)).filter(Boolean).slice(0, 6) : [];
      if (!title || !steps.length) return null;
      const minutes = Number(p.minutes);
      return {
        id: `ai-${i}`,
        title,
        minutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 60 ? Math.round(minutes) : 15,
        area: AREAS.includes(p.area) ? p.area : "감각",
        materials: Array.isArray(p.materials) ? p.materials.map((m) => str(m, 20)).filter(Boolean).slice(0, 8) : [],
        steps,
        tip: str(p.tip, 120),
        by: "ai",
      };
    }).filter(Boolean);
    return plays.length ? plays : null;
  }
  /** Claude 놀이도 똑같이 거른다. 안전한 것이 하나도 없으면 null */
  function screenAi(plays, months) {
    const checked = plays.map((p) => ({ ...p, check: screen(p, months) }));
    const picks = checked.filter((p) => p.check.ok).slice(0, 3);
    return { picks, screened: checked.filter((p) => !p.check.ok), usable: picks.length > 0 };
  }

  /** Claude에게 보내는 입력. 걱정 메모·아이 이름은 보내지 않는다 */
  function aiInput(q, log, today) {
    const avoid = SAFETY.filter((r) => r.always || q.months < r.under).map((r) => r.label);
    return { months: q.months, minutes: q.minutes, place: q.place, materials: q.materials, weekAreas: weekAreas(log, today), avoid };
  }

  /* ---------- 날짜 · 기록 · 내보내기 ---------- */
  function addDays(isoStr, n) { const [y, m, d] = isoStr.split("-").map(Number); const x = new Date(y, m - 1, d + n); return iso(x); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  /** 같은 날 같은 놀이는 한 번만 기록 */
  function addLog(log, entry) {
    if (log.some((e) => e.date === entry.date && e.title === entry.title)) return log;
    return [...log, entry];
  }
  /** 가족 단톡에 붙일 글. 아이 이름 대신 월령만 */
  function shareText(q, picks) {
    const head = `[오늘놀이] ${q.months}개월 · ${q.minutes}분 · ${q.place}`;
    const body = picks.map((p, i) => `${i + 1}. ${p.title} (${p.area} · ${p.minutes}분)\n   준비: ${p.materials.length ? p.materials.join(", ") : "없음"}\n` +
      p.steps.map((s) => `   - ${s}`).join("\n") + (p.check.cautions.length ? `\n   ⚠ ${p.check.cautions.map((c) => c.care).join(" / ")}` : "")).join("\n");
    return `${head}\n${body}\n안전 기준으로 거른 추천입니다. 놀이 중에는 어른이 곁에 있어 주세요.`;
  }

  return { AREAS, MATERIALS, SAFETY, CATALOG, JOSA, tokens, hasWord, screen, blockReason, monthsLabel, triage, placeOk, hash, weekAreas, recommend, normalizePlays, screenAi, aiInput, addDays, iso, addLog, shareText };
});
