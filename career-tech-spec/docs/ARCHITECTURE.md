# 구조

```mermaid
flowchart TB
  SC[화면 7개<br/>화면이 쓰는 테이블 체크] --> PR{logic.prune}
  AIP[AI 제안 테이블 13개<br/>컬럼 · FK · 용도] --> PR
  MAN[사람이 적은 '남기는 이유'] --> PR
  PR -- 화면이 씀 · 참조됨 · 사람이 남김 --> KEPT[남긴 테이블 7개]
  PR -- 쓰는 화면 없음 --> OFF[뺀 테이블 6개 + 이유]
  KEPT --> API[apisFor<br/>API 19개 → 14개]
  KEPT --> ERD[ERD]
  KEPT --> CK[checklist<br/>자동 4 + 사람 2]
  KEPT --> RR[ruleReasons<br/>규칙 근거 · 즉시 표시]
  OFF --> RR
  RR --> AI["/api/demo/ai · techspec.reasons<br/>결정과 함께 보냄"]
  AI --> C[Claude API]
  C --> NV{normalizeReview<br/>표에 있는 테이블? 결정과 같은가?}
  NV -- 통과 --> MG[mergeReasons<br/>근거 문장 덮어쓰기 + 위험 요소]
  NV -- 실패 · 연결 안 됨 --> KEEP[규칙 근거 유지<br/>이유 표시]
  MG --> MD[toMarkdown<br/>설계서 .md]
  KEEP --> MD
  API --> MD
  ERD --> MD
  CK --> MD
```

## 줄이기 규칙 (`prune`)

1. 화면이 하나라도 쓰는 테이블은 남긴다 (`why: screen`).
2. 사람이 이유를 적은 테이블은 남긴다 (`why: manual`). 빈 이유는 무시한다.
3. 남은 테이블이 FK로 참조하는 테이블을 끝까지 따라가 남긴다 (`why: fk`, `by`에 누가 참조했는지).
4. 나머지는 뺀다. 빠진 테이블을 참조하던 테이블이면 그 사실도 이유에 붙인다.

API는 쓰는 테이블이 모두 남아 있을 때만 남습니다(`apisFor`).

## AI와 규칙의 경계

- 남김·뺌 결정은 규칙과 사람이 합니다. Claude에게는 결정을 함께 보내고 근거 문장만 받습니다.
- 응답의 `keep`이 결정과 다르면 그 문장은 버립니다. 기다리는 사이 표가 바뀌어 결정 서명(`signature`)이 달라지면 응답 전체를 버립니다.
- 표를 바꾸면 Claude 근거는 더 이상 맞지 않으므로 규칙 근거로 돌아가고 `구성이 바뀜`을 표시합니다.
- 개인정보 컬럼 접근은 체크리스트에서 사람이 체크해야 통과합니다.

## 파일

| 파일 | 하는 일 | DOM |
|---|---|---|
| `logic.js` | 샘플 설계(테이블 13 · 화면 7 · API 19), 줄이기, API 걸러내기, 체크리스트, 근거, 응답 검사, 마크다운 | 없음 |
| `ai-client.js` | `/api/demo/ai` 호출, 실패하면 `null` | 없음 |
| `app.js` | 화면 × 테이블 표, 판단 기록, 체크리스트, ERD, API 명세 | 있음 |
| `tests/logic.test.js` | `node --test` 11개 | — |
