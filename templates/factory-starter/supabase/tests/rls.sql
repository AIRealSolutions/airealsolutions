-- RLS and access tests for 0001_init.sql. Runs in one transaction and rolls back; any failed check aborts with an error.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
begin;
create schema tests;
grant usage on schema tests to anon, authenticated;

create or replace function tests.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % (no error)', p_label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: % (%)', p_label, sqlerrm;
end $$;
create or replace function tests.expect(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok: %', p_label;
end $$;

insert into public.site_members(email, role) values ('owner@example.com', 'owner'), ('staff@example.com', 'staff');
grant execute on function tests.expect_error(text, text) to anon, authenticated;
grant execute on function tests.expect(boolean, text) to anon, authenticated;

-- Visitor (anon)
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select tests.expect(public.site_submit('service_request', 'requests', '{"name":"Ann","email":"ann@example.com"}', 'fp-1') is not null, 'anon can submit a form');
select tests.expect_error($q$select count(*) from public.site_submissions$q$, 'anon cannot read submissions');
select tests.expect_error($q$insert into public.site_submissions(form_key, entity_key, data) values ('x','y','{"a":"b"}')$q$, 'anon cannot insert directly');
select tests.expect_error($q$select count(*) from public.site_members$q$, 'anon cannot read members');
select tests.expect_error($q$select public.site_submit('Bad Key', 'requests', '{"a":"b"}')$q$, 'bad form key refused');
select tests.expect_error($q$select public.site_submit('f', 'requests', '{}')$q$, 'empty form refused');
select tests.expect_error($q$select public.site_submit('f', 'requests', '[1]')$q$, 'non-object refused');
reset role;

-- Rate limit: 10 per fingerprint per hour
set local role anon;
do $$ begin for i in 2..10 loop perform public.site_submit('service_request', 'requests', '{"n":"x"}', 'fp-1'); end loop; end $$;
select tests.expect_error($q$select public.site_submit('service_request', 'requests', '{"n":"x"}', 'fp-1')$q$, '11th submission from one fingerprint blocked');
select tests.expect(public.site_submit('service_request', 'requests', '{"n":"y"}', 'fp-2') is not null, 'another fingerprint still allowed');
reset role;

-- Signed in, but not a member
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000009","email":"stranger@example.com"}';
select tests.expect((select count(*) from public.site_submissions) = 0, 'non-member sees no submissions');
select tests.expect((select count(*) from public.site_members) = 0, 'non-member sees no members');
select tests.expect_error($q$insert into public.site_members(email) values ('stranger@example.com')$q$, 'non-member cannot add themselves');
reset role;

-- Staff member
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002","email":"Staff@Example.com"}';
select tests.expect((select count(*) from public.site_submissions) = 11, 'staff sees all submissions (email matched case-insensitively)');
update public.site_submissions set status = 'contacted' where data ->> 'name' = 'Ann';
select tests.expect((select status from public.site_submissions where data ->> 'name' = 'Ann') = 'contacted', 'staff can change status');
select tests.expect_error($q$update public.site_submissions set data = '{"name":"x"}'$q$, 'staff cannot rewrite submission data');
select tests.expect_error($q$insert into public.site_members(email) values ('friend@example.com')$q$, 'staff cannot add members');
delete from public.site_submissions;
reset role;
select tests.expect((select count(*) from public.site_submissions) = 11, 'staff delete removes nothing (owners only)');

-- Owner
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@example.com"}';
insert into public.site_members(email) values ('new.staff@example.com');
select tests.expect((select count(*) from public.site_members) = 3, 'owner can add a member');
delete from public.site_submissions where data ->> 'n' = 'y';
reset role;
select tests.expect((select count(*) from public.site_submissions) = 10, 'owner can delete a submission');

-- Every table in public has RLS on
select tests.expect(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'RLS is on for every public table');

rollback;
\o
\echo 'RLS tests passed'
