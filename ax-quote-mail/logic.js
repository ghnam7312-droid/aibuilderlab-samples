/* 견적함 · logic.js — 화면과 상관없는 순수 계산만 모았다.
 * 브라우저에서는 window.QM, Node 테스트에서는 require("../logic.js") 로 쓴다.
 *
 *  classify(mail)        규칙 분류 (제목 2점, 본문 1점, 1·2등 차이 1점 이하면 사람에게)
 *  fromAi(data)          Claude 응답(JSON)을 화면이 쓰는 모양으로 바꾸고, 이상한 값은 버린다
 *  extract(mail)         본문에서 품목·수량·납기
 *  daysLeft(due, today)  납기까지 남은 날
 *  replyDraft(mail, me)  견적 회신 초안 (AI가 안 될 때 쓰는 규칙 템플릿)
 *  toCsv(rows)           엑셀에서 한글이 안 깨지는 CSV
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QM = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ───────── 분류 규칙 ───────── */
  var CATS = {
    quote: { label: "견적 요청", words: ["견적", "단가", "가격", "얼마", "비용", "견적서"] },
    order: { label: "발주·주문", words: ["발주", "주문", "발주서", "주문 확정", "납품 요청", "구매 확정", "입고"] },
    ask: { label: "문의", words: ["문의", "궁금", "확인 부탁", "AS", "고장", "반품", "교환"] },
    etc: { label: "기타", words: ["안내", "공지", "세미나", "뉴스레터", "감사", "초대", "카탈로그"] },
  };
  var LANES = ["need", "quote", "order", "ask", "etc"];
  var LANE_LABEL = { need: "확인 필요", quote: "견적 요청", order: "발주·주문", ask: "문의", etc: "기타" };
  var LABEL_TO_KEY = { "견적 요청": "quote", "발주·주문": "order", "문의": "ask", "기타": "etc", "확인 필요": "need" };
  var NEED_BELOW = 0.6; // AI 확신이 이보다 낮으면 사람이 정한다

  // 끝인사만 있는 줄은 점수에서 뺀다 — 거의 모든 메일 끝에 붙어 '기타'로 끌려가던 문제(3주차 디버깅)
  var SIGN_OFF = /^\s*(감사합니다|감사드립니다|고맙습니다|잘 부탁드립니다)[.!~]*\s*$/gm;

  function classify(m) {
    var subjRaw = String(m.subj || "");
    var subj = subjRaw.toLowerCase();
    var all = (subjRaw + "\n" + String(m.body || "").replace(SIGN_OFF, "")).toLowerCase();
    var score = {}, hits = {};
    Object.keys(CATS).forEach(function (k) {
      score[k] = 0; hits[k] = [];
      CATS[k].words.forEach(function (w) {
        var lw = w.toLowerCase();
        if (all.indexOf(lw) >= 0) { score[k] += subj.indexOf(lw) >= 0 ? 2 : 1; hits[k].push(w); }
      });
    });
    var order = Object.keys(CATS).sort(function (a, b) { return score[b] - score[a]; });
    var top = order[0], second = order[1];
    if (score[top] === 0) return { cat: "etc", alt: null, need: false, score: score, hits: hits, confidence: 0.3 };
    var gap = score[top] - score[second];
    var need = score[second] > 0 && gap <= 1;
    // 규칙의 '확신'은 점수 차이로 어림한다 (화면 표시용)
    var confidence = Math.min(0.95, 0.5 + gap * 0.15 + (score[second] === 0 ? 0.2 : 0));
    return { cat: top, alt: second, need: need, score: score, hits: hits, confidence: Math.round(confidence * 100) / 100 };
  }

  /** Claude 응답 → {cat, need, confidence, reason, items[]}. 모양이 틀리면 null (그럼 규칙을 쓴다) */
  function fromAi(d) {
    if (!d || typeof d !== "object") return null;
    var cat = LABEL_TO_KEY[String(d.category || "").trim()];
    if (!cat || cat === "need") return null;
    var conf = Number(d.confidence);
    if (!(conf >= 0 && conf <= 1)) conf = 0.5;
    var items = Array.isArray(d.items) ? d.items.map(function (it) {
      var name = String((it && it.name) || "").trim();
      var qty = Number(it && it.qty);
      return name ? { name: name, qty: qty > 0 ? Math.round(qty) : null, due: String((it && it.due) || "").trim() } : null;
    }).filter(Boolean).slice(0, 10) : [];
    return { cat: cat, need: conf < NEED_BELOW, confidence: Math.round(conf * 100) / 100, reason: String(d.reason || "").slice(0, 200), items: items };
  }

  /** AI 품목 배열 → 진행표 문자열 */
  function itemsText(items) {
    return (items || []).map(function (it) { return it.qty ? it.name + " " + it.qty + "개" : it.name; }).join(", ");
  }

  /* ───────── 품목·수량·납기 ───────── */
  var ITEM_WORDS = ["27인치 모니터", "모니터 27형", "A4 용지", "프린터 토너", "사무용 의자", "노트북 거치대", "무선 키보드", "회의 테이블", "모니터", "토너", "용지", "의자", "키보드", "테이블"];
  function extract(m) {
    var text = String(m.body || m.subj || "");
    var items = [];
    var re = /(\d+)\s*(박스|대|개|장|세트|EA)/g, x;
    while ((x = re.exec(text))) {
      var before = text.slice(Math.max(0, x.index - 16), x.index);
      // 수량 바로 앞에서 끝나는 품목 이름. 끝 위치가 같으면 더 긴 이름("사무용 의자" > "의자")
      var name = null, end = -1;
      for (var i = 0; i < ITEM_WORDS.length; i++) {
        var w = ITEM_WORDS[i], at = before.lastIndexOf(w);
        if (at < 0) continue;
        var e = at + w.length;
        if (e > end || (e === end && w.length > name.length)) { end = e; name = w; }
      }
      if (name) items.push(name + " " + x[1] + x[2]);
    }
    var all = String(m.subj || "") + " " + String(m.body || "");
    var due = "";
    var d1 = all.match(/(\d{1,2})월\s*(\d{1,2})일/);
    var d2 = all.match(/이달 말|이번 주\s*[월화수목금]요일|다음 주\s*[월화수목금]요일|이번 주/);
    if (d1) due = d1[1] + "월 " + d1[2] + "일"; else if (d2) due = d2[0];
    var uniq = items.filter(function (v, i2) { return items.indexOf(v) === i2; });
    return { items: uniq.join(", "), due: due };
  }

  /** 납기 문자열 → 남은 날. today 는 Date(KST 기준 시각). 모르면 null */
  var DOW = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
  function daysLeft(due, today) {
    var t = today || new Date("2026-10-19T09:00:00+09:00");
    var y = new Date(t.getTime() + 9 * 3600000).getUTCFullYear();
    var s = String(due || ""), d = null, m;
    if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) d = kst(+m[1], +m[2], +m[3]);
    else if ((m = s.match(/(\d{1,2})월\s*(\d{1,2})일/))) d = kst(y, +m[1], +m[2]);
    else if (/이달 말/.test(s)) { var k = new Date(t.getTime() + 9 * 3600000); d = kst(k.getUTCFullYear(), k.getUTCMonth() + 2, 0); }
    else if ((m = s.match(/(이번|다음) 주\s*([월화수목금])요일/))) d = weekday(t, DOW[m[2]], m[1] === "다음" ? 7 : 0);
    else if (/이번 주/.test(s)) d = weekday(t, 5, 0);
    return d ? Math.round((d - startOfDay(t)) / 86400000) : null;
  }
  function kst(y, mo, da) { return new Date(Date.UTC(y, mo - 1, da) - 9 * 3600000); } // KST 자정
  function startOfDay(t) { var k = new Date(t.getTime() + 9 * 3600000); return kst(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate()); }
  function weekday(t, dow, plus) {
    var base = startOfDay(t), k = new Date(base.getTime() + 9 * 3600000);
    var cur = k.getUTCDay() || 7; // 월=1 … 일=7
    return new Date(base.getTime() + (dow - cur + plus) * 86400000);
  }

  /* ───────── 회신 초안 (규칙 템플릿) ───────── */
  function replyDraft(m, me) {
    me = me || { company: "다온오피스", sender: "영업지원팀 엑셀탈출" };
    var ex = extract(m);
    var person = String(m.person || "").trim();
    var hello = person && person !== "-" ? person + "님" : "담당자님";
    var lines = [
      "안녕하세요, " + hello + ". " + me.company + " " + me.sender + "입니다.",
      "",
      "보내 주신 견적 요청 잘 받았습니다. 요청 내용을 아래와 같이 확인했습니다.",
      "",
      "- 품목·수량: " + (ex.items || "(본문에서 확인하지 못했습니다. 품목과 수량을 알려 주세요)"),
      "- 희망 납기: " + (ex.due || "(말씀 주시면 일정에 맞춰 드리겠습니다)"),
      "",
      "단가와 납기 가능 여부는 영업일 1일 이내에 견적서로 회신드리겠습니다.",
      ex.items ? "혹시 원하시는 브랜드나 규격이 있으면 함께 알려 주세요." : "",
      "",
      "감사합니다.",
      me.company + " " + me.sender + " 드림",
    ].filter(function (l, i, a) { return !(l === "" && a[i - 1] === ""); });
    return { subject: "RE: " + String(m.subj || "견적 요청"), body: lines.join("\n") };
  }

  /* ───────── CSV ───────── */
  function toCsv(rows) {
    var q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    return "﻿" + rows.map(function (r) { return r.map(q).join(","); }).join("\r\n");
  }

  return {
    CATS: CATS, LANES: LANES, LANE_LABEL: LANE_LABEL, NEED_BELOW: NEED_BELOW,
    classify: classify, fromAi: fromAi, itemsText: itemsText, extract: extract,
    daysLeft: daysLeft, replyDraft: replyDraft, toCsv: toCsv,
  };
});
