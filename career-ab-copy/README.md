# 두문장

> 행사 홍보 문구 두 개를 나눠 보여 주고, **새로고침 중복을 뺀 클릭률**로 이긴 문구만 남기는 A/B 테스트 도우미

![tests](https://img.shields.io/badge/tests-14%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![stats](https://img.shields.io/badge/판정-z검정%20·%20유의수준%205%25-E04F2E) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![두문장 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-ab-copy/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘전환율장인’)** 의 예시 프로젝트입니다. 가상의 마케팅 학회 ‘클릭랩’의 홍보 문구 6쌍으로 시작하며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 동아리 행사 홍보 문구를 매번 한 개만 써서, 어떤 문구가 먹혔는지 아무도 몰랐다 | 문구 두 개를 방문자별로 나눠 보여 주고 노출·클릭을 따로 센다 |
| 클릭 수가 두 번씩 집계됐다 (새로고침하면 같은 기록이 또 들어옴) | **같은 방문자·문구·종류가 30분 안에 다시 오면 한 번만** 센다. 노출 없는 클릭도 뺀다 |
| 하루 숫자만 보고 “이겼다”고 판단했다 | 문구마다 노출 300회 이상 + 두 비율 z검정(유의수준 5%)일 때만 판정. 차이가 없으면 원래 문구 유지 |
| 문구 쓰는 데 매번 2시간 | 남긴 문구를 기준으로 후보 3개를 만들고, **다음 대결의 B로만** 올린다 |

**결과 (1기 목표치)** — 문구 6쌍 테스트, 클릭률 1.8% → 3.1%, 문구 작성 2시간 → 20분

## 주요 기능

- **대결 판정** — A·B 노출·클릭·클릭률, 판정(승리 · 차이 없음 · 표본 부족과 남은 노출 수), 날짜별 클릭률.
- **새로고침 중복 막기** — 켜고 끄며 차이를 볼 수 있습니다. 끄면 샘플의 B 클릭률이 두 배 가까이 부풀어요.
- **방문자가 되어 눌러 보기** — 새 방문자 → 링크 누르기 → 새로고침. 기록마다 ‘집계’ / ‘중복 · 제외’가 붙습니다.
- **다음 대결 후보** — 행사 정보(일시·장소·혜택·정원)만 다시 배치하는 규칙 후보가 바로 나오고, Claude 후보가 오면 과장 표현·지어낸 숫자·중복을 걸러 바꿉니다. 누르면 ‘○○ 2차’ 대결이 생깁니다.
- **보조** — 진행 중/끝남 거르기, 결과 CSV(방문자 정보 없이 집계만), 대결 지우기 + 되돌리기, 샘플로 되돌리기.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `abcopy.suggest` → `normalizeSuggest()`로 과장 표현·문구에 없는 숫자·기존과 같은 문구·길이 검사 | `Claude로 정리 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 알 수 없는 작업 | 규칙 후보(숫자 먼저 · 혜택 먼저 · 질문으로 · 마감 강조) | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 / 걸러서 남은 후보가 없음 | 버리고 규칙 후보 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

판정(승패)은 AI가 하지 않습니다. 숫자로만 정합니다. 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버에 합칠 작업 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 통계 | 두 비율 z검정, 정규분포 근사(Abramowitz–Stegun) 직접 구현 |
| 저장 | 브라우저 localStorage (실제 버전은 Next.js · Supabase에 클릭 기록 저장) |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-ab-copy/
├── index.html
├── style.css
├── logic.js          중복 막기 · 집계 · z검정 · 판정 · 후보 검사 · CSV (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            요약 · 대결 목록 · 상세 · 눌러 보기 · 후보 화면
├── tests/logic.test.js
├── docs/ (ARCHITECTURE · DEVLOG · PROMPTS · ai-task.json)
├── CHANGELOG.md
└── package.json
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 14개
```

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 47회 | 8회 | 7시간 |

- **막혔던 문제** — 클릭 수가 두 번씩 집계됨 → 새로고침 때 중복 기록을 막는 조건(같은 방문자·문구·종류 30분) 추가
- **리드 빌더 코멘트** — “AI가 쓴 문구를 그대로 쓰지 않고, 숫자로 이긴 문구만 남긴 점이 마케터답습니다.”
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
