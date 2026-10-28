// 한자리 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const H = L.H;
const NOW = new Date(2026, 9, 28, 14, 0).getTime(); // 2026-10-28(수) 14:00
const SLOT = "2026-10-30T19:30"; // 금
const make = (over) => {
  const r = L.createBooking([], { name: "김하린", email: "harin@example.com", product: "single", slot: SLOT, ...over }, NOW);
  assert.ok(r.ok, r.error);
  return r.booking;
};

test("시간 도우미: 표기와 왕복 변환", () => {
  assert.equal(L.slotLabel(SLOT), "10/30(금) 19:30");
  assert.equal(L.slotOf(L.slotMs(SLOT)), SLOT);
  assert.ok(Number.isNaN(L.slotMs("10/30 19:30")));
  assert.equal(L.won(280000), "280,000원");
});

test("예약 가능한 날: 일요일은 빠진다", () => {
  const days = L.buildSlots(NOW, 7, ["10:00", "19:30"]);
  assert.equal(days.length, 6);
  assert.ok(!days.some((d) => d.label.includes("(일)")));
  assert.equal(days[0].slots[0], "2026-10-28T10:00");
});

test("예약 검사: 이메일 · 2시간 이내 · 이미 잡힌 시간", () => {
  assert.equal(L.createBooking([], { name: "가", email: "nope", product: "single", slot: SLOT }, NOW).ok, false);
  assert.match(L.createBooking([], { name: "가", email: "a@b.kr", product: "single", slot: "2026-10-28T15:00" }, NOW).error, /2시간/);
  const b = make();
  assert.match(L.createBooking([b], { name: "나", email: "n@b.kr", product: "single", slot: SLOT }, NOW).error, /다른 분/);
  // 취소된 예약의 시간은 다시 잡을 수 있다
  const c = L.cancel(b, NOW).booking;
  assert.equal(L.createBooking([c], { name: "나", email: "n@b.kr", product: "single", slot: SLOT }, NOW).ok, true);
});

test("모의 결제: 결제 대기일 때만, 실패하면 그대로", () => {
  const b = make();
  assert.equal(L.pay(b, NOW, false).ok, false);
  const p = L.pay(b, NOW + H, true);
  assert.equal(p.booking.status, "paid");
  assert.equal(p.booking.paidAt, NOW + H);
  assert.equal(L.pay(p.booking, NOW, true).ok, false, "두 번 결제되지 않는다");
});

test("12시간 안에 결제하지 않으면 자리가 풀린다", () => {
  const b = make();
  assert.equal(L.expire([b], NOW + 11 * H)[0].status, "pending");
  const e = L.expire([b], NOW + 12 * H);
  assert.equal(e[0].status, "expired");
  assert.equal(L.taken(e).has(SLOT), false);
});

test("환불 규정: 24시간 전 전액, 그 뒤 50%, 결제 전 0원", () => {
  const paid = L.pay(make(), NOW, true).booking;
  assert.equal(L.cancel(paid, NOW).refund, 80000);
  assert.equal(L.cancel(paid, L.slotMs(SLOT) - 3 * H).refund, 40000);
  assert.equal(L.cancel(make(), NOW).refund, 0);
  assert.equal(L.cancel(L.cancel(paid, NOW).booking, NOW).ok, false, "취소된 예약은 다시 취소 안 됨");
});

test("발송 시점에 상태 확인: 취소한 예약에는 안내 메일이 가지 않는다", () => {
  const paid = L.pay(make(), NOW + H, true).booking;
  const cancelled = L.cancel(paid, NOW + 2 * H).booking;
  const out = L.runScheduler([cancelled], [], L.slotMs(SLOT));
  const day = out.find((o) => o.type === "day_before");
  const two = out.find((o) => o.type === "two_hours");
  assert.equal(day.sent, false);
  assert.equal(day.reason, "취소된 예약");
  assert.equal(two.sent, false);
  assert.equal(out.filter((o) => o.sent && L.MAILS[o.type].need === "paid").length, 0);
});

