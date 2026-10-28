# 값찾기

> 인터뷰 질문지에서 ‘쓰실 건가요?’ 같은 유도형 질문을 **지난 행동을 묻는 질문**으로 바꾸고, 가격 3안에 대한 **실제 선결제**로 가격을 정하는 1인 창업자용 정리 도구

![tests](https://img.shields.io/badge/tests-11%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![export](https://img.shields.io/badge/내보내기-CSV%20·%20요약-1F7A4D) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![값찾기 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/startup-price-test/index.html

> **알림** AI 빌더랩 창업 트랙 **1기 목표 모델(가상의 수강생 ‘스피킹메이트’)** 의 예시 프로젝트입니다. 인터뷰 대상·금액·반응은 모두 가상이며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 얼마를 받아야 할지 몰라 무료로 시작했다가 아무도 꾸준히 쓰지 않았다 | 가격 3안을 한 사람에게 하나씩 보여 주고 **예약금을 낸 사람만** 결제로 셈 → **월 3만 원 확정** (목표치) |
| 인터뷰에서 모두 ‘쓸게요’라고 했다 | 질문이 ‘쓰실 건가요?’처럼 **유도형**이었다 → 질문지 검사로 찾아 **지난 행동을 묻는 질문**으로 바꿈 |
| 말로 한 관심과 실제 결제를 섞어 셌다 | ‘선결제만 / 관심까지’를 나란히 보여 주고, 결정은 선결제로만 |
| 인터뷰 결과를 투자 설명에 옮겨 적었다 | 표 그대로 요약 마크다운 · CSV로 |

## 주요 기능

- **질문지 검사** — 질문마다 `미래 가정 / 동의 유도 / 가격 직접 묻기 / 지난 행동 / 보통`과 이유, 바꿀 안. `바꾸기` · `유도형 모두 바꾸기`(되돌리기), 질문 고치기·추가·지우기.
- **가격 3안 실험** — 안마다 제시·선결제·관심, 결제율, **100명당 기대 매출(가격 × 결제율)**. 1위 안에 표시하고 결정 문장을 보여 준다. `관심까지`를 누르면 결론이 어떻게 바뀌는지 보여 준다.
- **지난 행동이 결제를 말해 준다** — 최근 3개월 회화에 돈을 쓴 사람과 안 쓴 사람의 선결제 비교. 안마다 사람이 적으면 ‘방향을 보는 숫자’라고 알린다.
- **인터뷰 12명 표** — 이름 대신 번호. 반응 버튼(거절 → 관심 → 선결제), 지출·제시한 안 고치기, 구분(직장인·대학생·학부모) 거르기 → 위 결과가 바로 다시 계산된다.
- **내보내기** — 투자 설명용 요약(마크다운 표) 복사, CSV 내려받기(번호만).

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `pricetest.questions` → `normalizeCheck()` (개수 일치, 바꾼 질문이 또 유도형이면 규칙의 안) | `Claude로 검사 · 2.4초` |
| AI 키 없음 · 한도 초과 · 알 수 없는 작업 · 네트워크 오류 | 표현 규칙(‘~실 건가요’, ‘~겠죠?’, ‘얼마면’, ‘지난·마지막으로’)으로 검사, 주제별 바꿀 안 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 · 그사이 질문이 바뀜 | 버리고 규칙 결과 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

가격 집계와 결정은 AI 없이 브라우저 안에서 계산합니다. 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버에 넣을 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 저장 | 이 브라우저의 localStorage (`startup-price-test-v1`) |
| 내보내기 | 마크다운 표, CSV(UTF-8 BOM) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
startup-price-test/
├── index.html
├── style.css
├── logic.js          질문 분류 · 바꿀 안 · 응답 검사 · 가격 집계 · 요약 · CSV (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            질문지 · 가격 실험 · 인터뷰 표 화면
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
| 21회 | 0회 | 6시간 |

- **막혔던 문제** — 질문이 ‘쓰실 건가요?’처럼 유도형 → 지난 행동을 묻는 질문으로 바꿈
- **결과 (1기 목표치)** — 인터뷰 12명, 가격 3안 테스트 → 월 3만 원 확정
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
