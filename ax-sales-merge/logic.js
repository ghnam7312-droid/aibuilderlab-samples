/* 한장 · logic.js — 화면과 상관없는 순수 계산.
 * 브라우저에서는 window.HJ, Node 테스트에서는 require("../logic.js").
 *
 *  읽기     parseCSV · guessMapping · tableToFile
 *  검산     toNum · fixTypo · analyze (중복·형식 오류·부서별 보고 합계 대조)
 *  비교     compareWeeks · explainChange (지난주 대비 이상치를 규칙으로 설명)
 *  샘플     sampleWeek — 가상의 다온오피스(주) 10개 부서
 *
 * 이 서비스에는 AI가 없다. 숫자는 규칙으로만 맞춘다. 실수하면 안 되는 일이라서다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HJ = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var COLS = ["date", "owner", "client", "item", "qty", "amount"];
  var FIELD = { dept: "부서", date: "일자", owner: "담당", client: "거래처", item: "품목", qty: "수량", amount: "금액" };
  var REQUIRED = ["dept", "item", "qty", "amount"];

  /* ───────── 숫자 ───────── */
  /** "1,590,000원" → 1590000. 숫자가 아닌 글자가 섞이면 NaN */
  function toNum(v) {
    var s = String(v == null ? "" : v).replace(/[,\s원₩]/g, "");
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  /**
   * 숫자 칸의 흔한 오타를 고친 값을 제안한다. 못 고치면 null.
   *  영문 O/o → 0, l·I·| → 1, 전각 숫자 → 반각, 콤마 대신 마침표(1.590.000)
   */
  function fixTypo(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || Number.isFinite(toNum(s))) return null;
    var t = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ",");
    var n = toNum(t);
    return Number.isFinite(n) ? n : null;
  }
  function won(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "—"; }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + won(Math.abs(n)); }

  /* ───────── CSV 읽기 ─────────
     BOM, 따옴표 속 쉼표("1,590,000"), 따옴표 속 줄바꿈, "" 이스케이프를 처리한다. */
  function parseCSV(text) {
    var s = String(text || "").replace(/^﻿/, "");
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) {
        if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(cur); rows.push(row); row = []; cur = "";
      } else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return x.trim(); }); })
      .filter(function (r) { return r.some(function (x) { return x !== ""; }); });
  }

  /* ───────── 열 이름 맞추기 ───────── */
  var SYN = {
    dept: ["부서", "부서명", "팀", "팀명", "소속", "지사"],
    date: ["일자", "날짜", "매출일", "거래일", "판매일", "일"],
    owner: ["담당", "담당자", "영업담당", "영업 담당", "사원", "직원", "작성자"],
    client: ["거래처", "거래처명", "고객", "고객사", "업체", "업체명"],
    item: ["품목", "품목명", "상품", "상품명", "제품", "제품명", "품명"],
    qty: ["수량", "개수", "판매수량", "수", "ea", "qty"],
    amount: ["금액", "판매금액", "매출", "매출액", "공급가액", "합계금액", "amount"],
  };
  function norm(h) { return String(h || "").replace(/[\s()（）_\-·]/g, "").replace(/\(원\)|원$/g, "").toLowerCase(); }
  /**
   * 머리글 줄 → [{header, field, sure}] 와 빠진 필수 열.
   * 정확히 같은 이름이면 sure=true, 비슷한 이름(포함 관계)이면 sure=false — 이때 화면이 사람에게 확인받는다.
   */
  function guessMapping(header) {
    var used = {};
    var cols = header.map(function (h) {
      var n = norm(h), field = null, sure = false;
      Object.keys(SYN).forEach(function (f) {
        if (field || used[f]) return;
        if (SYN[f].some(function (w) { return norm(w) === n; })) { field = f; sure = true; }
      });
      if (!field) Object.keys(SYN).forEach(function (f) {
        if (field || used[f] || !n) return;
        if (SYN[f].some(function (w) { var nw = norm(w); return nw.length >= 2 && (n.indexOf(nw) >= 0 || nw.indexOf(n) >= 0); })) field = f;
      });
      if (field) used[field] = true;
      return { header: h, field: field, sure: sure };
    });
    var missing = REQUIRED.filter(function (f) { return f !== "dept" && !used[f]; });
    var allSure = cols.every(function (c) { return !c.field || c.sure; });
    return { cols: cols, missing: missing, needsReview: !allSure || missing.length > 0 };
  }
  /** 머리글 모양을 하나의 문자열로 — 같은 모양 파일은 지난번 매핑을 다시 쓴다 */
  function headerKey(header) { return header.map(norm).join("|"); }

  /**
   * 표(2차원 배열) → 부서 파일.
   * mapping: [field|null, ...] (열 순서대로). 없으면 머리글로 추측.
   * 반환: {file} | {error} | {needMap: guess, header, preview}
   */
  function tableToFile(name, cells, opts) {
    opts = opts || {};
    var rowsIn = (cells || []).filter(function (r) { return r && r.some(function (c) { return String(c == null ? "" : c).trim(); }); });
    if (!rowsIn.length) return { error: "빈 파일이에요." };
    var header = rowsIn[0].map(function (c) { return String(c == null ? "" : c).trim(); });
    var mapping = opts.mapping;
    if (!mapping) {
      var g = guessMapping(header);
      if (g.cols.filter(function (c) { return c.field; }).length < 3) return { error: "첫 줄에서 열 이름을 찾지 못했어요. 첫 줄에 ‘품목·수량·금액’ 같은 열 이름을 적어 주세요." };
      if (g.needsReview && !opts.trustGuess) return { needMap: g, header: header, preview: rowsIn.slice(1, 4) };
      mapping = g.cols.map(function (c) { return c.field; });
    }
    var miss = ["item", "qty", "amount"].filter(function (f) { return mapping.indexOf(f) < 0; });
    if (miss.length) return { error: "필요한 열이 없어요: " + miss.map(function (f) { return FIELD[f]; }).join(", ") };
    var declared = null, rows = [], dept = opts.dept || "";
    rowsIn.slice(1).forEach(function (c) {
      var o = {};
      mapping.forEach(function (f, i) { if (f) o[f] = String(c[i] == null ? "" : c[i]).trim(); });
      // '합계' 줄은 부서가 보고한 합계로 읽는다
      if (/합계|총계|소계/.test((o.dept || "") + (o.item || "") + (o.date || "") + (o.owner || ""))) { declared = toNum(o.amount); return; }
      if (!dept && o.dept) dept = o.dept;
      rows.push({ date: o.date || "", owner: o.owner || "", client: o.client || "", item: o.item || "", qty: o.qty || "", amount: o.amount || "" });
    });
    if (!rows.length) return { error: "읽을 수 있는 행이 없어요." };
    if (!dept) dept = String(name || "").replace(/\.[^.]+$/, "").replace(/_.*$/, "");
    var rowSum = rows.reduce(function (s, r) { return s + (toNum(r.amount) || 0); }, 0);
    return { file: { dept: dept, name: name, declared: Number.isFinite(declared) ? declared : rowSum, declaredFromFile: Number.isFinite(declared), rows: rows } };
  }

  /**
   * 부서 열에 여러 부서가 섞여 있으면(통합 시트를 다시 올린 경우) 부서별 파일로 나눈다.
   * 반환: {files:[...]} | {error} | {needMap}
   */
  function tableToFiles(name, cells, opts) {
    var r = tableToFile(name, cells, opts);
    if (!r.file) return r;
    var rowsIn = (cells || []).filter(function (x) { return x && x.some(function (c) { return String(c == null ? "" : c).trim(); }); });
    var mapping = (opts && opts.mapping) || guessMapping(rowsIn[0].map(String)).cols.map(function (c) { return c.field; });
    var di = mapping.indexOf("dept");
    if (di < 0) return { files: [r.file] };
    var depts = [];
    rowsIn.slice(1).forEach(function (c) { var d = String(c[di] == null ? "" : c[di]).trim(); if (d && !/합계|총계|소계/.test(d) && depts.indexOf(d) < 0) depts.push(d); });
    if (depts.length <= 1) return { files: [r.file] };
    var header = rowsIn[0];
    var files = depts.map(function (d) {
      var part = [header].concat(rowsIn.slice(1).filter(function (c) { return String(c[di] == null ? "" : c[di]).trim() === d; }));
      var f = tableToFile(name, part, { mapping: mapping }).file;
      f.dept = d; f.declaredFromFile = false;
      return f;
    });
    return { files: files, split: true };
  }

  /* ───────── 검산 ───────── */
  /**
   * files: [{id, dept, declared, rows:[{id, ...}]}], excluded: [rowId]
   * 같은 부서 안에서 담당·거래처·품목·수량·금액이 모두 같은 행은 중복 의심.
   * 부서별로 '보고 합계'와 '행 합계'를 맞춰 본다.
   */
  function analyze(files, excluded) {
    var ex = new Set(excluded || []);
    var all = [], seen = new Map(), dup = new Set(), bad = new Set();
    files.forEach(function (f) { f.rows.forEach(function (r, i) { all.push({ r: r, f: f, idx: i }); }); });
    all.forEach(function (x) {
      var r = x.r;
      if (Number.isNaN(toNum(r.qty)) || Number.isNaN(toNum(r.amount))) bad.add(r.id);
      var key = [x.f.dept, r.date, r.owner, r.client, r.item, toNum(r.qty), toNum(r.amount)].join("|");
      if (seen.has(key)) dup.add(r.id); else seen.set(key, r.id);
    });
    var valid = all.filter(function (x) { return !ex.has(x.r.id) && !bad.has(x.r.id); });
    var rowSum = valid.reduce(function (s, x) { return s + toNum(x.r.amount); }, 0);
    var declared = files.reduce(function (s, f) { return s + f.declared; }, 0);
    var perFile = {};
    files.forEach(function (f) {
      var s = f.rows.filter(function (r) { return !ex.has(r.id) && !bad.has(r.id); }).reduce(function (t, r) { return t + toNum(r.amount); }, 0);
      perFile[f.id] = { sum: s, diff: s - f.declared };
    });
    var dupLeft = all.filter(function (x) { return dup.has(x.r.id) && !ex.has(x.r.id); }).map(function (x) { return x.r.id; });
    var exSum = all.filter(function (x) { return ex.has(x.r.id) && !bad.has(x.r.id); }).reduce(function (s, x) { return s + toNum(x.r.amount); }, 0);
    return {
      all: all, dup: dup, bad: bad, ex: ex, valid: valid, used: all.filter(function (x) { return !ex.has(x.r.id); }),
      rowSum: rowSum, declared: declared, diff: rowSum - declared, exSum: exSum, dupLeft: dupLeft, perFile: perFile,
      pass: rowSum === declared && !dupLeft.length && !bad.size,
    };
  }

  /* ───────── 지난주 비교 + 이상치 설명 (규칙) ───────── */
  var FLAG_RATE = 15; // 지난주보다 ±15% 넘게 움직이면 '살펴볼 부서'
  /** 부서별 이번 주/지난주 합계와 증감 */
  function compareWeeks(nowFiles, lastFiles, excluded) {
    var a = analyze(nowFiles, excluded);
    var lastBy = {};
    (lastFiles || []).forEach(function (f) { lastBy[f.dept] = f; });
    return nowFiles.map(function (f) {
      var lf = lastBy[f.dept];
      var now = a.perFile[f.id].sum;
      var last = lf ? lf.rows.reduce(function (s, r) { return s + (toNum(r.amount) || 0); }, 0) : null;
      var diff = last == null ? null : now - last;
      var rate = last ? (diff / last) * 100 : null;
      return { dept: f.dept, now: now, last: last, diff: diff, rate: rate, flag: rate != null && Math.abs(rate) >= FLAG_RATE };
    });
  }
  /**
   * 증감을 품목별로 쪼개 가장 큰 원인을 문장으로 쓴다 (규칙, AI 아님).
   * 예: "B2B팀 +21% (+1,680,000원)" / "가장 크게 늘어난 품목은 회의 테이블(+4개, +1,680,000원) — 지난주엔 없던 품목이에요."
   */
  function explainChange(nowFile, lastFile, excludedIds) {
    var ex = new Set(excludedIds || []);
    var by = function (rows, skip) {
      var m = {};
      rows.forEach(function (r) {
        if (skip && ex.has(r.id)) return;
        var amt = toNum(r.amount), q = toNum(r.qty);
        if (!Number.isFinite(amt)) return;
        var k = r.item || "(품목 없음)";
        m[k] = m[k] || { amt: 0, qty: 0, clients: [] };
        m[k].amt += amt; m[k].qty += Number.isFinite(q) ? q : 0;
        if (r.client && m[k].clients.indexOf(r.client) < 0) m[k].clients.push(r.client);
      });
      return m;
    };
    var A = by(nowFile.rows, true), B = by(lastFile ? lastFile.rows : [], false);
    var keys = Object.keys(A).concat(Object.keys(B)).filter(function (k, i, arr) { return arr.indexOf(k) === i; });
    var deltas = keys.map(function (k) {
      var a = A[k] || { amt: 0, qty: 0, clients: [] }, b = B[k] || { amt: 0, qty: 0, clients: [] };
      return { item: k, amt: a.amt - b.amt, qty: a.qty - b.qty, isNew: !B[k], gone: !A[k], clients: (A[k] ? a : b).clients };
    }).filter(function (d) { return d.amt !== 0; });
    var total = deltas.reduce(function (s, d) { return s + d.amt; }, 0);
    var lastSum = Object.keys(B).reduce(function (s, k) { return s + B[k].amt; }, 0);
    var rate = lastSum ? Math.round((total / lastSum) * 100) : null;
    if (!total) return { total: 0, rate: 0, lines: [nowFile.dept + " · 지난주와 합계가 같아요."], top: null };
    var dir = total > 0 ? 1 : -1;
    var same = deltas.filter(function (d) { return Math.sign(d.amt) === dir; }).sort(function (x, y) { return Math.abs(y.amt) - Math.abs(x.amt); });
    var opp = deltas.filter(function (d) { return Math.sign(d.amt) === -dir; }).sort(function (x, y) { return Math.abs(y.amt) - Math.abs(x.amt); });
    var top = same[0];
    var desc = function (d) { return d.item + "(" + (d.qty ? (d.qty > 0 ? "+" : "−") + Math.abs(d.qty) + "개, " : "") + signed(d.amt) + "원)"; };
    var lines = [nowFile.dept + " " + (rate == null ? "" : (rate > 0 ? "+" : "") + rate + "% ") + "(" + signed(total) + "원)"];
    // 형식 오류 칸은 합계에서 빠진다 — 그 탓에 줄어 보이는지 먼저 알린다
    var badCount = nowFile.rows.filter(function (r) { return !ex.has(r.id) && Number.isNaN(toNum(r.amount)); }).length;
    if (badCount) lines.push("형식 오류 " + badCount + "칸이 합계에서 빠져 있어 실제보다 " + (dir > 0 ? "적게 늘어" : "많이 줄어") + " 보일 수 있어요. 오류를 고치면 다시 계산돼요.");
    var tail = top.isNew ? " — 지난주엔 없던 품목이에요" : top.gone ? " — 이번 주엔 없는 품목이에요" : "";
    var who = top.clients.length && top.clients.length <= 2 ? " · 거래처 " + top.clients.join(", ") : "";
    lines.push("가장 크게 " + (dir > 0 ? "늘어난" : "줄어든") + " 품목은 " + desc(top) + who + tail + ".");
    // 반대로 움직인 품목이 크면 함께 적는다 (합계만 보면 묻히는 변화)
    if (opp[0] && Math.abs(opp[0].amt) >= Math.abs(top.amt) * 0.25) lines.push("반대로 " + desc(opp[0]) + "은 " + (dir > 0 ? "줄었어요" : "늘었어요") + ".");
    else if (Math.abs(top.amt) <= Math.abs(total)) lines.push("이 품목이 증감의 " + Math.round((top.amt / total) * 100) + "%를 차지해요.");
    return { total: total, rate: rate, lines: lines, top: top, badCount: badCount };
  }

  /* ───────── 샘플 (가상의 다온오피스(주)) ───────── */
  var DEPTS = [
    ["영업1팀", ["김도윤", "이서연"], "08:12"], ["영업2팀", ["박지훈", "최유나"], "08:25"], ["영업3팀", ["정민재", "강하린"], "08:31"],
    ["온라인팀", ["조은비", "윤태오"], "08:36"], ["B2B팀", ["장서우", "임하준"], "08:40"], ["수도권지사", ["한지민", "오세훈"], "08:47"],
    ["영남지사", ["서예린", "신동현"], "08:52"], ["호남지사", ["권나은", "황준서"], "08:55"], ["충청지사", ["안소율", "송민기"], "08:58"],
    ["해외사업팀", ["류지안", "홍시우"], "09:41"],
  ];
  var CLIENTS = ["한빛상사", "대성테크", "미래물산", "서울푸드", "하나디자인", "코리아메디", "태양전자", "누리교육", "정우건설", "오렌지마켓", "바른회계", "동해물류"];
  var ITEMS = [["프린터 토너", 48000], ["A4 용지(박스)", 26000], ["모니터 27형", 289000], ["무선 키보드", 39000], ["사무용 의자", 159000], ["노트북 거치대", 32000], ["복합기 렌탈(월)", 120000], ["회의 테이블", 420000]];
  var DAYS = { now: ["10/12", "10/13", "10/14", "10/15", "10/16"], last: ["10/5", "10/6", "10/7", "10/8", "10/10"] };
  var ROWS_PER = [4, 5, 4, 6, 5, 4, 5, 4, 5, 4];

  /** 사고 없는 기준 행 (이번 주 기준) */
  function baseRows(di, d) {
    var rows = [];
    for (var j = 0; j < ROWS_PER[di]; j++) {
      var it = ITEMS[(di * 3 + j * 2) % ITEMS.length];
      var qty = 2 + ((di * 7 + j * 5) % 17);
      if (di === 7 && j === 2) { it = ["사무용 의자", 159000]; qty = 10; } // 호남지사 사고가 날 행
      rows.push({ j: j, date: DAYS.now[(di + j) % 5], owner: d[1][j % 2], client: CLIENTS[(di * 2 + j) % CLIENTS.length], item: it[0], price: it[1], qty: qty });
    }
    return rows;
  }
  // 지난주 수량 = 이번 주 수량 × 부서별 계수 (자연스러운 주간 흔들림)
  var LAST_FACTOR = [0.9, 1.08, 0.95, 1.12, 1.0, 0.92, 0.85, 1.05, 0.97, 1.0];

  /** 한 주치 부서 파일. now는 사고 2건(중복 행, 1,59O,000)을 일부러 넣는다 */
  function sampleWeek(week, uid) {
    uid = uid || (function () { var n = 0; return function (p) { return p + (n++); }; })();
    var files = DEPTS.map(function (d, di) {
      var rows = baseRows(di, d).map(function (b) {
        var qty = week === "last" ? Math.max(1, Math.round(b.qty * LAST_FACTOR[di])) : b.qty;
        var date = week === "last" ? DAYS.last[(di + b.j) % 5] : b.date;
        return { id: uid("r"), date: date, owner: b.owner, client: b.client, item: b.item, qty: String(qty), amount: String(qty * b.price) };
      });
      // 이번 주 B2B팀: 정우건설 회의 테이블 4개 신규 주문 (지난주엔 없던 품목 → 큰 증가)
      if (week === "now" && d[0] === "B2B팀") rows.push({ id: uid("r"), date: "10/15", owner: "임하준", client: "정우건설", item: "회의 테이블", qty: "4", amount: "1680000" });
      // 지난주 해외사업팀: 태양전자 모니터 12대 일회성 주문 (이번 주엔 없음 → 큰 감소)
      if (week === "last" && d[0] === "해외사업팀") rows.push({ id: uid("r"), date: "10/8", owner: "류지안", client: "태양전자", item: "모니터 27형", qty: "12", amount: "3468000" });
      var declared = rows.reduce(function (s, r) { return s + Number(r.amount); }, 0);
      return { id: uid("f"), dept: d[0], name: d[0] + "_10월" + (week === "last" ? "2" : "3") + "주_실적.xlsx", at: d[2], declared: declared, rows: rows, sample: true };
    });
    if (week === "now") {
      // 사고 1: 영업2팀이 같은 행을 두 번 붙여 넣었다
      var copy = JSON.parse(JSON.stringify(files[1].rows[1])); copy.id = uid("r");
      files[1].rows.splice(2, 0, copy);
      // 사고 2: 호남지사 금액에 영문 O가 섞였다 (1,590,000 → 1,59O,000)
      var hn = files[7].rows[2];
      hn.amount = "1,59O,000";
      files[7].declared = files[7].rows.reduce(function (s, r) { return s + (r === hn ? 1590000 : Number(r.amount)); }, 0);
    }
    return files;
  }

  return {
    FLAG_RATE: FLAG_RATE, COLS: COLS, FIELD: FIELD, REQUIRED: REQUIRED,
    toNum: toNum, fixTypo: fixTypo, won: won, signed: signed,
    parseCSV: parseCSV, guessMapping: guessMapping, headerKey: headerKey, tableToFile: tableToFile, tableToFiles: tableToFiles,
    analyze: analyze, compareWeeks: compareWeeks, explainChange: explainChange, sampleWeek: sampleWeek,
  };
});
