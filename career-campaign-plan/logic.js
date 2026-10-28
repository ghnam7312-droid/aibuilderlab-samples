/* 응답대로 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Eungdapdaero, Node(테스트)에서는 require('./logic.js').
 *
 * 원칙: 기획서의 모든 주장은 실제 설문 응답 번호(R01…)를 근거로 가진다.
 *   - 페르소나 통계(비율·가격·채널)는 AI 글이 아니라 근거 응답에서 다시 계산한다.
 *   - checkClaim()은 근거가 없거나, 없는 응답 번호를 쓰거나, 문장 속 %·명 숫자가 근거와 다르면 걸러 낸다.
 *   - 효능·건강 표현(healthClaim)은 AI·규칙이 판단하지 않고 '사람 확인 필요'로 넘긴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Eungdapdaero = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PRODUCT = { name: "톡차", line: "당을 줄인 스파클링 티 (가상의 신제품, 캔 355ml)" };
  const WHEN = ["수업·업무 사이", "운동 후", "식사·모임"];
  const CRITERIA = ["당 적음", "카페인 부담 적음", "맛", "가격", "디자인", "용량"];
  const CHANNELS = ["편의점", "카페", "온라인"];
  const PERSONA = {
    "수업·업무 사이": { name: "공강 사이 리프레셔", scene: "수업 사이" },
    "운동 후": { name: "운동 끝 갈증러", scene: "운동 끝나고" },
    "식사·모임": { name: "모임 자리 분위기파", scene: "식사 자리에서" },
  };
  const PHRASE = { "당 적음": "달지 않은", "카페인 부담 적음": "커피 대신", "맛": "톡 쏘는", "가격": "부담 없는", "디자인": "들고 다니기 좋은", "용량": "넉넉한" };
  const OVERCLAIM = /(무조건|100\s*%|역대급|최고|완벽|1위|유일한)/;
  const HEALTH = /(다이어트|살\s*빠|체지방|면역|피로\s*회복|해독|디톡스|건강에\s*좋|질병|혈당|붓기)/;

  /* ---------- 샘플 설문 52건 (가상) ---------- */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const QUOTES = {
    "수업·업무 사이": ["오후 수업 전에 커피는 부담돼요", "카페인 없이 정신 깨는 게 필요해요", "공강에 편의점 들러서 하나씩 사요", "단 음료는 마시고 나면 더 졸려요", "커피 세 잔째는 속이 쓰려요", "가방에 넣고 다닐 수 있으면 좋겠어요"],
    "운동 후": ["운동하고 이온음료는 너무 달아요", "탄산이 당기는데 설탕은 싫어요", "헬스장 앞 편의점에서 사요", "차가운 게 바로 필요해요", "양이 좀 많았으면 해요"],
    "식사·모임": ["술 대신 마실 게 마땅치 않아요", "모임에서 사진 찍었을 때 예쁘면 좋아요", "배달 시킬 때 같이 담아요", "맛이 특이하면 한 번은 사 봐요", "탄산이랑 차 맛이 같이 나면 궁금해요"],
  };
  function sampleResponses() {
    const r = rng(52);
    const plan = [["수업·업무 사이", 22, ["카페인 부담 적음", "당 적음", "가격", "디자인"], [0.82, 0.55, 0.45, 0.2], "편의점"],
      ["운동 후", 16, ["당 적음", "용량", "맛", "가격"], [0.88, 0.5, 0.4, 0.3], "편의점"],
      ["식사·모임", 14, ["맛", "디자인", "당 적음", "가격"], [0.79, 0.57, 0.36, 0.3], "온라인"]];
    const out = [];
    let n = 0;
    for (const [when, count, crit, prob, ch] of plan) {
      for (let i = 0; i < count; i++) {
        n++;
        // 비율이 정확히 나오도록: i번째 사람은 앞에서부터 round(count*p)명 안에 들면 그 기준을 고른다
        const criteria = crit.filter((c, k) => (i + k * 7) % count < Math.round(count * prob[k]));
        if (!criteria.length) criteria.push(crit[0]);
        const status = r() < 0.7 ? "대학생" : r() < 0.6 ? "직장인" : "취업 준비";
        const channel = i % 4 === 3 ? CHANNELS[(CHANNELS.indexOf(ch) + 1) % 3] : ch;
        const price = 1500 + Math.round((when === "식사·모임" ? 8 + r() * 8 : 3 + r() * 9)) * 100;
        const q = QUOTES[when];
        out.push({ id: `R${String(n).padStart(2, "0")}`, age: 20 + Math.floor(r() * 10), status, when, criteria, price, channel, quote: i < q.length ? q[i] : "" });
      }
    }
    return out;
  }

  /** 받침에 맞는 조사 */
  function jo(word, withB, withoutB) {
    const w = String(word), c = w.charCodeAt(w.length - 1);
    return w + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? withB : withoutB);
  }

  /* ---------- 숫자 도우미 ---------- */
  const pctOf = (n, total) => (total ? Math.round((n / total) * 100) : 0);
  function median(nums) { const a = nums.slice().sort((x, y) => x - y); if (!a.length) return 0; const m = a.length >> 1; return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2 / 100) * 100; }
  function countBy(list, f) { const m = {}; list.forEach((x) => [].concat(f(x)).forEach((k) => { m[k] = (m[k] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); }

  /** 근거 응답 묶음 → 통계 (AI 글이 아니라 여기서 계산한 숫자만 화면에 쓴다) */
  function statsOf(refs, responses) {
    const set = new Set(refs);
    const list = responses.filter((r) => set.has(r.id));
    return { n: list.length, share: pctOf(list.length, responses.length), criteria: countBy(list, (r) => r.criteria), price: median(list.map((r) => r.price)), channel: (countBy(list, (r) => r.channel)[0] || [""])[0], list };
  }

  /* ---------- 규칙 기획: 마시는 상황으로 나누기 ---------- */
  function rulePlan(responses) {
    const personas = WHEN.map((w) => {
      const refs = responses.filter((r) => r.when === w).map((r) => r.id);
      if (refs.length < 3) return null;
      const s = statsOf(refs, responses);
      const top = s.criteria.slice(0, 2).map(([c]) => c);
      return { name: PERSONA[w].name, when: w, summary: `${w}에 마시고, ${jo(top.join("·"), "을", "를")} 먼저 봐요. 응답 ${s.n}명(${s.share}%).`, needs: top, refs };
    }).filter(Boolean);
    const messages = personas.map((p) => {
      const c = p.needs[0];
      return { copy: `${PERSONA[p.when].scene}, ${PHRASE[c]} ${PRODUCT.name} 한 캔`, persona: p.name, angle: c, refs: responses.filter((r) => r.when === p.when && r.criteria.includes(c)).map((r) => r.id) };
    });
    const all = countBy(responses, (r) => r.criteria)[0];
    if (all) messages.push({ copy: `${PHRASE[all[0]]} 탄산, 매일 손이 가는 ${PRODUCT.name}`, persona: "전체", angle: all[0], refs: responses.filter((r) => r.criteria.includes(all[0])).map((r) => r.id) });
    return { personas, messages };
  }

  /* ---------- 근거 검사 ---------- */
  /** → { ok, refs(유효한 것만), issues:[] } */
  function checkClaim(text, refs, responses) {
    const ids = new Set(responses.map((r) => r.id));
    const given = Array.isArray(refs) ? refs.map(String) : [];
    const valid = [...new Set(given.filter((id) => ids.has(id)))];
    const issues = [];
    if (given.length > valid.length) issues.push(`없는 응답 번호 ${given.filter((id) => !ids.has(id)).slice(0, 3).join(", ")}`);
    if (!valid.length) issues.push("근거 응답 없음");
    const t = String(text || "");
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
      const want = pctOf(valid.length, responses.length);
      if (Math.abs(+m[1] - want) > 1) issues.push(`${m[1]}%는 근거와 다름 (근거 ${valid.length}명 = ${want}%)`);
    }
    for (const m of t.matchAll(/(\d+)\s*명/g)) {
      if (+m[1] !== valid.length && +m[1] !== responses.length) issues.push(`${m[1]}명은 근거와 다름 (근거 ${valid.length}명, 전체 ${responses.length}명)`);
    }
    return { ok: !issues.length, refs: valid, issues };
  }
  const overclaim = (t) => { const m = String(t || "").match(OVERCLAIM); return m ? m[1] : ""; };
  const healthClaim = (t) => { const m = String(t || "").match(HEALTH); return m ? m[1] : ""; };

  /** 메시지 평가표: 근거 · 타깃 · 길이 · 과장 없음 (각 1~5, 합 20) + 효능 표현 표시 */
  function score(msg, personas) {
    const n = msg.refs.length;
    const p = personas.find((x) => x.name === msg.persona);
    const key = p ? [PERSONA[p.when] ? PERSONA[p.when].scene : "", ...p.needs.map((c) => PHRASE[c])] : [PHRASE[msg.angle]];
    const len = msg.copy.replace(/\s/g, "").length;
    const s = {
      evidence: n >= 10 ? 5 : n >= 6 ? 4 : n >= 3 ? 3 : n >= 1 ? 2 : 1,
      target: key.some((k) => k && msg.copy.includes(k)) ? 5 : 2,
      length: len <= 12 ? 5 : len <= 16 ? 4 : len <= 20 ? 3 : 2,
      honest: overclaim(msg.copy) ? 1 : 5,
    };
    return { ...s, total: s.evidence + s.target + s.length + s.honest, health: healthClaim(msg.copy) };
  }

  /** Claude 응답 검사: 근거 없는 페르소나·메시지는 버리고, 통계는 다시 계산할 수 있게 refs만 믿는다 */
  function normalizePlan(data, responses) {
    if (!data || typeof data !== "object" || !Array.isArray(data.personas) || !Array.isArray(data.messages)) return null;
    const dropped = [];
    const personas = [];
    for (const p of data.personas.slice(0, 4)) {
      const name = String((p && p.name) || "").trim().slice(0, 20);
      const c = checkClaim(p && p.summary, p && p.refs, responses);
      if (!name || c.refs.length < 3 || !c.ok) { dropped.push({ kind: "페르소나", text: name || "(이름 없음)", issues: c.refs.length < 3 && c.ok ? ["근거 응답 3건 미만"] : c.issues }); continue; }
      personas.push({ name, when: String(p.when || ""), summary: String(p.summary || "").trim().slice(0, 140), needs: (Array.isArray(p.needs) ? p.needs : []).map(String).filter((x) => CRITERIA.includes(x)).slice(0, 3), refs: c.refs });
    }
    const messages = [];
    for (const m of data.messages.slice(0, 6)) {
      const copy = String((m && m.copy) || "").replace(/^["'“]+|["'”]+$/g, "").trim();
      const c = checkClaim(copy, m && m.refs, responses);
      const why = !copy || copy.length > 40 ? ["문구 길이"] : overclaim(copy) ? [`과장 표현 ‘${overclaim(copy)}’`] : c.ok ? [] : c.issues;
      if (why.length) { dropped.push({ kind: "메시지", text: copy || "(빈 문구)", issues: why }); continue; }
      const persona = String(m.persona || "");
      messages.push({ copy, persona: personas.some((p) => p.name === persona) ? persona : "전체", angle: CRITERIA.includes(m.angle) ? m.angle : "", refs: c.refs });
    }
    if (personas.length < 2 || messages.length < 2) return null;
    return { personas: personas.slice(0, 3), messages: messages.slice(0, 4), dropped };
  }

  /** 수업 과제 첫 초안: AI가 만든 설문 결과를 사실처럼 쓴 버전 (근거 검사 시연용) */
  function firstDraft() {
    return {
      personas: [
        { name: "헬시 플레저 MZ", summary: "응답자의 78%가 제로 칼로리 음료를 매일 마신다", refs: [] },
        { name: "갓생 직장인", summary: "설문 300명 중 64%가 오후 3시에 카페인을 찾는다", refs: ["R03", "R88"] },
        { name: "공강 사이 리프레셔", summary: "수업 사이에 마시는 응답 22명(42%)", refs: ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "R12", "R13", "R14", "R15", "R16", "R17", "R18", "R19", "R20", "R21", "R22"] },
      ],
      messages: [
        { copy: "마시면 살 빠지는 탄산, 톡차", refs: ["R23", "R24"] },
        { copy: "20대 1위 음료, 무조건 톡차", refs: [] },
        { copy: "수업 사이, 커피 대신 톡차 한 캔", refs: ["R01", "R02", "R05"] },
      ],
    };
  }
  /** 초안 전체를 검사해 줄마다 결과를 돌려준다 */
  function auditDraft(draft, responses) {
    const rows = [];
    (draft.personas || []).forEach((p) => rows.push({ kind: "페르소나", text: `${p.name}: ${p.summary}`, ...checkClaim(p.summary, p.refs, responses) }));
    (draft.messages || []).forEach((m) => {
      const c = checkClaim(m.copy, m.refs, responses);
      const extra = [overclaim(m.copy) && `과장 표현 ‘${overclaim(m.copy)}’`, healthClaim(m.copy) && `효능 표현 ‘${healthClaim(m.copy)}’ → 사람 확인`].filter(Boolean);
      rows.push({ kind: "메시지", text: m.copy, refs: c.refs, ok: c.ok && !extra.length, issues: c.issues.concat(extra) });
    });
    return rows;
  }

  /* ---------- 응답 추가 검사 ---------- */
  function validateResponse(x) {
    const errs = [];
    if (!WHEN.includes(x.when)) errs.push("마시는 상황을 골라 주세요");
    if (!Array.isArray(x.criteria) || !x.criteria.length) errs.push("고르는 기준을 하나 이상 골라 주세요");
    if (!(x.price >= 500 && x.price <= 10000)) errs.push("가격은 500~10,000원 사이로");
    if (!CHANNELS.includes(x.channel)) errs.push("사는 곳을 골라 주세요");
    return errs;
  }
  function nextId(responses) { const n = responses.reduce((m, r) => Math.max(m, +r.id.slice(1) || 0), 0) + 1; return `R${String(n).padStart(2, "0")}`; }

  /* ---------- 내보내기 ---------- */
  function toMarkdown(plan, responses, chosen) {
    const out = [`# ${PRODUCT.name} 20대 캠페인 기획서`, "", `- 제품: ${PRODUCT.line}`, `- 근거: 실제 설문 응답 ${responses.length}건 (응답 번호로 표기)`, "", "## 타깃 페르소나"];
    plan.personas.forEach((p) => {
      const s = statsOf(p.refs, responses);
      out.push(`### ${p.name}`, `- 응답 ${s.n}명 (${s.share}%) · 기대 가격 중간값 ${s.price.toLocaleString()}원 · 주로 ${s.channel}`, `- 먼저 보는 것: ${s.criteria.slice(0, 3).map(([c, n]) => `${c} ${n}명`).join(", ")}`, `- 근거: ${p.refs.join(", ")}`);
    });
    out.push("", "## 메시지", "| 안 | 문구 | 대상 | 평가 | 근거 |", "|---|---|---|---|---|");
    plan.messages.forEach((m, i) => { const sc = score(m, plan.personas); out.push(`| ${i + 1}${chosen === i ? " (채택)" : ""} | ${m.copy} | ${m.persona} | ${sc.total}/20${sc.health ? " · 효능 표현 확인 필요" : ""} | ${m.refs.length}명 |`); });
    return out.join("\n");
  }

  return { jo, PRODUCT, WHEN, CRITERIA, CHANNELS, PERSONA, PHRASE, rng, sampleResponses, pctOf, median, countBy, statsOf, rulePlan, checkClaim, overclaim, healthClaim, score, normalizePlan, firstDraft, auditDraft, validateResponse, nextId, toMarkdown };
});
