-- 접수 함수 수정: education 컬럼 참조 오타(p->>education → p->>'education'),
-- '하고 싶은 말'(message_extra) 칸 추가.
-- 이미 적용된 20261125130000 파일은 고치지 않고 새 파일로 반영합니다.

alter table learning_holliday.applications
  add column if not exists message_extra text;

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
