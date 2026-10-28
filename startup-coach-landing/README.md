# 다음걸음

> 1회 상담 다음의 **4주 패키지**를 구성하고, 랜딩 문구를 **A/B로 실험**하는 도구. Claude가 쓴 문구도 과장 표현 검사를 거쳐, 걸린 줄은 **게시 동의한 실제 후기**로 바꿉니다.

![tests](https://img.shields.io/badge/tests-11%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![과장 검사](https://img.shields.io/badge/과장%20표현-검사-1B7F5A) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![다음걸음 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/startup-coach-landing/index.html

> **알림** AI 빌더랩 창업 트랙 **1기 목표 모델(가상의 수강생 ‘이직나침반’)** 의 예시 프로젝트입니다. 후기와 실험 숫자는 모두 가상이며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 1회 상담만 팔아서 고객이 한 번 오고 끝났다 | 고객 여정(알게 됨 → 1회 상담 → 4주 패키지 → 사후 점검)에 **4주 패키지** 추가, 회당 가격을 1회 상담과 비교 |
| 랜딩 문구를 바꿔도 나아졌는지 몰랐다 | A/B 방문·신청 수로 전환율과 차이가 우연인지 표시 → **신청 전환율 2.1% → 4.4%** |
| AI 문구가 ‘합격 보장’처럼 과장됐다 | 과장 표현 검사(보장 · 100% · 누구나 · 최고 · 연봉 N배 · N주 만에 합격). 걸린 줄은 사실 문장과 **실제 후기**로 교체 |
| 후기를 동의 없이 쓸 뻔했다 | 게시 동의한 후기만 쓰고, 게시 전 확인에서 막음 |

## 주요 기능

- **상품 구성** — 회차 · 가격 · 포함 항목. 회당 가격과 ‘1회 상담 N번’ 금액을 바로 비교하고, 회당이 더 비싸면 알려 줍니다.
- **B안 문구 편집** — 입력하는 동안 과장 표현을 형광펜으로 표시합니다. `과장 빼고 후기로 바꾸기`(되돌리기 가능), `새 문구 만들기`(Claude, 실패 시 규칙).
- **미리보기 · 게시 전 확인** — A안(기존)과 B안을 랜딩 카드로 보고, 과장 0건 · 동의한 후기만 · 가격 표기 세 가지를 통과해야 게시 버튼이 열립니다.
- **A/B 실험 결과** — 방문·신청 수를 바꾸면 전환율 · 차이 · p값 · 판단이 바뀝니다. 안마다 방문 300명 미만이면 판단을 미룹니다.
- **실제 후기** — 이름은 성만, 게시 동의를 끄면 그 후기를 쓴 문구는 게시가 막힙니다.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | 상품 정보 + 동의한 후기만 보내 `coachlanding.copy` → 형식 검사 → **과장 검사·교체** | `Claude로 작성 · 2.1초` |
| AI 키 없음 · 한도 초과 · 알 수 없는 작업 · 네트워크 오류 | 상품 구성으로 규칙 문구 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 (제목·버튼 없음, 항목 2개 미만) | 버리고 규칙 문구 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

과장 검사(`lintClaims`, `cleanCopy`)와 게시 전 확인은 **항상 규칙**이 합니다. 작업 정의는 [docs/ai-task.json](docs/ai-task.json), 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문은 [docs/PROMPTS.md](docs/PROMPTS.md).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| 기획 | 고객 여정 · 랜딩 A/B 문구 |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 실험 판단 | 두 비율 z 검정 (정규분포 근사, 참고용) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
startup-coach-landing/
├── index.html
├── style.css
├── logic.js          패키지 계산 · 과장 검사/교체 · 규칙 문구 · 응답 검사 · 게시 전 확인 · A/B (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            상품 · 문구 · 미리보기 · 실험 · 후기 화면
├── tests/logic.test.js
├── docs/ (ARCHITECTURE · DEVLOG · PROMPTS · ai-task.json)
├── CHANGELOG.md
└── package.json
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 11개
```

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 24회 | 1회 | 5시간 |

- **막혔던 문제** — AI 문구가 ‘합격 보장’처럼 과장 → 과장 표현을 검사해 빼고 실제 후기로 교체
- **결과 (1기 목표치)** — 4주 패키지 출시, 신청 전환율 2.1% → 4.4%
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
