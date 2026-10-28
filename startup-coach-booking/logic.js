/* 한자리 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Hanjari, Node(테스트)에서는 require('./logic.js').
 * '지금'은 늘 인자(ms)로 받는다. 화면은 시뮬레이션 시계를 앞으로 돌려 자동 발송을 보여 준다.
 *
 *   예약: 빈 시간만 고를 수 있고, 같은 시간은 결제 대기·완료 예약이 하나뿐이다.
 *   결제: 모의 결제(실제 돈이 오가지 않음) — 결제 대기 → 결제 완료. 12시간 안에 결제하지 않으면 자리가 풀린다.
 *   메일: 보낼 시각이 되면 **그 순간의 예약 상태를 다시 확인**하고 보낸다. 취소된 예약에는 보내지 않는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Hanjari = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const H = 3600 * 1000;
  const DAYS = "일월화수목금토";
  const PRODUCTS = {
    single: { label: "1회 상담 (60분)", price: 80000 },
    pack4: { label: "직무 전환 4주 패키지 (4회)", price: 280000 },
  };
  const HOLD_H = 12; // 결제 대기 자리를 잡아 두는 시간
  const STATUS = { pending: "결제 대기", paid: "결제 완료", cancelled: "취소", expired: "기한 만료", done: "상담 완료", noshow: "노쇼" };
  const ACTIVE = ["pending", "paid"];

  /* ---------- 시간 ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  /** "2026-10-30T19:30" (로컬) → ms */
  function slotMs(slot) {
    const m = String(slot).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }
  function slotOf(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function slotLabel(slot) { const d = new Date(slotMs(slot)); return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  /** 오늘부터 n일, 일요일 빼고, 정해진 시각들 */
  function buildSlots(nowMs, days, times) {
    const out = [];
    const base = new Date(nowMs); base.setHours(0, 0, 0, 0);
    for (let i = 0; i < days; i++) {
      const d = new Date(base); d.setDate(d.getDate() + i);
      if (d.getDay() === 0) continue;
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      out.push({ day, label: `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`, slots: times.map((t) => `${day}T${t}`) });
    }
    return out;
  }
  const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;

  /* ---------- 예약 ---------- */
  const taken = (bookings) => new Set(bookings.filter((b) => ACTIVE.includes(b.status)).map((b) => b.slot));
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
  function createBooking(bookings, input, nowMs) {
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, error: "이름을 적어 주세요" };
    if (!isEmail(input.email)) return { ok: false, error: "안내 메일을 받을 이메일을 확인해 주세요" };
    if (!PRODUCTS[input.product]) return { ok: false, error: "상품을 골라 주세요" };
    const t = slotMs(input.slot);
    if (Number.isNaN(t)) return { ok: false, error: "시간을 골라 주세요" };
    if (t - nowMs < 2 * H) return { ok: false, error: "지금부터 2시간 이후 시간만 예약할 수 있어요" };
    if (taken(bookings).has(input.slot)) return { ok: false, error: "방금 다른 분이 예약한 시간이에요" };
    const booking = { id: `b${nowMs.toString(36)}${bookings.length}`, name, email: input.email.trim(), product: input.product, slot: input.slot, note: String(input.note || "").trim().slice(0, 200), status: "pending", createdAt: nowMs, paidAt: null, cancelledAt: null };
    return { ok: true, booking };
  }
  /** 모의 결제: 결제 대기일 때만. 실패하면 상태 그대로 */
  function pay(b, nowMs, success) {
    if (b.status !== "pending") return { ok: false, error: `${STATUS[b.status]} 상태라 결제할 수 없어요` };
    if (!success) return { ok: false, error: "결제가 승인되지 않았어요 (모의 실패)" };
    return { ok: true, booking: { ...b, status: "paid", paidAt: nowMs } };
  }
  /** 환불: 코치가 정한 규정 — 상담 24시간 전까지 전액, 그 뒤 50%, 결제 전이면 0원 */
  function refundOf(b, nowMs) {
    if (b.status !== "paid") return 0;
    const price = PRODUCTS[b.product].price;
    return slotMs(b.slot) - nowMs >= 24 * H ? price : Math.round(price / 2);
  }
  function cancel(b, nowMs) {
    if (!ACTIVE.includes(b.status)) return { ok: false, error: `${STATUS[b.status]} 상태라 취소할 수 없어요` };
    return { ok: true, refund: refundOf(b, nowMs), booking: { ...b, status: "cancelled", cancelledAt: nowMs } };
  }
  /** 결제 대기로 12시간 지나면 자리를 푼다 */
  function expire(bookings, nowMs) {
    return bookings.map((b) => (b.status === "pending" && nowMs - b.createdAt >= HOLD_H * H ? { ...b, status: "expired" } : b));
  }
  /** 상담 시각이 지난 확정 예약만 완료·노쇼로 */
  function close(b, nowMs, showed) {
    if (b.status !== "paid") return { ok: false, error: "결제 완료된 예약만 기록할 수 있어요" };
    if (nowMs < slotMs(b.slot)) return { ok: false, error: "상담 시각이 지난 뒤에 기록해요" };
    return { ok: true, booking: { ...b, status: showed ? "done" : "noshow" } };
  }

  /* ---------- 안내 메일 ---------- */
  const MAILS = {
    pay_request: { label: "결제 요청", need: "pending" },
    pay_remind: { label: "결제 리마인드", need: "pending" },
    confirm: { label: "예약 확정 안내", need: "paid" },
    day_before: { label: "하루 전 안내", need: "paid" },
    two_hours: { label: "2시간 전 안내", need: "paid" },
  };
  /** 예약 하나에 대해 보낼 메일과 시각 */
  function planMails(b) {
    const s = slotMs(b.slot);
    const list = [{ type: "pay_request", at: b.createdAt }, { type: "pay_remind", at: b.createdAt + 6 * H }];
    if (b.paidAt) list.push({ type: "confirm", at: b.paidAt });
    list.push({ type: "day_before", at: s - 24 * H }, { type: "two_hours", at: s - 2 * H });
    return list.filter((m) => m.at >= b.createdAt); // 예약보다 앞선 안내는 없다
  }
  /** 보낼 시각에 상태를 다시 본다 → {send, reason} */
  function shouldSend(type, b) {
    const need = MAILS[type].need;
    if (b.status === need) return { send: true, reason: "" };
    const why = { cancelled: "취소된 예약", expired: "기한 만료된 예약", paid: "이미 결제됨", pending: "결제 전", done: "상담 끝남", noshow: "상담 끝남" }[b.status];
    return { send: false, reason: why || "상태가 맞지 않음" };
  }
  /** 시계가 지나간 메일을 처리한다. 이미 처리한 것(예약+종류)은 다시 하지 않는다 → 새 기록 */
  function runScheduler(bookings, outbox, nowMs) {
    const done = new Set(outbox.map((o) => `${o.booking}:${o.type}`));
    const fresh = [];
    for (const b of bookings) {
      if (b.status === "done" || b.status === "noshow") continue; // 상담이 끝난 예약은 더 보낼 것이 없다
      for (const m of planMails(b)) {
        const key = `${b.id}:${m.type}`;
        if (done.has(key) || m.at > nowMs) continue;
        // 결제 대기에서 만료·취소되기 전의 결제 메일은 그 시각 기준으로 보낸다
        const d = shouldSend(m.type, b);
        fresh.push({ booking: b.id, type: m.type, at: m.at, sent: d.send, reason: d.reason });
        done.add(key);
      }
    }
    return fresh.sort((a, b) => a.at - b.at);
  }

  /** 예약의 지난 상태(결제 대기 → 결제 완료 → 취소)를 시간 순서대로 다시 돌려 메일 기록을 만든다 (샘플 채우기용) */
  function replay(b, nowMs) {
    const phases = [[{ ...b, status: "pending" }, b.paidAt ?? b.cancelledAt ?? (b.status === "expired" ? b.createdAt + HOLD_H * H : nowMs)]];
    if (b.paidAt) phases.push([{ ...b, status: "paid" }, b.cancelledAt ?? nowMs]);
    if (b.cancelledAt || b.status === "expired") phases.push([b, nowMs]);
    let box = [];
    phases.forEach(([v, until], i) => { box = box.concat(runScheduler([v], box, i < phases.length - 1 ? until - 1 : until)); });
    return box;
  }

  /* ---------- 메일 본문 ---------- */
  function maskEmail(e) {
    const [id, dom] = String(e || "").split("@");
    if (!dom) return "(이메일 없음)";
    return `${id.slice(0, 2)}${"*".repeat(Math.max(2, id.length - 2))}@${dom}`;
  }
  function ruleMail(type, b, coach) {
    const p = PRODUCTS[b.product], when = slotLabel(b.slot), who = `${b.name}님`;
    const sign = `\n\n${coach} 드림`;
    const t = {
      pay_request: [`[결제 요청] ${when} 상담 자리를 잡아 두었어요`, `${who}, ${p.label} 예약을 받았어요.\n${HOLD_H}시간 안에 아래 결제 링크로 ${won(p.price)}을 결제하시면 예약이 확정돼요. 그 뒤에는 자리가 풀려요.`],
      pay_remind: [`[결제 리마인드] ${when} 상담 결제가 아직이에요`, `${who}, 잡아 둔 ${when} 자리가 결제 전이에요. 결제 링크는 예약 뒤 ${HOLD_H}시간까지 열려 있어요.`],
      confirm: [`[예약 확정] ${when} 커리어 상담`, `${who}, 결제가 확인되어 ${when} ${p.label} 예약이 확정됐어요.\n상담 전에 사전 설문을 남겨 주시면 이력서를 미리 읽고 준비할게요.\n일정 변경·취소는 24시간 전까지 전액 환불돼요.`],
      day_before: [`[내일 상담] ${when}`, `${who}, 내일 ${when} 상담이 있어요. 온라인 상담 주소는 2시간 전에 다시 보내 드려요.`],
      two_hours: [`[2시간 전] ${when} 상담 주소`, `${who}, 2시간 뒤 상담이에요. 편한 곳에서 이력서 파일을 열어 두시면 좋아요.`],
    }[type];
    return { subject: t[0], body: t[1] + sign };
  }
  /** Claude가 쓴 확정 메일 검사: 제목·본문이 있고, 본문에 정확한 일시가 그대로 있어야 한다 */
  function normalizeMail(d, b) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.subject !== "string" || typeof d.body !== "string") return null;
    const subject = d.subject.trim(), body = d.body.trim();
    if (!subject || body.length < 20 || body.length > 1200) return null;
    if (!body.includes(slotLabel(b.slot))) return null; // 날짜를 잘못 쓰면 버린다
    if (/\d{1,3}(,\d{3})+\s*원/.test(body) && !body.includes(won(PRODUCTS[b.product].price))) return null; // 다른 금액
    return { subject: subject.slice(0, 80), body };
  }

  /* ---------- 숫자 ---------- */
  function stats(bookings) {
    const closed = bookings.filter((b) => b.status === "done" || b.status === "noshow");
    const noshow = closed.filter((b) => b.status === "noshow").length;
    return {
      pending: bookings.filter((b) => b.status === "pending").length,
      paid: bookings.filter((b) => b.status === "paid").length,
      closed: closed.length,
      noshowRate: closed.length ? Math.round((noshow / closed.length) * 1000) / 10 : 0,
      revenue: bookings.filter((b) => ["paid", "done", "noshow"].includes(b.status)).reduce((s, b) => s + PRODUCTS[b.product].price, 0),
    };
  }

  return { H, PRODUCTS, STATUS, HOLD_H, MAILS, slotMs, slotOf, slotLabel, buildSlots, won, taken, isEmail, createBooking, pay, refundOf, cancel, expire, close, planMails, shouldSend, runScheduler, replay, maskEmail, ruleMail, normalizeMail, stats };
});
