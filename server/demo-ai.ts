import "server-only";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 예시 서비스(/demo/*)가 함께 쓰는 Claude 호출.
 * - 작업(task)마다 정해진 지시문과 JSON 출력 형식이 있다. 화면은 task 이름과 입력만 보낸다.
 * - 키가 없거나 한도를 넘으면 {fallback:true}를 돌려주고, 화면은 브라우저 규칙으로 처리한다.
 * - 남용 방지: 방문자(IP 해시)당 시간당 DEMO_AI_PER_HOUR회, 전체 하루 DEMO_AI_PER_DAY회.
 */

const MODEL = process.env.DEMO_AI_MODEL || "claude-haiku-5-5";
const PER_HOUR = Number(process.env.DEMO_AI_PER_HOUR || 40);
const PER_DAY = Number(process.env.DEMO_AI_PER_DAY || 3000);
const MAX_INPUT = 12000; // 입력 JSON 최대 글자 수

export function demoAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.DEMO_AI_OFF !== "true";
}

export function ipHash(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`demo:${ip}:${process.env.AUTH_SHADOW_SECRET ?? ""}`).digest("hex").slice(0, 24);
}

type Task = { system: string; shape: string; maxTokens: number };

const KO = "모든 문장은 한국어로, 짧고 구체적으로 쓴다. 반드시 JSON 하나만 출력하고 다른 말은 쓰지 않는다.";

export const TASKS: Record<string, Task> = {
  "guestbook.classify": {
    system: `행사 익명 피드백 한 건을 분류한다. category는 칭찬, 개선 요청, 질문, 기타 중 하나. sentiment는 긍정, 중립, 부정 중 하나. topic은 운영진이 손볼 영역을 2~6자로(예: 시간 배분, 장소·시설, 음향·화면, 진행 방식, 음식, 안내·공지). reason은 판단 근거 한 문장. ${KO}`,
    shape: `{"category":"","sentiment":"","topic":"","reason":""}`,
    maxTokens: 200,
  },
  "guestbook.summary": {
    system: `행사 피드백 목록을 운영진용으로 요약한다. lines는 3문장(전체 분위기, 가장 많은 의견, 바로 할 일). actions는 개선 요청을 주제별로 묶은 것으로 많은 순서 최대 4개, suggestion은 다음 행사에서 할 구체적 조치. ${KO}`,
    shape: `{"lines":["","",""],"actions":[{"topic":"","count":0,"suggestion":""}]}`,
    maxTokens: 600,
  },
  "meeting.extract": {
    system: `회의록에서 결정사항, 할 일, 논의를 뽑는다. tasks의 owner는 회의록에 나온 이름 그대로, due는 YYYY-MM-DD (오늘 날짜 input.today 기준으로 '금요일까지', '내일' 같은 표현을 날짜로 바꾼다; 없으면 빈 문자열). 회의록에 없는 내용은 만들지 않는다. ${KO}`,
    shape: `{"title":"","attendees":[""],"decisions":[""],"tasks":[{"owner":"","task":"","due":""}],"discussion":[""]}`,
    maxTokens: 900,
  },
  "study.plan": {
    system: `시험 준비생의 이번 주 7일 공부 계획을 짠다. input.today부터 7일, 하루 총 학습 시간은 hoursPerDay를 넘기지 않는다. 하루 과목은 2개 이하, 7일째는 복습. phase는 남은 기간에 맞는 단계 이름(개념 정리, 기출 반복, 실전 모의 등). coach는 응원보다 구체적 조언 한 문장. ${KO}`,
    shape: `{"phase":"","days":[{"date":"YYYY-MM-DD","items":[{"subject":"","task":"","minutes":60}]}],"coach":""}`,
    maxTokens: 1500,
  },
  "mail.classify": {
    system: `거래처 메일 한 통을 분류한다. category는 견적 요청, 발주·주문, 문의, 기타 중 하나. confidence는 0~1. 두 범주 사이에서 애매하면 confidence를 0.6 미만으로. reason은 근거 한 문장. 견적 요청·발주면 items에 품목명(수식어 포함), 수량(숫자), 납기(YYYY-MM-DD 또는 원문 표현)를 뽑는다. 메일에 없는 것은 만들지 않는다. ${KO}`,
    shape: `{"category":"","confidence":0.0,"reason":"","items":[{"name":"","qty":0,"due":""}]}`,
    maxTokens: 500,
  },
  "mail.reply": {
    system: `견적 요청 메일에 보낼 회신 초안을 쓴다. 회사는 input.company, 담당자는 input.sender. 받은 메일의 품목·수량·납기를 확인하는 문장, 단가와 납기 회신 예정 시점(영업일 1일 이내), 추가로 확인할 점 1~2개를 담는다. 정중하지만 짧게. 단가 숫자는 지어내지 않는다. ${KO}`,
    shape: `{"subject":"","body":""}`,
    maxTokens: 700,
  },
  "report.summary": {
    system: `주간 성과 숫자로 보고서 요약 4문장을 쓴다. 1) 전체 결과와 전주 대비, 2) 가장 좋았던 날과 이유 추정(공휴일 등 input에 있는 사실만), 3) 주의할 지표, 4) 다음 주 할 일. 숫자는 input에 있는 값만 쓴다. ${KO}`,
    shape: `{"lines":["","","",""]}`,
    maxTokens: 600,
  },
  "academy.plan": {
    system: `학원 단원 평가 결과로 학부모에게 보낼 '다음 주 계획'을 쓴다. weak는 정답률 낮은 단원 최대 3개. plan은 요일이 들어간 구체적 학습 3줄(문항 수·시간 포함). message는 학부모 카카오톡 첫 문장(학생 이름 포함, 2문장 이내, 과장 없이). ${KO}`,
    shape: `{"weak":[""],"plan":["","",""],"message":""}`,
    maxTokens: 600,
  },
  "wrong.coach": {
    system: `한 학생의 오답 목록(문항 단원, 유형 태그, 고른 답, 정답)을 보고 오답 유형을 개념 부족, 계산 실수, 문제 이해 중 가장 큰 하나로 판단하고, 학부모에게 보낼 2문장 코멘트와 다음 수업 처방 1개를 쓴다. ${KO}`,
    shape: `{"main":"","comment":"","prescription":""}`,
    maxTokens: 400,
  },
  "interview.analyze": {
    system: `고객 인터뷰 메모 한 건을 분석한다. keywords는 3~5개 핵심어. quote는 메모 안의 문장 중 가장 의미 있는 한 문장을 그대로. evidence는 input.hypotheses 각각에 대해 stance(지지, 반증, 무관)와 근거 한 문장. 메모에 없는 사실은 만들지 않는다. ${KO}`,
    shape: `{"keywords":[""],"quote":"","evidence":[{"id":"H1","stance":"","why":""}]}`,
    maxTokens: 600,
  },
  "interview.question": {
    system: `고객 인터뷰 질문 하나를 점검한다. 답을 유도하거나(좋을까요, 하시겠어요, 원하세요), 미래 가정을 묻거나, 두 가지를 한꺼번에 묻는지 본다. leading은 true/false, reason은 한 문장, rewrite는 '지난달 실제로 한 행동'을 묻는 질문으로 고쳐 쓴 것. ${KO}`,
    shape: `{"leading":false,"reason":"","rewrite":""}`,
    maxTokens: 300,
  },
};

