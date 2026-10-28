# 말해봄

> 학생이 영어 말하기 숙제를 녹음(또는 받아쓴 문장)으로 올리면, **한 번에 고칠 점 2개**와 다시 말하기 대본을 돌려주는 1:1 튜터용 첨삭 서비스

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![speech](https://img.shields.io/badge/받아쓰기-Web%20Speech%20API-E5533D) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![말해봄 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/startup-speaking-coach/index.html

> **알림** AI 빌더랩 창업 트랙 **1기 목표 모델(가상의 수강생 ‘스피킹메이트’)** 의 예시 프로젝트입니다. 학생·문장은 모두 가상이며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 주 1회 수업만으로는 말하기가 늘지 않는다 | 수업 사이에 30초 말하기 숙제 → 바로 첨삭. **숙제 제출률 35% → 78%** (목표치) |
| 녹음 숙제를 일일이 들어 줄 시간이 없다 | 브라우저가 받아쓰고, 규칙·Claude가 실수를 찾아 첨삭 초안을 만든다. 튜터는 확인만 |
| 첨삭이 너무 많아 학생이 지쳤다 | 찾은 실수를 줄 세워 **위의 2개만** 학생에게. 나머지는 튜터만 보는 ‘다음 숙제에서 볼 것’ |
| 고쳤는지 확인할 방법이 없었다 | 고친 대본으로 다시 말하면 2개를 각각 ‘고침 / 아직’으로 표시 |

## 주요 기능

- **녹음하며 받아쓰기** — 영어로 말하면 브라우저 음성 인식(Web Speech API)이 받아쓰고 말한 길이를 잰다. 음성 인식이 없거나 마이크가 막혀 있으면 이유를 알려 주고, **받아쓴 문장을 직접 넣거나 샘플 녹음 대본 4개**로 같은 흐름을 쓸 수 있다.
- **고칠 점 2개** — 뜻이 달라지는 실수(과거 시제, bored/boring) → 반복 횟수 → 먼저 나온 순서. 받아쓴 문장에 번호로 표시하고, 같은 실수가 여러 번이면 ‘같은 실수 2번’.
- **측정값** — 길이, 단어 수, 분당 단어, um·uh 수, 목표 표현(`ended up -ing`) 사용 여부.
- **다시 말하기** — 고칠 점 2개만 바꾼 대본 → 다시 말한 문장으로 ‘고쳤는지 확인’.
- **튜터 화면** — 이번 주 제출률, 학생별 고칠 점·미룬 개수, 미제출 / 다시 말하기 전 거르기, 미제출 알림 문구 복사, 카톡용 첨삭 복사(전화번호·메일은 가림).

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `speakingcoach.feedback` → `normalizeFeedback()` 검사 (말하지 않은 표현 지적은 버림, 2개까지) | `Claude로 첨삭 · 2.1초` |
| AI 키 없음 · 한도 초과 · 알 수 없는 작업 · 네트워크 오류 | 실수 패턴 11개 + um·uh 규칙으로 첨삭 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 | 버리고 규칙 결과 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

받아쓴 글로는 알 수 없는 발음·억양은 판단하지 않습니다. 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버에 넣을 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| 받아쓰기 | Web Speech API `SpeechRecognition` (en-US), 없으면 직접 입력 |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 저장 | 이 브라우저의 localStorage (`startup-speaking-coach-v1`), 녹음 파일은 저장하지 않음 |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
startup-speaking-coach/
├── index.html
├── style.css
├── logic.js          실수 규칙 · 우선순위 · 2개 제한 · 응답 검사 · 다시 말하기 확인 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            제출 · 첨삭 · 튜터 화면
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
| 55회 | 10회 | 11시간 |

- **막혔던 문제** — 첨삭이 너무 많아 학생이 지침 → 한 번에 고칠 점을 2개로 제한
- **결과 (1기 목표치)** — 유료 수강생 41명(월 3만 원), 숙제 제출률 35% → 78%
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
