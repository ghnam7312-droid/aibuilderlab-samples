/* 오늘수업 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Oneulsueop, Node(테스트)에서는 require('./logic.js').
 *
 * 흐름: 수업 메모 한 덩어리 → 학생별 메모로 나누기(parseMemo) → 학생별 메시지 초안
 *       → 보내기 전 검사(checkMessage) → 튜터가 미리보기에서 '확인' → 보내기
 *
 * 핵심 결정: 보내기 전 미리보기 확인 단계.
 *   다른 학생 이름이 섞인 메시지를 발송 직전에 발견한 뒤로,
 *   - 메시지마다 명단의 다른 학생 이름이 들어 있는지 검사하고 (otherNames)
 *   - 튜터가 한 건씩 '확인'해야만 보낼 수 있고 (canSend)
 *   - 확인한 뒤에 내용을 고치면 확인이 풀린다 (edit → confirmed=false)
 *   AI에는 그 학생의 메모만 보낸다. 그래도 메모 자체에 다른 학생이 나올 수 있어 검사는 늘 한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Oneulsueop = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const COMMON = /^(공통|전체|오늘)\s*[:：-]\s*/;

  /* ---------- 메모 나누기 ---------- */
  /** "이름: 내용" / "이름 - 내용" 줄은 그 학생, "공통:" 줄은 모두, 나머지는 바로 위 학생에 이어 붙인다 */
  function parseMemo(memo, roster) {
    const names = roster.map((s) => s.name);
    const out = { common: [], by: {}, unknown: [] };
    names.forEach((n) => { out.by[n] = []; });
    let last = null;
    String(memo || "").split(/\n/).map((l) => l.replace(/^[\s\-•*·]+/, "").trim()).filter(Boolean).forEach((line) => {
      if (COMMON.test(line)) { out.common.push(line.replace(COMMON, "").trim()); last = "__common"; return; }
      const m = line.match(/^([가-힣A-Za-z]{2,10})\s*[:：-]\s*(.+)$/);
      if (m) {
        if (names.includes(m[1])) { out.by[m[1]].push(m[2].trim()); last = m[1]; return; }
        out.unknown.push(m[1]); last = null; return;
      }
      if (last === "__common") out.common.push(line);
      else if (last) out.by[last].push(line);
    });
    return out;
  }

  /** 메모 조각 → 문장 목록 (마침표 · 줄 단위) */
  function bits(lines) {
    return lines.join(". ").split(/(?<=[.!?])\s+|\.\s*$/).map((x) => x.replace(/[.\s]+$/, "").trim()).filter(Boolean);
  }
  const ABSENT = /결석|못\s*왔|빠졌/;
  const NEXT = /숙제|연습\s*필요|다음\s*(시간|수업)|해\s*오기|복습/;

  /* ---------- 규칙 초안 ---------- */
  function greeting(st) {
    return st.to === "parent" ? `안녕하세요, ${st.name} 학생 보호자님.` : `${st.name} 님, 오늘도 수고 많으셨어요.`;
  }
  function draftRule(st, lesson, parsed) {
    const mine = parsed.by[st.name] || [];
    const all = bits(mine);
    const topic = parsed.common.length ? bits(parsed.common).join(", ") : lesson.topic;
    const subj = st.to === "parent" ? `수업에서 본 ${st.name} 학생` : "오늘 수업에서 본 점";
    if (all.some((b) => ABSENT.test(b))) {
      const rest = all.filter((b) => !ABSENT.test(b));
      return [greeting(st), `오늘 ${lesson.className} 수업에 ${st.name} ${st.to === "parent" ? "학생이" : "님이"} 함께하지 못했어요.`, `오늘 다룬 내용: ${topic}`, ...rest.map((b) => `· ${b}`), "", `— ${lesson.tutor} 드림`].join("\n");
    }
    const next = all.filter((b) => NEXT.test(b));
    const good = all.filter((b) => !NEXT.test(b));
    const lines = [greeting(st), `오늘 ${lesson.className} 수업 소식 전해 드려요.`, "", `오늘 배운 것: ${topic}`];
    if (good.length) lines.push("", `${subj}`, ...good.map((b) => `· ${b}`));
    lines.push("", `다음 수업 전까지: ${next.length ? next.join(", ") : "오늘 배운 표현으로 30초 말하기 1개"}`, "", `— ${lesson.tutor} 드림`);
    return lines.join("\n");
  }

  /* ---------- 보내기 전 검사 ---------- */
  /** 메시지 안에 있는 '다른 학생' 이름 */
  function otherNames(text, self, roster) {
    const t = String(text || "");
    return roster.map((s) => s.name).filter((n) => n !== self && n.length >= 2 && !self.includes(n) && t.includes(n));
  }
  /** issues: other(막음) · noself(막음) · nomemo(확인 필요) · empty(막음) */
  function checkMessage(card, roster, parsed) {
    const issues = [];
    const t = String(card.text || "").trim();
    if (!t) { issues.push({ kind: "empty", block: true, msg: "내용이 비어 있어요" }); return issues; }
    otherNames(t, card.name, roster).forEach((n) => {
      if (!(card.acked || []).includes(n)) issues.push({ kind: "other", name: n, block: true, msg: `다른 학생 이름 '${n}'이 들어 있어요` });
    });
    if (!t.includes(card.name)) issues.push({ kind: "noself", block: true, msg: `받는 학생 이름 '${card.name}'이 없어요. 다른 학생에게 쓴 글일 수 있어요` });
    if (parsed && !(parsed.by[card.name] || []).length && !card.edited) issues.push({ kind: "nomemo", block: false, msg: "이 학생 메모가 없어 공통 내용만 들어갔어요" });
    return issues;
  }
  /** 보낼 수 있나: 미리보기 확인 + 막는 문제 없음 + 아직 안 보냄 */
  function canSend(card, roster) {
    return !!card.confirmed && !card.sent && !checkMessage(card, roster).some((i) => i.block);
  }
  /** 다른 학생 이름이 든 문장(줄)만 지운다 */
  function removeName(text, name) {
    return String(text || "").split(/\n/).map((line) => {
      if (!line.includes(name)) return line;
      const parts = line.split(/(?<=[.!?])\s+/).filter((p) => !p.includes(name));
      return parts.join(" ").trim();
    }).filter((line, i, a) => !(line.trim() === "" && (a[i - 1] || "").trim() === "") && !(/^·\s*$/.test(line))).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** 진행 상황 */
  function progress(cards, roster) {
    const live = cards.filter((c) => !c.skip);
    return {
      total: live.length,
      confirmed: live.filter((c) => c.confirmed).length,
      blocked: live.filter((c) => !c.sent && checkMessage(c, roster).some((i) => i.block)).length,
      ready: live.filter((c) => canSend(c, roster)).length,
      sent: live.filter((c) => c.sent).length,
    };
  }

  /* ---------- AI 응답 검사 ---------- */
  function normalizeDraft(d, st, roster, myNotes) {
    if (!d || typeof d !== "object" || typeof d.message !== "string") return null;
    const msg = d.message.replace(/\r/g, "").trim();
    if (msg.length < 20 || msg.length > 900) return null;
    if (!msg.includes(st.name)) return null;
    // 그 학생 메모에 없던 다른 학생 이름을 넣었다면 지어낸 것 → 버린다
    const memo = (myNotes || []).join(" ");
    if (otherNames(msg, st.name, roster).some((n) => !memo.includes(n))) return null;
    return {
      message: msg,
      highlights: (Array.isArray(d.highlights) ? d.highlights : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 3),
      next: typeof d.next === "string" ? d.next.trim().slice(0, 120) : "",
    };
  }

  /* ---------- 개인정보 ---------- */
  /** 화면·기록에는 가운데 4자리를 가린 번호만 */
  function maskPhone(p) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length < 10) return "번호 없음";
    return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
  }
  /** 발송 기록 한 줄 (본문은 남기지 않는다) */
  function logEntry(card, student, at) {
    return { id: card.id, name: card.name, to: student.to === "parent" ? "보호자" : "본인", phone: maskPhone(student.phone), at, chars: String(card.text || "").length };
  }
  /** 걸린 시간 (분, 올림) */
  function minutes(fromMs, toMs) { return fromMs && toMs && toMs > fromMs ? Math.max(1, Math.ceil((toMs - fromMs) / 60000)) : 0; }

  /** 화면 강조: 다른 학생 이름 위치 */
  function splitByNames(text, names) {
    const t = String(text || "");
    if (!names.length) return [{ s: t, hit: false }];
    const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return t.split(re).filter((x) => x !== "").map((s) => ({ s, hit: names.includes(s) }));
  }

  return { parseMemo, bits, draftRule, otherNames, checkMessage, canSend, removeName, progress, normalizeDraft, maskPhone, logEntry, minutes, splitByNames };
});
