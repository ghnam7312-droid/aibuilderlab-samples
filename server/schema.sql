-- 예시 서비스(/demo/*) 백엔드: AI 사용량 기록(남용 방지), 한마디함 실시간 방 글
create table if not exists public.demo_ai_usage (
  id bigserial primary key, ip_hash text not null, task text not null,
  ok boolean not null default true, created_at timestamptz not null default now()
);
create index if not exists demo_ai_usage_ip_time on public.demo_ai_usage (ip_hash, created_at desc);
create index if not exists demo_ai_usage_time on public.demo_ai_usage (created_at desc);
alter table public.demo_ai_usage enable row level security;
create table if not exists public.demo_room_posts (
  id bigserial primary key, room text not null,
  body text not null check (char_length(body) between 1 and 300),
  category text, sentiment text, topic text, reason text,
  mode text not null default 'rule', ip_hash text, created_at timestamptz not null default now()
);
create index if not exists demo_room_posts_room on public.demo_room_posts (room, id);
alter table public.demo_room_posts enable row level security;
