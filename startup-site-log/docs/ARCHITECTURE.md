# 구조

```mermaid
flowchart TB
  UP[사진 올리기<br/>버튼 · 끌어 놓기] --> ASSIGN[assignUploads<br/>지금 연 현장 폴더로만]
  ASSIGN --> ISS{photoIssues<br/>다른 폴더 · 다른 현장 이름 · 안전}
  ISS -- 다른 현장 의심 --> HOLD[보류 · 공유에서 뺌<br/>맞는 폴더로 옮기기]
  ISS -- 안전 메모 --> HUMAN[담당자 확인 표시<br/>고객에게는 '확인 중']
  ISS -- 통과 --> SH[shareable<br/>이 현장 · 이 날짜 · 넣기로 한 사진]
  HUMAN --> SH
  SH --> RULE[ruleLog<br/>공정별로 묶기 · 즉시 표시]
  SH --> AI["/api/demo/ai · sitelog.write<br/>(공정·메모만, 안전 메모는 내용 생략)"]
  AI --> C[Claude API]
  C --> N{normalizeLog<br/>그날 공정만 · 안전 건 '문제없음' 금지}
  N -- 통과 --> MERGE[mergeAi<br/>안전 표시 · 다음 공정은 규칙 값]
  N -- 실패 · 연결 안 됨 --> KEEP[규칙 일지 유지<br/>이유 표시]
  RULE --> LOG[공정 일지 · 진행 막대]
  MERGE --> LOG
  KEEP --> LOG
  LOG --> CL[고객 화면 미리보기<br/>shareText · 이름 가림]
  CL --> OUT[문구 복사 · 공유 링크 #view=토큰]
```

## 현장 폴더 (이번 프로젝트의 핵심 버그)

예전에는 사진을 한곳에 몰아 올리고 골라 보냈더니, 같은 날 다녀온 다른 현장 사진이 섞여 고객에게 갔다.

1. 업로드는 **지금 연 폴더**로만 들어간다(`assignUploads`). 폴더를 고르지 않고 올릴 방법이 없다.
2. 휴대폰에서 파일 이름 앞에 현장 코드를 붙여 찍는 습관(`B현장_도배_1420.jpg`)을 이용해, 코드가 폴더와 다르면 보류한다(`siteCodeOf`).
3. 보류한 사진은 `shareable()`에서 빠지고, 공정 진행 계산에서도 빠진다. ‘B현장 폴더로 옮기기’를 누르면 맞는 폴더로 간다.

## 안전 메모는 사람에게

`safetyFlag()`가 누수·균열·누전·구조·석면·가스·곰팡이 표현을 찾으면

- 내 일지: 노란 ‘담당자 확인 필요’ 표시
- AI 입력: 메모 내용 대신 “안전 확인 필요 (담당자가 판단, 내용 생략)”
- AI 응답: 안전 건이 있는데 ‘문제없다·이상 없다·안전하다’가 있으면 버림
- 고객 문구: “담당자가 현장에서 직접 확인한 뒤 따로 연락드립니다”

## 파일

| 파일 | 하는 일 | DOM |
|---|---|---|
| `logic.js` | 공정 짐작, 현장 코드·폴더 검사, 안전 표시, 진행, 규칙 일지, 응답 검사·합치기, 공유 문구·토큰 | 없음 |
| `ai-client.js` | `/api/demo/ai` 호출, 실패하면 `null` | 없음 |
| `app.js` | 현장 폴더 · 사진 카드(SVG 샘플 그림) · 일지 · 고객 화면, localStorage(`startup-site-log-v1`, 직접 올린 사진 파일은 저장하지 않음) | 있음 |
| `tests/logic.test.js` | `node --test` 12개 | — |
| `docs/ai-task.json` | 서버 TASKS에 넣을 `sitelog.write` 정의 | — |
