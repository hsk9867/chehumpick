-- 모집글 확장: 방문 가능 일정, 네이버 플레이스, 목표 키워드, 다중 사진
-- 기존 image 컬럼은 목록 대표 사진 호환용으로 유지하고 images의 첫 항목과 함께 저장합니다.

alter table public.campaigns
  add column images text[] not null default '{}'::text[],
  add column visit_schedule text not null default '',
  add column place_url text not null default '',
  add column target_keywords text[] not null default '{}'::text[];

-- 기존 모집글의 대표 사진을 새 갤러리에도 채웁니다.
update public.campaigns
set images = array[image]
where cardinality(images) = 0 and image <> '';

alter table public.campaigns
  add constraint campaigns_images_max_ten
    check (cardinality(images) <= 10),
  add constraint campaigns_target_keywords_max_three
    check (cardinality(target_keywords) <= 3),
  add constraint campaigns_place_url_is_naver
    check (
      place_url = ''
      or place_url ~* '^https?://([a-z0-9-]+\.)*(naver\.com|naver\.me)(/|$)'
    );

comment on column public.campaigns.images is '매장 사진 URL 목록. 첫 항목은 대표 사진이며 최대 10장';
comment on column public.campaigns.visit_schedule is '방문 가능한 요일·시간과 공휴일 등 방문 제한 안내';
comment on column public.campaigns.place_url is '사장님이 입력한 네이버 플레이스 URL';
comment on column public.campaigns.target_keywords is '캠페인 목표 키워드, 최대 3개';
