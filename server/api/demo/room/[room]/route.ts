import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_CORS, ipHash, runDemoTask } from "@/lib/demo-ai";

// 한마디함 실시간 방 — 방문자마다 무작위 방 코드를 만들고, 폰에서 QR로 들어와 글을 남긴다.
// 방 코드를 아는 사람만 읽고 쓸 수 있다. 글은 2일 뒤 지운다.
const ROOM = /^[a-z0-9]{6,16}$/;
const CATS = ["칭찬", "개선 요청", "질문", "기타"];
const SENTS = ["긍정", "중립", "부정"];

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: DEMO_CORS });
}

export async function GET(req: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  if (!ROOM.test(room)) return NextResponse.json({ ok: false, error: "방 코드가 올바르지 않습니다." }, { status: 400, headers: DEMO_CORS });
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  const { data } = await createAdminClient().from("demo_room_posts")
    .select("id, body, category, sentiment, topic, reason, mode, created_at")
    .eq("room", room).gt("id", after).order("id", { ascending: true }).limit(100);
  return NextResponse.json({ ok: true, posts: data ?? [] }, { headers: DEMO_CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  if (!ROOM.test(room)) return NextResponse.json({ ok: false, error: "방 코드가 올바르지 않습니다." }, { status: 400, headers: DEMO_CORS });
  const b = await req.json().catch(() => ({}));
  const text = String(b?.body ?? "").trim().slice(0, 300);
  if (!text) return NextResponse.json({ ok: false, error: "한마디를 적어 주세요." }, { status: 400, headers: DEMO_CORS });

  const db = createAdminClient();
  const hash = ipHash(req);
  const tenMin = new Date(Date.now() - 600_000).toISOString();
  const { count } = await db.from("demo_room_posts").select("id", { count: "exact", head: true }).eq("ip_hash", hash).gte("created_at", tenMin);
  if ((count ?? 0) >= 20) return NextResponse.json({ ok: false, error: "잠시 후 다시 남겨 주세요." }, { status: 429, headers: DEMO_CORS });

  // AI 분류, 안 되면 화면이 보낸 규칙 분류를 쓴다
  const rule = b?.rule ?? {};
  let row = {
    category: CATS.includes(rule.category) ? rule.category : "기타",
    sentiment: SENTS.includes(rule.sentiment) ? rule.sentiment : "중립",
    topic: String(rule.topic ?? "").slice(0, 20) || null,
    reason: String(rule.reason ?? "").slice(0, 120) || null,
    mode: "rule",
  };
  const ai = await runDemoTask("guestbook.classify", { text }, hash);
  if (ai.ok) {
    const d = ai.data as Record<string, string>;
    row = {
      category: CATS.includes(d.category) ? d.category : row.category,
      sentiment: SENTS.includes(d.sentiment) ? d.sentiment : row.sentiment,
      topic: String(d.topic ?? "").slice(0, 20) || row.topic,
      reason: String(d.reason ?? "").slice(0, 120) || row.reason,
      mode: "ai",
    };
  }
  const { data, error } = await db.from("demo_room_posts").insert({ room, body: text, ip_hash: hash, ...row })
    .select("id, body, category, sentiment, topic, reason, mode, created_at").single();
  if (error) return NextResponse.json({ ok: false, error: "저장하지 못했습니다." }, { status: 500, headers: DEMO_CORS });
  // 오래된 글 정리
  await db.from("demo_room_posts").delete().lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString());
  return NextResponse.json({ ok: true, post: data }, { headers: DEMO_CORS });
}
