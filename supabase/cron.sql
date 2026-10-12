-- Run AFTER the backend is deployed on Render.
-- Supabase calls the backend every minute to score new readings. This:
--   * keeps scoring working even after Render's free tier puts the service to sleep
--   * wakes the service up (first call after sleep can take ~1 min; that's fine)
--
-- Replace the two placeholders below:
--   <API_URL>      e.g. https://water-quality-api.onrender.com
--   <ADMIN_TOKEN>  Render dashboard -> water-quality-api -> Environment -> ADMIN_TOKEN

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the token in Vault instead of in the job text.
select vault.create_secret('<ADMIN_TOKEN>', 'water_api_admin_token');

select cron.unschedule('score-water-readings')
where exists (select 1 from cron.job where jobname = 'score-water-readings');

select cron.schedule(
  'score-water-readings',
  '* * * * *',
  $$
  select net.http_post(
    url     := '<API_URL>/api/score',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Admin-Token', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'water_api_admin_token')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Check it's working (status_code should be 200):
-- select id, status_code, content, created from net._http_response order by id desc limit 5;
