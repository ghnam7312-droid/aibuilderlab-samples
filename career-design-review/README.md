# 모아닫기

> 카톡·메일·피그마에 흩어진 시안 피드백을 모아 **같은 의견은 하나로 합치고**, 반영함·보류·안 함으로 **끝까지 닫는** 도구

![tests](https://img.shields.io/badge/tests-11%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![export](https://img.shields.io/badge/내보내기-Notion-6B4EE6) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![모아닫기 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-design-review/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘픽셀산책’)** 의 예시 프로젝트입니다. 팀 과제·팀원·코멘트는 모두 가상이며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 시안 피드백이 카톡·메일·피그마에 흩어져 놓치는 게 많았다 | 세 채널 코멘트를 한 받은함에 모으고, 채널별로 거르기 |
| 같은 의견이 여러 번 따로 올라와 수정 목록이 부풀었다 | 똑같은 코멘트는 지우고, 같은 화면의 비슷한 코멘트는 **한 수정 항목으로 합치는 규칙** |
| 정리했는데도 어떤 피드백을 처리했는지 흐려졌다 | 항목마다 **반영함 · 보류 · 안 함**으로 닫기. 보류·안 함은 이유가 있어야 닫힘 |
| 정리 후 노션에 다시 옮겨 적었다 | Notion 체크리스트로 한 번에 복사 |
| 결과 (1기 목표치) | 코멘트 정리 **1시간 → 10분**, 놓친 수정 **0건** |

## 주요 기능

- **받은함** — 샘플 17건(카톡 5 · 메일 5 · 피그마 7). `[피그마] 태민 · 결제: …` 형식으로 붙여 넣어 더할 수 있습니다.
- **합치기** — 똑같은 코멘트 1건을 지우고, 비슷한 의견을 묶어 11개 수정 항목으로. 항목에 올리면 왼쪽의 원래 코멘트가 밝혀집니다.
- **닫기** — 반영함은 바로, 보류·안 함은 이유를 적고 닫습니다. 다시 열기, 잘못 합쳤으면 ‘합친 것 나누기’, 모든 동작은 되돌리기.
- **남은 수정** — 위쪽 현황에 남은 항목 수를 늘 보여 주고, ‘남은 것’만 걸러 볼 수 있습니다. 닫은 항목에 새 코멘트가 오면 다시 열립니다.
- **Notion 복사** — 화면별 체크리스트, 상태와 이유 포함. 메일 주소·전화번호는 지웁니다.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `designreview.group` → 형식 검사(`normalizeGroups`) → 닫은 결정 옮겨 붙이기 | `Claude로 정리 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 아직 없는 작업 | 두 글자 조각 겹침 + 같은 뜻 낱말(글씨=텍스트=글자) 규칙으로 합치기 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 | 버리고 규칙 결과 유지. 없는 id·두 번 들어간 id·섞인 화면은 고치고, 빠진 코멘트는 따로 붙임 | `규칙 기반 · 응답 형식이 맞지 않음` |

Claude에는 코멘트 id·화면·내용만 보내고(이름 제외, 연락처는 지움), 닫을지 말지는 늘 사람이 정합니다. 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| 입력 | Figma 코멘트 · 카톡 · 메일 (공개 데모는 붙여 넣기) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 내보내기 | Notion 체크리스트 마크다운 |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-design-review/
├── index.html
├── style.css
├── logic.js          붙여 넣기 읽기 · 비슷한 정도 · 중복 지우기 · 합치기 · 응답 검사 · 닫기 · Notion (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            받은함 · 수정 항목 · 현황 화면
├── tests/logic.test.js
├── docs/ (DEVLOG · PROMPTS · ARCHITECTURE · ai-task.json)
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
| 29회 | 3회 | 4시간 |

- **막혔던 문제** — 같은 의견이 여러 번 묶임 → 비슷한 코멘트를 하나로 합치는 규칙 추가
- **결과 (1기 목표치)** — 코멘트 정리 1시간 → 10분, 놓친 수정 0건
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
