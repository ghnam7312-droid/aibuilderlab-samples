# server — 예시 서비스가 함께 쓰는 AI 서버

9개 서비스의 AI 기능은 모두 이 서버를 거쳐 Claude를 부릅니다. 운영 중인 사본은 aibuilderlab.kr(Next.js · Vercel · Supabase)에 들어 있고, 이 폴더는 공개용 사본입니다.

```mermaid
flowchart LR
  A[서비스 화면<br>ai-client.js] -- POST task, input --> B[/api/demo/ai/]
  B -- 한도 확인 --> D[(Supabase<br>demo_ai_usage)]
  B -- 작업별 지시문 + 출력 형식 --> C[Claude API]
  C -- JSON --> B -- data --> A
  B -. 키 없음·한도 초과·오류 .-> F[fallback:true]
  F -. 화면은 logic.js 규칙으로 처리 .-> A
```

| 파일 | 하는 일 |
|---|---|
| `demo-ai.ts` | 작업(task) 11개의 지시문과 JSON 출력 형식, 방문자·일일 한도, Claude 호출 |
| `api/demo/ai/route.ts` | `GET` 켜짐 여부 · `POST {task, input}` |
| `api/demo/room/[room]/route.ts` | 한마디함 실시간 방: 폰에서 남긴 글 저장·조회(방 코드를 아는 사람만, 2일 뒤 삭제) |
| `schema.sql` | Supabase 테이블 |

설계 원칙
- **지시문은 서버에만 둡니다.** 화면은 작업 이름과 입력만 보내므로, 지시문을 고쳐도 화면을 다시 배포할 필요가 없습니다.
- **AI가 멈춰도 서비스는 멈추지 않습니다.** 실패하면 `fallback:true`를 돌려주고 화면은 규칙으로 처리하며, 어느 쪽으로 분석했는지 화면에 표시합니다.
- **남용을 막습니다.** IP는 해시로만 저장하고, 방문자당 시간당·전체 일일 호출 수를 제한합니다.
