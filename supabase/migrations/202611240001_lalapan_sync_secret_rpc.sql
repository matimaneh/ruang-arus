create or replace function public.get_lalapan_sync_secret()
returns text
language sql
security definer
set search_path = pg_catalog
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'ruang_arus_lalapan_import_token_v1'
  limit 1;
$$;

revoke all on function public.get_lalapan_sync_secret() from public, anon, authenticated;
grant execute on function public.get_lalapan_sync_secret() to service_role;
