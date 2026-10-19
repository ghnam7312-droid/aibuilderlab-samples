import { NextResponse } from "next/server";
import { DEMO_CORS, TASKS, demoAiEnabled, ipHash, runDemoTask } from "@/lib/demo-ai";

// 예시 서비스 AI 호출 — POST {task, input} → {ok, mode:"ai", data} 또는 {ok:false, fallback:true}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: DEMO_CORS });
}

export async function GET() {
  return NextResponse.json({ enabled: demoAiEnabled(), tasks: Object.keys(TASKS) }, { headers: DEMO_CORS });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const task = String(body?.task ?? "");
  const r = await runDemoTask(task, body?.input, ipHash(req));
  return NextResponse.json(r, { headers: DEMO_CORS });
}