async function usageOk(hash: string): Promise<boolean> {
  const db = createAdminClient();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const [{ count: mine }, { count: all }] = await Promise.all([
    db.from("demo_ai_usage").select("id", { count: "exact", head: true }).eq("ip_hash", hash).gte("created_at", hourAgo),
    db.from("demo_ai_usage").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
  ]);
  return (mine ?? 0) < PER_HOUR && (all ?? 0) < PER_DAY;
}

function firstJson(text: string): unknown {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("JSON 없음");
  return JSON.parse(text.slice(s, e + 1));
}

export type DemoAiResult = { ok: true; mode: "ai"; model: string; data: unknown; ms: number } | { ok: false; fallback: true; reason: string };

export async function runDemoTask(taskName: string, input: unknown, hash: string): Promise<DemoAiResult> {
  const task = TASKS[taskName];
  if (!task) return { ok: false, fallback: true, reason: "알 수 없는 작업" };
  if (!demoAiEnabled()) return { ok: false, fallback: true, reason: "AI 키 미설정" };
  const payload = JSON.stringify(input ?? {});
  if (payload.length > MAX_INPUT) return { ok: false, fallback: true, reason: "입력이 너무 깁니다" };
  if (!(await usageOk(hash))) return { ok: false, fallback: true, reason: "사용량 한도" };

  const t0 = Date.now();
  const db = createAdminClient();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: task.maxTokens,
        system: `${task.system}\n출력 형식: ${task.shape}`,
        messages: [{ role: "user", content: `입력(JSON):\n${payload}` }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    const text = (j.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
    const data = firstJson(text);
    await db.from("demo_ai_usage").insert({ ip_hash: hash, task: taskName, ok: true });
    return { ok: true, mode: "ai", model: MODEL, data, ms: Date.now() - t0 };
  } catch (e) {
    await db.from("demo_ai_usage").insert({ ip_hash: hash, task: taskName, ok: false });
    return { ok: false, fallback: true, reason: e instanceof Error ? e.message.slice(0, 120) : "AI 호출 실패" };
  }
}

/** 예시 서비스는 깃허브 사본(로컬)에서도 호출할 수 있게 연다. 한도는 서버가 지킨다. */
export const DEMO_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
