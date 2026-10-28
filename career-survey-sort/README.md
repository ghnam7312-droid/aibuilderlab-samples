# 갈래

> 설문 서술형 응답을 **고정한 기준 5개**로 나누고, **사람 검수와의 일치율**을 숫자로 남기는 분류 · 검수 도구

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![agreement](https://img.shields.io/badge/검수%20일치율-목표%2091%25-5B3FD0) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![갈래 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-survey-sort/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘숫자읽는사람’)** 의 예시 프로젝트입니다. 설문 응답 42건은 모두 지어낸 샘플이며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 학과 설문 서술형 300건을 사람이 읽고 분류하느라 이틀 | 붙여 넣으면 기준대로 바로 분류, 사람은 검수만 → **이틀 → 40분** |
| AI 분류가 돌릴 때마다 달라졌다 | **분류 기준 5개와 예시를 고정**(v3), 동점 순서도 고정 → 같은 글은 언제나 같은 갈래 |
| 자동 분류를 얼마나 믿어도 되는지 몰랐다 | 사람 검수 칸 → **일치율을 숫자로** (목표 91%) |
| 응답에 학번 · 연락처가 섞여 있었다 | 받는 즉시 가리고, 가린 글만 화면 · AI · CSV에 사용 |

**목표치 (1기)** — 분류 이틀 → 40분, 사람 검수 일치율 91%

## 주요 기능

- **고정 기준 v3** — 교과과정 · 수업 방식 · 실습·환경 · 진로·취업 · 학과 운영, 그리고 ‘검토 필요’. 기준마다 정의와 예시 2개.
- **분류 근거** — 응답마다 어느 핵심어(규칙) 또는 어떤 구절(Claude)로 나눴는지 표시.
- **사람 검수 · 일치율** — 오른쪽 칸에서 고르면 일치율이 즉시 다시 계산되고, 되돌릴 수 있습니다. ‘검수 전’, ‘불일치’만 골라 보기.
- **같은 결과인지 확인** — 42건을 순서를 섞어 3번 다시 분류해 모두 같은지 보여 줍니다.
- **사람에게 넘기기** — 폭언 · 괴롭힘 · 차별 같은 민감한 응답은 자동 분류하지 않고, AI에도 보내지 않으며 ‘검토 필요’로 둡니다.
- **검수 시트 CSV · 응답 추가 · 샘플로 되돌리기**.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `survey.classify` (고정 기준 + 가린 응답) → 검사 → 쓸 수 있는 항목만 덮어쓰기 | `Claude로 분류 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 서버에 작업 없음 | 같은 기준의 핵심어로 규칙 분류 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 / 쓸 만한 답이 절반 미만 | 통째로 버리고 규칙 결과 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |
| 기준 밖 이름 · 없는 번호 · 중복 | 그 항목만 버리고 규칙 결과 유지 | `Claude로 분류 · … · n건은 규칙` |
| 민감한 응답 | AI에 보내지 않음 | `사람에게` |

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버에 합칠 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음). 실제 버전은 구글 시트 + 검수 시트 |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 저장 | 브라우저 localStorage (가린 글만) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-survey-sort/
├── index.html
├── style.css
├── logic.js          기준 · 개인정보 가리기 · 민감 판정 · 규칙 분류 · 응답 검사 · 일치율 · CSV (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            현황 · 목록 · 검수 · 기준 · 분포 화면
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
| 33회 | 4회 | 5시간 |

- **막혔던 문제** — 분류가 매번 달라짐 → 분류 기준 5개와 예시를 고정해 같은 결과가 나오게 함
- **결과 (1기 목표치)** — 분류 이틀 → 40분, 사람 검수 일치율 91%
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
