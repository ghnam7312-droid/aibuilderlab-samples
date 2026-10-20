import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mailerConfigured, sendMail } from "@/lib/mailer";

/**
 * 예시 서비스 AI 예산·장애 알림 메일.
 * 같은 달·같은 단계(80% / 100% / API 오류)는 한 번만 보낸다(demo_ai_alerts 기본키로 중복 방지).
 * 받는 주소: DEMO_AI_ALERT_TO (없으면 대표 메일).
 */
const TO = () => (process.env.DEMO_AI_ALERT_TO || "ghnam7312@gmail.com").trim();

export type AlertLevel = 80 | 100 | 500;

const TITLE: Record<AlertLevel, string> = {
  80: "AI 월 예산 80%를 썼습니다",
  100: "AI 월 예산이 모두 소진되어 규칙 모드로 전환되었습니다",
  500: "Claude API 호출이 실패하고 있습니다",
};

export async function sendDemoAiAlert(level: AlertLevel, month: string, info: { spent: number; budget: number; detail?: string }) {
  const db = createAdminClient();
  // 먼저 자리를 잡는다. 이미 있으면(같은 달·같은 단계) 보내지 않는다.
  const { error } = await db.from("demo_ai_alerts").insert({ month, level, detail: info.detail ?? null });
  if (error) return;
  if (!mailerConfigured()) {
    await db.from("demo_ai_alerts").update({ detail: `${info.detail ?? ""} [SMTP 미설정으로 메일 못 보냄]` }).eq("month", month).eq("level", level);
    return;
  }
  const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
  const lines = [
    `${month} AI 빌더랩 예시 서비스(aibuilderlab.kr/demo)의 Claude 사용 알림입니다.`,
    "",
    `· 이번 달 사용액: ${won(info.spent)} / 한도 ${won(info.budget)} (${Math.round((info.spent / info.budget) * 100)}%)`,
    level === 100 ? "· 지금부터 다음 달 1일 0시(한국 시간)까지 9개 서비스는 규칙 모드로 동작합니다. 서비스는 멈추지 않습니다." : "",
    level === 80 ? "· 이대로면 이번 달 안에 한도에 닿을 수 있습니다." : "",
    level === 500 ? `· 오류 내용: ${info.detail ?? "-"}\n· API 키, 크레딧 잔액, 결제 수단을 console.anthropic.com 에서 확인해 주세요. 그동안 서비스는 규칙 모드로 동작합니다.` : "",
    "",
    "· 한도를 바꾸려면 Vercel 환경변수 DEMO_AI_BUDGET_KRW 를 고치고 다시 배포하세요.",
    "· 사용 현황: https://aibuilderlab.kr/api/admin/demo-ai-usage (관리자 로그인 필요)",
  ].filter((l) => l !== "");
  const text = lines.join("\n");
  const html = `<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.7;color:#1B1530">${lines
    .map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")).join("<br>")}</div>`;
  const r = await sendMail({ to: TO(), subject: `[AI 빌더랩] ${TITLE[level]}`, html, text, noDefaultCc: true });
  await db.from("demo_ai_alerts").update({ sent_ok: r.ok, detail: r.ok ? info.detail ?? null : `발송 실패: ${r.error}` }).eq("month", month).eq("level", level);
}
