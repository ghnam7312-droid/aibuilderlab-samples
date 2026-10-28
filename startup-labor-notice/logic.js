/* 안내한장 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Annaehanjang, Node(테스트)에서는 require('./logic.js').
 *
 * 법령 개정 하나 × 고객사 하나 → 그 고객사에 맞춘 안내문 초안.
 *   1) 규칙 초안(틀)으로 즉시 만들고, Claude 초안이 오면 덮어쓴다.
 *   2) 어떤 초안이든 checkDraft()로 고시 정보와 대조한다.
 *      - 초안의 날짜가 고시 시행일과 다르면 막는다 (예전에 AI 초안의 시행일이 틀렸던 문제)
 *      - 고시에 없는 금액, 공식 고시 링크 누락, 단정적인 법적 판단 표현을 찾는다
 *      - 사람이 '고시 원문과 대조했어요'를 눌러야 발송 대기에 넣을 수 있다
 * 이 파일의 개정 내용·금액·시행일은 모두 샘플 값이다. 실제 법령 수치가 아니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Annaehanjang = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 날짜 · 금액 ---------- */
  function d0(isoStr) { const [y, m, d] = isoStr.split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(d0(s)) === s;
  const DAYS = "일월화수목금토";
  function korDate(isoStr) { const d = d0(isoStr); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일(${DAYS[d.getDay()]})`; }
  function daysUntil(isoStr, today) { return Math.round((d0(isoStr) - d0(today)) / 86400000); }
  const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;

  /** 글 안의 날짜를 모두 찾는다 → [{iso, text}] ("2027년 1월 1일", "2027-01-01", "2027. 1. 1.") */
  function findDates(text) {
    const out = [];
    const re = /(20\d{2})\s*(?:년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*일?/g;
    let m;
    while ((m = re.exec(String(text || "")))) {
      const x = new Date(+m[1], +m[2] - 1, +m[3]);
      out.push({ iso: x.getMonth() === +m[2] - 1 ? iso(x) : "", text: m[0].trim() });
    }
    return out;
  }
  /** 글 안의 원 금액을 모두 찾는다 → [숫자] ("11,500원", "1만 1,500원"은 쓰지 않는 것으로 본다) */
  function findAmounts(text) {
    return [...String(text || "").matchAll(/(\d[\d,]*)\s*원/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 100);
  }

  /* ---------- 링크 ---------- */
  /** 공식 고시 링크 검사 → {ok, kind: 'gov'|'sample'|'other'|'bad', host} */
  function linkInfo(url) {
    let u;
    try { u = new URL(String(url || "").trim()); } catch (e) { return { ok: false, kind: "bad", host: "" }; }
    if (u.protocol !== "https:") return { ok: false, kind: "bad", host: u.hostname };
    if (/\.go\.kr$/.test(u.hostname)) return { ok: true, kind: "gov", host: u.hostname };
    if (/\.example$/.test(u.hostname)) return { ok: true, kind: "sample", host: u.hostname };
    return { ok: true, kind: "other", host: u.hostname };
  }

  /* ---------- 대상 고객사 ---------- */
  /** 개정 항목이 이 고객사에 해당하는지 (사무소가 정한 안내 대상 조건. 법적 적용 여부 판단이 아니다) */
  function affected(a, c) {
    if (a.target === "hourly") return c.hourly > 0 ? { yes: true, why: `시급제 직원 ${c.hourly}명` } : { yes: false, why: "시급제 직원 없음" };
    if (a.target === "overtime") return c.shift || c.overtime ? { yes: true, why: c.shift ? "교대 근무 운영" : "연장 근무 있음" } : { yes: false, why: "교대·연장 근무 없음" };
    return { yes: true, why: "전체 고객사 안내" };
  }

  /* ---------- 규칙 초안 ---------- */
  function ruleDraft(a, c) {
    const lines = [`${c.name} ${c.contactName} ${c.contactRole}님, 안녕하세요. 노무한눈 노무사 사무소입니다.`, ""];
    lines.push(`${a.title}에 관한 안내드립니다. 시행일은 ${korDate(a.effective)}입니다.`);
    if (a.before && a.after) lines.push(`변경 내용: ${a.unit} ${won(a.before)} → ${won(a.after)}`);
    else lines.push(`변경 내용: ${a.summary}`);
    lines.push("", `${c.name}에서 확인하실 일`);
    if (a.target === "hourly") lines.push(`- 시급제 직원 ${c.hourly}명의 현재 시급을 변경 금액과 비교해 주세요.`, `- ${korDate(a.effective)} 이후 지급분부터 반영되는지 급여 담당자와 확인해 주세요.`);
    else if (a.target === "overtime") lines.push(`- ${c.shift ? "교대 근무표" : "연장 근무 기록"}를 새 서식으로 옮길 담당자를 정해 주세요.`, `- 시행일 전 마지막 기록은 기존 서식으로 보관해 주세요.`);
    else lines.push(`- 직원 ${c.staff}명에게 바뀐 신청 서식을 공지해 주세요.`, "- 사내 규정에 같은 서식이 있다면 교체가 필요한지 함께 살펴봐 주세요.");
    lines.push("", "조정이 필요한지, 어떻게 반영할지는 사업장 상황에 따라 달라 저희 사무소와 상담에서 함께 확인하겠습니다.");
    lines.push("", `근거: 공식 고시 ${a.link}`);
    return { subject: `[노무 안내] ${a.title} · ${a.effective} 시행`, body: lines.join("\n") };
  }

  /* ---------- AI 초안 검사 ---------- */
  function normalizeDraft(d) {
    if (!d || typeof d !== "object") return null;
    const subject = typeof d.subject === "string" ? d.subject.trim().slice(0, 80) : "";
    const body = typeof d.body === "string" ? d.body.trim().slice(0, 1600) : "";
    if (!subject || body.length < 40) return null;
    const checks = (Array.isArray(d.checks) ? d.checks : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 5);
    return { subject, body, checks };
  }
  /** AI가 링크를 빼먹으면 근거 줄을 붙여 준다 (링크는 사람이 넣은 값만 쓴다) */
  function ensureLink(body, link) {
    return String(body).includes(link) ? body : `${body.trim()}\n\n근거: 공식 고시 ${link}`;
  }

  const JUDGE = /(위반입니다|위법입니다|불법입니다|과태료가 부과됩니다|처벌(을|받)|반드시 지급해야|의무입니다|해당됩니다|문제없습니다)/;

  /** 초안 대조 → {issues:[{level:'error'|'warn'|'info', code, msg}], canSend}
   *  error 가 하나라도 있거나 사람이 대조 확인을 하지 않았으면 보낼 수 없다 */
  function checkDraft(draft, a, confirmed) {
    const text = `${draft.subject || ""}\n${draft.body || ""}`;
    const issues = [];
    const dates = findDates(text);
    const wrong = dates.filter((d) => d.iso !== a.effective);
    wrong.forEach((d) => issues.push({ level: "error", code: "date", msg: `날짜 ‘${d.text}’가 고시 시행일(${a.effective})과 달라요`, text: d.text }));
    if (!dates.some((d) => d.iso === a.effective)) issues.push({ level: "error", code: "nodate", msg: `시행일(${korDate(a.effective)})이 안내문에 없어요` });
    const allowed = [a.before, a.after].filter(Boolean);
    [...new Set(findAmounts(text))].filter((n) => !allowed.includes(n)).forEach((n) => issues.push({ level: "error", code: "amount", msg: `고시 정보에 없는 금액 ${won(n)}`, text: n.toLocaleString("ko-KR") }));
    const li = linkInfo(a.link);
    if (!li.ok) issues.push({ level: "error", code: "badlink", msg: "공식 고시 링크가 올바른 https 주소가 아니에요" });
    else if (!text.includes(a.link)) issues.push({ level: "error", code: "nolink", msg: "공식 고시 링크가 안내문에 없어요" });
    else if (li.kind === "sample") issues.push({ level: "info", code: "sample", msg: `샘플 링크(${li.host})예요. 실제 발송 때는 공식 고시 주소로 바꿔요` });
    else if (li.kind === "other") issues.push({ level: "warn", code: "other", msg: `${li.host}는 정부 도메인(.go.kr)이 아니에요. 공식 고시가 맞는지 확인하세요` });
    const j = text.match(JUDGE);
    if (j) issues.push({ level: "warn", code: "judge", msg: `‘${j[0]}’ 같은 단정 표현은 노무사가 직접 검토한 뒤에만 써요`, text: j[0] });
    if (!confirmed) issues.push({ level: "need", code: "confirm", msg: "고시 원문과 시행일·금액을 대조했다는 확인이 필요해요" });
    const canSend = !issues.some((x) => x.level === "error" || x.level === "need");
    return { issues, canSend };
  }

  /* ---------- 내보내기 ---------- */
  function maskName(n) {
    const s = String(n || "").trim();
    if (s.length <= 1) return s ? "*" : "";
    return s[0] + "*".repeat(Math.max(1, s.length - 2)) + (s.length > 2 ? s[s.length - 1] : "");
  }
  /** 발송 대기 목록 → 텍스트 파일 (담당자 이름은 가린다) */
  function exportQueue(queue) {
    const head = `안내한장 · 발송 대기 ${queue.length}건\n※ 개정 내용·금액·시행일은 샘플 값입니다.\n`;
    return head + queue.map((q, i) => [
      "", `==== ${i + 1}. ${q.client} (${maskName(q.contactName)} ${q.contactRole}) ====`,
      `제목: ${q.subject}`, `시행일 대조: ${q.effective} 확인함 · 근거 ${q.link}`, "", q.body.split(q.contactName).join(maskName(q.contactName)),
    ].join("\n")).join("\n") + "\n";
  }
  /** 한 개정에 대해 대상 고객사 수, 작성·대기 수 */
  function progress(a, clients, drafts, queue) {
    const targets = clients.filter((c) => affected(a, c).yes);
    const queued = targets.filter((c) => queue.some((q) => q.amend === a.id && q.clientId === c.id)).length;
    const drafted = targets.filter((c) => drafts[`${a.id}:${c.id}`]).length;
    return { targets: targets.length, drafted, queued };
  }

  return { d0, iso, isIso, korDate, daysUntil, won, findDates, findAmounts, linkInfo, affected, ruleDraft, normalizeDraft, ensureLink, JUDGE, checkDraft, maskName, exportQueue, progress };
});
