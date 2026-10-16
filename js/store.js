/*
 * 데이터 계층 (Supabase)
 * 서버에서 받아 온 데이터를 메모리(cache)에 두고, 화면 코드(app.js)는 여기 함수만 사용합니다.
 * 읽기 함수는 바로 값을 돌려주고, 바꾸는 함수는 서버에 반영한 뒤 끝나는 Promise를 돌려줍니다.
 * 누가 무엇을 할 수 있는지는 서버의 권한 규칙(supabase/migrations)이 최종적으로 검사합니다.
 */
(function () {
  const sb = window.supabase.createClient(window.CHEHUMPICK_CONFIG.supabaseUrl, window.CHEHUMPICK_CONFIG.supabaseKey);
  const DEFAULT_SETTINGS = window.CHEHUMPICK_DEFAULTS;
  const MEDIA_PREFIX = 'media:';
  const PICKED = ['selected', 'submitted', 'done'];
  // 로그인은 아이디로 받고, Supabase에는 내부용 주소로 바꿔 전달 (이 주소로 메일을 보내지 않음)
  const toEmail = username => username.trim().toLowerCase() + '@id.chehumpick.kr';

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const day = ts => ymd(new Date(ts));

  const cache = { meId: null, users: [], campaigns: [], applications: [], picked: {}, settings: {}, resetRequests: [], reservePhones: {}, ownerPhones: {} };

  // 서버 오류 문구를 화면용 문구로 바꿈 (권한 규칙이 보낸 한글 문구는 그대로 사용)
  function fail(error) {
    const msg = (error && error.message) || '';
    if (/Invalid login credentials/i.test(msg)) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
    if (/already registered|already been registered/i.test(msg)) throw new Error('이미 사용 중인 아이디입니다.');
    if (/profiles_username_key|Database error saving new user/i.test(msg)) throw new Error('이미 사용 중인 아이디입니다.');
    if (/applications_campaign_id_user_id_key/.test(msg)) throw new Error('이미 신청한 체험단입니다.');
    if (/row-level security/i.test(msg)) throw new Error('권한이 없거나 지금은 처리할 수 없습니다.');
    if (/Failed to fetch|NetworkError/i.test(msg)) throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if (/exceeded the maximum allowed size/i.test(msg)) throw new Error('파일 용량이 너무 큽니다.');
    throw new Error(/[가-힣]/.test(msg) ? msg : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  const ok = res => { if (res.error) fail(res.error); return res.data; };

  const campaignImages = r => {
    const images = [r.image].concat(Array.isArray(r.images) ? r.images : []).filter(Boolean);
    return images.filter((url, index) => images.indexOf(url) === index);
  };
  const toCampaign = r => ({
    id: r.id, ownerId: r.owner_id, storeName: r.store_name, menu: r.menu, amount: r.amount, region: r.region,
    category: r.category, channel: r.channel, capacity: r.capacity, image: campaignImages(r)[0] || '', images: campaignImages(r), deadline: r.deadline,
    periodStart: r.period_start, periodEnd: r.period_end, visitStart: r.visit_start, visitEnd: r.visit_end,
    visitSchedule: r.visit_schedule || '', placeUrl: r.place_url || '',
    targetKeywords: Array.isArray(r.target_keywords) ? r.target_keywords.filter(Boolean).slice(0, 3) : [],
    description: r.description, conditions: r.conditions, status: r.status, approval: r.approval, cancelled: r.cancelled || 0, createdAt: day(r.created_at)
  });
  const fromCampaign = d => ({
    store_name: d.storeName, menu: d.menu, amount: d.amount, region: d.region, category: d.category,
    channel: d.channel, capacity: d.capacity, image: d.image, images: d.images, deadline: d.deadline,
    period_start: d.periodStart, period_end: d.periodEnd, visit_start: d.visitStart, visit_end: d.visitEnd,
    visit_schedule: d.visitSchedule, place_url: d.placeUrl, target_keywords: d.targetKeywords,
    description: d.description, conditions: d.conditions
  });
  const toApplication = r => ({
    id: r.id, campaignId: r.campaign_id, userId: r.user_id, status: r.status, reviewUrl: r.review_url, message: r.message || '', visitedAt: r.visited_at ? day(r.visited_at) : '',
    createdAt: day(r.created_at), updatedAt: day(r.updated_at)
  });

  // 서버에서 최신 데이터를 다시 받아 옴. 로그인 상태에 따라 볼 수 있는 범위만 내려옴
  async function refresh(options) {
    const allowPendingOwner = !!(options && options.allowPendingOwner);
    const { data: { session } } = await sb.auth.getSession();
    const uid = session ? session.user.id : null;
    const none = Promise.resolve({ data: [] });
    const [campaigns, picked, settings, profiles, contacts, applications] = await Promise.all([
      sb.from('campaigns').select('*'),
      sb.rpc('picked_counts'),
      sb.from('settings').select('*'),
      uid ? sb.from('profiles').select('*') : none,
      uid ? sb.from('contacts').select('*') : none,
      uid ? sb.from('applications').select('*') : none
    ]);
    cache.campaigns = ok(campaigns).map(toCampaign);
    cache.picked = {};
    ok(picked).forEach(p => { cache.picked[p.campaign_id] = Number(p.picked); });
    cache.settings = {};
    ok(settings).forEach(s => { cache.settings[s.key] = s.value; });
    const contactOf = {};
    ok(contacts).forEach(c => { contactOf[c.user_id] = c; });
    cache.users = ok(profiles).map(p => ({
      id: p.id, role: p.role, name: p.name, username: p.username, snsType: p.sns_type, snsUrl: p.sns_url, storeName: p.store_name,
      snsLinks: Array.isArray(p.sns_links) ? p.sns_links : [], paidUntil: p.paid_until || null, plan: p.plan || null,
      ownerApproved: p.owner_approved !== false,
      email: (contactOf[p.id] || {}).email, phone: (contactOf[p.id] || {}).phone, createdAt: day(p.created_at)
    }));
    cache.applications = ok(applications).map(toApplication);
    // 비밀번호 재설정 요청 (관리자에게만 내려옴)
    cache.resetRequests = uid ? ok(await sb.from('password_requests').select('user_id').eq('done', false)).map(r => r.user_id) : [];
    // 예약 연락처 (작성한 사장님, 관리자, 선정된 인플루언서에게만 내려옴)
    cache.reservePhones = {};
    if (uid) ok(await sb.from('campaign_contacts').select('*')).forEach(r => { cache.reservePhones[r.campaign_id] = r.phone; });
    // 사장님 휴대폰 번호 (작성한 사장님과 관리자에게만 내려옴)
    cache.ownerPhones = {};
    if (uid) ok(await sb.from('campaign_owner_contacts').select('*')).forEach(r => { cache.ownerPhones[r.campaign_id] = r.phone; });
    cache.meId = uid;
    // 관리자가 삭제한 계정 등 프로필이 없는 로그인은 정리
    const me = cache.users.find(u => u.id === uid);
    if (uid && !me) { await sb.auth.signOut(); cache.meId = null; }
    else if (uid && me.role === 'owner' && !me.ownerApproved && !allowPendingOwner) {
      await sb.auth.signOut();
      cache.meId = null;
    }
  }
  const done = async value => { await refresh(); return value; };

  async function dataUrlToBlob(dataUrl) { return (await fetch(dataUrl)).blob(); }
  async function upload(path, blob) {
    ok(await sb.storage.from('media').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' }));
    return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }
  const storagePath = url => { const m = /\/object\/public\/media\/(.+)$/.exec(url || ''); return m ? decodeURIComponent(m[1]) : null; };
  async function removeFile(url) {
    const path = storagePath(url);
    if (path) await sb.storage.from('media').remove([path]);
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  const Store = {
    today,
    init: refresh,
    refresh,

    /* ---------- 회원 ---------- */
    currentUser() { return cache.users.find(u => u.id === cache.meId) || null; },
    // role을 넘기면 해당 유형의 회원만 로그인 (관리자는 어느 쪽에서든 가능)
    async login(username, password, role) {
      ok(await sb.auth.signInWithPassword({ email: toEmail(username), password }));
      await refresh({ allowPendingOwner: true });
      const u = this.currentUser();
      if (!u) throw new Error('삭제되었거나 사용할 수 없는 계정입니다.');
      if (role && u.role !== 'admin' && u.role !== role) {
        await this.logout();
        throw new Error(u.role === 'owner' ? '사장님 계정입니다. "사장님으로 로그인"을 선택해 주세요.'
          : '인플루언서 계정입니다. "인플루언서로 로그인"을 선택해 주세요.');
      }
      if (u.role === 'owner' && !u.ownerApproved) {
        await this.logout();
        throw new Error('관리자 승인 대기 중인 사장님 계정입니다. 승인 후 로그인해 주세요.');
      }
      return u;
    },
    async logout() { await sb.auth.signOut(); await refresh(); },
    async signup(data) {
      if (!['influencer', 'owner'].includes(data.role)) throw new Error('회원 유형을 선택해 주세요.');
      const res = ok(await sb.auth.signUp({
        email: toEmail(data.username), password: data.password,
        options: { data: {
          role: data.role, name: data.name.trim(), phone: data.phone.trim(),
          snsType: data.snsType, snsUrl: (data.snsUrl || '').trim(), storeName: (data.storeName || '').trim()
        } }
      }));
      if (!res.session) throw new Error('가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.');
      await refresh({ allowPendingOwner: true });
      const u = this.currentUser();
      if (u && u.role === 'owner' && !u.ownerApproved) {
        await this.logout();
        return Object.assign({}, u, { pendingApproval: true });
      }
      return u;
    },
    users() { return cache.users.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
    user(id) { return cache.users.find(u => u.id === id) || null; },
    // 사장님 이용권: 관리자가 지정한 날짜까지 모집글 등록 가능
    isPaid(u) { return !!(u && u.paidUntil && u.paidUntil >= today()); },
    // 요금제(Standard/Pro)가 있고 이용 기간이 남은 사장님: 모집글이 승인 없이 바로 게시됨
    hasPlan(u) { return !!(u && u.plan && this.isPaid(u)); },
    // 관리자가 "승인 없이 바로 게시"를 켜 두었는지
    autoPost() { return this.settings().ownerAutoPost === 'on'; },
    // 관리자가 사장님 모집글 등록을 유료 요금제 이용자에게만 열어 두었는지
    paidMode() { return this.settings().ownerPaidMode === 'on'; },
    // 관리자가 새 사장님 계정을 가입 즉시 승인하도록 켜 두었는지
    ownerSignupAutoApprove() { return this.settings().ownerSignupAutoApprove === 'on'; },
    // 무료 운영 중이거나 유효한 요금제를 이용 중인 사장님만 새 모집글을 등록할 수 있음
    canCreateCampaign(u) { return !!(u && u.role === 'owner' && (!this.paidMode() || this.hasPlan(u))); },
    // 이 사장님의 새 모집글이 승인 없이 바로 게시되는지 (요금제 이용 중이거나 바로 게시 모드)
    postsDirect(u) { return !!(u && u.role === 'owner' && (this.hasPlan(u) || this.autoPost())); },
    async setPlan(id, plan, until) { ok(await sb.rpc('admin_set_plan', { target: id, new_plan: plan || null, until: until || null })); return done(); },
    async setOwnerApproval(id, approved) { ok(await sb.rpc('admin_set_owner_approval', { target: id, approved: !!approved })); return done(); },
    async setPaid(id, until) { ok(await sb.rpc('admin_set_paid', { target: id, until: until || null })); return done(); },
    async updateSns(links) { ok(await sb.rpc('update_my_sns', { links })); return done(); },
    // 내 이름·연락처(사장님은 매장명도) 수정
    async updateProfile(data) {
      ok(await sb.rpc('update_my_profile', { p_name: data.name, p_phone: data.phone, p_store_name: data.storeName || null }));
      return done();
    },
    // 현재 비밀번호를 확인한 뒤 새 비밀번호로 변경
    async changePassword(current, next) {
      const u = this.currentUser();
      const check = await sb.auth.signInWithPassword({ email: toEmail(u.username), password: current });
      if (check.error) throw new Error('현재 비밀번호가 올바르지 않습니다.');
      ok(await sb.auth.updateUser({ password: next }));
    },
    // 아이디 찾기: 이름과 연락처가 일치하는 아이디(일부 가림) 목록
    async findUsername(name, phone) { return ok(await sb.rpc('find_username', { p_name: name, p_phone: phone })); },
    async requestPasswordReset(username, name, phone) {
      ok(await sb.rpc('request_password_reset', { p_username: username, p_name: name, p_phone: phone }));
    },
    hasResetRequest(id) { return cache.resetRequests.includes(id); },
    async adminResetPassword(id, password) {
      ok(await sb.rpc('admin_reset_password', { target: id, new_password: password }));
      return done();
    },
    async deleteUser(id) { ok(await sb.rpc('admin_delete_user', { target: id })); return done(); },

    /* ---------- 모집글 ---------- */
    campaigns() { return cache.campaigns.slice().sort((a, b) => a.deadline.localeCompare(b.deadline)); },
    campaign(id) { return cache.campaigns.find(c => c.id === id) || null; },
    isOpen(c) { return c.approval === 'approved' && c.status === 'open' && c.deadline >= today(); },
    // 관리자가 등록 신청을 수락(approved)하거나 반려(rejected)
    async setApproval(id, approval) {
      ok(await sb.from('campaigns').update({ approval }).eq('id', id));
      return done();
    },
    pickedCount(campaignId) { return cache.picked[campaignId] || 0; },
    reservePhone(campaignId) { return cache.reservePhones[campaignId] || ''; },
    ownerPhone(campaignId) { return cache.ownerPhones[campaignId] || ''; },
    async saveCampaign(data, id) {
      const old = id ? this.campaign(id) : null;
      if (id && !old) throw new Error('모집글을 찾을 수 없습니다.');
      if (!old && !this.canCreateCampaign(this.currentUser())) {
        throw new Error('유료 운영 중입니다. 요금제를 신청한 뒤 모집글을 등록해 주세요.');
      }
      const sourceImages = (Array.isArray(data.images) ? data.images : [data.image]).filter(Boolean).slice(0, 10);
      const row = fromCampaign({ ...data, image: sourceImages[0] || '', images: sourceImages });
      const newlyUploaded = [];
      const savedImages = [];
      // 새로 고른 사진만 파일 저장소에 올리고, 기존 사진 주소는 그대로 유지
      try {
        for (const source of sourceImages) {
          if (/^data:/.test(source)) {
            const url = await upload(`campaigns/${cache.meId}/${newId()}.jpg`, await dataUrlToBlob(source));
            newlyUploaded.push(url);
            savedImages.push(url);
          } else {
            savedImages.push(source);
          }
        }
        row.images = savedImages;
        row.image = savedImages[0] || '';
      } catch (error) {
        await Promise.all(newlyUploaded.map(removeFile));
        throw error;
      }
      let saved;
      try {
        if (old) {
          if (old.approval === 'rejected' && old.ownerId === cache.meId) row.approval = 'pending';
          saved = ok(await sb.from('campaigns').update(row).eq('id', id).select().single());
        } else {
          row.owner_id = cache.meId;
          if (this.postsDirect(this.currentUser())) row.approval = 'approved'; // 요금제 사장님·바로 게시 모드는 바로 게시
          saved = ok(await sb.from('campaigns').insert(row).select().single());
        }
      } catch (error) {
        await Promise.all(newlyUploaded.map(removeFile));
        throw error;
      }
      // DB 저장이 끝난 뒤 빠진 이전 사진을 정리합니다. 정리 실패가 저장된 글과 새 사진을 깨뜨리면 안 됩니다.
      if (old) {
        const removed = old.images.filter(url => !savedImages.includes(url));
        await Promise.allSettled(removed.map(removeFile));
      }
      if (data.reservePhone) ok(await sb.from('campaign_contacts').upsert({ campaign_id: saved.id, phone: data.reservePhone }));
      if (data.ownerPhone) ok(await sb.from('campaign_owner_contacts').upsert({ campaign_id: saved.id, phone: data.ownerPhone }));
      return done(toCampaign(saved));
    },
    // 재모집: 새 모집 마감일로 다시 열기 (빈자리가 다 차면 자동으로 다시 마감됨)
    async reopenCampaign(id, deadline) {
      ok(await sb.from('campaigns').update({ status: 'open', deadline }).eq('id', id));
      return done();
    },
    async setCampaignStatus(id, status) {
      ok(await sb.from('campaigns').update({ status }).eq('id', id));
      return done();
    },
    async deleteCampaign(id) {
      const c = this.campaign(id);
      ok(await sb.from('campaigns').delete().eq('id', id));
      if (c) await Promise.all(c.images.map(removeFile));
      return done();
    },

    /* ---------- 신청 ---------- */
    applications() { return cache.applications.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    applicationsByUser(userId) { return this.applications().filter(a => a.userId === userId); },
    applicationsByCampaign(campaignId) { return this.applications().filter(a => a.campaignId === campaignId); },
    findApplication(campaignId, userId) {
      return cache.applications.find(a => a.campaignId === campaignId && a.userId === userId) || null;
    },
    async apply(campaignId, message) {
      const c = this.campaign(campaignId);
      if (!c || !this.isOpen(c)) throw new Error('모집이 마감된 체험단입니다.');
      ok(await sb.from('applications').insert({ campaign_id: campaignId, user_id: cache.meId, message: message || '' }));
      return done();
    },
    // 신청 취소: 리뷰 링크 제출 전(신청·선정 상태)인 내 신청만 지울 수 있음
    async cancelApplication(id) {
      const removed = ok(await sb.from('applications').delete().eq('id', id).in('status', ['applied', 'selected']).select('id'));
      await refresh();
      if (!removed.length) throw new Error('지금 상태에서는 취소할 수 없습니다. 고객센터로 문의해 주세요.');
    },
    // 체험권 사용 완료: 인플루언서 본인이 매장에서 체험을 받은 뒤 누름
    async markVisited(id) {
      ok(await sb.from('applications').update({ visited_at: new Date().toISOString() }).eq('id', id));
      return done();
    },
    async setApplicationStatus(id, status) {
      ok(await sb.from('applications').update({ status }).eq('id', id));
      return done();
    },
    // 선정 마감: 남은 신청을 미선정으로 처리하고 모집을 마감
    async closeSelection(campaignId) {
      ok(await sb.from('applications').update({ status: 'rejected' }).eq('campaign_id', campaignId).eq('status', 'applied'));
      ok(await sb.from('campaigns').update({ status: 'closed' }).eq('id', campaignId));
      return done();
    },
    async submitReview(id, url) {
      ok(await sb.from('applications').update({ status: 'submitted', review_url: url }).eq('id', id));
      return done();
    },

    /* ---------- 사이트 설정 ---------- */
    defaultSettings() { return Object.assign({}, DEFAULT_SETTINGS); },
    settings() {
      const s = Object.assign({}, DEFAULT_SETTINGS);
      Object.keys(DEFAULT_SETTINGS).forEach(k => { if (typeof cache.settings[k] === 'string') s[k] = cache.settings[k]; });
      return s;
    },
    // 기본값과 다른 항목만 서버에 저장하고, 기본값으로 돌아간 항목은 지움
    async saveSettings(values) {
      const changed = [], same = [];
      Object.keys(DEFAULT_SETTINGS).forEach(k => {
        if (typeof values[k] !== 'string') return;
        if (values[k] !== DEFAULT_SETTINGS[k]) changed.push({ key: k, value: values[k] });
        else same.push(k);
      });
      if (changed.length) ok(await sb.from('settings').upsert(changed));
      if (same.length) ok(await sb.from('settings').delete().in('key', same));
      return done();
    },
    async resetSettings() {
      ok(await sb.from('settings').delete().in('key', Object.keys(DEFAULT_SETTINGS)));
      return done();
    },

    /* ---------- 사이트 영상·사진 ---------- */
    media: {
      url: key => cache.settings[MEDIA_PREFIX + key] || null,
      async put(key, blob) {
        const ext = (blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
        const old = cache.settings[MEDIA_PREFIX + key];
        const url = await upload(`site/${key}-${Date.now()}.${ext}`, blob);
        ok(await sb.from('settings').upsert({ key: MEDIA_PREFIX + key, value: url }));
        await removeFile(old);
        return done();
      },
      async remove(key) {
        const old = cache.settings[MEDIA_PREFIX + key];
        ok(await sb.from('settings').delete().eq('key', MEDIA_PREFIX + key));
        await removeFile(old);
        return done();
      }
    }
  };

  window.Store = Store;
})();
