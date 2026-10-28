# 천천예약

> 50~60대가 중간에 포기하던 동네 병원 예약 화면을 다시 설계하고, **눌러 보는 시제품과 사용성 테스트 기록**으로 검증하는 도구

![tests](https://img.shields.io/badge/tests-13%20passing-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![layout](https://img.shields.io/badge/배치%20점검-320·375·430px-0B7A75) ![no build](https://img.shields.io/badge/빌드-필요%20없음-555)

![천천예약 화면](./screenshot.png)

**데모** · https://aibuilderlab.kr/demo/career-clinic-booking/index.html

> **알림** AI 빌더랩 커리어 트랙 **1기 목표 모델(가상의 수강생 ‘픽셀산책’)** 의 예시 프로젝트입니다. 병원·의사·참가자는 모두 가상이며, 결과 숫자는 1기 목표치입니다. 실제 버전은 Figma 시안을 Next.js로 옮겼고, 공개 데모는 같은 흐름을 빌드 없는 정적 페이지로 만들었습니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 부모님이 병원 예약 화면에서 매번 중간에 포기 | 한 화면에 한 가지씩 4단계, 큰 글자·큰 버튼, ‘다음’은 늘 같은 자리 |
| 시안(그림)만으로는 정말 쉬운지 알 수 없었다 | 코드로 띄운 시제품을 50~60대 5명이 직접 눌러 봄 → 완료율 **54% → 86%** (목표치) |
| 휴대폰에서 버튼이 겹침 | 화면 폭·글자 크기별로 칸 수와 버튼 배치를 다시 계산. 처음 시안과 고친 시안을 같은 폭에서 바로 비교 |
| 어느 과로 가야 할지 모르면 거기서 멈춤 | ‘잘 모르겠어요’ → 접수처 전화 안내. 진료과를 AI가 골라 주지 않음 |

## 주요 기능

- **눌러 보는 시제품** — 진료과 → 날짜·시간 → 본인 정보 → 확인. 일요일 휴진, 점심시간, 이미 찬 시간은 막히고, 예약하면 그 시간이 ‘마감’으로 바뀝니다. 예약 취소는 되돌리기로.
- **시안 · 폭 · 글자 크기 바꾸기** — 처음 시안(v1)은 데스크톱 시안을 줄인 모습 그대로라 320~430px에서 아래 버튼이 실제로 겹칩니다.
- **배치 점검** — 지금 조합에서 겹치는 버튼과 44px보다 작은 버튼을 계산해 보여 줍니다.
- **사용성 테스트 기록** — 시안별 완료율, 단계별 도달·이탈, 기록 추가/지우기(되돌리기), CSV 내보내기(참가자 코드만).
- **막힌 곳 정리** — 관찰 메모를 단계·문제별로 묶고 고칠 방법을 붙입니다.
- **개인정보** — 확인 화면과 저장 기록에는 `김*숙 · 010-****-6789` 처럼 가린 값만. 입력 중인 이름·번호는 저장하지 않습니다.

## AI는 이렇게 동작합니다

| 상황 | 동작 | 화면 표시 |
|---|---|---|
| Claude 연결됨 | `clinicbooking.issues` → 형식 검사(`normalizeIssues`) | `Claude로 정리 · 2.1초` |
| AI 키 없음 · 한도 초과 · 네트워크 오류 · 아직 없는 작업 | 메모 낱말 규칙으로 단계·주제별 묶기(`ruleIssues`) | `규칙 기반 · (이유)` |
| 응답 형식이 틀림 · 의료 판단이 섞임 | 그 항목을 버리고, 남는 게 없으면 규칙 결과 유지 | `규칙 기반 · 응답 형식이 맞지 않음` |

Claude에는 참가자 코드·결과·메모만 보냅니다. 예약 화면 자체에는 AI를 쓰지 않습니다. 자세한 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 지시문 원문은 [docs/PROMPTS.md](docs/PROMPTS.md).

## 기술 스택

| 구분 | 사용 |
|---|---|
| 화면 | HTML · CSS · JavaScript (프레임워크·빌드 없음) — 실제 버전은 Next.js |
| 디자인 | Figma 시안 → 코드 시제품, 사용성 테스트 |
| AI | Claude API — 서버 `aibuilderlab.kr/api/demo/ai`가 호출 |
| 테스트 | Node 내장 `node:test` |

## 폴더 구조

```
career-clinic-booking/
├── index.html
├── style.css
├── logic.js          시간표 · 본인 정보 검사 · 중복 예약 · 가리기 · 배치 점검 · 완료율 · 메모 정리 · CSV (DOM 없음)
├── ai-client.js      /api/demo/ai 호출, 실패하면 null
├── app.js            시제품 · 배치 점검 · 테스트 기록 화면
├── tests/logic.test.js
├── docs/ (DEVLOG · PROMPTS · ARCHITECTURE · ai-task.json)
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
| 44회 | 7회 | 8시간 |

- **막혔던 문제** — 휴대폰에서 버튼이 겹침 → 화면 폭별 배치를 다시 지정
- **결과 (1기 목표치)** — 50~60대 5명 테스트, 예약 완료율 54% → 86%
- 주차별 기록: [docs/DEVLOG.md](docs/DEVLOG.md)
