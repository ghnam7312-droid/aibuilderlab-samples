# 집으로 · 구조

```mermaid
flowchart TB
  SRC[강의 원고] --> SPLIT[splitSentences<br/>문장 번호 매기기]
  Q[부모 질문] --> TRI{triage<br/>건강·발달·안전 낱말}
  TRI -- 응급 낱말 --> U[카드 없음 · 119 안내]
  TRI -- 상담 낱말 --> C[카드 없음 · 전문가 상담 안내]
  TRI -- 없음 --> RULE
  SPLIT --> RULE[buildCard<br/>원고 문장에서 규칙 카드 · 즉시 표시]
  RULE --> G1[ground<br/>근거 검사]
  Q -- 없음일 때만 --> SCR[scrub<br/>이름·전화·메일·나이 가림]
  SPLIT --> AI
  SCR --> AI["/api/demo/ai · parentcards.make"]
  AI --> CL[Claude API]
  CL --> N{normalizeCard<br/>형식 검사}
  N -- 통과 --> G2[문장마다 ground<br/>같은 근거 검사]
  G2 -- 말·행동·질문 모두 남음 --> OUT
  G2 -- 모자람 --> KEEP
  N -- 실패 · 연결 안 됨 --> KEEP[규칙 카드 유지<br/>이유 표시]
  G1 --> OUT[가정 실천 카드 + 버린 문장·이유]
  KEEP --> OUT
  OUT --> MAIL[buildMail<br/>무료판 / 유료판]
  OUT --> QUEUE[addToQueue<br/>이번 주 발송함]
```

## 근거 검사 (`ground`)

카드 문장 하나 `{text, refs}`를 원고 문장과 맞춰 본다. 위에서부터 하나라도 걸리면 버린다.

| 검사 | 버리는 경우 | 예 |
|---|---|---|
| 근거 번호 | refs가 비었거나 원고에 없는 번호 | `refs: [40]` |
| 의학·발달 낱말 | 카드에 있고 근거 문장에는 없는 `MED` 낱말 (낱말 + 조사로 찾음, ‘약속’은 ‘약’ 아님) | 멜라토닌, 약, 진단, 정상 발달 |
| 숫자 기준 | 근거 문장에 없는 ‘숫자 + 개월·살·시간·분·회’ | 하루 1시간 |
| 일치율 | 카드 문장의 글자쌍 중 근거 문장에 있는 비율이 60% 미만 | 원고와 다른 새 조언 |

규칙 카드는 원고 문장을 그대로 쓰므로 늘 통과하지만, 같은 검사를 거쳐 일치율을 화면에 보여 준다.

## 사람에게 넘기기 (`triage`)

부모 질문은 카드를 만들기 전에 먼저 본다. 건강·발달 낱말이면 상담 안내, 응급 낱말이면 119 안내를 띄우고 **카드도, AI 호출도 하지 않는다.** 질문은 localStorage에 저장하지 않는다.

## 파일

| 파일 | 하는 일 | DOM |
|---|---|---|
| `logic.js` | 샘플 원고 3개, 문장 나누기, 규칙 카드, 근거 검사, 응답 검사, 질문 분류, 개인정보 가리기, 메일·발송함·구독 계산 | 없음 |
| `ai-client.js` | `/api/demo/ai` 호출, 실패하면 `null` (공통 파일, 수정 금지) | 없음 |
| `app.js` | 원고 · 카드 · 메일 미리보기 · 검사기 · 발송함 화면, localStorage | 있음 |
| `tests/logic.test.js` | `node --test` 13개 | — |

## 저장

- `localStorage["startup-parent-cards-v1"]` — 고른 강의, 고친 원고, 다른 문장 보기 횟수, 무료/유료 미리보기, 발송함.
- 부모 질문은 저장하지 않고, AI에는 가린 질문만 보낸다.
