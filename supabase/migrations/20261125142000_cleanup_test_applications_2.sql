-- 검증용 접수를 한 번 더 지우고 접수 번호를 1번부터 시작하게 합니다.
delete from learning_holliday.applications
 where email = 'test-lh@example.com'
   and name = '테스트지원자';

do $$
begin
  if not exists (select 1 from learning_holliday.applications) then
    execute 'alter sequence learning_holliday.application_no_seq restart with 1';
  end if;
end $$;
