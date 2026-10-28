// 같은말 로직 테스트 — 실행: node --test (또는 npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

const TODAY = "2026-10-28"; // 수요일
const WEEK = L.reportWeek(TODAY);
const NAMES = ["김지현", "박서윤"];
const it = (date, text, name) => ({ date, text, name: name || "" });

test("리포트 주: 오늘 기준 지난주 월~일, 다음 발송은 다가오는 월요일", () => {
  assert.deepEqual([WEEK.start, WEEK.end], ["2026-10-19", "2026-10-25"]);
  assert.equal(WEEK.label, "10/19(월)–10/25(일)");
  assert.equal(L.nextSend(TODAY, 14), "11/2(월) 09:00");
  assert.equal(L.nextSend("2026-11-02", 8), "11/2(월) 09:00");
  assert.equal(L.nextSend("2026-11-02", 10), "11/9(월) 09:00");
});

test("주제: 순서대로 첫 번째로 맞는 주제, 없으면 기타", () => {
  assert.equal(L.topicOf("의자에 앉으면 삐걱 소리가 나요"), "chair");
  assert.equal(L.topicOf("반품 수거가 늦어요"), "pickup");
  assert.equal(L.topicOf("배송이 너무 늦어요"), "ship");
  assert.equal(L.topicOf("감사 인사 드려요"), "etc");
});

test("개인정보 지우기: 이름·휴대폰·이메일·주소·주문번호", () => {
  const r = L.scrub("김지현입니다. 010-3341-2287, jh.kim@example.com 솔담시 하늘구 버들로 12 103동 1201호 주문 SD2610187", NAMES);
  assert.equal(r.text, "[이름]입니다. [연락처], [이메일] [주소] [주소] 주문 [주문번호]");
  assert.deepEqual(r.found, { email: 1, phone: 1, order: 1, address: 2, name: 1 });
});

test("개인정보 지우기: 평범한 문장은 건드리지 않는다", () => {
  const s = "의자 2개 중 1개가 흔들거려요. 주로 저녁에 앉아요";
  assert.equal(L.scrub(s, NAMES).text, s);
  assert.deepEqual(L.findPii(s, NAMES), []);
});

test("모으기: 지난주 vs 그 전 주, 급증 판단", () => {
  const items = [
    ...Array.from({ length: 6 }, (_, i) => it("2026-10-2" + (i % 5), "의자가 삐걱 소리가 나요")),
    it("2026-10-14", "의자 삐걱"), it("2026-10-15", "의자 삐걱"),
    it("2026-10-20", "배송이 늦어요"), it("2026-10-13", "배송 지연"), it("2026-10-13", "배송 지연"), it("2026-10-14", "배송 늦어요"), it("2026-10-14", "배송 늦어요"),
    it("2026-10-01", "아주 예전 배송 문의"),
  ];
  const a = L.aggregate(items, WEEK, NAMES);
  const chair = a.rows.find((r) => r.id === "chair");
  const ship = a.rows.find((r) => r.id === "ship");
  assert.deepEqual([chair.count, chair.last, chair.rising], [6, 2, true]);
  assert.deepEqual([ship.count, ship.last, ship.rising, ship.delta], [1, 4, false, -3]);
  assert.equal(a.rows[0].id, "chair");
  assert.deepEqual([a.total, a.lastTotal], [7, 6]);
});

test("모으기: 대표 문장은 개인정보를 지운 글, 지운 건수를 센다", () => {
  const items = [it("2026-10-21", "김지현인데 의자가 삐걱거려요 010-3341-2287", "김지현"), it("2026-10-22", "의자 삐걱", "박서윤")];
  const a = L.aggregate(items, WEEK, NAMES);
  const q = a.rows[0].quotes.join(" ");
  assert.ok(!q.includes("김지현") && !q.includes("010-"));
  assert.ok(q.includes("[이름]") && q.includes("[연락처]"));
  assert.equal(a.removedTotal, 2);
});

