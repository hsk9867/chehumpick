-- 운영 관리자 계정(admin)을 생성하거나 요청된 비밀번호 해시와 역할로 맞춥니다.
-- 기존 admin 계정이 있으면 비밀번호와 역할을 맞추고, 없으면 인증 계정부터 생성합니다.
do $$
declare
  uid uuid;
begin
  select id into uid from auth.users where email = 'admin@id.chehumpick.kr';

  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, is_sso_user
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'admin@id.chehumpick.kr',
      '$2b$10$beEXjAR9bQRMu5ecd5Li4O2eKylr9oRgcZSnOkUTmabwOG68T3pfO', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"role":"influencer","name":"관리자","phone":""}'::jsonb,
      now(), now(), '', '', '', '', '', false
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), uid, uid::text, 'email',
      jsonb_build_object('sub', uid::text, 'email', 'admin@id.chehumpick.kr', 'email_verified', true, 'phone_verified', false),
      now(), now(), now()
    );
  else
    update auth.users
    set encrypted_password = '$2b$10$beEXjAR9bQRMu5ecd5Li4O2eKylr9oRgcZSnOkUTmabwOG68T3pfO',
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = uid;
  end if;

  update public.profiles
  set role = 'admin', name = '관리자', sns_type = null, sns_url = null, sns_links = '[]'::jsonb,
      store_name = null, plan = null, paid_until = null, owner_approved = true
  where id = uid;

  if not found then
    insert into public.profiles (id, role, name, username, sns_links, owner_approved)
    values (uid, 'admin', '관리자', 'admin', '[]'::jsonb, true);
    insert into public.contacts (user_id, email, phone)
    values (uid, 'admin@id.chehumpick.kr', '');
  end if;
end $$;
