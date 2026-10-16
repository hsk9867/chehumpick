-- 사장님 유료 운영: settings.ownerPaidMode = 'on'이면 유효한 요금제가 있는 사장님만
-- 새 모집글을 등록할 수 있습니다. 기존 모집글의 수정·삭제 권한은 그대로 유지합니다.
create function public.owner_paid_mode() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.settings where key = 'ownerPaidMode' and value = 'on')
$$;

drop policy campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns for insert
  with check (
    owner_id = auth.uid()
    and public.my_role() = 'owner'
    and public.owner_is_approved()
    and (not public.owner_paid_mode() or public.has_plan())
    and (
      approval = 'pending'
      or (approval = 'approved' and (public.has_plan() or public.owner_auto_post()))
    )
  );
