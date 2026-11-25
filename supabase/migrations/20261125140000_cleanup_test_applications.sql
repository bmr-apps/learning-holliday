-- 검증용으로 낸 테스트 접수 2건을 지웁니다.
-- (실제 지원서는 이 메일·이름과 겹치지 않으므로 영향이 없습니다.)
delete from learning_holliday.applications
 where email = 'test-lh@example.com'
   and name = '테스트지원자';

-- 테스트 접수 말고는 없으면 접수 번호를 1번부터 다시 시작합니다.
do $$
begin
  if not exists (select 1 from learning_holliday.applications) then
    execute 'alter sequence learning_holliday.application_no_seq restart with 1';
  end if;
end $$;
