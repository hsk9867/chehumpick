-- 모집글 승인 방식: 관리자가 "승인 없이 바로 게시"를 켜면(settings.ownerAutoPost = 'on')
-- 요금제가 없는 사장님도 등록하자마자 게시됨. 꺼져 있으면 기존처럼 승인 대기로 등록
create function public.owner_auto_post() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.settings where key = 'ownerAutoPost' and value = 'on')
$$;

drop policy campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns for insert
  with check (owner_id = auth.uid() and public.my_role() = 'owner'
              and (approval = 'pending' or (approval = 'approved' and (public.has_plan() or public.owner_auto_post()))));
