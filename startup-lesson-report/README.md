# 오늘수업

> 수업이 끝나면 메모를 붙여 넣고, 학생별 리포트 초안을 **미리보기에서 한 건씩 확인한 뒤** 보내는 1:1·소그룹 튜터용 도구

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![check](https://img.shields.io/badge/발송%20전-미리보기%20확인-5B4BDB) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![오늘수업 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/startup-lesson-report/index.html

> **알림** AI 빌더랩 창업 트랙 **1기 목표 모델(가상의 수강생 ‘스피킹메이트’)** 의 예시 프로젝트입니다. 반·학생·번호는 모두 가상이고, 데모에서는 실제로 메시지를 보내지 않습니다. 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 수업이 끝나면 학생별 피드백을 카톡으로 쓰느라 밤마다 1시간 | 메모 한 덩어리 → 학생별 초안이 한 번에. **피드백 작성 1시간 → 15분** (목표치) |
| 보호자·성인 수강생마다 말투를 바꿔 써야 했다 | 받는 사람(보호자 / 본인)을 고르면 인사와 문장이 바뀐다 |
| 다른 학생 이름이 섞인 메시지를 발송 직전에 발견했다 | **보내기 전 미리보기 확인 단계**: 다른 학생 이름이 보이면 보내기가 막히고, 한 건씩 확인해야 보낼 수 있다 |
| 꾸준한 피드백이 재등록으로 이어지는지 몰랐다 | 수업마다 빠짐없이 보내는 흐름. **재등록률 72% → 85%** (목표치) |

## 주요 기능

- **메모 나누기** — `이름: 내용`은 그 학생, `공통:`은 모두, 이름 없는 다음 줄은 바로 위 학생에게. 명단에 없는 이름은 알려 준다.
- **보내기 전 미리보기** — 카드마다 `확인 전 / 확인함 / 보내기 막힘 / 보냄`. 다른 학생 이름은 빨갛게 표시하고 `그 문장 지우기`·`의도한 언급이에요` 중 고른다. 받는 학생 이름이 없는 메시지도 막는다. 확인한 뒤 고치면 다시 확인해야 한다.
- **보내기 · 되돌리기** — 확인한 건만 한 번에 보내고, 5초 안에 되돌릴 수 있다(데모는 기록만 남김).
- **발송 기록** — 시간·이름·보호자/본인·가린 번호·글자 수. 메시지 본문은 남기지 않는다.
- **이번 리포트에 쓴 시간** — 리포트 만들기부터 모두 보낼 때까지.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | 학생마다 **그 학생 메모만** `lessonreport.draft`로 → `normalizeDraft()` 검사 → 튜터가 손대지 않은 카드만 덮어씀 | 카드에 `Claude · 1.8초` |
| AI 키 없음 · 한도 초과 · 알 수 없는 작업 · 네트워크 오류 | 메모 조각을 틀에 넣는 규칙 초안 | `규칙 · (이유)` |
| 응답 형식이 틀림 · 학생 이름 없음 · 메모에 없던 다른 학생 이름 | 버리고 규칙 초안 유지 | `규칙 · 응답 형식이 맞지 않음` |

AI가 쓴 초안이든 규칙 초안이든 **보내기 전 검사와 미리보기 확인은 똑같이** 거칩니다. 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버에 넣을 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 발송 | 실제 버전은 알림톡 발송 대행 API, 데모는 기록만 |
| 저장 | 이 브라우저의 localStorage (`startup-lesson-report-v1`) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
startup-lesson-report/
├── index.html
├── style.css
├── logic.js          메모 나누기 · 규칙 초안 · 보내기 전 검사 · 응답 검사 · 번호 가리기 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            메모 · 미리보기 · 발송 기록 화면
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
| 30회 | 4회 | 5시간 |

- **막혔던 문제** — 다른 학생 이름이 섞인 메시지를 발송 직전 발견 → 보내기 전 미리보기 확인 단계 추가
- **결과 (1기 목표치)** — 피드백 작성 1시간 → 15분, 재등록률 72% → 85%
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
