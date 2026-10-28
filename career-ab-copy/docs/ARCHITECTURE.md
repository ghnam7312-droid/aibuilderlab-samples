# 구조

```mermaid
flowchart TB
  EV[노출·클릭 기록<br/>샘플 seed + 직접 넣은 기록] --> MARK[logic.markEvents<br/>30분 안 같은 기록 → 중복<br/>노출 없는 클릭 → 제외]
  MARK --> TALLY[tally · daily]
  TALLY --> VER{verdict<br/>노출 300회씩?}
  VER -- 아니오 --> NEED[표본 부족 · 남은 노출 수]
  VER -- 예 --> Z[zTest · 유의수준 5%]
  Z --> WIN[승리 → 이긴 문구 남김]
  Z --> TIE[차이 없음 → A 유지]
  WIN & TIE --> SUM[summary<br/>처음 문구 vs 남긴 문구]
  WIN & TIE --> RULE[ruleSuggest<br/>규칙 후보 · 즉시 표시]
  RULE --> AI["/api/demo/ai · abcopy.suggest"]
  AI --> CHK{normalizeSuggest<br/>과장 · 지어낸 숫자 · 중복 · 길이}
  CHK -- 통과 --> CAND[Claude 후보로 교체]
  CHK -- 실패 · 연결 안 됨 --> KEEP[규칙 후보 유지 · 이유 표시]
  CAND & KEEP --> NEXT[nextTest<br/>남긴 문구 A vs 후보 B]
```

## 중복 막기 (`markEvents`)

기록을 시간순으로 놓고 `방문자|문구|종류` 열쇠마다 마지막으로 센 시각을 기억합니다.

1. 같은 열쇠가 30분 안에 또 오면 `dup` — 새로고침으로 같은 기록이 다시 들어온 경우.
2. 그 방문자가 그 문구를 본(노출) 기록이 없는데 클릭이 오면 `orphan`.
3. 나머지만 셉니다. `dedupe=false`는 고치기 전 방식(모두 셈)으로, 화면의 비교 스위치에만 씁니다.

## AI와 규칙의 경계

- **판정은 숫자만** — 승패·남길 문구는 `verdict()`가 정합니다. AI는 다음 후보를 ‘제안’만 합니다.
- **후보는 바로 쓰지 않는다** — 후보는 `nextTest()`로 새 대결의 B가 되어 다시 숫자로 검증받습니다.
- **사실은 입력에서만** — 규칙 후보는 `facts`를 다시 배치할 뿐이고, Claude 후보도 `inventedNumbers()`로 입력에 없는 숫자가 있으면 버립니다.

## 파일

| 파일 | 하는 일 | DOM |
|---|---|---|
| `logic.js` | 샘플 기록 생성, 중복 막기, 집계, z검정, 판정, 후보 검사, CSV | 없음 |
| `ai-client.js` | `/api/demo/ai` 호출, 실패하면 `null` | 없음 |
| `app.js` | 요약 · 목록 · 상세 · 눌러 보기 · 후보 화면, localStorage(`career-ab-copy-v1`) | 있음 |
| `tests/logic.test.js` | `node --test` 14개 | — |
