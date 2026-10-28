/* 아침한장 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.AchimHanjang, Node(테스트)에서는 require('./logic.js').
 *
 * 핵심 규칙 하나: 요약에 나오는 숫자는 원문에 '그대로' 있어야 한다.
 *   extractNumbers() 로 숫자와 단위를 뽑고, checkNumbers() 로 원문과 대조한다.
 *   Claude 요약이든 사람이 고친 문장이든 같은 검사를 거친다.
 *   원문에 없는 숫자가 하나라도 있으면 그 문장은 쓰지 않거나(Claude) 발송을 막는다(사람).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AchimHanjang = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 숫자 ---------- */
  // 긴 단위를 먼저 둔다 (개월 → 개). 만·억·천 뒤에는 세는 말이 한 번 더 올 수 있다 (42만 건 → '만건')
  const UNITS = ["퍼센트", "%", "TEU", "kg", "개월", "분기", "번째", "상자", "점포", "달러", "시간", "배", "원", "건", "명", "곳", "개", "톤", "년", "월", "일", "주", "대", "분"];
  const UNIT_ALT = UNITS.map((u) => u.replace(/[%]/g, "\\$&")).join("|");
  const NUM_RE = new RegExp(`(\\d+(?:[.,]\\d+)*)(?:\\s?([만억천]))?(?:\\s?(${UNIT_ALT}))?`, "g");

  /** 문장 속 숫자 → [{raw, value, unit}]. value 는 쉼표를 뺀 글자 ("1,240" → "1240") */
  function extractNumbers(text) {
    const out = [];
    const s = String(text || "");
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(s))) {
      const unit = (m[2] || "") + (m[3] === "퍼센트" ? "%" : (m[3] || ""));
      out.push({ raw: m[0].trim(), value: m[1].replace(/,/g, ""), unit, at: m.index });
    }
    return out;
  }

  /** 요약 문장의 숫자를 원문과 대조 → {ok, good:[raw], bad:[raw]}
   *  같은 값이 원문에 있어야 하고, 요약에 단위가 붙었다면 원문에서도 같은 단위여야 한다.
   *  '42만'처럼 세는 말만 빠진 것은 같은 숫자로 본다 (원문 '42만 건'). */
  function sameUnit(a, b) {
    return !a || a === b || (/^[만억천]$/.test(a) && b.startsWith(a));
  }
  function checkNumbers(summary, source) {
    const src = extractNumbers(source);
    const good = [], bad = [];
    extractNumbers(summary).forEach((n) => {
      const hit = src.some((x) => x.value === n.value && sameUnit(n.unit, x.unit));
      (hit ? good : bad).push(n.raw);
    });
    return { ok: bad.length === 0, good, bad };
  }

  /* ---------- 문장 ---------- */
  function sentences(body) {
    return String(body || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 4);
  }
  /** 두 글자 조각 (띄어쓰기·기호 무시) */
  function grams(s) {
    const t = String(s || "").replace(/[\s\p{P}\p{S}]/gu, "");
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  }
  function overlap(a, b) {
    const A = grams(a), B = grams(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    A.forEach((x) => { if (B.has(x)) hit++; });
    return hit / Math.min(A.size, B.size);
  }

  /* ---------- 규칙 요약 (AI가 없을 때) ---------- */
  /** 원문 문장을 그대로 골라 쓴다. 그래서 숫자가 틀릴 수 없다.
   *  점수: 숫자 있음 +2, 제목과 겹침 +2×비율, 첫 문장 +1, 너무 긴 문장 −1 */
  function ruleSummary(article, n) {
    const ss = sentences(article.body);
    const scored = ss.map((s, i) => ({
      s, i,
      score: (extractNumbers(s).length ? 2 : 0) + overlap(s, article.title) * 2 + (i === 0 ? 1 : 0) - (s.length > 110 ? 1 : 0),
    }));
    const pick = scored.slice().sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n || 2).sort((a, b) => a.i - b.i);
    return { id: article.id, headline: article.title, points: pick.map((p) => p.s), why: "", by: "rule" };
  }

  /* ---------- Claude 응답 검사 ---------- */
  /** 형식이 틀리면 null. 원문에 없는 숫자가 든 문장은 버리고 rejected 에 남긴다.
   *  어떤 기사의 문장이 다 버려지면 그 기사만 규칙 요약으로 채운다. */
  function normalizeDigest(d, articles) {
    if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
    const byId = new Map(articles.map((a) => [a.id, a]));
    const rejected = [];
    const seen = new Set();
    const items = [];
    d.items.forEach((it) => {
      if (!it || typeof it.id !== "string" || !byId.has(it.id) || seen.has(it.id)) return;
      seen.add(it.id);
      const a = byId.get(it.id);
      const pts = (Array.isArray(it.points) ? it.points : []).filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim().slice(0, 160)).slice(0, 3);
      const ok = pts.filter((p) => {
        const c = checkNumbers(p, a.body);
        if (!c.ok) rejected.push({ id: a.id, text: p, bad: c.bad });
        return c.ok;
      });
      const head = typeof it.headline === "string" && it.headline.trim() ? it.headline.trim().slice(0, 60) : a.title;
      const headOk = checkNumbers(head, a.title + " " + a.body).ok;
      const why = typeof it.why === "string" && checkNumbers(it.why, a.body).ok ? it.why.trim().slice(0, 140) : "";
      if (!ok.length) { items.push({ ...ruleSummary(a), fellBack: true }); return; }
      items.push({ id: a.id, headline: headOk ? head : a.title, points: ok, why, by: "ai" });
    });
    if (!items.length) return null;
    // Claude 가 빠뜨린 기사는 규칙 요약으로
    articles.forEach((a) => { if (!seen.has(a.id)) items.push({ ...ruleSummary(a), fellBack: true }); });
    const order = new Map(articles.map((a, i) => [a.id, i]));
    items.sort((x, y) => order.get(x.id) - order.get(y.id));
    const intro = typeof d.intro === "string" && d.intro.trim() && checkNumbers(d.intro, articles.map((a) => a.body).join(" ")).ok ? d.intro.trim().slice(0, 160) : "";
    return { items, intro, rejected };
  }

  /* ---------- 같은 소식 묶기 ---------- */
  /** 원문끼리 숫자(단위 포함) 2개 이상 + 글 조각 겹침 0.35 이상이면 같은 소식으로 본다 */
  function findDuplicates(articles) {
    const dup = {};
    for (let i = 0; i < articles.length; i++) {
      for (let j = 0; j < i; j++) {
        if (dup[articles[j].id]) continue;
        const A = new Set(extractNumbers(articles[i].body).filter((n) => n.unit).map((n) => n.value + n.unit));
        const shared = extractNumbers(articles[j].body).filter((n) => n.unit && A.has(n.value + n.unit)).map((n) => n.value + n.unit);
        if (new Set(shared).size >= 2 && overlap(articles[i].body, articles[j].body) >= 0.35) { dup[articles[i].id] = articles[j].id; break; }
      }
    }
    return dup; // {나중 기사 id: 먼저 기사 id}
  }

  /* ---------- 이번 호 ---------- */
  const FREE_COUNT = 3;
  /** 무료판은 앞 3개(해설 없음), 유료판은 전부 + 해설 */
  function issueFor(items, tier) {
    return tier === "paid" ? items : items.slice(0, FREE_COUNT).map((x) => ({ ...x, why: "" }));
  }
  /** 사람이 고친 문장까지 포함해 발송 가능한지 → {ready, problems:[{id, text, bad}]} */
  function sendCheck(items, articles) {
    const byId = new Map(articles.map((a) => [a.id, a]));
    const problems = [];
    items.forEach((it) => {
      const a = byId.get(it.id);
      if (!a) return;
      [it.headline, ...it.points, it.why].filter(Boolean).forEach((t) => {
        const c = checkNumbers(t, a.title + " " + a.body);
        if (!c.ok) problems.push({ id: it.id, text: t, bad: c.bad });
      });
    });
    return { ready: items.length > 0 && problems.length === 0, problems };
  }
  /** 읽는 시간 (분, 1분에 500자) */
  function readMinutes(items) {
    const chars = items.reduce((s, it) => s + it.headline.length + it.points.join("").length + (it.why || "").length, 0);
    return Math.max(1, Math.round(chars / 500));
  }

  /* ---------- 내보내기 ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function toText(title, intro, items, articles) {
    const byId = new Map(articles.map((a) => [a.id, a]));
    const body = items.map((it, i) => {
      const a = byId.get(it.id) || {};
      return `${i + 1}. ${it.headline}\n${it.points.map((p) => `  - ${p}`).join("\n")}${it.why ? `\n  → ${it.why}` : ""}\n  (출처: ${a.source || "-"})`;
    }).join("\n\n");
    return `${title}\n${intro ? intro + "\n" : ""}\n${body}\n`;
  }
  function toEmailHtml(title, intro, items, articles, accent) {
    const c = accent || "#D9480F";
    const byId = new Map(articles.map((a) => [a.id, a]));
    const rows = items.map((it, i) => {
      const a = byId.get(it.id) || {};
      return `<tr><td style="padding:16px 0;border-top:1px solid #eee"><div style="font-size:12px;color:${c};font-weight:700">${i + 1} · ${esc(a.source || "")}</div><div style="font-size:17px;font-weight:700;margin:4px 0 8px">${esc(it.headline)}</div><ul style="margin:0;padding-left:18px;color:#333">${it.points.map((p) => `<li style="margin:3px 0">${esc(p)}</li>`).join("")}</ul>${it.why ? `<p style="margin:8px 0 0;color:#555;font-size:14px">→ ${esc(it.why)}</p>` : ""}</td></tr>`;
    }).join("");
    return `<table role="presentation" width="100%" style="max-width:600px;margin:0 auto;font-family:sans-serif;line-height:1.6"><tr><td><h1 style="font-size:20px;margin:0 0 6px">${esc(title)}</h1>${intro ? `<p style="color:#555;margin:0 0 8px">${esc(intro)}</p>` : ""}</td></tr>${rows}<tr><td style="padding-top:16px;font-size:12px;color:#999">수신 거부는 메일 하단 링크에서 할 수 있어요.</td></tr></table>`;
  }

  /* ---------- 샘플 기사 (모두 가상의 매체·회사·숫자) ---------- */
  const SAMPLE = [
    { id: "a1", source: "가상 물류일보", time: "05:42", title: "수도권 새벽배송 물량 석 달 새 18% 늘어", body: "가상의 새벽배송 업체 '새벽길' 집계에 따르면 9월 수도권 새벽배송 물량은 하루 평균 42만 건으로 6월보다 18% 늘었다. 늘어난 물량의 절반가량은 신선식품이었다. 회사는 연말까지 서해권에 2번째 거점을 열 계획이다. 업계에서는 야간 인력 확보가 다음 과제라는 말이 나온다." },
    { id: "a2", source: "가상 해운경제", time: "05:55", title: "가람항 3분기 환적 물동량 6.2% 증가", body: "가람항의 3분기 환적 물동량은 312만 TEU로 지난해 같은 기간보다 6.2% 늘었다. 북미 항로 선복이 줄면서 환적 수요가 몰린 영향이다. 터미널 운영사들은 야드 혼잡을 줄이려 반출입 예약제를 12월부터 전 부두로 넓힌다. 선사 관계자는 4분기에도 증가세가 이어질 것으로 봤다." },
    { id: "a3", source: "가상 유통리포트", time: "06:03", title: "택배 단가 다시 오른다… 중소 화주 부담", body: "가상의 택배사 '누리택배'는 다음 달부터 중소 화주 계약 단가를 상자당 평균 120원 올린다. 올해 들어 두 번째 인상이다. 회사는 유류비와 인건비가 1년 새 각각 9%, 7% 올랐다고 설명했다. 월 5,000상자 미만 화주가 주로 영향을 받는다." },
    { id: "a4", source: "가상 물류일보", time: "06:10", title: "누리택배, 중소 화주 단가 상자당 120원 인상", body: "누리택배가 중소 화주 대상 택배 단가를 상자당 120원 인상한다고 밝혔다. 적용은 다음 달 1일부터다. 월 5,000상자 미만 화주 계약이 대상이며, 회사는 유류비와 인건비 상승을 이유로 들었다." },
    { id: "a5", source: "가상 해운경제", time: "06:18", title: "수도권 냉동창고 공실률 4년 만에 최저", body: "수도권 냉동·냉장 창고 공실률이 3분기 7.5%로 떨어졌다는 가상 부동산 조사가 나왔다. 2022년 이후 가장 낮다. 신규 공급이 1년 새 30% 줄어든 반면 식품 이커머스 수요는 꾸준했다. 임대료는 평당 월 5만 2천 원 수준으로 올랐다." },
    { id: "a6", source: "가상 테크물류", time: "06:25", title: "물류센터 로봇 피킹 도입 41곳으로", body: "자율이동로봇(AMR)을 피킹 작업에 쓰는 물류센터 운영사가 41곳으로 늘었다는 가상 협회 조사가 나왔다. 도입 기업의 평균 피킹 생산성은 시간당 120건에서 210건으로 올랐다. 다만 초기 비용을 회수하는 데 평균 2.5년이 걸렸다." },
    { id: "a7", source: "가상 물류일보", time: "06:31", title: "화물 운임 협의체 다시 열려… 결론은 12월께", body: "화주·운송사·차주 단체가 참여하는 가상의 운임 협의체가 이번 주 다시 열렸다. 협의체는 컨테이너 품목부터 논의하고 결론은 12월께 낼 계획이다. 운송사들은 유가 변동을 운임에 자동 반영하는 방식을 요구하고 있다." },
    { id: "a8", source: "가상 유통리포트", time: "06:40", title: "반품 물류 대행 이용 기업 1년 새 2배", body: "온라인 반품을 모아 검수와 재판매까지 맡는 반품 대행 서비스 이용 기업이 1년 새 2배로 늘었다. 가상의 대행사 '되돌림'은 월 처리량이 8만 건을 넘었다고 밝혔다. 의류 반품률이 25% 안팎으로 높은 것이 배경이다." },
    { id: "a9", source: "가상 해운경제", time: "06:47", title: "아시아-유럽 항공화물 운임 3주 연속 하락", body: "아시아-유럽 항공화물 운임이 3주 연속 내렸다. 가상 운임지수는 kg당 3.1달러로 전주보다 4% 낮다. 전자상거래 화물은 늘었지만 여객기 화물칸 공급이 더 빠르게 늘었다." },
    { id: "a10", source: "가상 테크물류", time: "06:52", title: "중소 물류사 TMS 도입률 23%에 그쳐", body: "중소 물류사 300곳을 조사한 결과 운송관리시스템(TMS)을 쓰는 곳은 23%에 그쳤다. 쓰지 않는 이유로는 비용(41%)과 기존 업무 방식(33%)이 꼽혔다. 조사를 맡은 가상 연구소는 월 구독형 제품이 늘면서 도입이 빨라질 것으로 봤다." },
    { id: "a11", source: "가상 물류일보", time: "07:05", title: "화물 매칭 스타트업 '짐길', 80억 원 투자 유치", body: "가상의 화물 매칭 스타트업 '짐길'이 80억 원 규모 시리즈A 투자를 받았다. 등록 차주는 1만 2천 명, 월 거래액은 45억 원이다. 회사는 투자금으로 정산 자동화와 영남권 확장에 나선다." },
    { id: "a12", source: "가상 유통리포트", time: "07:12", title: "편의점 택배 접수 1년 새 15% 증가", body: "편의점에서 접수한 개인 택배가 1년 새 15% 늘었다. 가상 편의점 체인 '골목24'의 9월 접수는 210만 건이다. 중고거래가 늘어난 영향으로, 체인은 무인 접수기를 300개 점포에 더 놓는다." },
  ];
  const SAMPLE_PICK = ["a1", "a3", "a2", "a5", "a6", "a10", "a8", "a11"];

  return { SAMPLE, SAMPLE_PICK, UNITS, extractNumbers, checkNumbers, sentences, grams, overlap, ruleSummary, normalizeDigest, findDuplicates, FREE_COUNT, issueFor, sendCheck, readMinutes, esc, toText, toEmailHtml };
});
