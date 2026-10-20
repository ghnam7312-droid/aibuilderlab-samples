import { NextResponse } from "next/server";
import { BUDGET_KRW, DEMO_CORS, TASKS, demoAiEnabled, ipHash, monthSpentKrw, runDemoTask } from "@/lib/demo-ai";

// 예시 서비스 AI 호출 — POST {task, input} → {ok, mode:"ai", data} 또는 {ok:false, fallback:true}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: DEMO_CORS });
}

export async function GET() {
  // 금액은 밝히지 않고, 예산이 남았는지만 알려 준다
  const key = demoAiEnabled();
  const left = key && (await monthSpentKrw()) < BUDGET_KRW;
  const reason = !key ? "AI 키 미설정" : left ? "" : "이번 달 AI 예산 소진";
  return NextResponse.json({ enabled: key && left, reason, tasks: Object.keys(TASKS) }, { headers: DEMO_CORS });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const task = String(body?.task ?? "");
  const r = await runDemoTask(task, body?.input, ipHash(req));
  return NextResponse.json(r, { headers: DEMO_CORS });
}
