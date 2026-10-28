# 답해둠

> 수강 문의를 재료·환불·수강 기간·영상으로 나누고 FAQ로 답변 초안을 쓰는 도구. **환불은 AI 없이 환불 규정 문서만 보고** 금액과 조항을 계산한다

![tests](https://img.shields.io/badge/tests-14%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![refund](https://img.shields.io/badge/환불-규정%20문서만-6A4BC4) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![답해둠 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/startup-class-faq/index.html

> **알림** AI 빌더랩 스타트업 트랙 **1기 목표 모델(가상의 수강생 ‘그림한스푼’)** 의 예시 프로젝트입니다. 문의·이름·주문 정보·환불 규정은 모두 샘플이며, 결과 숫자는 1기 목표치입니다. 환불 규정은 샘플 클래스가 정한 문서 예시이고 법률 판단을 대신하지 않습니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 같은 질문(재료, 환불, 수강 기간)에 하루 20번씩 답했다 | 분류하고 FAQ에서 가장 가까운 답으로 초안 → **반복 문의 응대 하루 1시간 → 15분** |
| 환불 질문에 AI가 규정과 다른 답을 썼다 | **환불은 AI에 보내지 않는다.** 규정 문서 조항과 주문 정보로만 계산하고, 조항 원문을 답변에 인용 |
| AI 초안에 돈 얘기가 섞여 들어올 수 있다 | 응답에 환불·환급·보상 같은 말이 있으면 버리고 FAQ 초안 유지 |
| 분쟁·신고, 규정에 없는 사정(입원 등)까지 자동으로 답하면 위험하다 | ‘운영자가 직접 답변’으로 넘기고 초안을 만들지 않는다 |

## 주요 기능

- **문의함** — 카톡 채널·DM·메일 문의를 분류(재료 · 환불 · 수강 기간 · 영상·접속 · 기타)하고 갈래(FAQ 초안 · 환불 규정 · 직접 답변)를 붙인다. 분류로 거르기.
- **새 문의 넣어 보기** — 문장을 넣으면 바로 분류하고 초안을 쓴다.
- **환불 계산** — 결제 후 날짜·시청 강의·키트 발송/반송을 고치면 규정대로 다시 계산하고, 적용한 조항 원문을 답변에 붙인다.
- **개인정보 가리기** — 이름은 `윤○○`으로, 문의 속 전화번호·이메일은 가려서 보이고, AI에도 이름은 보내지 않는다.
- **답변 완료 · 되돌리기 · 답변 복사**
- **자주 묻는 질문 정리** — 오늘 문의가 어느 FAQ로 답해졌는지 세고, 많이 걸린 순서로 FAQ 마크다운을 복사한다(환불 규정 포함).

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| FAQ 갈래 · Claude 연결됨 | `classfaq.reply` → 돈 얘기·형식 검사 → 초안 덮어쓰기 | `Claude로 초안 · 1.4초` |
| FAQ 갈래 · AI 키 없음 · 한도 초과 · 알 수 없는 작업 | FAQ 답을 그대로 쓴 규칙 초안 | `규칙 기반 · (이유)` |
| 응답에 환불·돈 얘기 · 형식 오류 · 없는 FAQ 번호 | 버리고 규칙 초안 유지 | `규칙 기반 · 돈 얘기·형식 오류라 버림` |
| 환불 문의 | AI 호출 없음. 규정 문서 + 주문 정보로 계산 | `규정 문서로 답변 · AI 사용 안 함` |
| 분쟁·신고·규정 밖 사정 | AI 호출 없음. 초안 없음 | `운영자가 직접 답변` |

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버용 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| 분류 · FAQ 찾기 | 낱말 규칙 + 두 글자 조각 겹침 |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 (FAQ 갈래만) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
startup-class-faq/
├── index.html
├── style.css
├── logic.js          분류 · 사람에게 넘기기 · 환불 규정 계산 · FAQ 찾기 · 응답 검사 · 가리기 · 정리 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            문의함 · 답변 · FAQ 정리 화면
├── tests/logic.test.js
├── docs/ (ARCHITECTURE · DEVLOG · PROMPTS · ai-task.json)
├── CHANGELOG.md
└── package.json
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 14개
```

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 25회 | 3회 | 4시간 |

- **막혔던 문제** — 환불 질문에 AI가 규정과 다른 답을 씀 → 환불은 규정 문서만 보고 답하게 제한
- **리드 빌더 코멘트** — “돈이 걸린 질문은 규정만 보게 한 판단이 정확했습니다.” (린스타터)
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
