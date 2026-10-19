# 들어보니 — 고객 인터뷰 보드

> 만들기 전에 먼저 들어 봅니다. 인터뷰를 카드로 붙이면 Claude가 메모를 읽고 근거를 **제안**하고, 사람이 확정한 근거만 쌓여 가설 도장이 **검증 중 → 검증됨 / 반증됨**으로 바뀝니다.

![tests](https://img.shields.io/badge/tests-12%20passed-2ea44f) ![Claude API](https://img.shields.io/badge/AI-Claude%20API-8A63D2) ![no build](https://img.shields.io/badge/build-none-555) ![license](https://img.shields.io/badge/license-MIT-blue)

![들어보니 화면](./screenshot.png)

**데모:** https://aibuilderlab.kr/demo/startup-interview-board/index.html

> 이 저장소는 **AI 빌더랩 창업 트랙 1기 ‘목표 모델’ 예시**입니다. 수료생이 이 수준까지 만든다는 목표를 보여 주려고 만들었고, 인터뷰 대상 15명은 모두 가상 인물입니다.

## 문제 → 해결

| 문제 | 해결 |
|---|---|
| 다른 학원도 같은 문제를 겪는지, 원장님이 돈을 낼 만큼 불편한지 몰랐습니다. | 가설 두 개를 숫자 기준과 함께 고정하고, 인터뷰마다 지지·반증을 태그해 도장으로 판정합니다. |
| “쓰시겠어요?”라고 물었더니 모두 “좋네요”라고만 했습니다. | 질문 점검기가 유도 질문을 바로 잡아내고, Claude가 **지난달 실제 행동**을 묻는 질문으로 고쳐 씁니다. |
| AI 요약을 그대로 믿으면 없는 말이 근거가 될 수 있습니다. | Claude는 점선 **제안**만 합니다. 인용은 메모에 실제로 있는지 대조하고, 근거는 사람이 눌러 확정한 것만 셉니다. |

## 주요 기능

- **보드** — 역할별 색 카드(원장·강사·학부모), 시간·금액·메모·고객의 말. 카드마다 Claude가 뽑은 **핵심어**, 형광펜 친 **핵심 문장**, 가설별 입장과 이유. 점선 제안을 누르면 확정, 다시 누르면 지지 → 반증 → 상관없음.
- **가설 도장** — 지지 3건 이상이고 반증의 2배 이상이면 ‘검증됨’, 반증이 더 많으면 ‘반증됨’. 바뀌는 순간 도장이 찍힙니다.
- **인터뷰 기록·고치기** — 붙이거나 고치면 Claude가 바로 읽고 제안을 답니다. 적는 동안 인용 수와 주제를 미리 보여 줍니다.
- **인사이트** — 주제별 언급 수(역할별 색), Claude 핵심어 모음, 역할마다 그대로 옮긴 말.
- **질문 설계** — 바꾼 질문 4쌍, 질문 점검기(즉시 판정 + Claude 고쳐 쓰기 + ‘이 질문으로 바꾸기’), 인터뷰 질문 목록.
- **가격 응답** — 원장 응답 구간, 중간값, 월 10만 원 이하 비율과 결정 근거.
- **인사이트 리포트** — 가설 판정, 가설별 근거 표, 많이 나온 이야기, 가격 응답, 고객의 말, 다음 결정을 A4로. 미리 보고 인쇄하거나 PDF로 저장합니다.

Claude에 연결할 수 없으면 기록된 숫자로 규칙 제안을 만들고 말 사전으로 주제를 셉니다. 화면 위 `Claude 연결됨 / 규칙 모드`와 카드마다 붙은 칩으로 어느 쪽인지 알 수 있어요.

## 기술 스택

| | 이 데모 | 실제 버전 |
|---|---|---|
| 화면 | HTML · CSS · JavaScript (빌드 도구 없음) | Next.js |
| 데이터 | 브라우저 localStorage | Supabase |
| AI | Claude API (서버 경유) + 규칙 대체 | Claude API |
| 출력 | 인쇄 · PDF | 링크 공유 |

글꼴은 Wanted Sans(화면)와 나눔명조(고객의 말). 자세한 구조: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 폴더 구조

```
startup-interview-board/
├── index.html        탭 4개, 기록 창, 리포트 미리보기
├── style.css         인덱스카드 · 도장 · 인쇄용 리포트
├── app.js            화면 · Claude 호출 · 리포트
├── logic.js          순수 함수: 가설 판정, 인용, 응답 검사, 유도 질문, 가격 통계
├── ai-client.js      Claude 호출기 (실패하면 null → 규칙으로)
├── tests/
│   └── logic.test.js   node:test 12개
├── docs/
│   ├── DEVLOG.md       1~3주차 개발 일지
│   ├── PROMPTS.md      AI 활용 기록
│   └── ARCHITECTURE.md
├── CHANGELOG.md
└── screenshot.png
```

## 실행 · 테스트

```bash
python3 -m http.server 8000      # → http://localhost:8000
npm test                         # Node 18 이상, 설치할 패키지 없음
```

## AI 활용 기록 (COVI 요약)

| 프롬프트 | 디버깅 | 걸린 시간 | 해결한 문제 |
|---:|---:|---:|---|
| 22 | 1 | 5시간 | 유도 질문이 섞임 → 지난달 실제 행동을 묻는 질문으로 다시 설계 |

결과(목표치): 인터뷰 15명, 가설 2개, 가격 기준 ‘월 10만 원 이하’. 주차별 기록은 [docs/DEVLOG.md](docs/DEVLOG.md), 지시문은 [docs/PROMPTS.md](docs/PROMPTS.md).

> 리드 빌더 코멘트 — “질문을 바꾼 뒤 원장님들이 실제 숫자를 말해 주기 시작했어요.” — 린스타터

---

AI 빌더랩 창업 트랙 · 린스타터 목표 모델 · MIT License
