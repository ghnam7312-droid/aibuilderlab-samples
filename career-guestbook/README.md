# 한마디함

> 행사 화면의 QR을 찍어 폰으로 한마디를 남기면, 3초 안에 벽에 붙고 Claude가 칭찬·개선 요청·질문으로 나눠 **운영진이 할 일**까지 정리해 주는 피드백 보드

![tests](https://img.shields.io/badge/tests-18%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![realtime](https://img.shields.io/badge/실시간-QR%20참여-1F6F55) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![한마디함 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-guestbook/index.html
폰으로 참여해 보려면 데모의 QR을 휴대폰 카메라로 찍으세요.

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘새벽기획자’)** 의 예시 프로젝트입니다. 샘플 의견 24건으로 시작하며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 행사 후 피드백을 받으려면 매번 구글폼을 새로 만들었다 | 행사마다 QR 하나. 이름 없이 바로 쓰는 쪽지 |
| 수백 건을 사람이 읽고 손으로 분류하느라 반나절이 걸렸다 | 들어오는 즉시 Claude가 분류, 요약까지 → **반나절 → 5분** |
| 개선 요청이 많아도 무엇부터 고칠지 몰랐다 | 개선 요청을 주제로 묶어 ‘운영진이 할 일’로 바꿔 줌 |
| 질문이 섞여 있어도 답하지 못하고 지나갔다 | 질문 쪽지에서 운영진이 바로 답변 |

## 주요 기능

- **폰으로 참여 (실시간)** — 방문자마다 방 코드가 생기고, QR → 참가자 화면 → 3초 안에 벽에 붙습니다. 남의 방 글은 보이지 않습니다.
- **두 단계 분류** — 키를 칠 때는 규칙으로 즉시 미리보기, 남길 때는 Claude가 문맥으로 다시 분류합니다. 쪽지마다 어느 쪽으로 분류됐는지 표시됩니다.
- **AI 요약 · 운영진이 할 일** — 세 줄 요약과 주제별 조치. 새 의견이 쌓이면 “새 의견 N건 반영해 다시 요약”이 켜집니다.
- **행사 진행 모드** — 프로젝터용 큰 QR과 벽을 전체 화면으로. Esc로 끝냅니다.
- **사람이 바로잡기** — 분류를 고치면 ‘사람이 고침’ 표시가 남고 가장 우선합니다. 숨기기는 되돌릴 수 있습니다.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | 남길 때 `guestbook.classify`, 요약은 `guestbook.summary` | `Claude로 요약 · 1.4초`, 쪽지에 `Claude` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 | 같은 화면을 브라우저 규칙으로 | `규칙 기반 · (이유)` |
| Claude가 이상한 값을 줌 | `logic.js`가 검사해 버리고 규칙으로 | 규칙 기반으로 표시 |

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 (키는 서버에만) |
| 실시간 방 | 서버 `/api/demo/room` + Supabase(Postgres), 3초 폴링 |
| QR | qrcode-generator 1.4.4 (불러오지 못하면 링크로 대체) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-guestbook/
├── index.html        운영진 화면 + 참가자 화면
├── style.css         쪽지 색, 진행 모드, 반응형
├── logic.js          규칙 분류 · 요약 계산 · 응답 검사 · 방 코드 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            화면 그리기와 이벤트
├── tests/logic.test.js
├── docs/
│   ├── DEVLOG.md     5~8주차 개발 일지
│   ├── PROMPTS.md    만들 때 쓴 프롬프트 + 서비스 지시문
│   └── ARCHITECTURE.md
├── CHANGELOG.md
└── package.json      npm test
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 18개
```

로컬에서 열어도 AI·실시간 방은 aibuilderlab.kr 서버를 부릅니다. 연결이 안 되면 규칙 모드로 끝까지 동작합니다.

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 42회 | 9회 | 6시간 |

- **막혔던 문제** — 배포 후 남긴 글이 보이지 않음 → Supabase RLS 읽기 정책이 빠진 것을 찾고, 방 코드 검사·도배 제한을 위해 서버 API로 옮겨 해결
- **결과 (1기 목표치)** — 동아리 2곳, 사용자 74명, 피드백 212건 · 분류 시간 반나절 → 5분
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
