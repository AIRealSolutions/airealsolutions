-- Optional: send scheduled posts on time and ping phones when reminders come due. Run after docs/office-phase7.sql.
-- Without this, scheduled posts go out when the Content Studio is open or with the weekday morning job.
-- Supabase's pg_cron calls the Office every 10 minutes using pg_net.
--
-- Before running: replace PASTE_CRON_SECRET_HERE with the CRON_SECRET value set in Vercel
-- (Project → Settings → Environment Variables). It is stored in Supabase Vault, not in this file.
-- Safe to run more than once.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from vault.secrets where name = 'office_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'office_cron_secret'), 'PASTE_CRON_SECRET_HERE');
  else
    perform vault.create_secret('PASTE_CRON_SECRET_HERE', 'office_cron_secret', 'Bearer token for /api/office/cron/tick');
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'office-publish';
select cron.schedule('office-publish', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://airealsolutions.com/api/office/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'office_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 290000)
$job$);

-- To check it:  select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'office-publish') order by start_time desc limit 5;
-- To stop it:   select cron.unschedule('office-publish');
