/* 프롬서랍 — 순수 로직 (화면과 분리)
 *
 * 브라우저에서는 window.Promseorap, Node(테스트)에서는 require('./logic.js').
 *
 * 팀 공용 프롬프트 12개를 꺼내 빈칸을 채우고 자료를 붙여 복사한다. 복사 전에 반드시 검사한다.
 *   1) 넣으면 안 되는 정보(고객 이름·연락처·주소·주문번호·주민번호·카드번호) → 있으면 복사 막기, '가리고 복사'만 허용
 *   2) 조심할 정보(미공개 매출·원가, 계약 단가) → 경고
 *   3) 법률·의료·안전 판단을 AI에 맡기는 요청 → '사람 확인' 표시 (AI 답을 근거로 쓰지 않는다)
 * 프롬프트 점검(역할·목적·대상·형식·분량·조건)과 결과물 검수(과장 표현·숫자 대조)도 여기서 한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Promseorap = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- 넣으면 안 되는 정보 (가이드 맨 앞) ---------- */
  const FORBIDDEN = [
    { id: "name", kind: "block", label: "고객 이름", example: "고객 김○○님", mask: "[고객]", re: /(?:고객|회원|주문자|구매자|수령인)\s?[가-힣]{2,4}\s?(?:님|씨|고객님)/g },
    { id: "phone", kind: "block", label: "전화번호", example: "010-0000-0000", mask: "[전화번호]", re: /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g },
    { id: "email", kind: "block", label: "이메일", example: "name@mail.com", mask: "[이메일]", re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
    { id: "address", kind: "block", label: "집 주소", example: "○○시 ○○구 ○○로 12", mask: "[주소]", re: /[가-힣]{1,4}(?:시|도)\s[가-힣]{1,4}(?:구|군|시)\s[가-힣0-9]{1,10}(?:로|길)\s?\d{1,4}(?:-\d{1,4})?/g },
    { id: "order", kind: "block", label: "주문·회원번호", example: "주문번호 2026…", mask: "[주문번호]", re: /(?:주문|회원|송장)\s?번호\s?:?\s?[A-Za-z0-9-]{6,}/g },
    { id: "rrn", kind: "block", label: "주민등록번호", example: "000000-0000000", mask: "[주민번호]", re: /\d{6}-[1-4]\d{6}/g },
    { id: "card", kind: "block", label: "카드번호", example: "0000-0000-0000-0000", mask: "[카드번호]", re: /\d{4}-\d{4}-\d{4}-\d{4}/g },
    { id: "secret", kind: "warn", label: "미공개 매출·원가·마진", example: "원가, 마진율, 내부 매출", re: /원가|마진율?|내부 매출|미공개|대외비/g },
    { id: "contract", kind: "warn", label: "계약서·거래처 단가", example: "계약서 전문, 단가표", re: /계약서|단가표|거래처 단가|공급 단가/g },
  ];
  /** AI가 판단하면 안 되는 일: 담당자에게 */
  const HUMAN_ONLY = /법적으로|위반인지|위반 여부|약관|표시광고|과대광고|소송|효능|치료|부작용|안전한지|안전성/;

  function scan(text) {
    const s = String(text || "");
    const found = [];
    FORBIDDEN.forEach((f) => {
      (s.match(new RegExp(f.re.source, "g")) || []).forEach((m) => found.push({ id: f.id, kind: f.kind, label: f.label, match: m }));
    });
    const legal = s.match(HUMAN_ONLY);
    return {
      block: found.filter((x) => x.kind === "block"),
      warn: found.filter((x) => x.kind === "warn"),
      human: legal ? legal[0] : "",
    };
  }
  /** 막아야 할 정보만 자리표시로 바꾼다 (조심할 정보는 사람이 판단) */
  function mask(text) {
    let s = String(text || "");
    FORBIDDEN.filter((f) => f.kind === "block").forEach((f) => { s = s.replace(new RegExp(f.re.source, "g"), f.mask); });
    return s;
  }

  /* ---------- 프롬프트 채우기 ---------- */
  const VAR = /\{\{([^{}]+)\}\}/g;
  function varsOf(body) { return [...new Set([...String(body).matchAll(VAR)].map((m) => m[1].trim()))]; }
  /** 빈칸 채우기 → { text, empty: [빈 칸 이름] } */
  function fill(body, values, material) {
    const empty = [];
    let text = String(body).replace(VAR, (_, k) => {
      const v = String((values || {})[k.trim()] ?? "").trim();
      if (!v) { empty.push(k.trim()); return `[${k.trim()}]`; }
      return v;
    });
    if (material && String(material).trim()) text += `\n\n[자료]\n${String(material).trim()}`;
    return { text, empty: [...new Set(empty)] };
  }

  /* ---------- 프롬프트 점검 (규칙) ---------- */
  const PARTS = [
    { id: "role", label: "역할", re: /당신은|너는|역할|담당자로서|입장에서/ },
    { id: "goal", label: "목적", re: /위해|목적|목표|하려고|용도|용으로|알리기|확인하는|공유하기|보고를|읽도록/ },
    { id: "audience", label: "대상", re: /대상|독자|고객층|타깃|받는 사람|팀원|팀장|상품팀|협력사|리뷰에|30대|20대|40대/ },
    { id: "format", label: "출력 형식", re: /표로|표\(|목록|형식|JSON|번호를|항목|제목과|불릿|순서로|\d\)/ },
    { id: "length", label: "분량", re: /\d+\s?(?:자|문장|줄|개|안|단어)|이내|넘지/ },
    { id: "limit", label: "조건·금지", re: /하지 ?마|쓰지 않|넣지 않|않는다|금지|말 것|피한다|과장|표시만/ },
  ];
  function checkPrompt(text) {
    const s = String(text || "");
    const has = PARTS.filter((p) => p.re.test(s)).map((p) => p.id);
    const missing = PARTS.filter((p) => !has.includes(p.id)).map((p) => p.label);
    return { score: Math.round((has.length / PARTS.length) * 100), has, missing };
  }

  /* ---------- AI 응답 검사 ---------- */
  /** Claude 점검 결과 → {score, missing, improved} 또는 null. 고친 프롬프트에 금지 정보가 있으면 버린다 */
  function normalizeReview(d) {
    if (!d || typeof d !== "object") return null;
    const score = Number(d.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    const missing = (Array.isArray(d.missing) ? d.missing : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 6);
    const improved = typeof d.improved === "string" ? d.improved.trim().slice(0, 1500) : "";
    if (!improved) return null;
    if (scan(improved).block.length) return null;
    return { score: Math.round(score), missing, improved };
  }

  /* ---------- 결과물 검수 ---------- */
  const HYPE = /최고|유일|100%|완벽|무조건|1위|최초|업계 최저|보장/g;
  const CHECKLIST = [
    { id: "pii", text: "넣으면 안 되는 정보가 결과물에 없다", auto: true },
    { id: "hype", text: "과장 표현(최고·유일·100%·보장)이 없다", auto: true },
    { id: "numbers", text: "숫자는 원본(시트·리포트)과 하나씩 대조했다", auto: false },
    { id: "legal", text: "법률·의료·안전 관련 문장은 담당자가 확인했다", auto: true },
    { id: "facts", text: "다른 회사·상품·사람에 대한 단정이 없다", auto: false },
    { id: "tone", text: "우리 팀 말투 가이드(존댓말, 짧은 문장)에 맞다", auto: false },
    { id: "source", text: "출처가 필요한 주장에는 출처를 달았다", auto: false },
    { id: "owner", text: "최종 담당자가 읽고 승인했다", auto: false },
  ];
  /** 결과물 자동 검사 → 체크리스트 항목별 { state: ok | bad | todo, note } */
  function inspectOutput(text) {
    const s = String(text || "");
    const sc = scan(s);
    const hype = [...new Set(s.match(HYPE) || [])];
    const nums = (s.match(/\d[\d,]*(?:\.\d+)?\s?(?:%|원|건|명|개|배)/g) || []);
    const r = {};
    r.pii = sc.block.length ? { state: "bad", note: `${sc.block.map((x) => x.label).join(", ")} 발견` } : { state: "ok", note: "없음" };
    r.hype = hype.length ? { state: "bad", note: `‘${hype.join("’, ‘")}’ 발견` } : { state: "ok", note: "없음" };
    r.numbers = { state: "todo", note: nums.length ? `숫자 ${nums.length}개 대조 필요` : "숫자 없음" };
    r.legal = sc.human ? { state: "bad", note: `‘${sc.human}’ — 담당자 확인 필요` } : { state: "ok", note: "해당 없음" };
    return r;
  }
  /** 자동 검사 + 사람이 체크한 항목 → 남은 항목 수 */
  function remaining(auto, checked) {
    return CHECKLIST.filter((c) => {
      if (c.auto && auto[c.id] && auto[c.id].state === "ok") return false;
      if (c.auto && auto[c.id] && auto[c.id].state === "bad") return true;
      return !checked[c.id];
    }).length;
  }

  /* ---------- 공용 프롬프트 12개 ---------- */
  const CATS = ["카피", "리포트", "리뷰", "메일", "기획", "정리"];
  const PROMPTS = [
    { id: "p01", cat: "카피", title: "상품 상세 카피 3안", uses: 41, owner: "콘텐츠", body: "당신은 생활용품 쇼핑몰의 카피라이터다. {{상품명}} 상세 페이지 첫 문단을 {{대상}}에게 쓴다. 장점 {{장점}}을 살려 3안을 번호를 붙여 쓰고, 각 안은 60자 이내. 최고·유일 같은 과장 표현은 쓰지 않는다." },
    { id: "p02", cat: "카피", title: "광고 소재 문구 A/B", uses: 33, owner: "퍼포먼스", body: "당신은 퍼포먼스 마케터다. {{채널}} 광고에 쓸 문구를 A안(혜택 강조)과 B안(문제 해결 강조)으로 2개씩 표로 쓴다. 상품은 {{상품명}}, 대상은 {{대상}}. 각 문구는 25자 이내, 확인되지 않은 수치는 넣지 않는다." },
    { id: "p03", cat: "카피", title: "SNS 캡션 + 해시태그", uses: 28, owner: "콘텐츠", body: "당신은 브랜드 SNS 담당자다. {{주제}} 게시물 캡션을 {{대상}}이 읽기 쉽게 3줄 이내로 쓰고, 해시태그 5개를 목록으로 붙인다. 이모지는 2개 이하, 과장 표현은 쓰지 않는다." },
    { id: "p04", cat: "리포트", title: "주간 광고 리포트 요약", uses: 24, owner: "퍼포먼스", body: "당신은 마케팅팀 주임이다. 팀장 보고를 위해 아래 채널별 숫자로 요약 3문장을 쓴다. 1) 전체 결과와 지난주 대비 2) 가장 좋은·나쁜 채널 3) 다음 주 검토할 일. 숫자는 자료에 있는 값만 쓰고 원인을 지어내지 않는다." },
    { id: "p05", cat: "리포트", title: "캠페인 결과 회고", uses: 12, owner: "기획", body: "당신은 캠페인 담당자다. {{캠페인명}} 결과를 팀 회고용으로 정리한다. 잘된 점·아쉬운 점·다음에 바꿀 점을 각각 3개 이내 목록으로 쓴다. 자료에 없는 숫자는 넣지 않는다." },
    { id: "p06", cat: "리뷰", title: "리뷰 불만 주제 묶기", uses: 19, owner: "CS", body: "당신은 고객 리뷰 분석 담당이다. 상품팀에 전달하기 위해 아래 리뷰를 불만 주제별로 묶어 표로 쓴다(주제, 건수, 대표 문장). 반어적 칭찬처럼 애매한 리뷰는 '사람 확인'으로 따로 둔다. 고객 이름은 쓰지 않는다." },
    { id: "p07", cat: "리뷰", title: "리뷰 답글 초안", uses: 37, owner: "CS", body: "당신은 {{쇼핑몰명}} 고객 응대 담당자다. 아래 리뷰에 남길 답글을 3문장 이내로 쓴다. 불편에 대한 사과, 확인할 내용, 다음 안내 순서로. 보상이나 환불을 약속하지 않는다." },
    { id: "p08", cat: "메일", title: "협력사 일정 확인 메일", uses: 15, owner: "기획", body: "당신은 마케팅팀 담당자다. {{협력사}}에 {{일정}} 촬영 일정을 확인하는 메일을 쓴다. 제목과 본문으로 나누고 본문은 5문장 이내, 확인할 항목은 번호를 붙인다. 단가나 계약 조건은 넣지 않는다." },
    { id: "p09", cat: "메일", title: "사내 공지 다듬기", uses: 11, owner: "전체", body: "당신은 사내 커뮤니케이션 담당이다. 아래 공지 초안을 팀원 모두가 1분 안에 읽도록 다듬는다. 핵심 3줄 + 일정·장소 목록 형식으로, 원문에 없는 내용은 더하지 않는다." },
    { id: "p10", cat: "기획", title: "이벤트 아이디어 10개", uses: 22, owner: "기획", body: "당신은 프로모션 기획자다. {{시즌}}에 {{상품군}}을 알리기 위한 이벤트 아이디어 10개를 표(이름, 방식, 예상 준비 기간)로 쓴다. 대상은 {{대상}}. 법적 검토가 필요한 경품 이벤트는 따로 표시만 한다." },
    { id: "p11", cat: "기획", title: "상품 비교표 틀", uses: 9, owner: "기획", body: "당신은 상품 기획 담당이다. {{상품군}} 구매를 고민하는 {{대상}}을 위해 비교 기준 6개를 표로 제안한다. 특정 회사 상품을 평가하거나 단정하지 않고, 기준과 확인 방법만 쓴다." },
    { id: "p12", cat: "정리", title: "회의 메모 → 할 일", uses: 30, owner: "전체", body: "당신은 회의 기록 담당이다. 팀원에게 공유하기 위해 아래 메모에서 결정사항과 할 일(담당, 마감)을 목록으로 뽑는다. 메모에 없는 담당자나 날짜는 만들지 않고 '미정'으로 쓴다." },
  ];
  /** 각 프롬프트의 예시 빈칸 값 */
  const SAMPLE_VALUES = { 상품명: "스텐 텀블러 500ml", 대상: "출퇴근하는 30대 직장인", 장점: "6시간 보온, 한 손 뚜껑", 채널: "SNS 피드", 주제: "가을 캠핑 준비물", 캠페인명: "10월 정리정돈 주간", 쇼핑몰명: "하루살림", 협력사: "가상스튜디오", 일정: "11월 6일(금) 오후 2시", 시즌: "연말", 상품군: "주방 수납용품" };
  const SAMPLE_MATERIAL = "리뷰(별점 2): 고객 김서연님 리뷰입니다. 뚜껑 사이로 커피가 새서 가방이 다 젖었어요. 교환하고 싶어요. 010-2345-6789로 연락 주세요.";
  const SAMPLE_OUTPUT = "불편을 드려 죄송합니다. 뚜껑 패킹이 제대로 끼워졌는지 확인 부탁드리며, 교환은 마이페이지에서 바로 신청하실 수 있습니다. 저희 텀블러는 업계 최고 수준의 밀폐력을 100% 보장합니다.";

  function search(list, q, cat) {
    const t = String(q || "").trim().toLowerCase();
    return list.filter((p) => (!cat || p.cat === cat) && (!t || `${p.title} ${p.body} ${p.cat} ${p.owner}`.toLowerCase().includes(t)));
  }

  return { FORBIDDEN, HUMAN_ONLY, PARTS, CHECKLIST, CATS, PROMPTS, SAMPLE_VALUES, SAMPLE_MATERIAL, SAMPLE_OUTPUT, scan, mask, varsOf, fill, checkPrompt, normalizeReview, inspectOutput, remaining, search };
});
