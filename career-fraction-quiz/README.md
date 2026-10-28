# 분수콕

> 초등 분수 10문항에서 아이가 **고른 오답**으로 오개념 5가지를 바로 분류하고, 교사에게 지도 활동을 제안하는 진단 퀴즈

![tests](https://img.shields.io/badge/tests-12%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![privacy](https://img.shields.io/badge/주소·CSV-번호만-12866A) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![분수콕 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-fraction-quiz/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘배움설계자’)** 의 예시 프로젝트입니다. 가상의 4학년 반 24명 샘플로 시작하며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 아이들이 분수를 틀리는 이유가 다 다른데 점수만 보고는 알 수 없었다 | 오답 선지마다 오개념을 붙여 두어, 고른 번호만으로 **유형 5개 자동 분류** |
| 손으로 채점하고 오답을 묶는 데 1시간 | 제출 즉시 채점·분류 → **채점 1시간 → 즉시** |
| 아이 이름이 화면 주소에 노출됨 | 주소는 `#/solve/07`처럼 **번호만**, 이름은 **교사 화면에만** 표시. 주소·CSV에 이름이 있으면 막음 |
| 어떤 유형인지 알아도 무엇을 해야 할지 막막했다 | 유형마다 아이의 생각 + 5분 교실 활동 + 아이에게 던질 질문 |

## 주요 기능

- **학생 풀이 화면** — 번호만 고르고 10문항을 풉니다. 그림 선지(색칠한 1/4)도 있습니다. 안 고른 문항은 표시해 알려 줍니다.
- **교사 화면** — 학생 × 5유형 표(● 확실 / ○ 의심), 유형을 누르면 그 학생만 거르기, 평균·가장 많은 오개념.
- **학생 한 명 보기** — 문항별 답, 유형마다 이유와 지도 활동, 아이에게 물어볼 질문. 풀이 주소 복사(번호만).
- **이름 가리기** — 수업 중 화면을 띄울 때 이름을 ○○○로.
- **CSV 내보내기** — 번호·점수·문항별 답·유형만 (이름 없음, 엑셀용 BOM).
- **샘플로 되돌리기** — 되돌리기 버튼으로 취소 가능.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `fractionquiz.explain` → 규칙 근거 없는 유형 버림 → 설명 표시 | `Claude로 설명 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 알 수 없는 작업 | 선지 표시로 정해 둔 규칙 설명 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 | 버리고 규칙 설명 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

분류(어떤 오개념인지)는 언제나 규칙이 합니다. Claude는 설명만 바꿉니다. Claude에는 이름을 보내지 않습니다. 진단은 참고 자료이고, 지원 필요 여부는 교사가 판단합니다.

자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 저장 | 브라우저 localStorage (번호별 답만, 명단은 저장 안 함) — 실제 버전은 Next.js · Supabase |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-fraction-quiz/
├── index.html
├── style.css
├── logic.js          문항·유형 · 채점·분류 · 주소/CSV/AI 입력(이름 없음) · 응답 검사 (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            교사 화면 · 학생 풀이 화면
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
| 49회 | 9회 | 8시간 |

- **막혔던 문제** — 아이 이름이 화면 주소에 노출됨 → 번호로 바꾸고 이름은 교사 화면에만 표시
- **결과 (1기 목표치)** — 학생 63명 사용, 오개념 유형 5개 자동 분류 · 채점 1시간 → 즉시
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
