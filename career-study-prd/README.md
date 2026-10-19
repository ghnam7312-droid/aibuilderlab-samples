# 하루치

> 시험일과 하루 공부 시간을 넣으면 Claude가 7일 계획을 짜고, **규칙 검사를 통과한 계획만** 보여 주는 AI 공부 코치 — 기획서 · 프로토타입 · 프롬프트 평가표

![tests](https://img.shields.io/badge/tests-16%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![PRD](https://img.shields.io/badge/기획서-v1.3-13254A) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![하루치 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-study-prd/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘새벽기획자’)** 의 예시 프로젝트입니다. 스터디원 진행률 등은 샘플 값입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 스터디원마다 계획이 따로라 누가 어디까지 했는지 모른다 | 스터디 진행률을 한 화면에 |
| 계획을 짜는 데만 한 시간 | 목표·시험일·하루 시간·과목 → Claude가 7일 계획 |
| AI 계획이 그럴듯하지만 지킬 수 없다 | 날짜 · 하루 시간 · 하루 2과목을 **검사해서 통과한 것만** |
| 하루 밀리면 계획 전체가 무너진다 | ‘밀린 일 다시 나누기’ — 가장 가벼운 날부터 옮김 |

## 세 개의 탭

| 탭 | 내용 |
|---|---|
| **프로토타입** | 계획 만들기(Claude, 기다리는 동안 빈 달력이 빛남) · 체크하면 형광펜 · 진행률 고리 · 코치 한마디 · 밀린 일 다시 나누기 |
| **기획서 (PRD v1.3)** | 문제 · 대상 · 1차 기능 5개 · 2차로 미룬 것 · 화면 7개 흐름 · AI 설계 · 성공 지표 · 결정 기록(D1~D4) · 버전 기록 |
| **프롬프트 평가** | v1~v3을 5개 기준으로 채점(11 → 17 → 24점). v3은 서비스가 실제로 쓰는 지시문이고, 그 자리에서 실행해 검사 결과까지 볼 수 있음 |

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결 · 검사 통과 | Claude 계획 + 코치 조언 | `Claude 계획 · 검사 통과 · 3.1초` |
| Claude 연결 · 검사에 걸림 | 규칙 계획으로 바꿈 | `규칙 계획` + “10/22 계획이 228분 — 하루 2시간(120분)을 넘김” |
| AI 키 없음 · 네트워크 오류 | 같은 규칙으로 계획 | `규칙 계획 · (이유)` |

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문과 평가는 [docs/PROMPTS.md](docs/PROMPTS.md).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`의 `study.plan` |
| 검사 | `logic.js`의 `checkPlan()` (Node 테스트로 고정) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-study-prd/
├── index.html        프로토타입 · 기획서 · 프롬프트 평가
├── style.css         모눈 공책, 형광펜
├── logic.js          규칙 계획 · 계획 검사 · 다시 나누기 · 코치 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js
├── tests/logic.test.js
├── docs/ (DEVLOG · PROMPTS · ARCHITECTURE)
├── CHANGELOG.md
└── package.json
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 16개
```

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 31회 | 2회 | 4시간 |

- **막혔던 문제** — 요구사항이 섞여 범위가 커짐 → 필수 기능 5개만 남기고 나머지는 2차로 분리
- **결과** — 기능 5개 정의, 화면 7개 설계 · 8주차에 프로토타입을 Claude + 검사로 보완
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
