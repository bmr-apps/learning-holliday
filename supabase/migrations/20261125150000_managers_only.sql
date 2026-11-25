-- 관리자 열람 범위를 담당자 메일로만 좁힙니다.
--  · 지금까지는 BMR APPS 승인 개발자(bmr.is_staff)·관리자(bmr.is_admin)도 지원서를 볼 수 있었습니다.
--  · 이제 learning_holliday.managers 에 등록된 담당자 이메일로 허브에 로그인한 사람만
--    지원서 열람·수정·삭제를 할 수 있습니다. (지원 접수 함수는 그대로 누구나 쓸 수 있습니다.)

create or replace function learning_holliday.am_i_manager() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text;
begin
  -- 로그인 토큰의 이메일만 봅니다 (없으면 관리자가 아님)
  v_email := lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
  if v_email = '' then return false; end if;

  return exists (select 1 from learning_holliday.managers m where lower(m.email) = v_email);
end $$;

revoke all on function learning_holliday.am_i_manager() from public;
grant execute on function learning_holliday.am_i_manager() to anon, authenticated;
