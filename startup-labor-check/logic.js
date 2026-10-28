/* 열두칸 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Yeoldukan, Node(테스트)에서는 require('./logic.js').
 *
 * 소상공인 노무 진단 상품 기획판.
 *   - 후보 항목 40개 중 사장님이 끝까지 답할 수 있는 핵심 12개를 고른다 (40개 버전은 인터뷰에서 아무도 끝내지 못했다)
 *   - 고른 묶음을 검사한다: 12개 넘음, 예상 소요 시간, 바로 답하기 어려운 항목, 빠진 영역
 *   - 사장님 화면 미리보기: '아니오·모름'은 위반 판정이 아니라 '노무사 상담에서 확인' 목록이 된다
 *   - 가격 실험(샘플 가격)과 인터뷰 응답으로 상품 구성을 정한다
 * 인터뷰 수치·가격은 가상의 목표 모델 샘플 값이다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Yeoldukan = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const LIMIT = 12;          // 핵심 항목 수
  const PER_CAT = 2;         // 추천할 때 한 영역에서 최대
  const INTERVIEWS = 9;      // 인터뷰한 사장님 수 (샘플)
  const CATS = ["계약·서류", "임금", "근로시간·휴일", "휴가", "퇴직·종료", "보험·신고", "직장 내 관계", "안전"];

  /* 후보 40개: [영역 번호, 노무사 표현, 사장님 말, 인터뷰 언급 수(9명 중), 상담 빈도 1~3, 바로 답할 수 있나, 답하는 데 드는 분] */
  const RAW = [
    [0, "근로계약서 서면 작성·교부", "직원마다 근로계약서를 쓰고 한 부씩 주었나요?", 8, 3, 1, 1],
    [0, "근로조건 변경 시 계약서 재작성", "시급이나 근무 시간이 바뀌면 계약서를 새로 쓰나요?", 5, 2, 1, 1],
    [0, "취업규칙 작성·비치", "회사 규칙을 문서로 갖고 있나요?", 2, 1, 0, 2],
    [0, "근로자 명부 작성·보관", "직원 명부를 만들어 보관하고 있나요?", 1, 1, 1, 1],
    [0, "연소자 보호자 동의서", "미성년 직원이 있다면 보호자 동의서를 받았나요?", 3, 2, 1, 1],
    [1, "임금 정기 지급", "정해진 날짜에 월급을 빠짐없이 주고 있나요?", 6, 3, 1, 1],
    [1, "임금명세서 교부", "월급을 줄 때 명세서를 함께 주나요?", 7, 2, 1, 1],
    [1, "주휴수당 산정", "주휴수당을 계산해서 주고 있나요?", 9, 3, 0, 2],
    [1, "최저임금 이상 지급 확인", "올해 고시된 금액 이상으로 시급을 주는지 확인했나요?", 8, 3, 1, 1],
    [1, "연장·야간·휴일 가산", "늦게까지 일하거나 쉬는 날 일한 시간을 따로 계산하나요?", 6, 3, 0, 2],
    [2, "근로시간 기록", "직원별 출퇴근 시간을 기록하고 있나요?", 7, 3, 1, 1],
    [2, "휴게시간 부여", "일하는 중간에 쉬는 시간을 주고 있나요?", 6, 2, 1, 1],
    [2, "주휴일 부여", "일주일에 하루 이상 쉬는 날이 있나요?", 4, 2, 1, 1],
    [2, "연장근로 합의", "연장 근무를 미리 직원과 합의하나요?", 3, 2, 0, 1],
    [2, "교대제 운영 기준", "교대 근무표를 미리 알려 주나요?", 1, 1, 1, 1],
    [3, "연차휴가 부여·관리", "직원별 남은 연차를 알고 있나요?", 7, 2, 0, 2],
    [3, "연차 사용 촉진", "쓰지 않은 연차를 어떻게 할지 직원과 정했나요?", 3, 2, 0, 2],
    [3, "출산·육아 휴가 처리", "출산·육아 휴가를 신청하면 어떻게 할지 정해 두었나요?", 2, 2, 0, 2],
    [3, "공휴일 처리", "공휴일에 쉬거나 일할 때 어떻게 할지 정했나요?", 4, 2, 1, 1],
    [3, "병가 처리 기준", "아파서 쉬는 날 처리 기준이 있나요?", 2, 1, 1, 1],
    [4, "해고 예고·서면 통지", "직원을 그만두게 할 때 미리, 글로 알리나요?", 6, 3, 1, 1],
    [4, "퇴직금 적립·지급", "오래 일한 직원이 그만둘 때 줄 퇴직금을 준비하고 있나요?", 8, 3, 1, 1],
    [4, "사직서 수령", "직원이 그만둘 때 사직서를 받아 두나요?", 4, 2, 1, 1],
    [4, "수습기간 명시", "수습 기간을 계약서에 적어 두었나요?", 3, 1, 1, 1],
    [4, "퇴직 시 금품 청산", "그만둔 직원에게 남은 돈을 정리해서 주나요?", 5, 3, 1, 1],
    [5, "4대보험 취득 신고", "새 직원이 오면 4대보험 신고를 하나요?", 7, 3, 1, 1],
    [5, "4대보험 상실 신고", "직원이 그만두면 4대보험 상실 신고를 하나요?", 3, 2, 1, 1],
    [5, "일용·단기 근로자 신고", "하루·단기로 일한 직원도 신고하고 있나요?", 4, 2, 0, 1],
    [5, "근로소득 원천징수", "월급에서 세금을 떼고 신고하나요?", 2, 1, 1, 1],
    [5, "산재 발생 시 처리 절차", "일하다 다치면 어떻게 할지 정해 두었나요?", 3, 3, 1, 1],
    [6, "직장 내 괴롭힘 예방·조치", "괴롭힘이 생기면 누구에게 말할지 정해 두었나요?", 4, 3, 1, 1],
    [6, "법정 의무교육", "직원 교육(성희롱 예방 등)을 하고 있나요?", 2, 2, 1, 1],
    [6, "고충 처리 창구", "직원이 불만을 말할 창구가 있나요?", 3, 1, 1, 1],
    [6, "직원 개인정보 동의", "직원 개인정보를 받을 때 동의서를 받나요?", 1, 1, 1, 1],
    [6, "영상정보처리기기 고지", "매장 CCTV가 있다면 직원에게 알렸나요?", 2, 1, 1, 1],
    [7, "신규 채용 시 안전교육", "처음 온 직원에게 안전 교육을 하나요?", 3, 2, 1, 1],
    [7, "보호구 지급", "위험한 일을 할 때 장갑·보호구를 주나요?", 2, 2, 1, 1],
    [7, "휴게시설", "직원이 쉴 공간이 있나요?", 2, 1, 1, 1],
    [7, "건강진단 안내", "직원 건강검진 안내를 하나요?", 1, 1, 1, 1],
    [7, "비상 연락망 게시", "다쳤을 때 연락할 곳이 붙어 있나요?", 1, 1, 1, 1],
  ];
  const ITEMS = RAW.map(([c, pro, plain, mentions, risk, easy, min], i) => ({ id: `i${String(i + 1).padStart(2, "0")}`, cat: CATS[c], pro, plain, mentions, risk, easy: !!easy, min }));

  /** 우선순위 점수: 인터뷰에서 많이 나오고, 상담에서 자주 문제가 되고, 바로 답할 수 있으면 높다 */
  function score(it) { return it.mentions * 2 + it.risk * 3 + (it.easy ? 2 : 0) - it.min * 2; }
  /** 핵심 n개 추천 (한 영역에서 최대 perCat개, 점수가 같으면 원래 순서) */
  function recommend(items, n = LIMIT, perCat = PER_CAT) {
    const ranked = items.map((it, i) => ({ it, i, s: score(it) })).sort((a, b) => b.s - a.s || a.i - b.i);
    const out = [], per = {};
    for (const r of ranked) {
      if (out.length >= n) break;
      if ((per[r.it.cat] || 0) >= perCat) continue;
      per[r.it.cat] = (per[r.it.cat] || 0) + 1;
      out.push(r.it.id);
    }
    // 영역 제한 때문에 n개를 못 채우면 남은 것 중 점수 순으로 채운다
    for (const r of ranked) { if (out.length >= n) break; if (!out.includes(r.it.id)) out.push(r.it.id); }
    return items.filter((it) => out.includes(it.id)).map((it) => it.id);
  }

  /** 인터뷰에서 끝까지 답한 사장님 수 (샘플): 12개 8명, 20개 4명, 40개 0명 → 사이 값은 직선으로 */
  const DONE_AT = [[0, 9], [LIMIT, 8], [20, 4], [40, 0]];
  function completion(n) {
    if (n >= 40) return 0;
    for (let k = 1; k < DONE_AT.length; k++) {
      const [x0, y0] = DONE_AT[k - 1], [x1, y1] = DONE_AT[k];
      if (n <= x1) return Math.round(y0 + ((y1 - y0) * (n - x0)) / (x1 - x0));
    }
    return 0;
  }

  /** 고른 묶음 검사 → {count, minutes, done, cats, issues:[{level, msg}], ok} */
  function checkSet(ids, items) {
    const sel = items.filter((it) => ids.includes(it.id));
    const minutes = sel.reduce((s, it) => s + it.min, 0);
    const cats = CATS.filter((c) => sel.some((it) => it.cat === c));
    const hard = sel.filter((it) => !it.easy);
    const issues = [];
    if (!sel.length) issues.push({ level: "error", msg: "항목을 하나 이상 골라 주세요" });
    if (sel.length > LIMIT) issues.push({ level: "error", msg: `${sel.length}개예요. ${LIMIT}개를 넘으면 인터뷰에서 끝까지 답한 사장님이 크게 줄었어요` });
    if (minutes > 15) issues.push({ level: "warn", msg: `예상 ${minutes}분. 가게 문 열기 전 10~15분 안에 끝나야 해요` });
    if (hard.length > 3) issues.push({ level: "warn", msg: `서류를 찾아봐야 답할 수 있는 항목이 ${hard.length}개예요 (3개 이하 권장)` });
    const missing = CATS.filter((c) => !cats.includes(c));
    if (sel.length && missing.length) issues.push({ level: "info", msg: `빠진 영역: ${missing.join(", ")} · 정기 진단 다음 회차로 돌릴 수 있어요` });
    return { count: sel.length, minutes, done: completion(sel.length), cats: cats.length, hard: hard.length, issues, ok: !issues.some((x) => x.level === "error") };
  }

  /** 사장님 답 → 상담에서 확인할 항목 ('아니오'·'모름'). 위반 여부를 판정하지 않는다 */
  function toConsult(ids, answers, items) {
    const sel = items.filter((it) => ids.includes(it.id));
    const list = sel.filter((it) => answers[it.id] === "no" || answers[it.id] === "unk").map((it) => ({ id: it.id, cat: it.cat, plain: it.plain, pro: it.pro, a: answers[it.id] }));
    const answered = sel.filter((it) => answers[it.id]).length;
    return { list, answered, total: sel.length };
  }

  /* ---------- 가격 실험 (샘플 가격 · 인터뷰 응답) ---------- */
  const TIERS = [
    { id: "t1", name: "체크만", price: 40000, desc: "월 1회 12칸 진단 + 결과 요약", want: 6, signed: 0 },
    { id: "t2", name: "체크 + 상담", price: 90000, desc: "월 1회 진단 + 분기마다 노무사 상담 30분", want: 4, signed: 3 },
    { id: "t3", name: "체크 + 서류 대행", price: 180000, desc: "진단 + 월 상담 + 계약서·명세서 서식 정리", want: 1, signed: 0 },
  ];
  const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;
  /** 가격안별 예상 월 매출 = 가격 × 계약 수 (계약이 없으면 '쓰겠다' 응답의 1/3로 가정) */
  function revenue(t) {
    const n = t.signed || Math.floor(t.want / 3);
    return { n, sum: n * t.price, assumed: !t.signed };
  }

  /* ---------- AI 결과 검사 ---------- */
  const JUDGE = /(위반|위법|불법|과태료|처벌|의무(입니다|예요)|해야 합니다|해당(합니다|됩니다))/;
  /** Claude 가 다듬은 질문 → {id: plain}. 아는 id, 60자 이하, 질문형, 판단 표현 없음만 받는다. 하나도 없으면 null */
  function normalizePlain(d, ids) {
    if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
    const out = {};
    let rejected = 0;
    d.items.forEach((x) => {
      if (!x || typeof x.id !== "string" || typeof x.plain !== "string") return;
      const p = x.plain.trim();
      if (!ids.includes(x.id) || out[x.id]) return;
      if (!p || p.length > 60 || !/(\?|나요|까요|있어요|했어요)\s*$/.test(p) || JUDGE.test(p)) { rejected++; return; }
      out[x.id] = p;
    });
    return Object.keys(out).length ? { plain: out, rejected } : null;
  }

  /** 상품 기획서 (마크다운) */
  function planMd(ids, items, tier, plainMap) {
    const c = checkSet(ids, items);
    const sel = items.filter((it) => ids.includes(it.id));
    return [
      "## 소상공인 월 정기 노무 진단 (기획안)",
      "",
      `- 진단표: 핵심 ${c.count}개 · 예상 ${c.minutes}분 · 영역 ${c.cats}/${CATS.length}`,
      `- 근거: 사장님 ${INTERVIEWS}명 인터뷰 · 끝까지 답한 사람(추정) ${c.done}/${INTERVIEWS}명`,
      `- 가격(실험가, 샘플): ${tier.name} 월 ${won(tier.price)} · ${tier.desc}`,
      "- 진단 결과는 위반 판정이 아니라 '노무사 상담에서 확인할 항목' 목록으로 드립니다.",
      "",
      "### 진단 항목",
      ...sel.map((it, i) => `${i + 1}. [${it.cat}] ${(plainMap && plainMap[it.id]) || it.plain}`),
    ].join("\n");
  }

  return { LIMIT, PER_CAT, INTERVIEWS, CATS, ITEMS, score, recommend, completion, checkSet, toConsult, TIERS, won, revenue, JUDGE, normalizePlain, planMd };
});
