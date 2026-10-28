# 구조

```mermaid
flowchart TB
  PR[단가 기록<br/>item · price · asOf] --> PICK[pickPrice<br/>기준일 이전 가장 최신]
  BASIS[단가 기준<br/>최신 · 작년] --> PICK
  PR --> STALE[staleItems<br/>더 새 단가가 있음 · 1년 넘음]
  PKG[패키지 3종<br/>면적 · 구성 · 인건비 일수 · 판매가] --> CALC[calcPackage<br/>자재 + 인건비 + 관리비 = 원가]
  PICK --> CALC
  CALC --> JUDGE[status · minPrice<br/>목표 마진 판정 · 최소 판매가]
  JUDGE --> CARDS[패키지 카드 · 구성 표]
  STALE --> BAND[단가 기준 띠 경고]
  CALC --> CSV[toCsv · 비교표 내보내기]
  PKG --> RULE[rulePitch<br/>규칙 소개 문구 · 즉시 표시]
  PKG --> AI["/api/demo/ai · smallpkg.pitch<br/>(구성 이름만, 금액 없음)"]
  AI --> C[Claude API]
  C --> N{normalizePitch<br/>구성에 있는 항목만 · 금액·과장 금지}
  N -- 통과 --> PITCH[소개 문구]
  N -- 실패 · 연결 안 됨 --> RULE
  RULE --> PITCH
  CALC --> PITCH
```

## 단가 기준일 (이번 프로젝트의 핵심 실수)

처음 기획할 때 자재 단가표를 작년 것 그대로 썼다. 원룸 기본 마진이 30%로 보여 그 가격으로 내놓을 뻔했는데, 최신 단가로 다시 계산하니 21%, 투룸 기본은 목표(20%) 아래였다.

1. 단가는 덮어쓰지 않고 `{item, price, asOf}` 기록으로 쌓는다.
2. 계산은 `pickPrice(prices, item, 기준일)` — 기준일 이전 중 가장 최신. 기본 기준일은 오늘.
3. `staleItems()` — 고른 단가보다 새 기록이 있거나, 1년이 넘은 단가면 띠에 경고.
4. 화면에서 ‘작년 단가’를 누르면 그때 계산이 어떻게 보였는지, 카드마다 반대 기준의 마진을 함께 보여 준다.
5. 테스트: 작년 기준 30.1% → 최신 기준 20.9%, 최신 기준에서는 오래된 단가 0개.

## 숫자와 문장을 나눈 이유

| 부분 | 누가 | 이유 |
|---|---|---|
| 수량 · 단가 · 원가 · 마진 · 판매가 | `logic.js` 규칙만 | 같은 입력이면 늘 같은 값이어야 가격을 정할 수 있다 |
| 소개 문구(한 줄 소개 · 제외 · 질문) | Claude, 실패하면 규칙 | 고객 눈높이의 말은 AI가 낫지만, 가격·구성을 바꾸면 안 된다 |

## 파일

| 파일 | 하는 일 | DOM |
|---|---|---|
| `logic.js` | 단가 고르기, 오래된 단가, 패키지 계산, 판정·최소 판매가, CSV, 소개 문구 규칙·검사 | 없음 |
| `ai-client.js` | `/api/demo/ai` 호출, 실패하면 `null` | 없음 |
| `app.js` | 단가 기준 띠 · 패키지 카드 · 구성 표 · 소개 문구 · 단가표, localStorage(`startup-small-package-v1`) | 있음 |
| `tests/logic.test.js` | `node --test` 12개 | — |
| `docs/ai-task.json` | 서버 TASKS에 넣을 `smallpkg.pitch` 정의 | — |
