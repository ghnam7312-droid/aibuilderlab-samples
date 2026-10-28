# 차곡퀴즈

> 수업 자료를 붙여 넣으면 차시별 확인 퀴즈를 **정답 근거 문장과 함께** 만들고, 사람이 검토표에서 통과·고치기·제외로 확인하는 도구

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![review](https://img.shields.io/badge/정답-근거%20문장%20검토-6A4CE0) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![차곡퀴즈 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-quiz-maker/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘배움설계자’)** 의 예시 프로젝트입니다. 가상의 중1 과학 수업 자료(3차시)로 시작하며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 수업 자료를 만들 때마다 확인 퀴즈를 따로 써서 한 차시에 1시간 | 자료를 붙여 넣으면 차시별 문항이 바로 → **차시당 1시간 → 12분** |
| 생성한 문항에 정답이 틀린 것이 섞였다 | 문항마다 **정답 근거 문장**을 함께 내고, 자동 확인 3가지 + 사람이 근거를 읽고 통과 |
| 어떤 문항이 괜찮은지 감으로만 판단했다 | 검토표에서 통과·고치기·제외를 남기고 **검토 통과율**로 생성 품질을 본다 (목표 88%) |
| 문항을 다시 학습지·문서로 옮겨 적었다 | 통과한 문항만 학생용 복사·인쇄, 교사용 CSV(정답·근거) |

## 주요 기능

- **차시 나누기** — `## 1차시 제목` 줄로 나누고, 차시당 3·4·5문항을 고릅니다. 객관식 재료가 모자라면 ‘흡수/방출’처럼 뒤집을 수 있는 문장으로 OX를 만듭니다.
- **정답 근거 문장** — 근거에서 정답은 밑줄, 근거에 같이 나온 다른 선지는 주황으로 칠합니다.
- **자동 확인** — 근거가 자료에 있는지 · 근거에 정답이 있는지 · 다른 선지도 근거에 나오는지. 경고가 있는 문항은 왼쪽에 주황 띠.
- **검토표** — 통과 / 고치기(문항·선지·정답·근거 수정 후 다시 확인) / 제외(되돌리기). 검토 진행률과 통과율.
- **내보내기** — 학생용 복사(정답 없음), 교사용 CSV(정답·근거·검토 결과), 학생용 인쇄. 통과한 문항만.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `quizmaker.generate` → 형식 검사 → 자동 확인 → 사람 검토 | `Claude로 생성 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 알 수 없는 작업 | “A를 B라고 한다” 문장으로 만드는 규칙 문항 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 | 버리고 규칙 문항 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

어느 쪽으로 만들었든 정답은 사람이 근거를 읽고 정합니다. 자동 확인은 먼저 볼 곳을 알려 줄 뿐입니다.

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| 문서 읽기 | 붙여 넣은 글을 차시·문장으로 나누기 (실제 버전은 PDF·한글 파일 텍스트 추출) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 검토표 · 내보내기 | localStorage 저장, CSV(BOM) · 클립보드 · 인쇄용 학생지 |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-quiz-maker/
├── index.html
├── style.css
├── logic.js          차시 나누기 · 문항 만들기 · 자동 확인 · 응답 검사 · 통과율 · 내보내기 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            수업 자료 · 검토표 · 내보내기 화면
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
| 34회 | 4회 | 5시간 |

- **막혔던 문제** — 정답이 틀린 문항이 섞임 → 생성 후 정답 근거 문장을 함께 내게 해 사람이 확인
- **결과 (1기 목표치)** — 차시당 퀴즈 1시간 → 12분, 문항 검토 통과율 88%
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
