-- 별무리 러닝 홀리데이 · 온라인 지원 접수
--  · 누구나(비로그인) 지원서를 낼 수 있고, 접수된 지원서는 관리자만 열람·수정·삭제합니다.
--  · 접수는 security definer 함수 submit_application() 으로만 들어갑니다 (표에 직접 insert 권한을 주지 않음).

-- 1) 접수 번호용 번호표
create sequence if not exists learning_holliday.application_no_seq;

-- 2) 지원서 표
create table if not exists learning_holliday.applications (
  id            bigint generated always as identity primary key,
  receipt_no    text not null unique
                default ('LH-2027-' || lpad(nextval('learning_holliday.application_no_seq')::text, 4, '0')),
  -- 기본 인적 사항
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  birth_date    date not null,
  phone         text not null check (char_length(btrim(phone)) between 7 and 30),
  email         text not null check (char_length(btrim(email)) between 5 and 160),
  address       text,
  affiliation   text,
  apply_route   text,
  -- 지원 구분 · 희망 파트
  category      text not null check (category in ('별무리 졸업생', '교사선교회 예비 교사', '기타')),
  part          text not null check (part in ('생태', '문화', '연구', '무관')),
  -- 학력 · 경력
  education     text,
  career        text,
  -- 자기소개 및 지원 동기 3문항
  q_self        text not null,
  q_motive      text not null,
  q_plan        text not null,
  -- 동의
  agree_live    boolean not null default false,
  agree_privacy boolean not null check (agree_privacy),
  newsletter    boolean not null default false,
  -- 관리자 심사
  status        text not null default '접수완료'
                check (status in ('접수완료', '서류검토', '인터뷰', '합격', '보류')),
  memo          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists applications_created_at_idx on learning_holliday.applications (created_at desc);
create index if not exists applications_status_idx on learning_holliday.applications (status);

alter table learning_holliday.applications enable row level security;

-- 3) 관리자 명단 (이 메일로 허브에 로그인한 사람만 지원서를 봅니다)
create table if not exists learning_holliday.managers (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

insert into learning_holliday.managers (email, note) values
  ('mrgoodway@bmrschool.org', '앱 담당자'),
  ('mrgoodway@gmail.com',     '앱 담당자 (구글 계정)'),
  ('dev@bmrschool.org',       'BMR APPS 관리자')
on conflict (email) do nothing;

-- 4) 지금 사람이 관리자인가 (참·거짓만 돌려주는 도우미)
--    · BMR APPS 승인 개발자(bmr.is_staff) 또는 관리자(bmr.is_admin), 또는 managers 명단의 메일
--    · 함수가 없는 환경에서도 깨지지 않게 존재 여부를 확인한 뒤 부릅니다.
create or replace function learning_holliday.am_i_manager() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text;
  v_ok    boolean := false;
begin
  if to_regprocedure('bmr.is_staff()') is not null then
    execute 'select coalesce(bmr.is_staff(), false)' into v_ok;
  end if;
  if not v_ok and to_regprocedure('bmr.is_admin()') is not null then
    execute 'select coalesce(bmr.is_admin(), false)' into v_ok;
  end if;
  if v_ok then return true; end if;

  v_email := lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
  if v_email = '' then return false; end if;

  return exists (select 1 from learning_holliday.managers m where lower(m.email) = v_email);
end $$;

revoke all on function learning_holliday.am_i_manager() from public;
grant execute on function learning_holliday.am_i_manager() to anon, authenticated;