test("규칙 리포트: 늘어난 불만이 제목, 상품팀 요청은 급증한 주제만", () => {
  const items = [...Array.from({ length: 5 }, () => it("2026-10-21", "러그 털이 빠져요")), it("2026-10-14", "러그 털 빠짐"), it("2026-10-21", "배송 늦어요")];
  const a = L.aggregate(items, WEEK, NAMES);
  const r = L.ruleSummary(a);
  assert.equal(r.headline, "러그 털 빠짐 문의가 5건으로 그 전 주 1건의 5배");
  assert.equal(r.asks.length, 1);
  assert.equal(r.asks[0].topic, "러그 털 빠짐");
  assert.ok(r.lines[0].includes("전체 문의 6건"));
});

test("Claude 응답 검사: 형식이 틀리면 버리고, 없는 숫자가 든 문장은 뺀다", () => {
  const items = [...Array.from({ length: 5 }, () => it("2026-10-21", "러그 털이 빠져요")), it("2026-10-14", "러그 털 빠짐")];
  const a = L.aggregate(items, WEEK, NAMES);
  assert.equal(L.normalizeVoc({ lines: [] }, a, NAMES), null);
  assert.equal(L.normalizeVoc("요약", a, NAMES), null);
  const n = L.normalizeVoc({ headline: "러그 털 빠짐 5건", lines: ["러그 문의가 5건으로 늘었어요.", "러그 문의가 42건입니다."], asks: [{ topic: "러그 털 빠짐", ask: "소재 확인" }, { topic: "없는 주제", ask: "x" }] }, a, NAMES);
  assert.deepEqual(n.lines, ["러그 문의가 5건으로 늘었어요."]);
  assert.equal(n.asks.length, 1);
});

test("Claude 응답 검사: 개인정보가 섞이면 통째로 버린다", () => {
  const items = [...Array.from({ length: 5 }, () => it("2026-10-21", "러그 털이 빠져요"))];
  const a = L.aggregate(items, WEEK, NAMES);
  assert.equal(L.normalizeVoc({ headline: "러그 털 빠짐 5건", lines: ["김지현 고객이 러그 문의를 했어요."], asks: [] }, a, NAMES), null);
  assert.equal(L.normalizeVoc({ headline: "러그 털 빠짐 5건", lines: ["010-3341-2287로 회신 요청"], asks: [] }, a, NAMES), null);
});

test("메일과 마지막 검사: 본문에 개인정보가 없으면 통과", () => {
  const items = [...Array.from({ length: 4 }, () => it("2026-10-21", "김지현인데 의자가 삐걱거려요 jh.kim@example.com", "김지현"))];
  const a = L.aggregate(items, WEEK, NAMES);
  const mail = L.buildMail(L.ruleSummary(a), a);
  assert.ok(mail.subject.startsWith("[주간 문의 동향] 10/19(월)–10/25(일)"));
  assert.ok(mail.body.includes("[이메일]"));
  assert.deepEqual(L.piiGate(mail, NAMES), []);
  assert.equal(L.piiGate({ subject: "x", body: mail.body + "\n박서윤 님 확인" }, NAMES)[0].type, "name");
});

test("상품 개선 연결: 단계 돌리기와 확정 건수", () => {
  assert.equal(L.nextLink(""), "전달");
  assert.equal(L.nextLink("전달"), "개선 확정");
  assert.equal(L.nextLink("개선 확정"), "");
  assert.equal(L.linkedCount({ chair: "개선 확정", rug: "전달", size: "개선 확정" }), 2);
});

test("CSV: 주제별 숫자만, 고객 글은 없다", () => {
  const items = [it("2026-10-21", "김지현 의자 삐걱", "김지현")];
  const csv = L.toCsv(L.aggregate(items, WEEK, NAMES));
  assert.ok(csv.startsWith("﻿주제,담당 팀"));
  assert.ok(csv.includes("원목 의자 삐걱임,상품,1,0,1,"));
  assert.ok(!csv.includes("김지현"));
});
