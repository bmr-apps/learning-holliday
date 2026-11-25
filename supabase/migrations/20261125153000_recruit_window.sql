-- 모집 기간(2026. 12. 1 00:00 ~ 12. 31 24:00, 한국 시간) 밖에는 지원서를 받지 않습니다.
--  · 지원서 화면도 12/1 이전에는 작성 칸 대신 "2026년 12월 1일 00:00부터 지원서가 열립니다" 안내를 보여 줍니다.
--  · 이미 접수된 지원서(테스트 접수 LH-2027-0001 포함)는 지우지 않고 그대로 둡니다.

create or replace function learning_holliday.submit_application(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name     text := btrim(coalesce(p->>'name', ''));
  v_phone    text := btrim(coalesce(p->>'phone', ''));
  v_email    text := lower(btrim(coalesce(p->>'email', '')));
  v_category text := btrim(coalesce(p->>'category', ''));
  v_part     text := btrim(coalesce(p->>'part', ''));
  v_recent   int;
  v_receipt  text;
  v_created  timestamptz;
begin
  -- 모집 기간 확인 (한국 시간 2026-12-01 00:00 ~ 2027-01-01 00:00)
  if now() < timestamptz '2026-12-01 00:00:00+09'
     or now() >= timestamptz '2027-01-01 00:00:00+09' then
    raise exception '모집 기간(2026. 12. 1 ~ 12. 31)에만 지원할 수 있습니다.' using errcode = 'P0001';
  end if;

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

  select count(*) into v_recent
    from learning_holliday.applications
   where created_at > now() - interval '10 minutes';
  if v_recent >= 40 then
    raise exception '지금 접수가 잠시 몰리고 있습니다. 조금 뒤 다시 시도해 주세요.' using errcode = 'P0001';
  end if;

  insert into learning_holliday.applications (
    name, birth_date, phone, email, address, affiliation, apply_route,
    category, part, education, career, q_self, q_motive, q_plan,
    agree_live, agree_privacy, newsletter, message_extra
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
    nullif(left(btrim(coalesce(p->>'education', '')), 2000), ''),
    nullif(left(btrim(coalesce(p->>'career', '')), 2000), ''),
    left(btrim(p->>'q_self'), 5000),
    left(btrim(p->>'q_motive'), 5000),
    left(btrim(p->>'q_plan'), 5000),
    coalesce((p->>'agree_live')::boolean, false),
    true,
    coalesce((p->>'newsletter')::boolean, false),
    nullif(left(btrim(coalesce(p->>'message_extra', '')), 2000), '')
  )
  returning receipt_no, created_at into v_receipt, v_created;

  return jsonb_build_object('receipt_no', v_receipt, 'created_at', v_created);
end $$;

revoke all on function learning_holliday.submit_application(jsonb) from public;
grant execute on function learning_holliday.submit_application(jsonb) to anon, authenticated;

-- 확인: 은길님이 관리자 화면에서 보실 테스트 접수(LH-2027-0001)가 DB에 남아 있는지 봅니다.
--  (빈 DB에서 처음부터 다시 돌리는 경우에는 그냥 넘어갑니다.)
do $$
begin
  if exists (select 1 from learning_holliday.applications)
     and not exists (
       select 1 from learning_holliday.applications
        where receipt_no = 'LH-2027-0001'
          and name = '김별무리(테스트)'
     ) then
    raise exception '테스트 접수 LH-2027-0001 이 남아 있지 않습니다. 확인이 필요합니다.';
  end if;
end $$;