test("결제 완료 예약: 확정·하루 전·2시간 전 안내가 시각에 맞춰 한 번씩", () => {
  const b = make();
  let box = L.runScheduler([b], [], NOW); // 예약 직후: 결제 요청
  const paid = L.pay(b, NOW + H, true).booking;
  box = box.concat(L.runScheduler([paid], box, NOW + H));
  assert.deepEqual(box.filter((o) => o.sent).map((o) => o.type), ["pay_request", "confirm"]);
  box = box.concat(L.runScheduler([paid], box, L.slotMs(SLOT) - 24 * H));
  box = box.concat(L.runScheduler([paid], box, L.slotMs(SLOT)));
  assert.deepEqual(box.filter((o) => o.sent).map((o) => o.type), ["pay_request", "confirm", "day_before", "two_hours"]);
  assert.equal(box.find((o) => o.type === "pay_remind").reason, "이미 결제됨");
  assert.equal(L.runScheduler([paid], box, L.slotMs(SLOT) + H).length, 0, "같은 메일을 두 번 보내지 않는다");
});

test("결제 대기: 결제 리마인드는 가고 확정 안내는 가지 않는다", () => {
  const b = make();
  const box = L.runScheduler([b], [], NOW + 7 * H);
  assert.deepEqual(box.map((o) => [o.type, o.sent]), [["pay_request", true], ["pay_remind", true]]);
});

test("상담 완료·노쇼 기록은 상담 시각 뒤에만, 노쇼율 계산", () => {
  const paid = L.pay(make(), NOW, true).booking;
  assert.equal(L.close(paid, NOW, true).ok, false);
  const after = L.slotMs(SLOT) + H;
  const list = [L.close(paid, after, true).booking, L.close({ ...paid, id: "x" }, after, false).booking, L.close({ ...paid, id: "y" }, after, true).booking, L.close({ ...paid, id: "z" }, after, true).booking];
  const s = L.stats(list);
  assert.equal(s.closed, 4);
  assert.equal(s.noshowRate, 25);
  assert.equal(s.revenue, 320000);
});

test("Claude 확정 메일 검사: 일시가 틀리거나 금액이 다르면 버린다", () => {
  const b = L.pay(make(), NOW, true).booking;
  assert.equal(L.normalizeMail(null, b), null);
  assert.equal(L.normalizeMail({ subject: "확정", body: "10/31(토) 19:30 상담이 확정됐어요. 기다릴게요." }, b), null);
  assert.equal(L.normalizeMail({ subject: "확정", body: "10/30(금) 19:30 상담이 확정됐어요. 결제 금액 50,000원" }, b), null);
  const ok = L.normalizeMail({ subject: " 확정 ", body: "김하린님, 10/30(금) 19:30 상담이 확정됐어요. 결제 80,000원 확인했어요." }, b);
  assert.equal(ok.subject, "확정");
});

test("메일함 표시용 이메일 가리기 · 규칙 메일에 일시가 들어간다", () => {
  assert.equal(L.maskEmail("harin@example.com"), "ha***@example.com");
  assert.equal(L.maskEmail("ab@x.kr"), "ab**@x.kr");
  const m = L.ruleMail("confirm", make(), "이직나침반");
  assert.ok(m.subject.includes("10/30(금) 19:30") && m.body.includes("24시간 전까지"));
});

test("지난 기록 다시 돌리기: 결제 때는 확정 메일이 갔고, 취소 뒤 안내는 보류", () => {
  const b = { ...make(), paidAt: NOW + H, cancelledAt: NOW + 3 * H, status: "cancelled" };
  const box = L.replay(b, L.slotMs(SLOT));
  const by = Object.fromEntries(box.map((o) => [o.type, o]));
  assert.equal(by.pay_request.sent, true);
  assert.equal(by.confirm.sent, true);
  assert.equal(by.pay_remind.reason, "취소된 예약");
  assert.equal(by.day_before.sent, false);
  assert.equal(L.runScheduler([{ ...b, status: "done" }], [], L.slotMs(SLOT)).length, 0, "끝난 상담은 처리하지 않는다");
});