-- 5) 지원서 접수 (비로그인도 부를 수 있는 유일한 쓰기 길)
create or replace function learning_holliday.submit_application(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name    text := btrim(coalesce(p->>'name', ''));
  v_phone   text := btrim(coalesce(p->>'phone', ''));
  v_email   text := lower(btrim(coalesce(p->>'email', '')));
  v_category text := btrim(coalesce(p->>'category', ''));
  v_part    text := btrim(coalesce(p->>'part', ''));
  v_recent  int;
  v_receipt text;
  v_created timestamptz;
begin
  if coalesce((p->>'agree_privacy')::boolean, false) is not true then
    raise exception '개인정보 수집·이용에 동의해야 지원할 수 있습니다.' using errcode = 'P0001';
  end if;
  if v_name = '' or v_phone = '' or v_email = '' then
    raise exception '이름, 휴대전화, 이메일은 꼭 적어 주세요.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p->>'q_self', '')) = '' or btrim(coalesce(p->>'q_motive', '')) = ''
     or btrim(coalesce(p->>'q_plan', '')) = '' then
    raise exception '자기소개와 지원 동기 세 문항은 꼭 적어 주세요.' using errcode = 'P0001';
  end if;
  if v_category not in ('별무리 졸업생', '교사선교회 예비 교사', '기타') then
    raise exception '지원 구분을 골라 주세요.' using errcode = 'P0001';
  end if;
  if v_part not in ('생태', '문화', '연구', '무관') then
    raise exception '희망 파트를 골라 주세요.' using errcode = 'P0001';
  end if;

  -- 짧은 시간에 너무 많이 들어오면 잠시 막습니다
  select count(*) into v_recent
    from learning_holliday.applications
   where created_at > now() - interval '10 minutes';
  if v_recent >= 40 then
    raise exception '지금 접수가 잠시 몰리고 있습니다. 조금 뒤 다시 시도해 주세요.' using errcode = 'P0001';
  end if;

  insert into learning_holliday.applications (
    name, birth_date, phone, email, address, affiliation, apply_route,
    category, part, education, career, q_self, q_motive, q_plan,
    agree_live, agree_privacy, newsletter
  ) values (
    left(v_name, 60),
    (p->>'birth_date')::date,
    left(v_phone, 30),
    left(v_email, 160),
    nullif(left(btrim(coalesce(p->>'address', '')), 200), ''),
    nullif(left(btrim(coalesce(p->>'affiliation', '')), 200), ''),
    nullif(left(btrim(coalesce(p->>'apply_route', '')), 100), ''),
    v_category,
    v_part,
    nullif(left(btrim(coalesce(p->>education, '')), 2000), ''),
    nullif(left(btrim(coalesce(p->>'career', '')), 2000), ''),
    left(btrim(p->>'q_self'), 5000),
    left(btrim(p->>'q_motive'), 5000),
    left(btrim(p->>'q_plan'), 5000),
    coalesce((p->>'agree_live')::boolean, false),
    true,
    coalesce((p->>'newsletter')::boolean, false)
  )
  returning receipt_no, created_at into v_receipt, v_created;

  return jsonb_build_object('receipt_no', v_receipt, 'created_at', v_created);
end $$;

revoke all on function learning_holliday.submit_application(jsonb) from public;
grant execute on function learning_holliday.submit_application(jsonb) to anon, authenticated;

-- 6) 정책 — 관리자만 읽기·고치기·지우기. 넣기는 위 함수로만.
drop policy if exists "지원서: 관리자만 보기" on learning_holliday.applications;
create policy "지원서: 관리자만 보기" on learning_holliday.applications
  for select to authenticated using ((select learning_holliday.am_i_manager()));

drop policy if exists "지원서: 관리자만 고치기" on learning_holliday.applications;
create policy "지원서: 관리자만 고치기" on learning_holliday.applications
  for update to authenticated
  using ((select learning_holliday.am_i_manager()))
  with check ((select learning_holliday.am_i_manager()));

drop policy if exists "지원서: 관리자만 지우기" on learning_holliday.applications;
create policy "지원서: 관리자만 지우기" on learning_holliday.applications
  for delete to authenticated using ((select learning_holliday.am_i_manager()));

-- 쓰기 권한은 직접 줘야 합니다 (넣기 권한은 주지 않습니다 — 접수는 함수로만)
grant select, update, delete on learning_holliday.applications to authenticated;
revoke insert, update, delete on learning_holliday.applications from anon;
