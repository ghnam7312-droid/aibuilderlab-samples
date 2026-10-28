# 십분설계

> 직장인 학습자용 **10분 차시 설계서**. 학습 목표를 행동 동사로 바꾸고 평가 문항과 짝을 맞추며, 차시 분량을 10분 안으로 관리하는 도구

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![design](https://img.shields.io/badge/목표·평가-짝%20검사-D2541F) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![십분설계 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-microlearning/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘배움설계자’)** 의 예시 프로젝트입니다. 가상의 사내 과정 ‘신임 파트장을 위한 1:1 면담 기술’ 설계서로 시작하며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 직장인 학습자가 1시간 강의를 끝까지 못 듣는다(설문) | 한 차시 = 영상 + 실습 + 퀴즈 **10분**, 넘으면 바로 표시 → **10분 단위 차시 8개** |
| 목표가 ‘이해한다’처럼 측정 불가 | 관찰할 수 없는 동사를 빨강으로 표시하고 **행동 동사**로 바꾸는 제안 |
| 목표와 평가 문항이 따로 놀았다 | 동사마다 짝이 되는 평가 유형과 문항 속 행동을 검사 → **학습 목표·평가 문항 짝 맞춤** |
| 설계서를 제작팀에 넘길 때 다시 정리했다 | 마크다운 표 복사 · 인쇄 |

## 주요 기능

- **과정 요약** — 차시 수·총 분량, 측정 가능한 목표 n/8, 목표–평가 짝 n/8, 10분 넘는 차시, 제작 준비 완료.
- **차시 목록** — 목표 속 동사를 초록(행동 동사)·빨강(관찰 불가)으로 칠하고, 분량 막대에 10분 선. ‘확인할 차시만’ 거르기.
- **차시 고치기** — 목표 동사 · 평가 짝 · 분량을 입력할 때마다 다시 검사합니다.
- **행동 동사로 고치기** — 규칙 제안이 바로, Claude 제안은 검사를 통과하면 덮어씁니다. 적용은 사람이 누르고 되돌릴 수 있습니다. 목표가 이미 측정 가능하면 평가 문항만 짝을 맞춥니다.
- **내보내기** — 설계서 마크다운 표 복사, 인쇄. 샘플로 되돌리기.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `microlearning.objective` → 측정 가능·동사 일치·평가 짝 검사 → 제안 | `Claude로 다듬음 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 알 수 없는 작업 | 목표 낱말로 동사를 고르고 동사별 평가 틀을 붙이는 규칙 제안 | `규칙 기반 · (이유)` |
| 응답이 검사를 통과하지 못함 | 버리고 규칙 제안 유지 | `규칙 기반 · 응답이 검사를 통과하지 못함` |

동사 기준표와 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| 학습 목표 설계 | 행동 동사 8개 · 단계 · 짝 평가 유형 기준표 (`logic.js`의 `VERBS`) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출, 화면이 같은 기준으로 다시 검사(프롬프트 평가표) |
| 저장 · 내보내기 | localStorage, 마크다운 표 복사, 인쇄 |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-microlearning/
├── index.html
├── style.css
├── logic.js          동사 기준 · 목표 읽기 · 차시 검사 · 규칙 제안 · 응답 검사 · 마크다운 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            과정 요약 · 차시 목록 · 고치기 화면
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
| 26회 | 1회 | 5시간 |

- **막혔던 문제** — 목표가 ‘이해한다’처럼 측정 불가 → 행동 동사로 바꿔 평가 문항과 연결
- **결과 (1기 목표치)** — 10분 단위 차시 8개, 학습 목표·평가 문항 짝 맞춤
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
