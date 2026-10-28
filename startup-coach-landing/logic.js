/* 다음걸음 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Daeumgeoleum, Node(테스트)에서는 require('./logic.js').
 *
 *   상품 구성: 1회 상담과 4주 패키지의 회당 가격을 비교한다.
 *   문구: Claude(또는 규칙)가 랜딩 문구를 쓰고, 과장 표현 검사(lintClaims)를 반드시 거친다.
 *         걸린 줄은 게시 동의한 실제 후기 또는 사실 문장으로 바꾼다(cleanCopy). AI 결과도 예외가 없다.
 *   실험: A/B 방문·신청 수로 전환율과 차이가 우연인지(두 비율 z 검정) 본다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Daeumgeoleum = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const won = (n) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;

  /* ---------- 상품 구성 ---------- */
  function packageMath(singlePrice, pack) {
    const sessions = Math.max(1, Math.floor(Number(pack.sessions) || 1));
    const price = Math.max(0, Number(pack.price) || 0);
    const per = Math.round(price / sessions);
    const save = singlePrice * sessions - price;
    return { sessions, price, per, save, rate: singlePrice ? Math.round((1 - per / singlePrice) * 1000) / 10 : 0, cheaper: per < singlePrice };
  }

  /* ---------- 과장 표현 검사 ---------- */
  const CLAIMS = [
    { re: /합격\s*(을\s*)?보장|보장(된|하는)?\s*합격|취업\s*보장|이직\s*보장/, why: "결과를 보장할 수 없어요" },
    { re: /100\s*%|백\s*퍼센트/, why: "확인할 수 없는 수치예요" },
    { re: /무조건|반드시\s*(합격|이직|취업)|누구나/, why: "모든 사람에게 같은 결과를 약속하는 말이에요" },
    { re: /업계\s*(최고|1위|최초)|국내\s*(최고|1위|유일)|최고의/, why: "비교 근거가 없는 최상급 표현이에요" },
    { re: /연봉\s*\d+\s*(배|%)|연봉\s*(상승|인상)\s*보장/, why: "근거 없는 연봉 숫자예요" },
    { re: /\d+\s*(주|일)\s*만에\s*(합격|이직|취업)/, why: "기간 안 결과를 약속하는 말이에요" },
    { re: /합격(하기|시켜)/, why: "버튼이 결과를 약속해요" },
  ];
  /** 걸린 표현 목록 → [{field, match, why}] */
  function lintClaims(copy) {
    const out = [];
    const check = (field, text) => {
      for (const c of CLAIMS) {
        const m = String(text || "").match(c.re);
        if (m) out.push({ field, match: m[0], why: c.why });
      }
    };
    check("headline", copy.headline); check("sub", copy.sub);
    (copy.bullets || []).forEach((b, i) => check(`bullets.${i}`, b));
    check("cta", copy.cta);
    return out;
  }
  const hasClaim = (t) => CLAIMS.some((c) => c.re.test(String(t || "")));

  /* ---------- 후기 ---------- */
  const quote = (r) => `“${r.text}” — ${r.who}`;
  /** 게시 동의한 후기만 쓴다 */
  const usable = (reviews) => reviews.filter((r) => r.consent === true);
  /** 문구에 쓰인 후기 중 동의가 없는 것 */
  function unconsentedUsed(copy, reviews) {
    const all = [copy.headline, copy.sub, ...(copy.bullets || [])].join("\n");
    return reviews.filter((r) => !r.consent && all.includes(r.text));
  }

  /* ---------- 문구 ---------- */
  function factSub(pack, singlePrice) {
    const m = packageMath(singlePrice, pack);
    return `${m.sessions}회 · ${won(m.price)} (회당 ${won(m.per)}) · ${(pack.includes || []).slice(0, 2).join(", ")}`;
  }
  function ruleCopy(pack, singlePrice, reviews) {
    const m = packageMath(singlePrice, pack);
    const rv = usable(reviews).slice(0, 1).map(quote);
    return {
      headline: `${m.sessions}주 동안, 직무 전환을 함께 준비합니다`,
      sub: factSub(pack, singlePrice),
      bullets: [...(pack.includes || []).slice(0, 3), ...rv].slice(0, 4),
      cta: `${m.sessions}주 패키지 신청하기`,
    };
  }
  /** 과장 걸린 칸을 사실 문장·실제 후기로 바꾼다 → {copy, replaced} */
  function cleanCopy(copy, pack, singlePrice, reviews) {
    const m = packageMath(singlePrice, pack);
    const replaced = [];
    const pool = usable(reviews).map(quote).filter((q) => !(copy.bullets || []).includes(q));
    const out = { ...copy, bullets: [] };
    if (hasClaim(copy.headline)) { out.headline = `${m.sessions}주 동안, 직무 전환을 함께 준비합니다`; replaced.push({ field: "headline", from: copy.headline, to: out.headline }); }
    if (hasClaim(copy.sub)) { out.sub = factSub(pack, singlePrice); replaced.push({ field: "sub", from: copy.sub, to: out.sub }); }
    (copy.bullets || []).forEach((b) => {
      if (!hasClaim(b)) { out.bullets.push(b); return; }
      const to = pool.shift();
      replaced.push({ field: "bullet", from: b, to: to || "(빼기)" });
      if (to) out.bullets.push(to);
    });
    if (hasClaim(copy.cta)) { out.cta = `${m.sessions}주 패키지 신청하기`; replaced.push({ field: "cta", from: copy.cta, to: out.cta }); }
    return { copy: out, replaced };
  }
  /** Claude 응답 검사 → 쓸 수 없으면 null (과장 검사는 그다음 cleanCopy가 한다) */
  function normalizeCopy(d) {
    if (!d || typeof d !== "object") return null;
    const s = (x, n) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : "");
    const headline = s(d.headline, 60), sub = s(d.sub, 140), cta = s(d.cta, 20);
    const bullets = (Array.isArray(d.bullets) ? d.bullets : []).filter((b) => typeof b === "string" && b.trim()).map((b) => b.trim().slice(0, 120)).slice(0, 4);
    if (!headline || !cta || bullets.length < 2) return null;
    return { headline, sub, bullets, cta };
  }

  /* ---------- 게시 전 확인 ---------- */
  function publishCheck(copy, pack, singlePrice, reviews) {
    const lint = lintClaims(copy);
    const bad = unconsentedUsed(copy, reviews);
    const text = [copy.headline, copy.sub, ...(copy.bullets || [])].join(" ");
    const priced = text.includes(won(Number(pack.price)));
    const checks = [
      { ok: lint.length === 0, label: lint.length ? `과장 표현 ${lint.length}건` : "과장 표현 없음" },
      { ok: bad.length === 0, label: bad.length ? `게시 동의 없는 후기 ${bad.length}건` : "쓴 후기는 모두 게시 동의" },
      { ok: priced, label: priced ? "가격이 적혀 있음" : `가격(${won(pack.price)})이 문구에 없음` },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  }

  /* ---------- A/B 실험 ---------- */
  /** 표준정규 누적분포 (Abramowitz–Stegun 근사) */
  function phi(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }
  function abTest(a, b, minVisitors) {
    const n1 = Math.max(0, Math.floor(a.visitors)), n2 = Math.max(0, Math.floor(b.visitors));
    const x1 = Math.min(n1, Math.max(0, Math.floor(a.apps))), x2 = Math.min(n2, Math.max(0, Math.floor(b.apps)));
    const r1 = n1 ? x1 / n1 : 0, r2 = n2 ? x2 / n2 : 0;
    const res = { rateA: Math.round(r1 * 1000) / 10, rateB: Math.round(r2 * 1000) / 10, lift: r1 ? Math.round(((r2 - r1) / r1) * 100) : null, z: 0, p: 1, verdict: "", winner: "" };
    if (n1 < (minVisitors || 300) || n2 < (minVisitors || 300)) { res.verdict = `표본 부족 · 안마다 방문 ${minVisitors || 300}명 이상 모아 주세요`; return res; }
    const pool = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
    res.z = se ? Math.round(((r2 - r1) / se) * 100) / 100 : 0;
    res.p = Math.round(2 * (1 - phi(Math.abs(res.z))) * 10000) / 10000;
    if (res.p < 0.05) { res.winner = r2 > r1 ? "B" : "A"; res.verdict = `${res.winner}안이 낫다고 볼 수 있어요 (p=${res.p})`; }
    else res.verdict = `차이가 우연일 수 있어요 (p=${res.p}) · 더 모아 보세요`;
    return res;
  }

  function toText(copy) {
    return [`# ${copy.headline}`, copy.sub, "", ...(copy.bullets || []).map((b) => `- ${b}`), "", `[${copy.cta}]`].join("\n");
  }

  return { won, packageMath, CLAIMS, lintClaims, hasClaim, quote, usable, unconsentedUsed, ruleCopy, cleanCopy, normalizeCopy, publishCheck, phi, abTest, toText };
});
