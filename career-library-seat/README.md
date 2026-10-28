# 빈자리

> 도서관 좌석 기록으로 **언제 · 어디가 모자란지** 찾고, **이 데이터로는 모르는 것**까지 먼저 적는 좌석 이용 분석 보고서

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![report](https://img.shields.io/badge/혼잡%20시간대-3개-B8471F) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![빈자리 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-library-seat/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘숫자읽는사람’)** 의 예시 프로젝트입니다. 도서관과 좌석 기록은 모두 가상의 샘플이며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 시험 기간마다 좌석이 모자란다는 말만 있고, 언제 · 어디가 모자란지 근거가 없었다 | 구역 × 시각 열지도 + 90% 이상 연속 구간 → **혼잡 시간대 3개** |
| 좌석 시스템이 멈춘 시간이 0으로 계산되어 평균이 낮게 나왔다 | **결측은 빼고 평균을 다시 계산**. 이전 방식과 스위치로 비교 |
| 숫자만으로는 결정이 안 됐다 | ‘모르는 것 → 결론 → 재배치 제안’ 순서의 보고서, 인쇄 가능 |

**목표치 (1기)** — 혼잡 시간대 3개 도출, 좌석 재배치 제안서 1건 채택

## 주요 기능

- **열지도** — 1층 열람실 A, 2층 열람실 B, 노트북 존, 그룹 스터디룸, 3층 창가석 × 8–24시. 90% 이상은 굵은 테두리, 기록이 빠진 날이 있는 칸은 빗금.
- **칸 상세** — 날짜 10일의 기록을 막대로. 기록이 없는 날은 ‘없음’, 평균에서 뺐는지 넣었는지 표시.
- **결측 처리 비교** — 스위치를 켜면 이전 방식(빈칸 = 0)으로 다시 계산. 시험 기간 2층 열람실 B 오전 혼잡이 사라지는 것을 바로 확인할 수 있습니다.
- **혼잡 시간대** — 누르면 열지도의 그 칸으로 이동.
- **보고서** — ‘이 데이터로는 모르는 것’을 결론보다 먼저. 재배치 결정은 도서관 담당자가 현장 확인 뒤에 한다는 전제.
- **시험 기간 / 평소**, 표 CSV, 보고서 인쇄, 샘플로 되돌리기.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `libseat.report` → 형식 검사 → **문장 속 숫자를 입력 숫자와 대조** | `Claude로 작성 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 서버에 작업 없음 | 정해진 문장 틀로 쓴 규칙 보고서 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 / 입력에 없는 숫자 | 버리고 규칙 보고서 유지 | `규칙 기반 · 숫자 검산 실패 (…)` |

평균 · 혼잡 시간대는 언제나 `logic.js`가 계산하고, Claude는 문장만 씁니다. 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버에 합칠 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음). 실제 버전은 Python 분석 + 시각화 |
| 데이터 | 가상의 좌석 시스템 기록 (기간별 10일 × 5구역 × 16시간) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-library-seat/
├── index.html
├── style.css
├── logic.js          샘플 기록 · 결측 제외 평균 · 혼잡 찾기 · 요약 · 규칙 보고서 · 응답 검사 · CSV (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            조건 · 열지도 · 칸 상세 · 혼잡 시간대 · 보고서 화면
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
| 24회 | 3회 | 6시간 |

- **막혔던 문제** — 결측 시간이 0으로 계산됨 → 결측은 빼고 평균을 다시 계산
- **결과 (1기 목표치)** — 혼잡 시간대 3개 도출, 좌석 재배치 제안서 1건 채택
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
