# 구조

```mermaid
flowchart TB
  CO[비용 설정<br/>수수료 2개 · 재료 · 배송 · 작가 시간 · 고정비 · 방문자] --> U[logic.unit<br/>1인당 남는 돈 · 남는 비율]
  PL[구성 3가지<br/>가격 · 작가 시간 · 키트] --> U
  CO --> MC[missingCosts<br/>빠진 비용 경고]
  U --> BE[breakEven<br/>손익분기 인원]
  U --> LG[1기 계산 방식 비교<br/>legacy: 수수료 빠짐]
  PRE[사전 신청 테스트<br/>방문 · 신청] --> R[presignRows<br/>신청률 · 방문자당 · 예상 수강생·이익]
  U --> R
  R --> RULE[reviewRule<br/>방문자당 남는 돈 최대 · 즉시 표시]
  R --> AI["/api/demo/ai · classpricing.review"]
  AI --> CHK{normalizeReview<br/>구성 id · 입력에 있는 숫자만}
  CHK -- 통과 · 숫자 그대로 --> REC[Claude 추천 이유]
  CHK -- 실패 · 연결 안 됨 · 숫자 바뀜 --> RULE
  REC & RULE --> DEC[이 구성으로 정하기 · 되돌리기]
  R --> CSV[계산표 .csv]
```

## 계산 (`unit`)

```
1인당 남는 돈 = 가격 − 가격×플랫폼 수수료율 − 가격×결제 수수료율 − (키트면 재료비 + 배송비) − 작가 시간(분)/60 × 시간당 값
기수 이익     = 1인당 남는 돈 × 수강생 − 고정비
손익분기      = ⌈고정비 ÷ 1인당 남는 돈⌉ (남는 돈 ≤ 0 이면 불가)
방문자당      = 신청률 × 1인당 남는 돈
```
`{legacy:true}`는 수수료 두 줄을 0으로 두는 1기 방식이다. 테스트가 “두 방식의 차이 = 수수료 두 줄”을 확인한다.

## AI / 규칙 분기

- 계산은 늘 규칙(`logic.js`)이 한다. AI는 추천 구성과 이유 문장만 낸다.
- 숫자를 고치면 규칙 추천이 바로 다시 계산된다. 그 전에 받은 Claude 추천은 입력 키(`keyOf`)가 달라지면 버린다.
- `numbersGrounded`: 글 속 숫자(쉼표 제거)가 입력 숫자, 그 반올림, 천·만 단위 표기(9.9만), 백분율(12.5%) 중 하나와 맞아야 한다. 10 이하 작은 수는 허용.

## 파일

| 파일 | 하는 일 | DOM |
|---|---|---|
| `logic.js` | 샘플 숫자, 1인당 계산, 손익분기, 빠진 비용, 사전 신청, 규칙 추천, 숫자 검사, CSV | 없음 |
| `ai-client.js` | `/api/demo/ai` 호출, 실패하면 `null` | 없음 |
| `app.js` | 돌아보기 · 비용 · 구성 카드 · 테스트 표 · 추천 화면, localStorage | 있음 |
| `tests/logic.test.js` | `node --test` 12개 | — |
| `docs/ai-task.json` | 서버 TASKS에 합칠 작업 정의 | — |
