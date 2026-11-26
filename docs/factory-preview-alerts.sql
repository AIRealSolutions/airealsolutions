-- Email the link's creator when an investor opens a preview link.
-- Applied to the AIrealsolutions.com Supabase project as migration `factory_preview_alerts`.
--
-- The browser calls POST /api/factory/preview-alert with its pass right after factory_preview_open hands one out.
-- That server route calls factory_preview_alert_claim with the service-role key; the claim decides (and records,
-- in the same statement) whether an email is due: on the first open, then at most once every 12 hours per link,
-- and only while the link has notify_owner on. So a visitor replaying the call cannot cause extra emails.

alter table public.factory_preview_invites add column if not exists notify_owner boolean not null default true;
alter table public.factory_preview_invites add column if not exists last_alerted_at timestamptz;
grant select (notify_owner, last_alerted_at) on public.factory_preview_invites to authenticated;
grant update (notify_owner) on public.factory_preview_invites to authenticated;

create or replace function public.factory_preview_alert_claim(p_grant uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite public.factory_preview_invites%rowtype;
  v_project public.factory_projects%rowtype;
  v_email text;
  v_first boolean;
begin
  select i.* into v_invite
  from private.factory_preview_grants g
  join public.factory_preview_invites i on i.id = g.invite_id
  where g.id = p_grant and g.expires_at > now() and i.revoked_at is null
  for update of i;
  if v_invite.id is null or not v_invite.notify_owner then
    return null;
  end if;
  if v_invite.last_alerted_at is not null and v_invite.last_alerted_at > now() - interval '12 hours' then
    return null;
  end if;

  select u.email into v_email from auth.users u where u.id = v_invite.created_by;
  if v_email is null then
    return null;
  end if;
  select * into v_project from public.factory_projects p where p.id = v_invite.project_id;
  v_first := v_invite.last_alerted_at is null;

  update public.factory_preview_invites i set last_alerted_at = now() where i.id = v_invite.id;
  insert into public.factory_project_events(project_id, actor_id, event_type, detail)
  values (v_invite.project_id, null, 'preview.invite_opened',
          jsonb_build_object('invite_id', v_invite.id, 'label', v_invite.label, 'first', v_first, 'views', v_invite.view_count));

  return jsonb_build_object(
    'to', v_email,
    'label', v_invite.label,
    'project_name', v_project.name,
    'project_slug', v_project.slug,
    'first', v_first,
    'view_count', v_invite.view_count,
    'first_viewed_at', v_invite.first_viewed_at,
    'has_pin', v_invite.pin_hash is not null);
end;
$$;

revoke all on function public.factory_preview_alert_claim(uuid) from public, anon, authenticated;
grant execute on function public.factory_preview_alert_claim(uuid) to service_role;
