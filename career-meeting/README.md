# 회의끝

> 받아 적은 그대로의 회의록을 붙여 넣으면 Claude가 결정사항과 할 일(담당·마감)을 찾아 업무판에 올리고, **캘린더와 Notion으로** 내보내는 도구

![tests](https://img.shields.io/badge/tests-17%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![export](https://img.shields.io/badge/내보내기-.ics%20·%20Notion-2F5BFF) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![회의끝 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-meeting/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘새벽기획자’)** 의 예시 프로젝트입니다. 샘플 회의록으로 시작하며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 주 3회 회의마다 정리·업무 배정에 40분 | 붙여 넣고 ‘정리하기’ → **40분 → 6분** |
| 회의록을 다시 읽으며 할 일·담당·마감을 손으로 뽑았다 | Claude가 문맥으로 뽑고, ‘금요일까지’도 날짜로 바꾼다 |
| AI가 뽑은 게 맞는지 확인하기 어려웠다 | 항목마다 **회의록 몇 번째 줄**에서 나왔는지 붙여, 눌러서 바로 확인 |
| 정리한 뒤 노션·캘린더에 또 옮겼다 | 업무판에서 Notion 마크다운 · `.ics` 캘린더로 한 번에 |

## 주요 기능

- **두 가지 예시** — ‘받아 적은 그대로’(표시 없음)와 ‘형식 맞춘 회의록’(`@이름`, `결정:`). 같은 회의록에서 규칙과 Claude가 찾은 개수를 나란히 보여 줍니다.
- **기다리지 않는 정리** — 규칙 결과가 즉시 나오고, Claude 결과가 오면 줄 색이 다시 칠해집니다.
- **출처 줄** — 결과의 `5줄` 버튼 ↔ 회의록의 `→ 할 일 2` 버튼으로 서로 오갑니다. 카드에 마우스를 올려도 출처 줄이 밝혀집니다.
- **바로 고치기** — 담당·할 일·마감을 표에서 고치면 업무판 카드도 함께 바뀝니다. 잘못된 날짜는 바로 알려 줍니다.
- **업무판** — 끌어 놓기 또는 키보드(← →), 담당자별 거르기, 지우기 + 되돌리기.
- **마감 알림 · 캘린더** — 지났거나 2일 안에 마감인 일을 위에 모아 보여 주고, `.ics`로 내보내면 마감일 종일 일정 + 하루 전 알림이 들어갑니다.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `meeting.extract` → 형식 검사 → 출처 줄 연결 | `Claude로 정리 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 | 표시(`@이름`, `결정:`)만 읽는 규칙 정리. 처음 화면도 ‘형식 맞춘 회의록’으로 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 | 버리고 규칙 결과 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 내보내기 | iCalendar(RFC 5545) 직접 생성, Notion 체크리스트 마크다운 (실제 버전은 Notion API) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-meeting/
├── index.html
├── style.css
├── logic.js          날짜 · 규칙 정리 · 응답 검사 · 출처 줄 · .ics · Notion (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            회의록 · 결과 · 업무판 화면
├── tests/logic.test.js
├── docs/ (DEVLOG · PROMPTS · ARCHITECTURE)
├── CHANGELOG.md
└── package.json
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 17개
```

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 58회 | 7회 | 9시간 |

- **막혔던 문제** — Notion API 권한 오류(403) → 통합(integration)을 페이지에 ‘연결’로 공유해 해결
- **결과 (1기 목표치)** — 회의 뒤 정리 40분 → 6분
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
