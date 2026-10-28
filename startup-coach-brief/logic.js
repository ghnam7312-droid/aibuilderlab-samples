/* 미리봄 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Miribom, Node(테스트)에서는 require('./logic.js').
 * '오늘'과 '지금'은 늘 인자로 받는다. 그래서 테스트가 날짜에 따라 흔들리지 않는다.
 *
 *   사전 진단: 이력서 경력 줄을 읽어 총 경력을 세고, 희망 직무의 핵심어와 겹치는 경험(강점)과
 *             빠진 핵심어(채울 부분), 상담에서 물어볼 질문을 만든다. Claude가 되면 문장을 다듬는다.
 *   주의 신호: 마음 건강·노무(법률) 표현이 있으면 규칙이 표시하고, AI 결과로 지우지 못한다.
 *   파일 권한: 이력서는 본인과 담당 코치만, 10분 뒤 만료되는 주소로만 연다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Miribom = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 희망 직무별 핵심어 (코치가 쓰는 점검표) ---------- */
  const TARGETS = {
    hr: { label: "HR(인사)", keys: ["채용", "면접", "온보딩", "교육", "평가", "급여", "조직문화", "규정", "데이터", "설명회"] },
    pm: { label: "서비스 기획(PM)", keys: ["고객", "기획", "데이터", "지표", "개선", "프로젝트", "협업", "문서", "사용자", "실험"] },
    da: { label: "데이터 분석", keys: ["SQL", "엑셀", "파이썬", "통계", "대시보드", "지표", "분석", "시각화", "자동화", "A/B"] },
  };

  /* ---------- 개인정보 가리기 (AI로 보내기 전, 내보내기 전) ---------- */
  function maskPii(text) {
    return String(text || "")
      .replace(/\d{6}\s*-\s*[1-4]\d{6}/g, "******-*******")
      .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, "010-****-****")
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "(이메일 가림)");
  }

  /* ---------- 경력 읽기 ---------- */
  const ym = (y, m) => Number(y) * 12 + (Number(m) - 1);
  /** "2018.03 - 현재  가람대학교 학사지원팀 · 행정 주임" 같은 줄과 그 아래 '- ' 줄 */
  function parseCareer(resume, today) {
    const [ty, tm] = String(today).split("-").map(Number);
    const now = ym(ty, tm);
    const jobs = [];
    let cur = null;
    for (const raw of String(resume || "").split(/\n/)) {
      const line = raw.trim();
      const m = line.match(/^(\d{4})\.(\d{1,2})\s*[-–~]\s*(현재|재직\s*중|(\d{4})\.(\d{1,2}))\s+(.+)$/);
      if (m) {
        const from = ym(m[1], m[2]);
        const to = m[4] ? ym(m[4], m[5]) : now;
        if (to < from || Number(m[2]) > 12 || (m[5] && Number(m[5]) > 12)) { cur = null; continue; }
        const [org, role] = m[6].split(/\s*·\s*/);
        cur = { from, to, org: (org || "").trim(), role: (role || "").trim(), bullets: [] };
        jobs.push(cur);
      } else if (cur && /^[-•·]\s*/.test(line) && line.length > 2) {
        cur.bullets.push(line.replace(/^[-•·]\s*/, ""));
      } else if (line && !/^[-•·]/.test(line)) cur = null; // 새 제목(자격·교육 등)이 나오면 경력 끝
    }
    return { jobs, months: totalMonths(jobs) };
  }
  /** 겹치는 기간은 한 번만 센다 (두 곳을 같이 다닌 기간) */
  function totalMonths(jobs) {
    const iv = jobs.map((j) => [j.from, j.to + 1]).sort((a, b) => a[0] - b[0]);
    let sum = 0, s = null, e = null;
    for (const [a, b] of iv) {
      if (s === null) { s = a; e = b; continue; }
      if (a <= e) e = Math.max(e, b);
      else { sum += e - s; s = a; e = b; }
    }
    if (s !== null) sum += e - s;
    return sum;
  }
  const yearsLabel = (mo) => (mo >= 12 ? `${Math.floor(mo / 12)}년${mo % 12 ? ` ${mo % 12}개월` : ""}` : `${mo}개월`);

  /* ---------- 주의 신호: AI가 판단하지 않고 코치에게 넘긴다 ---------- */
  const FLAG_RULES = [
    { kind: "wellbeing", label: "마음 건강", re: /(잠을?\s*(잘\s*)?못\s*자|불면|우울|공황|불안해서|숨이\s*막|죽고\s*싶|극단적)/,
      action: "코치가 상담 초반에 직접 안부를 묻고, 필요하면 전문 상담 기관을 안내합니다. AI는 판단하지 않습니다." },
    { kind: "labor", label: "노무·법률", re: /(권고\s*사직|부당\s*해고|해고|임금\s*체불|위로금|퇴직금|실업\s*급여|계약\s*해지)/,
      action: "법률 판단은 이 서비스와 코치가 하지 않습니다. 노무사 등 전문가 상담을 권합니다." },
  ];
  function safetyFlags(text) {
    const t = String(text || "");
    return FLAG_RULES.filter((r) => r.re.test(t)).map((r) => ({ kind: r.kind, label: r.label, hit: t.match(r.re)[0], action: r.action }));
  }

  /* ---------- 규칙 진단 ---------- */
  function ruleDiagnose(client, today) {
    const target = TARGETS[client.target] || TARGETS.hr;
    const career = parseCareer(client.resume, today);
    const text = String(client.resume || "");
    const hit = target.keys.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
    const gaps = target.keys.filter((k) => !hit.includes(k)).slice(0, 4);
    const bullets = career.jobs.flatMap((j) => j.bullets);
    const strengths = bullets
      .map((b) => ({ b, n: hit.filter((k) => b.toLowerCase().includes(k.toLowerCase())).length }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.b);
    const worry = String(client.worry || "");
    const questions = [];
    if (gaps[0]) questions.push(`‘${gaps[0]}’ 경험을 보여 줄 작은 사례가 있나요? 없다면 4주 안에 만들 수 있는 것은?`);
    if (/연봉|월급|돈|수입/.test(worry)) questions.push("연봉이 줄어도 괜찮은 하한선은 얼마인가요?");
    if (/나이|늦|경력/.test(worry)) questions.push("지금 경력 중 새 직무에서도 그대로 쓰일 일은 무엇이라고 보나요?");
    questions.push(`${target.label}로 옮기고 싶은 이유를 한 문장으로 말해 볼까요?`);
    const summary = career.jobs.length
      ? `${career.jobs[0].org || "현 직장"}에서 ${career.jobs[0].role || "실무"}로 일하는 총 경력 ${yearsLabel(career.months)}의 고객. ${target.label} 핵심어 ${target.keys.length}개 중 ${hit.length}개가 이력서에 있다.`
      : `이력서에서 경력 기간(예: 2020.03 - 현재)을 찾지 못했다. 상담 전에 경력 줄을 확인해야 한다.`;
    return { mode: "rule", target: target.label, career, hit, gaps, strengths, questions: questions.slice(0, 4), summary, flags: safetyFlags(worry + "\n" + (client.memo || "")) };
  }

  /* ---------- Claude 응답 검사 ---------- */
  function normalizeDiagnose(d) {
    if (!d || typeof d !== "object") return null;
    const strs = (a, n) => (Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 160)).slice(0, n);
    if (typeof d.summary !== "string" || !d.summary.trim()) return null;
    const questions = strs(d.questions, 5);
    if (!questions.length) return null;
    return { summary: d.summary.trim().slice(0, 300), strengths: strs(d.strengths, 3), gaps: strs(d.gaps, 4), questions };
  }
  /** Claude 문장을 쓰되, 경력 계산과 주의 신호는 규칙 것을 그대로 둔다 (AI가 지우지 못한다) */
  function mergeDiagnose(rule, ai) {
    return { ...rule, mode: "ai", summary: ai.summary, strengths: ai.strengths.length ? ai.strengths : rule.strengths, gaps: ai.gaps.length ? ai.gaps : rule.gaps, questions: ai.questions, flags: rule.flags };
  }
  /** AI로 보내는 입력: 이름 없이, 연락처는 가려서 */
  function aiInput(client) {
    const noName = (s) => (client.name ? String(s || "").split(client.name).join("고객") : String(s || ""));
    return { target: (TARGETS[client.target] || TARGETS.hr).label, worry: maskPii(noName(client.worry)).slice(0, 1000), resume: maskPii(noName(client.resume)).slice(0, 4000) };
  }

  /* ---------- 이력서 파일 권한 ---------- */
  /** 본인 또는 담당 코치만 */
  function canOpen(file, viewer) {
    if (!file || !viewer || !viewer.id) return false;
    if (viewer.role === "client") return viewer.id === file.owner;
    if (viewer.role === "coach") return viewer.id === file.coach;
    return false;
  }
  /** 짧은 해시 (서명 흉내 — 실제 버전은 Supabase Storage 서명 주소) */
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  const LINK_MS = 10 * 60 * 1000;
  /** 권한이 있으면 10분짜리 주소. 주소에는 이름이 들어가지 않는다 */
  function issueLink(file, viewer, nowMs) {
    if (!canOpen(file, viewer)) return null;
    const exp = nowMs + LINK_MS;
    return { url: `/files/r/${file.id}?exp=${exp}&sig=${hash(`${file.id}|${viewer.id}|${exp}`)}`, exp, viewer: viewer.id };
  }
  function verifyLink(link, file, viewer, nowMs) {
    if (!link) return { ok: false, reason: "주소 없음" };
    if (!canOpen(file, viewer)) return { ok: false, reason: "권한 없음" };
    if (link.viewer !== viewer.id || !link.url.endsWith(`sig=${hash(`${file.id}|${viewer.id}|${link.exp}`)}`)) return { ok: false, reason: "다른 사람에게 발급된 주소" };
    if (nowMs > link.exp) return { ok: false, reason: "만료됨" };
    return { ok: true, reason: "" };
  }

  /* ---------- 상담 뒤 요약 리포트 (고객에게 보내는 글) ---------- */
  /** 메모 규칙: '→' 또는 '할 일:'로 시작하면 다음 할 일, '#'으로 시작하면 코치만 보는 줄(리포트에서 뺀다) */
  function buildReport(client, diag, memo, sessionDate) {
    const lines = String(memo || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
    const todo = [], talk = [];
    for (const l of lines) {
      if (/^#/.test(l)) continue;
      if (/^(→|->|할\s*일\s*[:：])/.test(l)) todo.push(l.replace(/^(→|->|할\s*일\s*[:：])\s*/, ""));
      else talk.push(l.replace(/^[-•·]\s*/, ""));
    }
    const first = String(client.name || "").slice(0, 1);
    const out = [
      `${first ? first + "○○" : "고객"}님 상담 요약 · ${sessionDate || ""}`.trim(),
      `희망 직무: ${diag ? diag.target : ""}`,
      "",
      "■ 오늘 나눈 이야기",
      ...(talk.length ? talk.map((t) => `- ${t}`) : ["- (메모가 없어요)"]),
      "",
      "■ 다음 상담까지 할 일",
      ...(todo.length ? todo.map((t, i) => `${i + 1}. ${t}`) : ["- (메모에 '→'로 할 일을 적어 주세요)"]),
    ];
    if (diag && diag.gaps.length) out.push("", "■ 함께 채워 갈 부분", `- ${diag.gaps.slice(0, 3).join(", ")}`);
    return maskPii(out.join("\n"));
  }

  return { TARGETS, maskPii, parseCareer, totalMonths, yearsLabel, safetyFlags, ruleDiagnose, normalizeDiagnose, mergeDiagnose, aiInput, canOpen, hash, issueLink, verifyLink, LINK_MS, buildReport };
});
