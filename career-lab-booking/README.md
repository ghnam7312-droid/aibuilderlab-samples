# 장비표

> 학과 실험실 장비를 시간표에서 예약하고, 두 사람이 **동시에 같은 시간을 눌러도 한 사람만** 들어가게 막는 예약 도구

![tests](https://img.shields.io/badge/tests-13%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![constraint](https://img.shields.io/badge/겹침%20방지-DB%20제약-0F7B6C) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![장비표 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-lab-booking/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘커밋하는곰’)** 의 예시 프로젝트입니다. 실험실·장비·예약자는 모두 가상이며, 결과 숫자는 1기 목표치입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 장비를 단톡방으로 예약해서 한 달에 아홉 번씩 시간이 겹쳤다 | 장비별 시간표에서 빈 칸을 눌러 예약 → **예약 충돌 월 9건 → 0건 (목표)** |
| 화면에서 ‘비어 있나’ 확인을 넣었는데도 두 사람이 동시에 누르면 둘 다 저장됐다 | **저장하는 순간 DB가 겹침을 다시 검사**(exclude 제약). 늦게 누른 사람은 거절되고 다른 시간을 안내받는다 |
| 안전교육이 필요한 장비를 아무나 예약했다 | SEM·CNC는 자동 확정하지 않고 **관리자 승인 대기**. 이수 여부는 사람이 확인한다 |
| 예약 문장을 칸에 옮겨 적기 번거로웠다 | “내일 오후 2시부터 3시간 SEM” 한 줄 → 장비·날짜·시간 자동 채우기 |

## 주요 기능

- **장비 시간표** — 날짜 7일 × 장비 6대(연구실 3곳). 빈 칸을 누르면 그 장비·시간으로 예약 칸이 채워지고, 예약을 누르면 자세히 보고 취소(되돌리기 가능)합니다.
- **겹침 방지** — 화면 검사(`validate`: 지난 시간, 운영 시간 09~21시, 30분 단위, 최대 4시간) 뒤에 저장소의 `insert`가 한 번 더 겹침을 검사합니다. 14:00에 끝나고 14:00에 시작하는 예약은 허용합니다.
- **동시 예약 재현** — ‘예전: 화면 확인만’과 ‘지금: DB 제약’을 바꿔 가며 두 사람이 0.004초 차이로 누르는 상황을 재현합니다. 예전 방식은 충돌 1건, 지금 방식은 0건.
- **관리자 승인 대기** — 안전교육 장비 예약은 대기 목록에 쌓이고 ‘이수 확인 · 승인’ 또는 ‘반려’를 사람이 누릅니다. AI는 허가 여부를 판단하지 않습니다.
- **내보내기** — CSV(예약자 이름은 `김*준`처럼 가림), 인쇄용 시간표.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `labbooking.parse` → 형식 검사(`normalizeParse`) → 예약 칸 덮어쓰기 | `Claude로 정리 · 1.2초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 서버에 작업 없음 | 규칙(`parseRequest`)으로 ‘내일’, ‘금요일’, ‘오후 2시’, ‘3시간’, 장비 별칭만 읽기 | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 (목록에 없는 장비, 날짜 아님) | 그 칸은 비우고 채울 것이 없으면 버림 → 규칙 결과 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

AI는 문장을 칸으로 옮기기만 합니다. 저장·겹침 검사·승인은 AI를 거치지 않습니다. 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md), 서버에 합칠 정의는 [docs/ai-task.json](docs/ai-task.json).

## 기술 스택

| 구분 | 실제 버전 | 이 데모 |
|---|---|---|
| 화면 | Next.js | HTML · CSS · JavaScript (빌드 없음) |
| 데이터 | Supabase(Postgres) `bookings` 테이블 + `exclude using gist` 제약 | `createStore()`가 같은 규칙으로 저장 순간 검사, localStorage에 보관 |
| 인증 | Supabase Auth (학교 메일 로그인) | 이름 입력으로 대신함 |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai` | 같음 |
| 테스트 | Node 내장 `node:test` | 같음 |

## 폴더 구조

```
career-lab-booking/
├── index.html
├── style.css
├── logic.js          시간 계산 · 겹침 · 검사 · 저장소(DB 제약 흉내) · 동시 예약 재현 · 문장 해석 · CSV (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            예약 폼 · 시간표 · 승인 대기 · 동시 예약 재현 화면
├── tests/logic.test.js
├── docs/ (ARCHITECTURE · DEVLOG · PROMPTS · ai-task.json)
├── CHANGELOG.md
└── package.json
```

## 실행 · 테스트

```bash
python3 -m http.server 8000   # http://localhost:8000
npm test                      # = node --test, 13개
```

## AI 활용 기록 (COVI 기록 요약)

| 프롬프트 | 디버깅 | 걸린 시간 |
|---|---|---|
| 61회 | 14회 | 12시간 |

- **막혔던 문제** — 두 사람이 동시에 같은 시간을 잡음 → DB에서 겹치는 예약을 막는 제약 추가, 테스트로 먼저 재현
- **결과 (1기 목표치)** — 연구실 3곳 사용, 예약 충돌 월 9건 → 0건
- **리드 빌더 코멘트 (배포요정)** — “동시 예약 같은 진짜 버그를 테스트로 재현하고 고친 기록이 가장 큰 무기입니다.”
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
