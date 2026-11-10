-- Spec Agent (and later agents): reserve credits before a model call, settle after it.
-- Applied to the AIrealsolutions.com Supabase project as migration `factory_agent_run_credits`.
--
-- factory_agent_runs and factory_credit_ledger only have SELECT policies, so every write goes
-- through these two functions:
--   * factory_agent_run_reserve: called by the server AS the signed-in user. Checks project
--     access and wallet balance, opens the run and writes a `reserve` ledger entry.
--   * factory_agent_run_settle: service_role only (the server's SUPABASE_SECRET_KEY), so a
--     browser can never mark its own run as free. Releases the reservation and charges usage.

create or replace function public.factory_agent_run_reserve(
  p_project uuid,
  p_agent text,
  p_stage text,
  p_model text,
  p_credits bigint,
  p_summary text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_balance bigint;
  v_run uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to the Factory first.' using errcode = '28000';
  end if;
  if p_credits is null or p_credits <= 0 or p_credits > 10000 then
    raise exception 'Invalid credit reservation.' using errcode = '22023';
  end if;
  if not private.factory_can_access_project(p_project) then
    raise exception 'Project not available.' using errcode = '42501';
  end if;
  select organization_id into v_org from public.factory_projects where id = p_project;

  -- One reservation at a time per user, so two parallel runs cannot spend the same credits.
  perform pg_advisory_xact_lock(hashtextextended('factory_wallet:' || v_uid::text, 0));
  select coalesce(sum(credits), 0) into v_balance from public.factory_credit_ledger where user_id = v_uid;
  if v_balance < p_credits then
    raise exception 'Not enough Factory Credits: this step needs %, your balance is %.', p_credits, v_balance
      using errcode = 'P0402';
  end if;

  insert into public.factory_agent_runs(
    organization_id, project_id, requested_by, status, provider, model, runtime, model_source,
    credits_reserved, request_summary, started_at, metadata)
  values (v_org, p_project, v_uid, 'running', 'anthropic', p_model, 'api', 'factory_resolve_model',
    p_credits, left(p_summary, 500), now(), jsonb_build_object('agent', p_agent, 'stage', p_stage))
  returning id into v_run;

  insert into public.factory_credit_ledger(organization_id, project_id, user_id, entry_type, credits,
    balance_bucket, description, idempotency_key, metadata)
  values (v_org, p_project, v_uid, 'reserve', -p_credits, 'included',
    'Reserved for ' || coalesce(p_agent, 'agent') || ' run', 'agent_run:' || v_run || ':reserve',
    jsonb_build_object('agent_run_id', v_run, 'stage', p_stage));

  return v_run;
end;
$$;

create or replace function public.factory_agent_run_settle(
  p_run uuid,
  p_status text,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_micros bigint,
  p_credits_charged bigint,
  p_result_summary text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.factory_agent_runs%rowtype;
  v_charge bigint;
begin
  if p_status not in ('succeeded', 'failed', 'canceled') then
    raise exception 'Invalid final status %.', p_status using errcode = '22023';
  end if;
  select * into r from public.factory_agent_runs where id = p_run for update;
  if not found then
    raise exception 'Agent run not found.' using errcode = 'P0002';
  end if;
  if r.status not in ('running', 'reserved', 'queued') then
    return; -- already settled; settling twice is a no-op
  end if;
  -- Never charge more than was reserved.
  v_charge := greatest(0, least(coalesce(p_credits_charged, 0), r.credits_reserved));

  update public.factory_agent_runs set
    status = p_status,
    model = coalesce(p_model, model),
    input_tokens = coalesce(p_input_tokens, 0),
    output_tokens = coalesce(p_output_tokens, 0),
    provider_cost_micros = coalesce(p_cost_micros, 0),
    credits_charged = v_charge,
    result_summary = left(p_result_summary, 2000),
    metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
    finished_at = now()
  where id = p_run;

  insert into public.factory_credit_ledger(organization_id, project_id, user_id, entry_type, credits,
    balance_bucket, description, idempotency_key, metadata)
  values (r.organization_id, r.project_id, r.requested_by, 'release', r.credits_reserved, 'included',
    'Released reservation', 'agent_run:' || p_run || ':release', jsonb_build_object('agent_run_id', p_run))
  on conflict (idempotency_key) do nothing;

  if v_charge > 0 then
    insert into public.factory_credit_ledger(organization_id, project_id, user_id, entry_type, credits,
      balance_bucket, description, idempotency_key, metadata)
    values (r.organization_id, r.project_id, r.requested_by, 'usage', -v_charge, 'included',
      coalesce(r.metadata->>'agent', 'agent') || ' run', 'agent_run:' || p_run || ':usage',
      jsonb_build_object('agent_run_id', p_run))
    on conflict (idempotency_key) do nothing;
  end if;
end;
$$;

revoke all on function public.factory_agent_run_reserve(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.factory_agent_run_reserve(uuid, text, text, text, bigint, text) to authenticated;

revoke all on function public.factory_agent_run_settle(uuid, text, text, bigint, bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.factory_agent_run_settle(uuid, text, text, bigint, bigint, bigint, bigint, text, jsonb) to service_role;
