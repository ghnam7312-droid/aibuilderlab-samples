# 챙김

> 미팅 메모에서 **고객에게 보낼 내용만** 골라 후속 메일 초안을 쓰고, 보내기로 한 자료를 기한 알림으로 챙기는 도구

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![export](https://img.shields.io/badge/내보내기-.ics-6A4CE0) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![챙김 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/ax-followup-mail/index.html

> **알림** AI 빌더랩 직장인 AX 트랙 **1기 목표 모델(가상의 수강생 ‘미팅기록왕’)** 의 예시 프로젝트입니다. 등장하는 회사와 사람은 모두 가상이고, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 미팅 후 보내기로 한 자료를 깜빡해 고객이 먼저 연락함 | 메모에서 약속(자료 + 기한)을 찾아 **후속 알림**과 캘린더로 → **후속 누락 월 6건 → 0건** (목표치) |
| 후속 메일을 매번 처음부터 씀 | 고객 공유 줄로 초안이 바로 나오고, Claude가 고객이 읽기 좋게 다시 씀 |
| 내부용 메모(할인 한도·경쟁사 얘기)가 고객 메일 초안에 섞임 | 줄마다 **고객 공유 / 내부 전용**을 나눠 고객 공유 줄만 초안·AI에 넣음. 초안은 내부 줄과 다시 대조해 걸리면 복사를 막음 |

## 주요 기능

- **줄 분류** — `(내부)`·`[사내]`·`우리끼리:` 표시나 민감 낱말(마지노선·원가·할인 한도·경쟁사 단가·팀장님께 등)이 있으면 내부 전용. 줄을 눌러 바로 바꿉니다.
- **기다리지 않는 초안** — 규칙 초안이 즉시 나오고, Claude 초안이 오면 덮어씁니다.
- **섞임 검사** — 민감 낱말 · 내부 줄의 금액·% · 내부 줄과 겹치는 문장을 찾아 표시하고, 걸리면 복사 버튼을 잠급니다. 본문을 고칠 때마다 다시 검사합니다.
- **후속 알림** — 기한 순서, 지남·오늘·D-2 표시, ‘보냈어요’ + 되돌리기, 이번 달 놓친 후속 수.
- **캘린더** — 안 보낸 약속만 `.ics`로, 기한일 종일 일정 + 전날 오전 9시 알림.
- **개인정보** — 고객 메일 주소는 화면에 보여 주지 않고, 메일은 직접 보내지 않고 복사해서 씁니다.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `followup.draft`(고객 공유 줄만) → 형식 검사 → 섞임 검사 | `Claude로 작성 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 알 수 없는 작업 | 고객 공유 줄을 정해진 양식에 넣은 규칙 초안 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 | 버리고 규칙 초안 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |
| Claude 초안에 내부 메모가 섞임 | 버리고 규칙 초안 유지 | `규칙 기반 · AI 초안에 내부 메모가 섞여 버림` |

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 알림 | 브라우저 안의 목록(localStorage) + iCalendar(RFC 5545) 직접 생성 |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
ax-followup-mail/
├── index.html
├── style.css
├── logic.js          기한 · 분류 · 약속 · 규칙 초안 · 섞임 검사 · 응답 검사 · 알림 · .ics (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            메모 줄 · 초안 · 후속 알림
├── tests/logic.test.js
├── docs/ (ARCHITECTURE · DEVLOG · PROMPTS · ai-task.json)
├── CHANGELOG.md
└── package.json
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 12개
```

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 25회 | 3회 | 4시간 |

- **막혔던 문제** — 내부용 메모가 고객 메일 초안에 섞임 → 고객에게 보낼 내용만 따로 뽑게 바꿈
- **결과 (1기 목표치)** — 후속 누락 월 6건 → 0건
- **리드 빌더 코멘트** — “내부 메모가 밖으로 나갈 뻔한 걸 스스로 막은 점을 칭찬합니다.”
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
