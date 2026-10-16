-- 사장님 회원가입 승인: 신규 가입 기본 정책과 회원별 승인 상태를 관리합니다.
-- 기존 사장님은 승인 상태를 유지하고, 설정이 없을 때는 가입 즉시 승인합니다.
alter table public.profiles
  add column owner_approved boolean not null default true;

create function public.owner_signup_auto_approve() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'on' from public.settings where key = 'ownerSignupAutoApprove'), true)
$$;

create function public.set_initial_owner_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.owner_approved := case when new.role = 'owner' then public.owner_signup_auto_approve() else true end;
  return new;
end $$;

create trigger profiles_set_initial_owner_approval
before insert on public.profiles
for each row execute function public.set_initial_owner_approval();

create function public.owner_is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and owner_approved
  )
$$;

create function public.admin_set_owner_approval(target uuid, approved boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  update public.profiles set owner_approved = approved where id = target and role = 'owner';
  if not found then raise exception '사장님 계정을 찾을 수 없습니다.'; end if;
end $$;

-- 승인 취소 즉시 기존 로그인 세션의 사장님 관리 권한도 제한합니다.
create or replace function public.owns_campaign(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.campaigns
    where id = c and owner_id = auth.uid() and public.owner_is_approved()
  )
$$;

drop policy campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns for insert
  with check (owner_id = auth.uid() and public.my_role() = 'owner' and public.owner_is_approved()
              and (approval = 'pending' or (approval = 'approved' and (public.has_plan() or public.owner_auto_post()))));

drop policy campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns for update
  using ((owner_id = auth.uid() and public.owner_is_approved()) or public.is_admin())
  with check ((owner_id = auth.uid() and public.owner_is_approved()) or public.is_admin());

drop policy campaigns_delete on public.campaigns;
create policy campaigns_delete on public.campaigns for delete
  using ((owner_id = auth.uid() and public.owner_is_approved()) or public.is_admin());

drop policy media_insert on storage.objects;
create policy media_insert on storage.objects for insert with check (
  bucket_id = 'media' and (
    public.is_admin()
    or ((storage.foldername(name))[1] = 'campaigns' and (storage.foldername(name))[2] = auth.uid()::text
        and public.my_role() = 'owner' and public.owner_is_approved())
  )
);

drop policy media_update on storage.objects;
create policy media_update on storage.objects for update using (
  bucket_id = 'media' and (public.is_admin() or (owner = auth.uid() and public.owner_is_approved()))
);

drop policy media_delete on storage.objects;
create policy media_delete on storage.objects for delete using (
  bucket_id = 'media' and (public.is_admin() or (owner = auth.uid() and public.owner_is_approved()))
);
