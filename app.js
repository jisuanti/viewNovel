// ================= 配置区 =================
const SUPABASE_URL = 'https://opzllintslozjchwjcjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wemxsaW50c2xvempjaHdqY2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NjQxNzksImV4cCI6MjEwOTA0MDE3OX0.jrPeGJqWj2oN4hiqjNoSfEsY-U2g06SSEOwmdK6PbAg';

let supabaseClient = null;
let currentUser = null;
let localStoriesCache = [];
let globalProfilesCache = {};
const DEFAULT_AVATAR = 'https://ui-avatars.com/api/?name=User&background=333&color=fff&size=128';
const IMG_HOST_HINT = 'https://img.remit.ee/image-to-url';

let _dragging = false;
let _linking = false;

// ================= 工具与安全 =================
function safeGetLocal(k){try{return localStorage.getItem(k)}catch(e){return null}}
function safeSetLocal(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function safeBind(id,e,f){const el=document.getElementById(id);if(el)el[e]=f}
function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function splitConditions(str) {
    if (str == null) return [];
    return String(str).split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
}

// ================= 玩法状态（跨章伏笔核心） =================
// vn_play_state: { [storyId]: { pendingEntry: '', vars: [] } }
// vn_resume_points: { [storyId]: { chapterId, nodeId, vars, pendingEntry, timestamp, title, cover, chapterTitle } }

function _loadStateMap() {
    try { return JSON.parse(localStorage.getItem('vn_play_state') || '{}') || {}; } catch(e) { return {}; }
}
function _saveStateMap(map) {
    try { localStorage.setItem('vn_play_state', JSON.stringify(map)); } catch(e) {}
}
function loadPlayState(storyId) {
    const map = _loadStateMap();
    const ps = map[storyId] || {};
    return {
        pendingEntry: typeof ps.pendingEntry === 'string' ? ps.pendingEntry : '',
        vars: Array.isArray(ps.vars) ? [...ps.vars] : []
    };
}
function savePlayState(storyId, state) {
    const map = _loadStateMap();
    map[storyId] = {
        pendingEntry: state.pendingEntry || '',
        vars: Array.isArray(state.vars) ? state.vars : []
    };
    _saveStateMap(map);
}
function clearPlayState(storyId) {
    const map = _loadStateMap();
    delete map[storyId];
    _saveStateMap(map);
}

function getResumePoints() {
    try { return JSON.parse(localStorage.getItem('vn_resume_points') || '{}') || {}; } catch(e) { return {}; }
}
function saveResumePoint(storyId, data) {
    try {
        const map = getResumePoints();
        map[storyId] = { ...data, timestamp: Date.now() };
        localStorage.setItem('vn_resume_points', JSON.stringify(map));
    } catch(e) {}
}
function clearResumePoint(storyId) {
    try {
        const map = getResumePoints();
        delete map[storyId];
        localStorage.setItem('vn_resume_points', JSON.stringify(map));
    } catch(e) {}
}

function formatTime(ts) {
    if (!ts || typeof ts !== 'number') return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff/60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff/86400000)} 天前`;
    const d = new Date(ts);
    return `${d.getMonth()+1}月${d.getDate()}日`;
}

// 把当前进度写入断点
function saveReadProgress() {
    if (!playStoryId || !playChap || !currNodeId) return;
    const s = getStories().find(x => x.id === playStoryId);
    if (!s) return;
    const ps = loadPlayState(playStoryId);
    ps.vars = [...currentVars];
    savePlayState(playStoryId, ps);
    saveResumePoint(playStoryId, {
        chapterId: playChap.id,
        nodeId: currNodeId,
        pendingEntry: ps.pendingEntry || '',
        vars: [...currentVars],
        title: s.title || '',
        cover: s.cover || '',
        chapterTitle: playChap.title || ''
    });
}

// ================= 作者显示 =================
function displayAuthorOf(story) {
    if (story && story.user_id && globalProfilesCache[story.user_id] && globalProfilesCache[story.user_id].username) {
        const p = globalProfilesCache[story.user_id];
        return { name: p.username, avatar: p.avatar_url || DEFAULT_AVATAR };
    }
    return { name: (story && story.author) || '未知', avatar: (story && story.author_avatar) || DEFAULT_AVATAR };
}

// ================= 初始化 =================
function initApp() {
    const statusEl = document.getElementById('cloud-status');
    let raw = safeGetLocal('vn_stories');
    if (raw) { try { localStoriesCache = JSON.parse(raw); } catch(e) {} }

    if (localStoriesCache.length === 0) {
        localStoriesCache = [getDefaultStory()];
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache));
    }

    const doRoute = () => {
        if (!window._initialRouted) {
            window._initialRouted = true;
            router();
        }
    };

    if (typeof window.supabase !== 'undefined') {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            if(statusEl) { statusEl.innerText = '连接云端中...'; statusEl.style.color = '#c0a062'; }
            checkSession().then(doRoute).catch(doRoute);
            setTimeout(doRoute, 3000);
        } catch(e) {
            if(statusEl) statusEl.innerText = '本地模式';
            doRoute();
        }
    } else {
        if(statusEl) statusEl.innerText = '本地模式';
        doRoute();
    }

    safeBind('confirm-ok-btn', 'onclick', handleConfirmOk);
}

function getDefaultStory() {
    let map = new Array(1600).fill('transparent');
    for (let y = 0; y < 40; y++) { for (let x = 0; x < 40; x++) { let idx = y * 40 + x; if (x < 20) map[idx] = '#2E8B57'; if (x >= 25) map[idx] = '#4682B4'; if (x >= 15 && x < 25 && y > 20) map[idx] = '#4682B4'; if (x >= 20 && x < 25 && y <= 20) map[idx] = '#2E8B57'; } }
    return { id: 'story_1793443325138', title: 'Rainative', author: '寒流偏暖', author_avatar: DEFAULT_AVATAR, intro: '...', status: 'private', cover: '...', tags: [], chapters: [], characters: [], plots: [], wiki: [], relationships: [], mapGrid: map, is_draft: true };
}

async function checkSession() {
    if(!supabaseClient) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) { currentUser = session.user; }

        const statusEl = document.getElementById('cloud-status');
        if(statusEl) { statusEl.innerText = '🟢 已连接云端'; statusEl.style.color = '#52c41a'; }

        try {
            const { data: profiles } = await supabaseClient.from('profiles').select('*');
            if (profiles) { profiles.forEach(p => { globalProfilesCache[p.id] = p; }); }
        } catch(e) {}

        updateAuthUI();
        syncOwnStoriesAuthor();
        await pullFromCloud();

        if (currentUser && (!globalProfilesCache[currentUser.id] || !globalProfilesCache[currentUser.id].username)) {
            openProfileModal(true);
        }

    } catch(e) {
        const statusEl = document.getElementById('cloud-status');
        if(statusEl) statusEl.innerText = '🔴 连接失败';
    }
}

// ================= 账号系统 =================
function openAuthModal() { const el = document.getElementById('auth-overlay'); if(el) el.classList.add('active'); }

async function handleAuth(type) {
    if(!supabaseClient) return showToast("云端未连接");
    const email = (document.getElementById('auth-email').value || '').trim();
    const password = document.getElementById('auth-password').value || '';
    if(!email || !password) return showToast("请填写完整的邮箱和密码");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast("❌ 邮箱格式不正确");
    if (password.length < 6) return showToast("❌ 密码至少需要 6 位");

    try {
        let res = type === 'login'
            ? await supabaseClient.auth.signInWithPassword({ email, password })
            : await supabaseClient.auth.signUp({ email, password });
        if (res.error) throw res.error;

        if (type === 'signup' && res.data && !res.data.session) {
            showToast("✅ 注册成功！请前往邮箱点击验证链接后再登录");
            document.getElementById('auth-overlay').classList.remove('active');
            return;
        }

        showToast(type === 'login' ? "登录成功" : "注册成功");
        document.getElementById('auth-overlay').classList.remove('active');

        if (res.data.user) {
            currentUser = res.data.user;
            updateAuthUI();
            await checkSession();
            if (type === 'signup') openProfileModal(true);
        }
    } catch(e) {
        console.error("Auth error:", e);
        const msg = (e && e.message) || String(e);
        if (msg.includes('Failed to fetch') || msg.toLowerCase().includes('network')) showToast("❌ 网络连接失败！请检查网络或开启代理/VPN");
        else if (msg.includes('Invalid login credentials')) showToast("❌ 邮箱或密码错误，或账号尚未注册");
        else if (msg.includes('Email not confirmed')) showToast("❌ 邮箱尚未验证，请先到邮箱点击验证链接");
        else if (msg.includes('already registered') || msg.includes('User already registered')) showToast("❌ 该邮箱已注册，请直接登录");
        else if (msg.includes('Password should be at least')) showToast("❌ 密码太短，请使用至少 6 位密码");
        else if (msg.includes('Signups not allowed')) showToast("❌ 该站点已关闭注册功能");
        else if (msg.includes('rate limit') || msg.includes('Email rate')) showToast("❌ 操作过于频繁，请稍后再试");
        else if (msg.includes('Unable to validate email')) showToast("❌ 邮箱格式不正确");
        else if (msg.includes('Error sending confirmation email')) showToast("❌ 验证邮件发送失败，请稍后重试");
        else showToast("❌ 操作失败：" + msg);
    }
}

async function handleLogout() {
    if(supabaseClient) await supabaseClient.auth.signOut();
    currentUser = null;
    document.getElementById('user-profile-area').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('auth-btn').style.display = 'block';
    document.getElementById('profile-overlay').classList.remove('active');
    renderWorkspace(); await pullFromCloud();
    showToast("已退出登录");
}

function updateAuthUI() {
    if (currentUser) {
        document.getElementById('auth-btn').style.display = 'none';
        document.getElementById('user-profile-area').style.display = 'flex';
        document.getElementById('logout-btn').style.display = 'block';

        const profile = globalProfilesCache[currentUser.id];
        const savedAvatar = (profile && profile.avatar_url) ? profile.avatar_url : (safeGetLocal('user_avatar_' + currentUser.id) || DEFAULT_AVATAR);
        const savedName = (profile && profile.username) ? profile.username : (safeGetLocal('user_name_' + currentUser.id) || '未命名用户');

        document.getElementById('nav-avatar').src = savedAvatar;
        document.getElementById('nav-username').innerText = savedName;
    } else {
        document.getElementById('user-profile-area').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
        document.getElementById('auth-btn').style.display = 'block';
    }
}

function openProfileModal(isForced = false) {
    if (currentUser) {
        const profile = globalProfilesCache[currentUser.id];
        const currentName = profile ? profile.username : safeGetLocal('user_name_' + currentUser.id);
        const currentAvatar = profile ? profile.avatar_url : safeGetLocal('user_avatar_' + currentUser.id);
        const currentBio = profile ? profile.bio : safeGetLocal('user_bio_' + currentUser.id);

        document.getElementById('profile-name-input').value = currentName || '';
        document.getElementById('profile-avatar-input').value = currentAvatar || '';
        document.getElementById('profile-bio-input').value = currentBio || '';
        document.getElementById('profile-avatar').src = currentAvatar || DEFAULT_AVATAR;
    }

    const titleEl = document.getElementById('profile-modal-title');
    const cancelBtn = document.getElementById('profile-cancel-btn');

    if (isForced) {
        titleEl.innerText = '🎉 欢迎加入！请完善您的资料';
        cancelBtn.style.display = 'none';
    } else {
        titleEl.innerText = '编辑个人资料';
        cancelBtn.style.display = 'block';
    }

    document.getElementById('profile-overlay').classList.add('active');
}

async function saveProfile() {
    const newName = document.getElementById('profile-name-input').value.trim();
    let newAvatar = document.getElementById('profile-avatar-input').value.trim();
    const newBio = document.getElementById('profile-bio-input').value.trim();

    if (!newName) return showToast("昵称不能为空！");
    if (!currentUser) return;

    if (!newAvatar) newAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=random&color=fff&size=128`;

    safeSetLocal('user_name_' + currentUser.id, newName);
    safeSetLocal('user_avatar_' + currentUser.id, newAvatar);
    safeSetLocal('user_bio_' + currentUser.id, newBio);

    const stories = getStories();
    stories.forEach(s => {
        if (s.user_id === currentUser.id) { s.author = newName; s.author_avatar = newAvatar; }
    });
    saveStories(stories);

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient.from('profiles').upsert({
                id: currentUser.id, username: newName, avatar_url: newAvatar, bio: newBio, updated_at: new Date().toISOString()
            });
            if (error) throw error;
            globalProfilesCache[currentUser.id] = { username: newName, avatar_url: newAvatar, bio: newBio };
            showToast("资料已保存");
            document.getElementById('profile-overlay').classList.remove('active');
        } catch (e) {
            console.error("保存资料失败:", e);
            showToast("❌ 保存失败：" + (e.message || '请检查网络或数据库权限'));
            return; 
        }
    }

    updateAuthUI();
    if (window.location.hash.startsWith('#profile/')) renderProfilePage();
}

function syncOwnStoriesAuthor() {
    if (!currentUser) return;
    const p = globalProfilesCache[currentUser.id];
    const name   = (p && p.username)   ? p.username   : safeGetLocal('user_name_'   + currentUser.id);
    const avatar = (p && p.avatar_url) ? p.avatar_url : safeGetLocal('user_avatar_' + currentUser.id);
    if (!name) return;

    const stories = getStories();
    let changed = false;
    stories.forEach(s => {
        if (s.user_id === currentUser.id && (s.author !== name || s.author_avatar !== (avatar || DEFAULT_AVATAR))) {
            s.author = name;
            s.author_avatar = avatar || DEFAULT_AVATAR;
            changed = true;
        }
    });
    if (changed) saveStories(stories);
}

async function renderProfilePage() {
    const parts = window.location.hash.split('/');
    let targetId = parts[1];
    if(targetId === 'me' && currentUser) targetId = currentUser.id;
    if(!targetId) return location.hash = '#workspace';

    const isMe = currentUser && targetId === currentUser.id;
    document.getElementById('btn-follow').style.display = (isMe || !currentUser) ? 'none' : 'block';
    document.getElementById('btn-edit-profile').style.display = isMe ? 'block' : 'none';

    let userName = '未知用户';
    let userAvatar = DEFAULT_AVATAR;
    let userBio = '这个人很懒，什么都没有留下。';

    if (globalProfilesCache[targetId] && globalProfilesCache[targetId].username) {
        userName = globalProfilesCache[targetId].username;
        userAvatar = globalProfilesCache[targetId].avatar_url || DEFAULT_AVATAR;
        if (globalProfilesCache[targetId].bio) userBio = globalProfilesCache[targetId].bio;
    } else if (isMe) {
        userName = safeGetLocal('user_name_' + targetId) || '未命名用户';
        userAvatar = safeGetLocal('user_avatar_' + targetId) || DEFAULT_AVATAR;
        userBio = safeGetLocal('user_bio_' + targetId) || '这个人很懒，什么都没有留下。';
    } else {
        const authorStories = localStoriesCache.filter(s => s.user_id === targetId);
        if (authorStories.length > 0) {
            userName = authorStories[0].author || '未命名作者';
            userAvatar = authorStories[0].author_avatar || DEFAULT_AVATAR;
        }
    }

    document.getElementById('prof-big-avatar').src = userAvatar;
    document.getElementById('prof-big-name').innerText = userName;
    document.getElementById('prof-bio').innerText = userBio;

    const works = localStoriesCache.filter(s => (s.user_id === targetId && s.status === 'public') || (isMe && s.user_id === targetId));
    document.getElementById('prof-works-list').innerHTML = works.map(s => `
        <div class="story-card" onclick="location.hash = '#detail/${s.id}'">
            <img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
            <div class="card-info"><h3>${escapeHtml(s.title)}</h3><p>${s.status === 'public' ? '公开' : '私密'}</p></div>
        </div>
    `).join('') || '<div style="color:#888;">暂无作品</div>';

    // ===== 最近观看记录（仅自己） =====
    const recentSection = document.getElementById('prof-recent-section');
    const recentList = document.getElementById('prof-recent-list');
    if (recentSection && recentList) {
        if (isMe) {
            const pts = getResumePoints();
            const recent = Object.entries(pts)
                .map(([id, rp]) => {
                    const story = getStories().find(s => s.id === id);
                    return (story && rp && rp.chapterId && rp.timestamp) ? { id, rp, story } : null;
                })
                .filter(Boolean)
                .sort((a, b) => (b.rp.timestamp || 0) - (a.rp.timestamp || 0))
                .slice(0, 12);
            if (recent.length > 0) {
                recentSection.style.display = 'block';
                recentList.innerHTML = recent.map(({id, rp, story}) => `
                    <div class="story-card" onclick="resumeFromProfile('${id}')" style="position:relative;">
                        <img src="${story.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
                        <div class="card-info">
                            <h3 style="font-size:1rem;">${escapeHtml(story.title)}</h3>
                            <p style="color:#c0a062; font-size:0.8rem;">📖 ${escapeHtml(rp.chapterTitle || '未知章节')}</p>
                            <p style="color:#666; font-size:0.7rem; margin-top:4px;">${formatTime(rp.timestamp)}</p>
                        </div>
                    </div>
                `).join('');
            } else {
                recentSection.style.display = 'none';
            }
        } else {
            recentSection.style.display = 'none';
        }
    }

    if (supabaseClient) {
        try {
            const { count: f1 } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetId);
            const { count: f2 } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', targetId);
            document.getElementById('prof-following').innerText = f1 || 0;
            document.getElementById('prof-followers').innerText = f2 || 0;

            if (!isMe && currentUser) {
                const { data } = await supabaseClient.from('follows').select('*').eq('follower_id', currentUser.id).eq('following_id', targetId).maybeSingle();
                document.getElementById('btn-follow').innerText = data ? '取消关注' : '关注';
            }
        } catch(e) {}
    }
}

function resumeFromProfile(storyId) {
    const pts = getResumePoints();
    const rp = pts[storyId];
    if (!rp || !rp.chapterId || !rp.nodeId) {
        location.hash = `#detail/${storyId}`;
        return;
    }
    window._pendingResume = rp;
    location.hash = `#play/${storyId}/${rp.chapterId}`;
}

async function toggleFollow() {
    if(!currentUser) return showToast("请先登录");
    const targetId = window.location.hash.split('/')[1];
    const btn = document.getElementById('btn-follow');
    const isFollowing = btn.innerText === '取消关注';

    if (isFollowing) { await supabaseClient.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', targetId); showToast("已取消"); }
    else { await supabaseClient.from('follows').insert({ follower_id: currentUser.id, following_id: targetId }); showToast("已关注"); }
    renderProfilePage();
}

// ================= 云端同步 =================
async function pullFromCloud() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('stories').select('*');
        if (error) throw error;
        const cloudStories = data.map(s => ({
            id: s.id, title: s.title, author: s.author, author_avatar: s.author_avatar || DEFAULT_AVATAR, intro: s.intro, status: s.status, cover: s.cover,
            tags: s.tags || [], chapters: s.chapters || [], characters: s.characters || [], plots: s.plots || [],
            wiki: s.wiki || [], relationships: s.relationships || [], mapGrid: s.map_grid || new Array(1600).fill('transparent'),
            is_draft: false, user_id: s.user_id
        }));
        let newCache = [];
        cloudStories.forEach(cs => newCache.push(cs));
        localStoriesCache.forEach(ls => { if (!newCache.find(c => c.id === ls.id)) newCache.push(ls); });
        localStoriesCache = newCache;
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache));

        const hash = window.location.hash;
        if(hash === '' || hash === '#workspace') renderWorkspace();
        else if(hash === '#square') renderSquare();
        else if(hash.startsWith('#profile/')) renderProfilePage();
    } catch(e) {}
}

async function uploadToCloud(storyId) {
    if (!currentUser || !supabaseClient) return showToast("请登录");
    const story = localStoriesCache.find(s => s.id === storyId); if (!story) return;

    const dataSize = new Blob([JSON.stringify(story)]).size;
    if (dataSize > 4 * 1024 * 1024) return showToast("❌ 作品数据过大(超过4MB)，请减少节点里的本地图片或BGM！");

    const p = globalProfilesCache[currentUser.id];
    story.author        = (p && p.username)   ? p.username   : (safeGetLocal('user_name_'   + currentUser.id) || '未命名用户');
    story.author_avatar = (p && p.avatar_url) ? p.avatar_url : (safeGetLocal('user_avatar_' + currentUser.id) || DEFAULT_AVATAR);
    story.user_id       = currentUser.id;

    showToast("上传中...");
    try {
        const { error } = await supabaseClient.from('stories').upsert({
            id: story.id, title: story.title, author: story.author, author_avatar: story.author_avatar, intro: story.intro, status: story.status, cover: story.cover,
            tags: story.tags, chapters: story.chapters, characters: story.characters, plots: story.plots, wiki: story.wiki, relationships: story.relationships, map_grid: story.mapGrid,
            user_id: currentUser.id, is_draft: false
        }, { onConflict: 'id' });
        if (error) throw error;
        story.is_draft = false;
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache)); 
        renderWorkspace(); 
        showToast("已发布到云端");
    } catch(e) { 
        console.error(e);
        if (e.message.includes('Failed to fetch')) showToast("❌ 网络连接失败！请检查网络或开启代理");
        else if (e.message.includes('row-level security')) showToast("❌ 权限不足：请在Supabase允许修改stories表");
        else showToast("❌ 上传失败：" + e.message); 
    }
}

// ================= 路由与核心 =================
let currentManageId = null, currentChapterId = null, currentDetailStory = null;
let _lastRoutedHash = '';

function router() {
    const hash = window.location.hash || '#workspace';

    window._prevHash = _lastRoutedHash;
    _lastRoutedHash = hash;

    const parts = hash.split('/');
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
    const showView = (id) => { const el = document.getElementById(id); if (el) { el.classList.add('active'); el.style.display = 'block'; window.scrollTo(0, 0); } };

    const globalHeader = document.getElementById('global-header');
    if (globalHeader) globalHeader.style.display = (parts[0] === '#play') ? 'none' : 'flex';

    const navBtn = document.getElementById('nav-square-btn');
    if (navBtn) {
        if (parts[0] === '#square') { navBtn.innerText = '返回工作台'; navBtn.onclick = () => location.hash = '#workspace'; }
        else { navBtn.innerText = '故事广场'; navBtn.onclick = () => location.hash = '#square'; }
    }

    if (parts[0] === '#workspace') { showView('view-workspace'); renderWorkspace(); }
    else if (parts[0] === '#square') { showView('view-square'); renderSquare(); }
    else if (parts[0] === '#profile') { showView('view-profile'); renderProfilePage(); }
    else if (parts[0] === '#manage') {
        currentManageId = parts[1];
        const story = localStoriesCache.find(s => s.id === currentManageId);
        if (!story) { showToast("不存在"); return location.hash = '#workspace'; }

        const isMine = currentUser && story.user_id === currentUser.id;
        if (!isMine && story.user_id) { showToast("无权限修改他人作品"); return location.hash = `#detail/${story.id}`; }

        if (parts[2] === 'node-editor') { currentChapterId = parts[3]; showView('view-node-editor'); renderNodeEditor(); }
        else if (parts[2]) { showView('view-' + parts[2]); renderManageSubPage(parts[2]); }
        else { showView('view-manage'); renderManageMain(); }
    }
    else if (parts[0] === '#detail') { currentDetailStory = localStoriesCache.find(s => s.id === parts[1]); showView('view-detail'); renderDetail(parts[1]); }
    else if (parts[0] === '#play') { showView('view-player'); startPlayer(parts[1], parts[2]); }
}
window.addEventListener('hashchange', router); window.addEventListener('load', initApp);

// ================= 工作台与广场 =================
let toastTimer;
function showToast(msg) { const t = document.getElementById('toast'); if(!t) return; document.getElementById('toast-text').innerText = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000); }

function openModal(title, html, cb) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('active');
    const btn = document.getElementById('modal-confirm-btn');
    btn.innerText = '确定';
    btn.onclick = async () => {
        try {
            const r = await cb();
            if (r === false) return;
        } catch(e) {
            console.error(e);
            showToast("操作失败：" + (e && e.message ? e.message : e));
        }
        closeModal();
    };
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('active'); }

// 确认弹窗：支持"确定"和"取消"各自回调
let confirmCallback = null;
let confirmCancelCallback = null;

function showConfirm(title, msg, cb, cancelCb) { 
    document.getElementById('confirm-title').innerText = title; 
    document.getElementById('confirm-msg').innerText = msg; 
    document.getElementById('confirm-overlay').classList.add('active'); 
    confirmCallback = cb || null; 
    confirmCancelCallback = cancelCb || null;
}

async function handleConfirmOk() {
    const cb = confirmCallback;
    document.getElementById('confirm-overlay').classList.remove('active');
    confirmCallback = null;
    confirmCancelCallback = null;
    if (cb) {
        try { await cb(); } catch(e) { console.error(e); }
    }
}
function handleConfirmCancel() {
    const cb = confirmCancelCallback;
    document.getElementById('confirm-overlay').classList.remove('active');
    confirmCallback = null;
    confirmCancelCallback = null;
    if (cb) {
        try { cb(); } catch(e) { console.error(e); }
    }
}
function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('active'); confirmCallback = null; confirmCancelCallback = null; }

const getStories = () => localStoriesCache;
const saveStories = (data) => { if (!Array.isArray(data)) return; localStoriesCache = data; safeSetLocal('vn_stories', JSON.stringify(localStoriesCache)); };

function renderWorkspace() {
    const container = document.getElementById('workspace-list');
    if (!container) return;
    if (localStoriesCache.length === 0) { container.innerHTML = '<div style="color:#888; padding:50px; text-align:center; width:100%;">暂无数据。尝试创建或从云端拉取。</div>'; return; }

    container.innerHTML = localStoriesCache.map(s => {
        const isMine = currentUser && s.user_id === currentUser.id;
        const isUnbound = !s.user_id;
        const au = displayAuthorOf(s);

        let syncStatus = '';
        if (isMine) { syncStatus = s.is_draft ? '<span style="color:#c0a062;"> [本地草稿]</span>' : '<span style="color:#52c41a;"> [已发布]</span>'; }
        else if (isUnbound) { syncStatus = '<span style="color:#c0a062;"> [本地私密]</span>'; }
        else { syncStatus = '<span style="color:#52c41a;"> [云端作品]</span>'; }

        let uploadBtn = '';
        if (isMine || isUnbound) {
            if (currentUser) { uploadBtn = `<button class="btn-gold" style="position:absolute; bottom:10px; right:10px; font-size:0.8rem; padding:5px 10px;" onclick="event.stopPropagation(); uploadToCloud('${s.id}')">☁️ ${isUnbound?'绑定并发布':'更新'}</button>`; }
            else { uploadBtn = `<button class="btn-gold" style="position:absolute; bottom:10px; right:10px; font-size:0.8rem; padding:5px 10px; background:#666;" onclick="event.stopPropagation(); showToast('请先登录');">登录后发布</button>`; }
        }

        const canManage = isMine || isUnbound;
        const targetHash = canManage ? `#manage/${s.id}` : `#detail/${s.id}`;
        return `
        <div class="story-card" style="position:relative;" onclick="location.hash = '${targetHash}'">
            <img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
            <div class="card-info"><h3>${escapeHtml(s.title)} ${syncStatus}</h3><p>作者：${escapeHtml(au.name)}</p></div>
            ${uploadBtn}
        </div>`;
    }).join('');
}

function renderSquare() {
    const list = localStoriesCache.filter(s => s.is_draft === false && s.status === 'public');
    const el = document.getElementById('story-list');
    if(el) {
        el.innerHTML = list.map(s => {
            const au = displayAuthorOf(s);
            return `
            <div class="story-card" onclick="location.hash = '#detail/${s.id}'">
                <img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
                <div class="card-info"><h3>${escapeHtml(s.title)}</h3><p>作者：${escapeHtml(au.name)}</p></div>
            </div>`;
        }).join('') || '<div style="color:#888; padding:50px;">广场空空如也，快去发布你的作品吧！</div>';
    }
}

// ================= 故事管理 =================
function renderManageMain() {
    const story = getStories().find(s => s.id === currentManageId); if (!story) return location.hash = '#workspace';
    document.getElementById('manage-title').innerText = story.title || '未命名';
    document.getElementById('manage-subtitle').innerText = story.intro || '';
    document.getElementById('manage-meta').innerText = `${story.chapters?.length || 0} 章 · ${story.characters?.length || 0} 个角色`;
    document.querySelectorAll('#status-toggle span').forEach(span => { span.classList.toggle('active', span.dataset.status === (story.status || 'private')); });
}

function changeStatus(newStatus) {
    const stories = getStories(); const story = stories.find(s => s.id === currentManageId);
    if(!story) return; story.status = newStatus; saveStories(stories); renderManageMain();
}

function deleteStory() {
    showConfirm("删除小说", "确定要删除这本小说吗？删除后无法恢复。", async () => {
        const story = getStories().find(s => s.id === currentManageId);
        if (!story) return;

        if (supabaseClient) {
            showToast("正在清理云端数据...");
            try {
                const { error } = await supabaseClient.from('stories').delete().eq('id', story.id);
                if (error) throw error;
            } catch (e) {
                console.error("cloud delete failed:", e);
                showToast("云端删除失败：" + (e.message || '请检查 Supabase 的 DELETE 权限') + "（本地已保留）");
                return;
            }
        }

        const stories = getStories();
        const newStories = stories.filter(s => s.id !== story.id);
        saveStories(newStories);
        clearPlayState(story.id);
        clearResumePoint(story.id);
        location.hash = '#workspace';
        showToast("已彻底删除");
    });
}

function renderManageSubPage(page) {
    const story = getStories().find(s => s.id === currentManageId); if (!story) return;
    if (page === 'chapters') {
        const list = story.chapters || [];
        document.getElementById('chapter-list').innerHTML = list.length ? list.map(c => `
            <div class="list-item"><div class="list-item-content"><h4>${escapeHtml(c.title)}</h4></div>
            <div class="list-item-actions"><button class="text-btn" onclick="location.hash = '#manage/${currentManageId}/node-editor/${c.id}'">编辑</button><button class="text-btn" style="color:#d9534f; margin-left:10px;" onclick="deleteItem('chapters', '${c.id}')">删除</button></div></div>
        `).join('') : `<div style="text-align:center;color:#888;padding:50px;">暂无章节</div>`;
    } else if (page === 'characters') {
        switchCharTab('list');
        let changed = false;
        story.characters = (story.characters || []).map(c => {
            if (typeof c === 'string') { changed = true; return { id: 'char_' + Date.now(), name: c, desc: '', sprites: [] }; }
            if (!Array.isArray(c.sprites)) { c.sprites = []; changed = true; }
            return c;
        });
        if (changed) { saveStories(getStories()); }
        document.getElementById('char-count').innerText = `${story.characters.length} 个角色`;
        document.getElementById('char-content-list').innerHTML = story.characters.length ? story.characters.map(c => `
            <div class="list-item">
                <div class="list-item-content">
                    <h4>${escapeHtml(c.name)}</h4>
                    <p>${escapeHtml(c.desc || '暂无')}</p>
                    <p style="color:#888;font-size:0.85rem;margin-top:5px;">立绘：${(c.sprites||[]).length} 张</p>
                </div>
                <div class="list-item-actions">
                    <button class="text-btn" onclick="openSpriteManager('${c.id}')">🖼️ 立绘</button>
                    <button class="text-btn" style="color:#d9534f; margin-left:10px;" onclick="deleteItem('characters', '${c.id}')">删除</button>
                </div>
            </div>
        `).join('') : `<div style="text-align:center;padding:50px;">暂无角色</div>`;
    } else if (page === 'plots') {
        const list = story.plots || [];
        document.getElementById('plot-content-list').innerHTML = list.length ? list.map(p => `
            <div class="list-item"><div class="list-item-content"><h4>${escapeHtml(p.title)}</h4><p>${escapeHtml(p.desc || '')}</p></div><div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('plots', '${p.id}')">删除</button></div></div>
        `).join('') : `<div style="text-align:center;padding:50px;">暂无节点</div>`;
    } else if (page === 'wiki') {
        const list = story.wiki || [];
        document.getElementById('wiki-count').innerText = `共 ${list.length} 个词条`;
        document.getElementById('wiki-list').innerHTML = list.length ? list.map(w => `
            <div class="list-item"><div class="list-item-content"><h4>${escapeHtml(w.term)}</h4><p>${escapeHtml(w.content)}</p></div><div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('wiki', '${w.id}')">删除</button></div></div>
        `).join('') : `<div style="text-align:center;padding:50px;">暂无词条</div>`;
    } else if (page === 'edit') {
        document.getElementById('edit-title').value = story.title || '';
        document.getElementById('edit-intro').value = story.intro || '';
        document.getElementById('edit-tags').value = (story.tags || []).join('，');
        document.getElementById('edit-cover').value = story.cover || '';
    }
}

function goTo(sub) { window.location.hash = `#manage/${currentManageId}/${sub}`; }
function deleteItem(type, id) {
    showConfirm("删除确认", "确定要删除吗？", () => {
        const stories = getStories(); const story = stories.find(s => s.id === currentManageId); if(!story) return;
        story[type] = story[type].filter(item => String(item.id) !== String(id)); saveStories(stories); router();
    });
}

// ================= 角色立绘管理 =================
let currentSpriteCharId = null;

function openSpriteManager(charId) { currentSpriteCharId = charId; renderSpriteManager(); }

function renderSpriteManager() {
    const story = getStories().find(s => s.id === currentManageId);
    if (!story) return;
    const char = story.characters.find(c => c.id === currentSpriteCharId);
    if (!char) return;
    if (!Array.isArray(char.sprites)) char.sprites = [];

    const listHtml = char.sprites.length ? char.sprites.map(sp => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px; border:1px solid #444; border-radius:8px; margin-bottom:8px;">
            <img src="${sp.url}" style="width:56px; height:56px; object-fit:contain; border-radius:6px; background:#000;">
            <div style="flex:1; min-width:0;">
                <div style="color:#fff; font-weight:bold; font-size:0.95rem;">${escapeHtml(sp.name)}</div>
                <div style="color:#888; font-size:0.75rem; word-break:break-all;">${sp.url.startsWith('data:') ? '本地文件 (Base64)' : escapeHtml(sp.url.substring(0, 60)) + (sp.url.length > 60 ? '...' : '')}</div>
            </div>
            <button class="text-btn" style="color:#d9534f; flex-shrink:0;" onclick="deleteSprite('${sp.id}')">删除</button>
        </div>
    `).join('') : '<div style="color:#888; text-align:center; padding:15px;">暂无立绘，去下面添加吧</div>';

    const html = `
        <div style="max-height:60vh; overflow-y:auto; padding-right:5px;">
            <div style="margin-bottom:15px;">
                <h4 style="color:#c0a062; margin-bottom:10px;">${escapeHtml(char.name)} 的立绘（${char.sprites.length} 张）</h4>
                <div>${listHtml}</div>
            </div>
            <div style="border-top:1px solid #444; padding-top:15px;">
                <h4 style="color:#c0a062; margin-bottom:10px;">添加新立绘</h4>
                <div class="form-group"><label>立绘名称（如：正常、哭脸）</label><input type="text" id="sprite-name-input" placeholder="例如：哭脸"></div>
                <div class="form-group">
                    <label>图片链接（URL）</label>
                    <p style="color:#c0a062; font-size:0.8rem; margin-bottom:6px;">
                        💡 可在 <a href="${IMG_HOST_HINT}" target="_blank" style="color:#6cf; text-decoration:underline;">${IMG_HOST_HINT}</a> 上传图片获取直链
                    </p>
                    <input type="text" id="sprite-url-input" placeholder="https://...">
                </div>
                <div class="form-group">
                    <label>或上传本地图片${currentUser ? '' : '（未登录时以 Base64 存储在本地，建议使用 URL）'}</label>
                    <input type="file" id="sprite-file-input" accept="image/*" style="width:100%;">
                </div>
                <div id="sprite-preview-area" style="text-align:center; margin:10px 0; min-height:0;"></div>
                <button class="btn-gold" style="width:100%; padding:10px;" onclick="addSprite()">➕ 添加立绘</button>
            </div>
        </div>
    `;

    document.getElementById('modal-title').innerText = '立绘管理';
    document.getElementById('modal-content').innerHTML = html;
    const btn = document.getElementById('modal-confirm-btn');
    btn.innerText = '完成';
    btn.onclick = () => closeModal();
    document.getElementById('modal-overlay').classList.add('active');

    const fileInput = document.getElementById('sprite-file-input');
    if (fileInput) {
        fileInput.onchange = () => {
            const f = fileInput.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = e => {
                const prev = document.getElementById('sprite-preview-area');
                if (prev) prev.innerHTML = `<img src="${e.target.result}" style="max-width:120px; max-height:120px; border-radius:8px; border:1px solid #444;">`;
            };
            r.readAsDataURL(f);
        };
    }
}

async function addSprite() {
    const name = document.getElementById('sprite-name-input').value.trim();
    let url = document.getElementById('sprite-url-input').value.trim();
    const fileInput = document.getElementById('sprite-file-input');

    if (!name) return showToast("请填写立绘名称");

    const story = getStories().find(s => s.id === currentManageId);
    const char = story && story.characters.find(c => c.id === currentSpriteCharId);
    if (!char) return;

    if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (supabaseClient && currentUser) {
            showToast("上传中...");
            try {
                const rawName = file.name;
                const ext = rawName.substring(rawName.lastIndexOf('.'));
                const baseName = rawName.substring(0, rawName.lastIndexOf('.'));
                const safeBase = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_');
                const safeFileName = safeBase + ext;

                const { data, error } = await supabaseClient.storage.from('audio').upload(`sprite_${Date.now()}_${safeFileName}`, file);
                if (error) throw error;
                url = supabaseClient.storage.from('audio').getPublicUrl(data.path).data.publicUrl;
                showToast("立绘上传成功");
            } catch (e) {
                showToast("上传失败：" + (e.message || '请检查 storage 桶 "audio" 是否已创建且允许上传'));
                return;
            }
        } else {
            url = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = ev => resolve(ev.target.result);
                r.onerror = reject;
                r.readAsDataURL(file);
            });
            if (url.length > 3 * 1024 * 1024) return showToast("图片过大（>3MB），请登录后上传或填写图片 URL");
        }
    }

    if (!url) return showToast("请填写图片链接或上传文件");

    char.sprites = char.sprites || [];
    char.sprites.push({ id: 'sprite_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name, url });
    saveStories(getStories());
    renderSpriteManager();
    showToast("已添加立绘");
}

function deleteSprite(spriteId) {
    const story = getStories().find(s => s.id === currentManageId);
    const char = story && story.characters.find(c => c.id === currentSpriteCharId);
    if (!char || !char.sprites) return;
    char.sprites = char.sprites.filter(s => s.id !== spriteId);
    saveStories(getStories());
    renderSpriteManager();
    showToast("已删除立绘");
}

// ================= 详情页 =================
function goBackFromDetail() {
    const prev = window._prevHash || '';
    if (prev && !prev.startsWith('#play') && !prev.startsWith('#detail')) location.hash = prev;
    else location.hash = '#workspace';
}
function goToAuthorProfile() {
    if(currentDetailStory && currentDetailStory.user_id) window.location.hash = `#profile/${currentDetailStory.user_id}`;
    else showToast("该作者未绑定账号");
}

function renderDetail(id) {
    const story = getStories().find(s => s.id === id); if (!story) return;
    const au = displayAuthorOf(story);
    document.getElementById('detail-cover').src = story.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop';
    document.getElementById('detail-title').innerText = story.title;
    document.getElementById('detail-author').innerText = `作者：${au.name}`;
    document.getElementById('detail-tags').innerHTML = (story.tags || []).map(t => `<span>${escapeHtml(t)}</span>`).join('');
    document.getElementById('detail-intro').innerText = story.intro || '';

    const area = document.getElementById('detail-wiki-area'); area.innerHTML = '';
    const wikiList = story.wiki || [];
    if (wikiList.length === 0) {
        area.innerHTML = '<div style="color:#666;">暂无词条</div>';
    } else {
        wikiList.forEach(w => {
            let isUnlocked = true;
            if (w.unlockChapter) { try { isUnlocked = JSON.parse(safeGetLocal('vn_read_history') || '[]').includes(w.unlockChapter); } catch(e){} }
            if (isUnlocked) {
                area.innerHTML += `<div style="background:#1e1e24; border:1px solid #333; border-radius:8px; padding:15px; min-width:200px; flex:1 1 200px;"><h4 style="color:#c0a062; margin-bottom:8px;">${escapeHtml(w.term)}</h4><p style="color:#ccc; font-size:0.9rem; line-height:1.5;">${escapeHtml(w.content)}</p></div>`;
            } else {
                area.innerHTML += `<div style="background:#111; border:1px dashed #333; border-radius:8px; padding:15px; min-width:200px; flex:1 1 200px; display:flex; align-items:center; justify-content:center; color:#666;">🔒 阅读特定章节后解锁</div>`;
            }
        });
    }

    const mapArea = document.getElementById('detail-map-area');
    if (story.mapGrid && story.mapGrid.some(c => c !== 'transparent')) {
        let gridHtml = `<div style="display:grid; grid-template-columns:repeat(40, 1fr); grid-template-rows:repeat(40, 1fr); width:100%; aspect-ratio:1/1; position:relative; background:#1a1a24;">`;
        story.mapGrid.forEach(color => { gridHtml += `<div style="background:${color}; width:100%; height:100%; border: 1px solid rgba(255,255,255,0.01);"></div>`; });
        gridHtml += `</div>`;
        (story.plots || []).forEach(p => {
            gridHtml += `<div class="map-pin-detail" style="position:absolute; left:${p.x}%; top:${p.y}%; transform:translate(-50%,-50%); z-index:10; cursor:pointer;"
                onmouseenter="showMapTooltip(this, '${escapeHtml(p.title).replace(/'/g, "\\'")}', '${escapeHtml(p.desc||'').replace(/'/g, "\\'")}')"
                onmouseleave="hideMapTooltip(this)"
                onclick="event.stopPropagation(); showMapTooltip(this, '${escapeHtml(p.title).replace(/'/g, "\\'")}', '${escapeHtml(p.desc||'').replace(/'/g, "\\'")}')">
                <div style="font-size:24px;">📍</div>
            </div>`;
        });
        mapArea.innerHTML = gridHtml;
    } else { mapArea.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#666;">暂无地图</div>`; }

    const relArea = document.getElementById('detail-relation-area');
    const chars = story.characters || []; let rels = story.relationships || [];
    if (chars.length < 2) { relArea.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#666;">角色太少</div>`; }
    else {
        const uniqueRels = []; const pairs = new Set();
        rels.forEach(rel => { const key = [rel.from, rel.to].sort().join('_'); if (!pairs.has(key)) { pairs.add(key); uniqueRels.push(rel); } });
        const width = 800, height = 400, cx = width/2, cy = height/2, r = 150;
        const nodes = chars.map((c, i) => { const angle = (i / chars.length) * 2 * Math.PI - Math.PI / 2; return { ...c, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }; });
        let svg = `<svg width="100%" height="100%" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">`;
        uniqueRels.forEach(rel => {
            const n1 = nodes.find(n => n.name === rel.from); const n2 = nodes.find(n => n.name === rel.to);
            if (n1 && n2) { svg += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="#555" stroke-width="2" />`; const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2; svg += `<rect x="${mx-30}" y="${my-12}" width="60" height="24" fill="#121212" rx="12" />`; svg += `<text x="${mx}" y="${my+4}" fill="#c0a062" font-size="13" text-anchor="middle" font-weight="bold">${escapeHtml(rel.label)}</text>`; }
        });
        nodes.forEach(n => { svg += `<g transform="translate(${n.x}, ${n.y})"><circle r="40" fill="#1a1a24" stroke="#c0a062" stroke-width="2"/><text y="5" fill="#fff" font-size="14" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${escapeHtml(n.name)}</text></g>`; });
        svg += `</svg>`; relArea.innerHTML = svg;
    }

    // ===== 按钮逻辑 =====
    const btn = document.getElementById('btn-start');
    const btnChapters = document.getElementById('btn-chapters');
    const chapters = story.chapters || [];
    if (chapters.length === 0) {
        btn.innerText = "暂无章节";
        btn.style.background = "#ccc";
        btn.onclick = () => showToast("作者还没写呢！");
        if (btnChapters) btnChapters.style.display = 'none';
    } else {
        const pts = getResumePoints();
        const rp = pts[story.id];
        btn.innerText = (rp && rp.chapterId && rp.nodeId) ? "▶️ 继续观看" : "开始观看";
        btn.style.background = "#fff";
        btn.onclick = () => startStoryFromDetail(story);
        if (btnChapters) {
            btnChapters.style.display = 'inline-block';
            btnChapters.onclick = () => openChapterList(story);
        }
    }
}

function startStoryFromDetail(story) {
    const chapters = story.chapters || [];
    if (chapters.length === 0) { showToast("作者还没写呢！"); return; }

    const pts = getResumePoints();
    const rp = pts[story.id];

    if (!rp || !rp.chapterId || !rp.nodeId) {
        startFresh(story.id);
        return;
    }

    const chapterTitle = (chapters.find(c => c.id === rp.chapterId) || {}).title || '未知章节';
    showConfirm(
        "继续阅读？",
        `检测到上次读到《${chapterTitle}》\n\n点「确定」从上次位置继续\n点「取消」从头开始观看`,
        () => {
            window._pendingResume = rp;
            location.hash = `#play/${story.id}/${rp.chapterId}`;
        },
        () => {
            startFresh(story.id);
        }
    );
}

function startFresh(storyId) {
    clearResumePoint(storyId);
    clearPlayState(storyId);
    window._pendingResume = null;
    const story = getStories().find(x => x.id === storyId);
    if (!story) return;
    const chapters = story.chapters || [];
    if (chapters.length === 0) return;
    location.hash = `#play/${storyId}/${chapters[0].id}`;
}

function openChapterList(story) {
    const chapters = story.chapters || [];
    const pts = getResumePoints();
    const rp = pts[story.id];
    const readHistory = JSON.parse(safeGetLocal('vn_read_history') || '[]');

    let html = '<div style="max-height:60vh; overflow-y:auto; padding-right:5px; margin-top:-5px;">';
    if (chapters.length === 0) {
        html += '<div style="color:#888; text-align:center; padding:30px;">暂无章节</div>';
    } else {
        chapters.forEach((c, i) => {
            const isCurrent = rp && rp.chapterId === c.id;
            const isRead = readHistory.includes(c.id);
            let badge = '';
            if (isCurrent) badge = ' <span style="color:#c0a062; font-size:0.75rem;">[上次看到]</span>';
            else if (isRead) badge = ' <span style="color:#52c41a; font-size:0.75rem;">[已读]</span>';

            html += `
                <div style="display:flex; align-items:center; padding:14px 10px; border-bottom:1px solid #333; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='rgba(192,160,98,0.15)'" onmouseout="this.style.background=''" onclick="jumpToChapter('${story.id}', '${c.id}')">
                    <span style="color:#888; margin-right:15px; min-width:30px; font-family: monospace;">${String(i+1).padStart(2, '0')}.</span>
                    <span style="flex:1; color:#fff; word-break:break-word;">${escapeHtml(c.title)}${badge}</span>
                    <span style="color:#c0a062; font-size:1.1rem; margin-left:10px;">▶</span>
                </div>
            `;
        });
    }
    html += '</div>';

    openModal("📖 目录", html, () => {});
    const btn = document.getElementById('modal-confirm-btn');
    if (btn) btn.innerText = '关闭';
}

function jumpToChapter(storyId, chapterId) {
    closeModal();
    window._pendingResume = null;
    location.hash = `#play/${storyId}/${chapterId}`;
}

function showMapTooltip(el, title, desc) {
    let tooltip = document.getElementById('map-tooltip');
    const mapArea = document.getElementById('detail-map-area');
    if(!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'map-tooltip';
        tooltip.style.cssText = 'position:absolute; background:rgba(0,0,0,0.95); color:#fff; padding:10px; border-radius:8px; font-size:14px; z-index:100; pointer-events:none; border:1px solid #c0a062; white-space:nowrap; box-shadow:0 4px 10px rgba(0,0,0,0.5); transition: opacity 0.2s; max-width: 90%;';
        if(mapArea) mapArea.appendChild(tooltip);
    }
    tooltip.innerHTML = `<div style="color:#c0a062; font-weight:bold; margin-bottom:5px;">${title}</div><div style="font-size:12px;">${desc || '暂无详细描述'}</div>`;
    tooltip.style.display = 'block';

    const pinRect = el.getBoundingClientRect();
    const areaRect = mapArea.getBoundingClientRect();
    let left = pinRect.left - areaRect.left + (pinRect.width / 2) - (tooltip.offsetWidth / 2);
    let top = pinRect.top - areaRect.top - tooltip.offsetHeight - 10;
    if (left < 0) left = 0;
    if (left + tooltip.offsetWidth > areaRect.width) left = areaRect.width - tooltip.offsetWidth;
    if (top < 0) top = pinRect.top - areaRect.top + pinRect.height + 10;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}
function hideMapTooltip() { const tooltip = document.getElementById('map-tooltip'); if(tooltip) tooltip.style.display = 'none'; }
document.addEventListener('click', function(e) {
    const tooltip = document.getElementById('map-tooltip');
    if (tooltip && tooltip.style.display === 'block') {
        if (!e.target.closest('.map-pin-detail')) tooltip.style.display = 'none';
    }
});

// ================= 节点编辑器 =================
function renderNodeEditor() {
    const story = getStories().find(s => s.id === currentManageId); if(!story) return;
    const chapter = story.chapters.find(c => c.id === currentChapterId); if (!chapter) return;

    const canvas = document.getElementById('node-canvas'); const svg = document.getElementById('node-svg');
    if(!canvas || !svg) return; canvas.innerHTML = ''; svg.innerHTML = '';
    if (!chapter.nodes) chapter.nodes = []; if (!chapter.edges) chapter.edges = [];
    let needSave = false;
    if (!chapter.nodes.some(n => n.type === 'start')) { chapter.nodes.push({ id: 'n_start_' + Date.now(), type: 'start', x: 100, y: 150, entryKey: '' }); needSave = true; }
    if (!chapter.nodes.some(n => n.type === 'end')) { chapter.nodes.push({ id: 'n_end_' + Date.now(), type: 'end', x: 600, y: 150 }); needSave = true; }
    if (needSave) { saveStories(getStories()); }

    let totalErrors = 0;

    chapter.nodes.forEach(node => {
        if (!node || !node.type) return;
        if (node.type === 'branch' && (!node.options || node.options.length === 0)) { node.options = [{ text: '选项A' }, { text: '选项B' }]; }

        let content = '';
        if (node.type === 'dialogue') content = `<b>${escapeHtml(node.name || '角色')}</b>: ${escapeHtml(node.text || '...')}${node.setVars ? `<br><span style="color:#52c41a;font-size:0.75rem;">[获得: ${escapeHtml(node.setVars)}]</span>` : ''}`;
        else if (node.type === 'narration') content = `<span style="color:#888;">旁白:</span> ${escapeHtml(node.text || '...')}${node.setVars ? `<br><span style="color:#52c41a;font-size:0.75rem;">[获得: ${escapeHtml(node.setVars)}]</span>` : ''}`;
        else if (node.type === 'figure') {
            let action = node.action || (node.hide ? 'hide' : 'show');
            let pos = node.pos || (node.hide ? 'all' : 'center');
            const posText = pos === 'left' ? '左侧' : (pos === 'right' ? '右侧' : (pos === 'all' ? '全部' : '居中'));
            content = action === 'hide' ? `🧍 隐藏立绘(${posText})` : `🧍 显示立绘(${posText}): ${node.img ? '已设置' : '未设置'}`;
        }
        else if (node.type === 'bgm') content = node.bgm ? (node.bgm.startsWith('http') ? `🔗 BGM: 云端` : `🎵 BGM: 本地`) : `🔇 BGM: 停止`;
        else if (node.type === 'illustration') content = `🖼️ 背景: ${node.hide ? '清空' : (node.img ? '已设置' : '未设置')}`;
        else if (node.type === 'branch') {
            content = `<div style="color:#c0a062; font-weight:bold;">🔀 分支 (${node.options.length}项)：</div><div style="font-size:0.8rem; margin-top:5px;">`;
            node.options.forEach((opt, i) => { content += `${String.fromCharCode(65+i)}: ${escapeHtml(opt.text)} ${opt.reqVars ? '🔒' : ''}${opt.nextEntry ? ` ➡️[${escapeHtml(opt.nextEntry)}]` : ''}<br>`; });
            content += `</div>`;
        }
        else if (node.type === 'end') content = `🛑 结局: ${node.text ? escapeHtml(node.text.substring(0, 10)) + '...' : '未命名'}`;
        else if (node.type === 'start') content = `🚩 开始${node.entryKey ? ` [${escapeHtml(node.entryKey)}]` : ''}`;
        else content = '开始';

        let errs = [];
        const outs = chapter.edges.filter(e => e.from === node.id);
        const ins = chapter.edges.filter(e => e.to === node.id);

        if (node.type !== 'start' && ins.length === 0) errs.push('缺少入口连线');
        if (node.type !== 'end' && outs.length === 0) errs.push('缺少出口连线');
        if (node.type === 'branch' && outs.length < node.options.length) errs.push(`分支有${node.options.length}项，但只连了${outs.length}条线`);
        if (node.type === 'end' && outs.length > 0) errs.push('结局节点不应有出口');

        if (errs.length > 0) totalErrors++;

        const div = document.createElement('div'); div.className = 'graph-node'; div.id = `node-${node.id}`; div.style.left = `${node.x || 100}px`; div.style.top = `${node.y || 100}px`;

        if (errs.length > 0) {
            div.style.border = '2px solid #ff4d4f';
            div.style.boxShadow = '0 0 10px rgba(255, 77, 79, 0.5)';
        }

        let inPort = node.type !== 'start' ? `<div class="node-port port-in" data-node="${node.id}" data-dir="left" style="left:-10px; top:50%;"></div>` : '';
        
        let outPort = '';
        if (node.type === 'branch') {
            const outCount = node.options.length;
            for (let i = 0; i < outCount; i++) {
                const topPct = (i + 1) / (outCount + 1) * 100;
                outPort += `<div class="node-port port-out" style="right:-10px; top:${topPct}%; transform:translateY(-50%);" data-node="${node.id}" data-branch="${i}" data-dir="right"></div>`;
            }
        } else if (node.type !== 'end') {
            outPort = `<div class="node-port port-out" style="right:-10px; top:50%;" data-node="${node.id}" data-dir="right"></div>`;
        }

        let errIcon = errs.length > 0 ? `<div style="position:absolute; top:-10px; right:-10px; background:#ff4d4f; color:#fff; border-radius:50%; width:20px; height:20px; display:flex; justify-content:center; align-items:center; font-size:14px; z-index:10; pointer-events: none; box-shadow:0 2px 5px rgba(0,0,0,0.3);" title="${errs.join('，')}">!</div>` : '';

        const headerText = `${node.type.toUpperCase()}${node.entryKey ? ` <span style="color:#c0a062; font-size:0.75rem; font-weight:normal;">🚩[${escapeHtml(node.entryKey)}]</span>` : ''}`;
        div.innerHTML = `${errIcon}<div class="graph-node-header"><span>${headerText}</span><span class="node-del-btn" style="cursor:pointer;color:red;padding:0 5px;" onclick="deleteNode(event, '${node.id}')">×</span></div><div class="graph-node-body" onclick="editNode('${node.id}')">${content}</div>${inPort}${outPort}`;
        canvas.appendChild(div);

        const header = div.querySelector('.graph-node-header');
        header.onpointerdown = (e) => {
            if (e.target.classList.contains('node-del-btn')) return;
            if (_dragging || _linking) return;
            e.preventDefault();
            _dragging = true;
            const pid = e.pointerId;
            try { header.setPointerCapture(pid); } catch(_) {}

            const container = document.getElementById('node-canvas-container');
            const prevTouch = container ? container.style.touchAction : '';
            if (container) container.style.touchAction = 'none';

            let startX = e.clientX - node.x, startY = e.clientY - node.y;
            let moved = false;

            const move = (ev) => {
                if (ev.pointerId !== pid) return;
                node.x = ev.clientX - startX;
                node.y = ev.clientY - startY;
                div.style.left = `${node.x}px`; div.style.top = `${node.y}px`;
                drawEdges(chapter.edges);
                moved = true;
            };
            const end = (ev) => {
                if (ev.pointerId !== pid) return;
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', end);
                document.removeEventListener('pointercancel', end);
                if (container) container.style.touchAction = prevTouch;
                try { header.releasePointerCapture(pid); } catch(_) {}
                _dragging = false;
                if (moved) saveStories(getStories());
            };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', end);
            document.addEventListener('pointercancel', end);
        };
    });

    const titleEl = document.getElementById('node-editor-title');
    if (totalErrors > 0) {
        titleEl.innerHTML = `${escapeHtml(chapter.title || '未命名章节')} <span style="color:#ff4d4f; font-size:0.85rem; margin-left:10px; font-weight:normal;">⚠️ 发现 ${totalErrors} 个连线错误</span>`;
    } else {
        titleEl.innerHTML = `${escapeHtml(chapter.title || '未命名章节')} <span style="color:#52c41a; font-size:0.85rem; margin-left:10px; font-weight:normal;">✅ 结构正常</span>`;
    }

    drawEdges(chapter.edges); bindPorts(chapter);
}

function drawEdges(edges) {
    const svg = document.getElementById('node-svg'); if(!svg) return; svg.innerHTML = ''; if (!edges) return;
    edges.forEach(edge => {
        const fromNode = document.getElementById(`node-${edge.from}`), toNode = document.getElementById(`node-${edge.to}`);
        if (fromNode && toNode) {
            let x1 = fromNode.offsetLeft + fromNode.offsetWidth, y1 = fromNode.offsetTop + fromNode.offsetHeight / 2;
            let x2 = toNode.offsetLeft, y2 = toNode.offsetTop + toNode.offsetHeight / 2;
            if (edge.branchIndex !== undefined) { 
                const p = fromNode.querySelector(`.node-port[data-branch="${edge.branchIndex}"]`); 
                if(p) y1 = fromNode.offsetTop + p.offsetTop + 8; 
            } else { 
                if (toNode.offsetLeft + toNode.offsetWidth < fromNode.offsetLeft) { x1 = fromNode.offsetLeft; x2 = toNode.offsetLeft + toNode.offsetWidth; } 
            }
            const d = `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); path.setAttribute('stroke', '#c0a062'); path.setAttribute('stroke-width', '3'); path.setAttribute('fill', 'none');
            const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); hitPath.setAttribute('d', d); hitPath.setAttribute('stroke', 'transparent'); hitPath.setAttribute('stroke-width', '20'); hitPath.setAttribute('fill', 'none'); hitPath.style.pointerEvents = 'stroke'; hitPath.style.cursor = 'pointer';
            hitPath.onmouseenter = () => { path.setAttribute('stroke', '#ff4d4f'); path.setAttribute('stroke-width', '4'); }; hitPath.onmouseleave = () => { path.setAttribute('stroke', '#c0a062'); path.setAttribute('stroke-width', '3'); };
            hitPath.onclick = (e) => { e.stopPropagation(); showConfirm("取消连线", "确定删除连线？", () => { const st = getStories().find(s => s.id === currentManageId), ch = st.chapters.find(c => c.id === currentChapterId); ch.edges = ch.edges.filter(e => !(e.from === edge.from && e.to === edge.to && e.branchIndex === edge.branchIndex)); saveStories(getStories()); renderNodeEditor(); }); };
            g.appendChild(path); g.appendChild(hitPath); svg.appendChild(g);
        }
    });
}

function bindPorts(chapter) {
    document.querySelectorAll('.node-port').forEach(port => {
        port.onpointerdown = (e) => {
            if (_linking || _dragging) return;
            _linking = true;
            e.stopPropagation(); 
            e.preventDefault();
            
            const pid = e.pointerId;
            try { port.setPointerCapture(pid); } catch(_) {}
            
            const container = document.getElementById('node-canvas-container');
            const prevTouch = container ? container.style.touchAction : '';
            if (container) container.style.touchAction = 'none';
            
            const nodeIdA = port.dataset.node, dirA = port.dataset.dir, branchIndex = port.dataset.branch !== undefined ? parseInt(port.dataset.branch) : undefined;
            const nodeA = document.getElementById(`node-${nodeIdA}`); 
            if (!nodeA) { _linking = false; return; }
            
            let x1 = dirA === 'right' ? nodeA.offsetLeft + nodeA.offsetWidth : nodeA.offsetLeft;
            let y1 = nodeA.offsetTop + port.offsetTop + 8;
            const svg = document.getElementById('node-svg');
            let tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); 
            tempPath.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y1}`); 
            tempPath.setAttribute('stroke', '#c0a062'); 
            tempPath.setAttribute('stroke-width', '3'); 
            tempPath.setAttribute('stroke-dasharray', '5,5'); 
            tempPath.setAttribute('fill', 'none'); 
            svg.appendChild(tempPath);

            const onPointerMove = (ev) => { 
                if (ev.pointerId !== pid) return;
                const c = document.getElementById('node-canvas').getBoundingClientRect(); 
                const mX = ev.clientX - c.left, mY = ev.clientY - c.top; 
                tempPath.setAttribute('d', `M ${x1} ${y1} C ${x1 + (dirA==='right'?50:-50)} ${y1}, ${mX + (dirA==='right'?-50:50)} ${mY}, ${mX} ${mY}`); 
            };

            const cleanup = () => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.removeEventListener('pointercancel', onPointerCancel);
                if (tempPath) tempPath.remove();
                if (container) container.style.touchAction = prevTouch;
                try { port.releasePointerCapture(pid); } catch(_) {}
                _linking = false;
            };
            const onPointerCancel = () => cleanup();

            const onPointerUp = (ev) => {
                if (ev.pointerId !== pid) return;
                const el = document.elementFromPoint(ev.clientX, ev.clientY);
                const targetPort = el ? el.closest('.node-port') : null;
                cleanup();

                if (targetPort && nodeIdA !== targetPort.dataset.node) {
                    const isSourceOut = dirA === 'right';
                    const isTargetIn = targetPort.dataset.dir === 'left';

                    let fromId = nodeIdA, toId = targetPort.dataset.node;
                    let finalBranchIndex = undefined;

                    if (!isSourceOut && !isTargetIn) return showToast("只能从【右侧出口】连到【左侧入口】");
                    else if (!isSourceOut && isTargetIn) {
                        fromId = targetPort.dataset.node;
                        toId = nodeIdA;
                        finalBranchIndex = targetPort.dataset.branch !== undefined ? parseInt(targetPort.dataset.branch) : undefined;
                    } else {
                        finalBranchIndex = branchIndex;
                    }

                    const st = getStories().find(s => s.id === currentManageId), ch = st.chapters.find(c => c.id === currentChapterId);
                    ch.edges = ch.edges.filter(edge => !(edge.from === fromId && edge.to === toId && edge.branchIndex === finalBranchIndex));
                    ch.edges.push({ from: fromId, to: toId, branchIndex: finalBranchIndex });

                    saveStories(getStories()); 
                    renderNodeEditor();
                }
            };
            document.addEventListener('pointermove', onPointerMove); 
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerCancel);
        };
    });
}

function addNode(type) {
    const st = getStories().find(s => s.id === currentManageId), ch = st.chapters.find(c => c.id === currentChapterId); if (!ch) return;
    if (!ch.nodes) ch.nodes = []; if (!ch.edges) ch.edges = [];
    const c = document.getElementById('node-canvas-container');
    const newNode = { 
        id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), 
        type, 
        x: (c?c.scrollLeft:0)+(c?c.offsetWidth:800)/2-110, 
        y: (c?c.scrollTop:0)+(c?c.offsetHeight:600)/2-50, 
        text: '', name: '', bgm: '', img: '', pos: 'center', action: 'show', setVars: '' 
    };
    if (type === 'branch') newNode.options = [{ text: '选项A' }, { text: '选项B' }];
    if (type === 'start') newNode.entryKey = '';
    ch.nodes.push(newNode); saveStories(getStories()); renderNodeEditor();
}

function deleteNode(e, id) { e.stopPropagation(); showConfirm("删除", "确认删除节点？", () => { const st = getStories().find(s => s.id === currentManageId), ch = st.chapters.find(c => c.id === currentChapterId); ch.nodes = ch.nodes.filter(n => n.id !== id); ch.edges = ch.edges.filter(e => e.from !== id && e.to !== id); saveStories(getStories()); renderNodeEditor(); }); }

function addBranchOptInput(text = '', reqVars = '', nextEntry = '') {
    const container = document.getElementById('branch-opt-list');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'branch-opt-row';
    div.innerHTML = `
        <input type="text" class="opt-text" value="${escapeHtml(text)}" placeholder="选项文字(例如: 拿出钥匙)">
        <input type="text" class="opt-req" value="${escapeHtml(reqVars)}" placeholder="要求条件(可选，多个用逗号/顿号隔开)">
        <input type="text" class="opt-next" value="${escapeHtml(nextEntry)}" placeholder="下一章入口标签(可选，跨章伏笔)">
        <button class="glass-btn" style="padding:6px 10px; color:#d9534f !important; border-color:#d9534f;" onclick="this.parentNode.remove()">删除</button>
    `;
    container.appendChild(div);
}

function editNode(id) {
    const story = getStories().find(s => s.id === currentManageId), ch = story.chapters.find(c => c.id === currentChapterId), node = ch.nodes.find(n => n.id === id);
    if (!node) return;

    // start 节点：编辑入口标签
    if (node.type === 'start') {
        const html = `
            <p style="color:#c0a062; font-size:0.85rem; margin-bottom:15px; line-height:1.6;">
                💡 <b>跨章伏笔</b>：给这个入口起一个标签（例如「分支A」「拿到钥匙」）。玩家在上一章（或任意更早章节）的分支选项里填相同的「下一章入口标签」后，进入本章时会自动从对应入口开始。<br>
                留空 = 默认入口（玩家没选过特定分支时走这里）。
            </p>
            <div class="form-group">
                <label>入口标签（留空 = 默认入口）</label>
                <input type="text" id="e-node-entry" value="${escapeHtml(node.entryKey || '')}" placeholder="例如：分支A、拿到钥匙、拯救公主">
            </div>
        `;
        openModal("编辑入口", html, async () => {
            const n = getStories().find(s => s.id === currentManageId).chapters.find(c => c.id === currentChapterId).nodes.find(x => x.id === id);
            if (!n) return;
            n.entryKey = document.getElementById('e-node-entry').value.trim();
            saveStories(getStories()); 
            renderNodeEditor();
        });
        return;
    }

    let html = '';

    if (node.type === 'dialogue' || node.type === 'narration' || node.type === 'end') {
        if (node.type === 'dialogue') html = `<div class="form-group"><label>角色</label><input type="text" id="e-node-name" value="${escapeHtml(node.name||'')}"></div>`;
        if (node.type === 'dialogue' || node.type === 'narration') html += `<div class="form-group"><label>内容</label><textarea id="e-node-text" rows="3">${escapeHtml(node.text||'')}</textarea></div>`;
        if (node.type === 'end') html = `<div class="form-group"><label>结局</label><textarea id="e-node-text" rows="4">${escapeHtml(node.text||'')}</textarea></div>`;
        
        html += `
            <div class="form-group">
                <label style="color:#52c41a;">解锁道具/剧情条件（可选，多个用逗号或顿号隔开）</label>
                <input type="text" id="e-node-setvars" value="${escapeHtml(node.setVars||'')}" placeholder="例如：获得钥匙，遇到魔女（英文/中文逗号/顿号都可以）">
                <p style="font-size:0.75rem; color:#888; margin-top:5px;">只要玩家经过了这里，就会自动获得这些条件。后续分支用同样的写法即可判断。</p>
            </div>
        `;

        // dialogue/narration 允许设置入口标签（跨章伏笔不局限于 start 节点）
        if (node.type === 'dialogue' || node.type === 'narration') {
            html += `
                <div class="form-group" style="border-top:1px dashed #444; padding-top:15px;">
                    <label style="color:#c0a062;">🚩 入口标签（可选，用于跨章伏笔）</label>
                    <input type="text" id="e-node-entrykey" value="${escapeHtml(node.entryKey||'')}" placeholder="例如：分支A、拿到钥匙">
                    <p style="font-size:0.75rem; color:#888; margin-top:5px;">
                        在上一章的分支选项里填相同的「下一章入口标签」，玩家选该分支后，后续任意章节都会从这个节点开始（直到被新的分支选择覆盖）。
                    </p>
                </div>
            `;
        }
    }
    else if (node.type === 'figure') {
        let action = node.action || (node.hide ? 'hide' : 'show');
        let pos = node.pos || (node.hide ? 'all' : 'center');
        const allSprites = [];
        (story.characters || []).forEach(c => { (c.sprites || []).forEach(sp => { allSprites.push({ charName: c.name, spriteName: sp.name, url: sp.url }); }); });
        const options = allSprites.length ? allSprites.map(sp => { const safeUrl = (sp.url || '').replace(/"/g, '&quot;'); const selected = sp.url === node.img ? 'selected' : ''; return `<option value="${safeUrl}" ${selected}>${escapeHtml(sp.charName)} - ${escapeHtml(sp.spriteName)}</option>`; }).join('') : '';
        html = `
            <p style="color:#c0a062; font-size:0.85rem; margin-bottom:15px; line-height:1.5;">💡 提示：同屏多人只需添加多个"显示立绘"节点；想让某人单独退场，选"隐藏立绘"并指定位置即可。</p>
            <div class="form-group"><label>操作动作</label><select id="e-node-figure-action" style="width:100%; padding:8px; border-radius:5px; border:1px solid #ccc;" onchange="document.getElementById('e-node-figure-img-area').style.display = this.value === 'show' ? 'block' : 'none';"><option value="show" ${action === 'show' ? 'selected' : ''}>显示 / 更新立绘</option><option value="hide" ${action === 'hide' ? 'selected' : ''}>隐藏 / 退场立绘</option></select></div>
            <div class="form-group"><label>目标位置</label><select id="e-node-figure-pos" style="width:100%; padding:8px; border-radius:5px; border:1px solid #ccc;"><option value="center" ${pos === 'center' ? 'selected' : ''}>居中</option><option value="left" ${pos === 'left' ? 'selected' : ''}>左侧</option><option value="right" ${pos === 'right' ? 'selected' : ''}>右侧</option><option value="all" ${pos === 'all' ? 'selected' : ''}>全部位置</option></select></div>
            <div id="e-node-figure-img-area" style="display: ${action === 'show' ? 'block' : 'none'};">
                <div class="form-group"><label>从角色立绘中选择</label><select id="e-node-sprite-select" style="width:100%; padding:8px; border-radius:5px; border:1px solid #ccc;"><option value="">-- 不选择（手动填 URL）--</option>${options}</select>${allSprites.length ? '' : '<p style="color:#888;font-size:0.8rem;margin-top:5px;">还没有立绘，请先到「角色管理 → 立绘」中添加</p>'}</div>
                <div class="form-group">
                    <label>或填写图片链接</label>
                    <p style="color:#c0a062; font-size:0.8rem; margin-bottom:6px;">💡 可在 <a href="${IMG_HOST_HINT}" target="_blank" style="color:#6cf; text-decoration:underline;">${IMG_HOST_HINT}</a> 上传图片获取直链</p>
                    <input type="text" id="e-node-img" value="${escapeHtml(node.img||'')}" oninput="const i=document.getElementById('preview-img'); i.src=this.value; i.style.display=this.value?'block':'none';">
                    <div style="text-align:center;margin-top:10px;"><img id="preview-img" src="${escapeHtml(node.img||'')}" style="max-width:100%;max-height: 30vh; object-fit: contain; display:${node.img?'block':'none'}; margin:0 auto;"></div>
                </div>
            </div>
        `;
    }
    else if (node.type === 'illustration') {
        html = `
            <label style="display:flex; align-items:center; gap:5px; margin-bottom:15px; cursor:pointer; color:#fff;">
                <input type="checkbox" id="e-node-illus-hide" ${node.hide ? 'checked' : ''}> 清空背景（变为纯黑屏）
            </label>
            <div class="form-group">
                <label>图片链接</label>
                <p style="color:#c0a062; font-size:0.8rem; margin-bottom:6px;">💡 可在 <a href="${IMG_HOST_HINT}" target="_blank" style="color:#6cf; text-decoration:underline;">${IMG_HOST_HINT}</a> 上传图片获取直链</p>
                <input type="text" id="e-node-img" value="${escapeHtml(node.img||'')}" oninput="const i=document.getElementById('preview-img'); i.src=this.value; i.style.display=this.value?'block':'none';">
                <div style="text-align:center;margin-top:10px;"><img id="preview-img" src="${escapeHtml(node.img||'')}" style="max-width:100%; max-height:150px; display:${node.img?'block':'none'}; margin:0 auto;"></div>
            </div>
        `;
    }
    else if (node.type === 'bgm') {
        html = `
            <div class="form-group"><label>上传 BGM（推荐登录后上传）</label><input type="file" id="e-node-bgm-file" accept="audio/*" style="width:100%;"></div>
            <div class="form-group"><label>或填音频直链</label><input type="text" id="e-node-bgm" value="${escapeHtml(node.bgm||'')}" placeholder="https://... .mp3"></div>
            <div style="text-align:right;margin-top:10px;"><button class="text-btn" style="color:#d9534f;" onclick="document.getElementById('clear-bgm-flag').value='1'; showToast('点击确定后清空 BGM');">清空</button><input type="hidden" id="clear-bgm-flag" value="0"></div>
        `;
    }
    else if (node.type === 'branch') {
        html = `
            <p style="color:#c0a062; font-size:0.85rem; margin-bottom:15px; line-height:1.5;">
                💡 提示：可以添加任意数量的选项。「要求条件」需与解锁节点里填写的内容完全一致。<br>
                「下一章入口标签」用于<b>跨章伏笔</b>：填了之后，玩家选这个选项后，<b>后续任意章节</b>都会从对应标签的入口节点进入，直到被新的分支选择覆盖。
            </p>
            <div id="branch-opt-list" style="margin-bottom:15px;"></div>
            <button class="glass-btn" style="width:100%; border:1px dashed #c0a062; color:#c0a062 !important;" onclick="addBranchOptInput()">+ 添加新选项</button>
        `;
    }
    else return;

    openModal("编辑节点", html, async () => {
        const n = getStories().find(s => s.id === currentManageId).chapters.find(c => c.id === currentChapterId).nodes.find(x => x.id === id);
        if (!n) return;

        if (n.type === 'dialogue') {
            n.name = document.getElementById('e-node-name').value;
            n.text = document.getElementById('e-node-text').value;
            n.setVars = document.getElementById('e-node-setvars').value.trim();
            const ek = document.getElementById('e-node-entrykey');
            if (ek) n.entryKey = ek.value.trim();
        }
        else if (n.type === 'narration' || n.type === 'end') {
            n.text = document.getElementById('e-node-text').value;
            n.setVars = document.getElementById('e-node-setvars').value.trim();
            const ek = document.getElementById('e-node-entrykey');
            if (ek) n.entryKey = ek.value.trim();
        }
        else if (n.type === 'figure') {
            n.action = document.getElementById('e-node-figure-action').value;
            n.pos = document.getElementById('e-node-figure-pos').value;
            if (n.action === 'show') n.img = document.getElementById('e-node-img').value;
            delete n.hide;
        }
        else if (n.type === 'illustration') {
            n.hide = document.getElementById('e-node-illus-hide').checked;
            if (!n.hide) n.img = document.getElementById('e-node-img').value;
        }
        else if (n.type === 'branch') {
            const rows = document.querySelectorAll('#branch-opt-list .branch-opt-row');
            const newOpts = [];
            rows.forEach(row => {
                const t = row.querySelector('.opt-text').value.trim();
                const r = row.querySelector('.opt-req').value.trim();
                const next = row.querySelector('.opt-next') ? row.querySelector('.opt-next').value.trim() : '';
                if (t) newOpts.push({ text: t, reqVars: r, nextEntry: next });
            });
            n.options = newOpts.length > 0 ? newOpts : [{ text: '选项A', reqVars: '' }];
            
            const st = getStories().find(s => s.id === currentManageId);
            st.chapters.find(c => c.id === currentChapterId).edges = st.chapters.find(c => c.id === currentChapterId).edges.filter(e => {
                return !(e.from === id && e.branchIndex !== undefined && e.branchIndex >= n.options.length);
            });
        }
        else if (n.type === 'bgm') {
            const clearFlag = document.getElementById('clear-bgm-flag').value === '1';
            const fileInput = document.getElementById('e-node-bgm-file');
            const urlInput = document.getElementById('e-node-bgm');

            if (clearFlag) {
                n.bgm = '';
                showToast("已清空 BGM");
            } else if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                if (supabaseClient && currentUser) {
                    showToast("上传中...");
                    try {
                        const rawName = file.name;
                        const ext = rawName.substring(rawName.lastIndexOf('.'));
                        const baseName = rawName.substring(0, rawName.lastIndexOf('.'));
                        const safeBase = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_');
                        const safeFileName = safeBase + ext;

                        const { data, error } = await supabaseClient.storage.from('audio').upload(`bgm_${Date.now()}_${safeFileName}`, file);
                        if (error) throw error;
                        n.bgm = supabaseClient.storage.from('audio').getPublicUrl(data.path).data.publicUrl;
                        showToast("✅ BGM 上传成功");
                    } catch (e) {
                        console.error("BGM upload failed:", e);
                        showToast("❌ BGM 上传失败：" + (e.message || '请检查 Supabase storage 桶 "audio" 是否存在且为 public'));
                        return false;
                    }
                } else {
                    const base64 = await new Promise((resolve, reject) => {
                        const r = new FileReader(); r.onload = ev => resolve(ev.target.result); r.onerror = reject; r.readAsDataURL(file);
                    });
                    if (base64.length > 3 * 1024 * 1024) { showToast("文件过大（>3MB），请登录后上传或填写音频 URL"); return false; }
                    n.bgm = base64;
                    showToast("已使用本地 BGM（建议登录上传）");
                }
            } else if (urlInput.value.trim()) {
                n.bgm = urlInput.value.trim();
                showToast("BGM 链接已保存");
            }
        }

        saveStories(getStories());
        renderNodeEditor();
    });

    if (node.type === 'figure') {
        setTimeout(() => {
            const sel = document.getElementById('e-node-sprite-select');
            if (sel) sel.onchange = () => {
                if (!sel.value) return;
                const imgInput = document.getElementById('e-node-img');
                const preview = document.getElementById('preview-img');
                imgInput.value = sel.value; preview.src = sel.value; preview.style.display = 'block';
            };
        }, 0);
    }
    if (node.type === 'branch') {
        setTimeout(() => {
            const list = document.getElementById('branch-opt-list');
            if (list) {
                list.innerHTML = '';
                node.options.forEach(opt => addBranchOptInput(opt.text || '', opt.reqVars || '', opt.nextEntry || ''));
            }
        }, 0);
    }
}

// ================= 自动排版算法 =================
function autoLayout() {
    const st = getStories().find(s => s.id === currentManageId);
    const ch = st.chapters.find(c => c.id === currentChapterId);
    if (!ch || !ch.nodes || ch.nodes.length === 0) return;

    const levels = {}; 
    const visited = new Set();
    const startNode = ch.nodes.find(n => n.type === 'start');
    
    const queue = [{ id: startNode ? startNode.id : null, level: 0 }];
    while(queue.length > 0) {
        const { id, level } = queue.shift();
        if (!id || visited.has(id)) continue;
        visited.add(id);
        if (!levels[level]) levels[level] = [];
        levels[level].push(id);

        const outEdges = ch.edges.filter(e => e.from === id);
        outEdges.forEach(e => {
            if (!visited.has(e.to)) queue.push({ id: e.to, level: level + 1 });
        });
    }

    ch.nodes.forEach(n => {
        if (!visited.has(n.id)) {
            const maxLvl = Object.keys(levels).length;
            if (!levels[maxLvl]) levels[maxLvl] = [];
            levels[maxLvl].push(n.id);
        }
    });

    let maxNodesInLevel = 0;
    Object.keys(levels).forEach(lvl => { maxNodesInLevel = Math.max(maxNodesInLevel, levels[lvl].length); });

    const startX = 100; const gapX = 280; 
    const startY = 100; const gapY = 120; 
    let maxX = 0, maxY = 0;

    Object.keys(levels).forEach(lvl => {
        const nodesInLvl = levels[lvl];
        const startOffsetY = startY + (maxNodesInLevel - nodesInLvl.length) * gapY / 2;
        nodesInLvl.forEach((nodeId, index) => {
            const node = ch.nodes.find(n => n.id === nodeId);
            if (node) {
                node.x = startX + parseInt(lvl) * gapX;
                node.y = startOffsetY + index * gapY;
                maxX = Math.max(maxX, node.x); maxY = Math.max(maxY, node.y);
            }
        });
    });

    let canvas = document.getElementById('node-canvas');
    let svg = document.getElementById('node-svg');
    if (canvas && svg) {
        let newW = Math.max(3000, maxX + 800); 
        let newH = Math.max(3000, maxY + 500); 
        canvas.style.width = newW + 'px'; canvas.style.height = newH + 'px';
        svg.setAttribute('width', newW); svg.setAttribute('height', newH);
        svg.style.width = newW + 'px'; svg.style.height = newH + 'px';
    }

    saveStories(getStories()); renderNodeEditor(); showToast("✨ 排版完成");
}

function openAddChapterModal() { openModal("新章节", `<input type="text" id="m-ch-title" placeholder="标题">`, () => { const t = document.getElementById('m-ch-title').value; if(!t) return; const s = getStories().find(x => x.id === currentManageId); if(!s.chapters) s.chapters=[]; s.chapters.push({ id: 'ch_'+Date.now(), title: t, nodes: [], edges: [] }); saveStories(getStories()); renderManageSubPage('chapters'); }); }
function openAddCharacterModal() { openModal("新角色", `<input type="text" id="m-c-name" placeholder="名字"><textarea id="m-c-desc" rows="3" placeholder="简介" style="margin-top:10px;"></textarea>`, () => { const n = document.getElementById('m-c-name').value; if(!n) return; const s = getStories().find(x => x.id === currentManageId); if(!s.characters) s.characters=[]; s.characters.push({ id: 'char_'+Date.now(), name: n, desc: document.getElementById('m-c-desc').value, sprites: [] }); saveStories(getStories()); renderManageSubPage('characters'); }); }
function openAddPlotModal() { openModal("新地点", `<input type="text" id="m-p-title" placeholder="名称"><textarea id="m-p-desc" rows="3" placeholder="描述" style="margin-top:10px;"></textarea>`, () => { const t = document.getElementById('m-p-title').value; if(!t) return; const s = getStories().find(x => x.id === currentManageId); if(!s.plots) s.plots=[]; s.plots.push({ id: 'plot_'+Date.now(), title: t, desc: document.getElementById('m-p-desc').value, x: 50, y: 50 }); saveStories(getStories()); renderManageSubPage('plots'); }); }

function openAddWikiModal() { 
    const s = getStories().find(x => x.id === currentManageId);
    const chapterOpts = (s.chapters || []).map(c=>`<option value="${c.id}">读完 ${escapeHtml(c.title)} 解锁</option>`).join('');
    openModal("新词条", `<input type="text" id="m-w-term" placeholder="词条名"><textarea id="m-w-content" rows="3" placeholder="内容" style="margin-top:10px;"></textarea><select id="m-w-unlock" style="margin-top:10px;width:100%;padding:5px;"><option value="">所有人可见</option>${chapterOpts}</select>`, () => { 
        const t = document.getElementById('m-w-term').value; if(!t) return; 
        if(!s.wiki) s.wiki=[]; 
        s.wiki.push({ id: 'wiki_'+Date.now(), term: t, content: document.getElementById('m-w-content').value, unlockChapter: document.getElementById('m-w-unlock').value }); 
        saveStories(getStories()); renderManageSubPage('wiki'); 
    }); 
}
function openAddRelationshipModal() { 
    const s = getStories().find(x=>x.id===currentManageId); 
    if(!s.characters || s.characters.length < 2) return showToast("需要至少2个角色"); 
    const opts = s.characters.map(c=>`<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join(''); 
    openModal("添加关系", `<div class="form-group"><label>A</label><select id="m-rel-from">${opts}</select></div><div class="form-group"><label>B</label><select id="m-rel-to">${opts}</select></div><div class="form-group"><label>标签</label><input type="text" id="m-rel-label"></div>`, () => { 
        const f = document.getElementById('m-rel-from').value, t = document.getElementById('m-rel-to').value, l = document.getElementById('m-rel-label').value; 
        if(f===t || !l) return; 
        if(!s.relationships) s.relationships = []; 
        s.relationships = s.relationships.filter(r => !(r.from === f && r.to === t) && !(r.from === t && r.to === f)); 
        s.relationships.push({ from: f, to: t, label: l }); 
        saveStories(getStories()); switchCharTab('graph'); 
    }); 
}
function saveStoryInfo() { const s = getStories().find(x => x.id === currentManageId); if(!s) return; s.title = document.getElementById('edit-title').value; s.intro = document.getElementById('edit-intro').value; s.tags = document.getElementById('edit-tags').value.split(/[，,]/).map(t=>t.trim()).filter(Boolean); s.cover = document.getElementById('edit-cover').value; saveStories(getStories()); showToast("已保存"); setTimeout(()=>{location.hash=`#manage/${s.id}`}, 500); }
function switchCharTab(t) { document.getElementById('tab-char-list').classList.toggle('active', t==='list'); document.getElementById('tab-char-graph').classList.toggle('active', t==='graph'); document.getElementById('char-content-list').style.display = t==='list'?'flex':'none'; document.getElementById('char-content-graph').style.display = t==='graph'?'block':'none'; if(t==='graph') renderRelationshipGraph(); }

function renderRelationshipGraph() {
    const s = getStories().find(x => x.id === currentManageId); const area = document.getElementById('relationship-graph-area');
    if (!s || !s.characters || s.characters.length < 2) { area.innerHTML = ''; return; }
    const chars = s.characters, rels = s.relationships || [];
    const nodes = chars.map((c, i) => { const a = (i / chars.length) * 2 * Math.PI - Math.PI / 2; return { ...c, x: 400 + 150 * Math.cos(a), y: 250 + 150 * Math.sin(a) }; });
    let svg = `<svg width="100%" height="100%" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid meet">`;
    rels.forEach(r => { const n1 = nodes.find(n => n.name === r.from), n2 = nodes.find(n => n.name === r.to); if (n1 && n2) { svg += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="#ccc" stroke-width="2" />`; const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2; svg += `<rect x="${mx-30}" y="${my-12}" width="60" height="24" fill="#fcf9f2" rx="12" /><text x="${mx}" y="${my+4}" fill="#c0a062" font-size="13" text-anchor="middle" font-weight="bold">${escapeHtml(r.label)}</text>`; } });
    nodes.forEach(n => { svg += `<g transform="translate(${n.x}, ${n.y})"><circle r="45" fill="#fff" stroke="#c0a062" stroke-width="2"/><text y="5" fill="#333" font-size="15" font-weight="bold" text-anchor="middle">${escapeHtml(n.name)}</text></g>`; });
    area.innerHTML = svg + `</svg>`;
}

function exportData() { const dataStr = JSON.stringify(localStoriesCache, null, 2); const blob = new Blob([dataStr], {type: "application/json"}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup.json`; a.click(); }
function importData(e) { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = (ev) => { try { let imp = JSON.parse(ev.target.result); if(!Array.isArray(imp)) imp = imp.stories || [imp]; let nc = [...localStoriesCache]; imp.forEach(x => { if(x.id && x.title) { const idx = nc.findIndex(y => y.id === x.id); if(idx === -1) nc.push(x); else nc[idx] = x; } }); saveStories(nc); renderWorkspace(); showToast("导入成功"); } catch(err) { showToast("格式错误"); } }; r.readAsText(f); }

// ================= 播放器核心 =================
let currNodeId = null, isTyping = false, typeTimer = null, chIdx = 0, txt = "", hist = [], isAuto = false, isSkip = false, autoT = null, skipT = null, playStoryId = null, playChap = null;
let currentVars = [];

function previewChapter() {
    if (!currentManageId || !currentChapterId) return;
    window._isPreview = true;
    window._pendingResume = null;
    location.hash = `#play/${currentManageId}/${currentChapterId}`;
}

function startPlayer(sid, cid) {
    playStoryId = sid; 
    const s = getStories().find(x => x.id === sid); 
    if (!s) return;
    playChap = (s.chapters || []).find(x => x.id === cid);
    if (!playChap) { showToast("章节不存在"); location.hash = `#detail/${sid}`; return; }
    
    document.getElementById('bg-layer').style.backgroundImage = s.bg ? `url('${s.bg}')` : 'none';
    ['left', 'center', 'right'].forEach(pos => { const f = document.getElementById('figure-layer-' + pos); if (f) f.style.display = 'none'; });
    document.getElementById('choices-container').style.display = 'none';
    document.getElementById('bgm-player').pause(); 
    hist = []; updateHist(); 
    isAuto = false; isSkip = false; 
    clearTimeout(autoT); clearTimeout(skipT); 
    document.getElementById('btn-auto').style.color = '#fff'; 
    document.getElementById('btn-skip').style.color = '#fff';
    
    // ===== 状态恢复 =====
    const ps = loadPlayState(sid);
    const rp = window._pendingResume;
    window._pendingResume = null;
    
    if (rp && rp.chapterId === cid) {
        currentVars = Array.isArray(rp.vars) ? [...rp.vars] : [];
        ps.pendingEntry = rp.pendingEntry || '';
        ps.vars = [...currentVars];
        savePlayState(sid, ps);
    } else {
        currentVars = Array.isArray(ps.vars) ? [...ps.vars] : [];
    }
    
    // ===== 选择起始节点 =====
    let chosen = null;
    
    // 1. 断点恢复（章节匹配时才用）
    if (rp && rp.chapterId === cid && rp.nodeId) {
        chosen = (playChap.nodes || []).find(n => n.id === rp.nodeId) || null;
    }
    // 2. pendingEntry 匹配任意带 entryKey 的节点
    if (!chosen && ps.pendingEntry) {
        chosen = (playChap.nodes || []).find(n => (n.entryKey || '') === ps.pendingEntry) || null;
    }
    // 3. 默认 start 节点（无 entryKey 优先）
    if (!chosen) {
        const startNodes = (playChap.nodes || []).filter(n => n.type === 'start');
        chosen = startNodes.find(n => !n.entryKey) || startNodes[0] || null;
    }
    
    if (!chosen) {
        showToast("本章无可用入口节点，请检查节点编辑器");
        location.hash = `#detail/${sid}`;
        return;
    }
    
    currNodeId = chosen.id;
    processNode();
}

function processNode() {
    clearTimeout(autoT); clearTimeout(skipT);
    saveReadProgress();  // 保存断点（每次进入新节点）
    
    const n = (playChap.nodes || []).find(x => x.id === currNodeId);
    if (!n) { showChapterEnd(""); return; }
    if (n.type === 'end') { showChapterEnd(n.text || ""); return; }
    if (n.type === 'start') { nextNode(); return; }

    if ((n.type === 'dialogue' || n.type === 'narration') && n.setVars) {
        const varsToAdd = splitConditions(n.setVars);
        varsToAdd.forEach(v => { if (!currentVars.includes(v)) currentVars.push(v); });
    }

    if (n.type === 'bgm') { const a = document.getElementById('bgm-player'); if(n.bgm) { a.src = n.bgm; a.play().catch(()=>{}); } else { a.pause(); a.src = ''; } nextNode(); return; }
    
    if (n.type === 'illustration') { 
        const bg = document.getElementById('bg-layer'); 
        if (n.hide) { bg.style.backgroundImage = 'none'; } else if (n.img) { bg.style.backgroundImage = `url('${n.img}')`; }
        nextNode(); return; 
    }
    
    if (n.type === 'figure') { 
        const fLeft = document.getElementById('figure-layer-left');
        const fCenter = document.getElementById('figure-layer-center');
        const fRight = document.getElementById('figure-layer-right');
        let action = n.action || (n.hide ? 'hide' : 'show');
        let pos = n.pos || (n.hide ? 'all' : 'center');

        if (action === 'hide') {
            if (pos === 'all' || pos === 'left') { if(fLeft) fLeft.style.display = 'none'; }
            if (pos === 'all' || pos === 'center') { if(fCenter) fCenter.style.display = 'none'; }
            if (pos === 'all' || pos === 'right') { if(fRight) fRight.style.display = 'none'; }
        } else {
            let targetEl = fCenter;
            if (pos === 'left') targetEl = fLeft;
            if (pos === 'right') targetEl = fRight;
            if (targetEl) {
                if (n.img) { targetEl.src = n.img; targetEl.style.display = 'block'; } else { targetEl.style.display = 'none'; }
            }
        }
        nextNode(); return; 
    }

    if (n.type === 'branch') {
        const ed = (playChap.edges || []).filter(x => x.from === currNodeId);
        if (ed.length > 0) { showChoices(ed, n); }
        else {
            document.getElementById('textbox-container').style.display = 'block';
            document.getElementById('char-name').style.display = 'none';
            document.getElementById('dialogue-text').innerText = "【剧情缺失：当前分支节点未连线】";
            document.getElementById('next-indicator').style.display = 'block';
        }
        return;
    }

    if (n.type === 'dialogue' || n.type === 'narration') {
        document.getElementById('textbox-container').style.display = 'block';
        const nEl = document.getElementById('char-name');
        if (n.type === 'narration') { nEl.style.display = 'none'; } else { nEl.style.display = 'flex'; nEl.innerText = n.name || '角色'; }
        txt = n.text || '...'; chIdx = 0; document.getElementById('dialogue-text').innerText = ""; document.getElementById('next-indicator').style.display = 'none'; isTyping = true;
        hist.push({ name: n.type === 'dialogue' ? n.name : '旁白', text: n.text }); updateHist();

        if (isSkip) { document.getElementById('dialogue-text').innerText = txt; isTyping = false; document.getElementById('next-indicator').style.display = 'block'; skipT = setTimeout(nextNode, 100); } else typeText();
    }
}

function typeText() { if (chIdx < txt.length) { document.getElementById('dialogue-text').innerText += txt.charAt(chIdx); chIdx++; typeTimer = setTimeout(typeText, isSkip ? 10 : 30); } else { isTyping = false; document.getElementById('next-indicator').style.display = 'block'; if (isAuto) autoT = setTimeout(nextNode, 1500); if (isSkip) skipT = setTimeout(nextNode, 100); } }
function nextLine() { if (isTyping) { clearTimeout(typeTimer); document.getElementById('dialogue-text').innerText = txt; isTyping = false; document.getElementById('next-indicator').style.display = 'block'; if (isAuto) autoT = setTimeout(nextNode, 1500); if (isSkip) skipT = setTimeout(nextNode, 100); } else { nextNode(); } }
document.getElementById('textbox-container').onclick = nextLine;
document.addEventListener('keydown', (e) => { if (document.getElementById('view-player').classList.contains('active') && (e.code === 'Space' || e.code === 'Enter')) nextLine(); });
function toggleAuto() { isAuto = !isAuto; isSkip = false; document.getElementById('btn-auto').style.color = isAuto ? '#c0a062' : '#fff'; document.getElementById('btn-skip').style.color = '#fff'; if (isAuto && !isTyping) autoT = setTimeout(nextNode, 1500); else clearTimeout(autoT); clearTimeout(skipT); }
function toggleSkip() { isSkip = !isSkip; isAuto = false; document.getElementById('btn-skip').style.color = isSkip ? '#c0a062' : '#fff'; document.getElementById('btn-auto').style.color = '#fff'; if (isSkip) { if (isTyping) { clearTimeout(typeTimer); document.getElementById('dialogue-text').innerText = txt; isTyping = false; document.getElementById('next-indicator').style.display = 'block'; } skipT = setTimeout(nextNode, 100); } else clearTimeout(skipT); clearTimeout(autoT); }
document.addEventListener('click', e => { const p = document.getElementById('history-panel'); if (p && p.classList.contains('open')) { if (!p.contains(e.target) && !e.target.closest('button[onclick="toggleHistory()"]')) p.classList.remove('open'); } });
function updateHist() { const l = document.getElementById('history-list'); l.innerHTML = hist.map(h => `<div style="margin-bottom:10px;"><div style="color:#888;font-size:0.9em;">${escapeHtml(h.name)}</div><div style="color:#ddd;">${escapeHtml(h.text)}</div></div>`).join(''); l.scrollTop = l.scrollHeight; }
function toggleHistory() { document.getElementById('history-panel').classList.toggle('open'); }

function showChoices(eds, branchNode) { 
    document.getElementById('textbox-container').style.display = 'none'; 
    const c = document.getElementById('choices-container'); 
    c.innerHTML = ''; 
    
    const validEds = eds.filter(ed => {
        if (ed.branchIndex === undefined) return true;
        const opt = branchNode.options[ed.branchIndex];
        if (!opt) return false;
        const reqs = splitConditions(opt.reqVars);
        if (reqs.length === 0) return true;
        return reqs.every(r => currentVars.includes(r));
    });

    if (validEds.length === 0) {
        document.getElementById('textbox-container').style.display = 'block';
        document.getElementById('char-name').style.display = 'none';
        document.getElementById('dialogue-text').innerText = "【你似乎缺少了某些关键的线索，无法做出选择。请检查剧情变量或联系作者。】";
        document.getElementById('next-indicator').style.display = 'none';
        document.getElementById('textbox-container').onclick = exitPlayer;
        return;
    }

    validEds.forEach((ed, i) => { 
        const btn = document.createElement('button'); 
        btn.className = 'choice-btn'; 
        const opt = (branchNode && branchNode.options && ed.branchIndex !== undefined && branchNode.options[ed.branchIndex]) ? branchNode.options[ed.branchIndex] : null;
        btn.innerText = opt ? opt.text : `选项 ${i+1}`; 
        btn.onclick = () => { 
            // 跨章伏笔：持久化 pendingEntry（会一直保留，直到被新的分支选择覆盖）
            if (opt && opt.nextEntry) {
                const ps = loadPlayState(playStoryId);
                ps.pendingEntry = opt.nextEntry;
                ps.vars = [...currentVars];
                savePlayState(playStoryId, ps);
            }
            c.style.display = 'none'; 
            currNodeId = ed.to; 
            processNode(); 
        }; 
        c.appendChild(btn); 
    }); 
    c.style.display = 'flex'; 
}

function nextNode() {
    clearTimeout(autoT); clearTimeout(skipT);
    const ed = (playChap.edges || []).find(e => e.from === currNodeId);
    if (ed) {
        currNodeId = ed.to; processNode();
    } else {
        const n = playChap.nodes.find(x => x.id === currNodeId);
        if (n && n.type !== 'end') {
            document.getElementById('textbox-container').style.display = 'block';
            document.getElementById('char-name').style.display = 'none';
            document.getElementById('dialogue-text').innerText = "【剧情断裂：作者尚未连接后续节点，点击退出】";
            document.getElementById('next-indicator').style.display = 'none';
            document.getElementById('textbox-container').onclick = exitPlayer;
        } else {
            showChapterEnd("");
        }
    }
}

function showChapterEnd(t) {
    document.getElementById('textbox-container').style.display = 'none';
    const ov = document.getElementById('chapter-end-overlay'), c = document.getElementById('end-content-area');
    if (playChap) { let rh = []; try { rh = JSON.parse(safeGetLocal('vn_read_history') || '[]'); } catch(e){} if (!rh.includes(playChap.id)) { rh.push(playChap.id); safeSetLocal('vn_read_history', JSON.stringify(rh)); } }

    c.innerHTML = t && t.trim() ? `<h3 style="color:#c0a062; margin-bottom:15px; text-align:center;">结局</h3><p style="white-space:pre-wrap; text-align:justify;">${escapeHtml(t)}</p>` : `<h3 style="color:#c0a062; margin-bottom:15px; text-align:center;">本章已看完</h3>`;
    ov.classList.add('active');

    const s = getStories().find(x => x.id === playStoryId);
    const ci = (s.chapters || []).findIndex(x => x.id === playChap.id);
    const nb = document.getElementById('btn-next-chapter');

    if (ci >= 0 && ci < s.chapters.length - 1) {
        nb.style.display = 'block'; nb.disabled = false; nb.style.opacity = '1'; nb.style.cursor = 'pointer';
    } else {
        nb.style.display = 'block'; nb.disabled = true; nb.style.opacity = '0.5'; nb.style.cursor = 'not-allowed';
    }
}

function goNextChapter() {
    const s = getStories().find(x => x.id === playStoryId), ci = (s.chapters || []).findIndex(x => x.id === playChap.id);
    if (ci >= 0 && ci < s.chapters.length - 1) {
        document.getElementById('chapter-end-overlay').classList.remove('active');
        location.hash = `#play/${s.id}/${s.chapters[ci+1].id}`;
    }
}
function goHomeFromEnd() { document.getElementById('chapter-end-overlay').classList.remove('active'); document.getElementById('bgm-player').pause(); location.hash = '#workspace'; }
function goBackFromEnd() { document.getElementById('chapter-end-overlay').classList.remove('active'); document.getElementById('bgm-player').pause(); location.hash = `#detail/${playStoryId}`; }

function exitPlayer() {
    clearTimeout(autoT); clearTimeout(skipT);
    document.getElementById('bgm-player').pause();
    document.getElementById('textbox-container').onclick = nextLine;
    saveReadProgress();
    if (window._isPreview) {
        window._isPreview = false;
        location.hash = `#manage/${playStoryId}/node-editor/${playChap.id}`;
    } else {
        location.hash = `#detail/${playStoryId}`;
    }
}

// ================= 地图编辑器 =================
let isDrawing = false, brushColor = '#2E8B57';
function setBrush(c, b) { brushColor = c; document.querySelectorAll('.brush-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); }
function zoomMap(v) { const g = document.getElementById('map-grid'); if(g) { g.style.gridTemplateColumns = `repeat(40, ${v}px)`; g.style.gridTemplateRows = `repeat(40, ${v}px)`; } }
function switchPlotTab(t) { document.getElementById('tab-plot-list').classList.toggle('active', t==='list'); document.getElementById('tab-plot-map').classList.toggle('active', t==='map'); document.getElementById('plot-content-list').style.display = t==='list'?'flex':'none'; document.getElementById('plot-content-map').style.display = t==='map'?'block':'none'; if(t==='map') renderMapEditor(); }
function renderMapEditor() {
    const s = getStories().find(x => x.id === currentManageId); if(!s) return;
    let wr = document.querySelector('.map-grid-wrapper'); if (!wr) { document.getElementById('map-viewport').innerHTML = '<div class="map-grid-wrapper" id="map-grid-wrapper"><div class="map-grid" id="map-grid"></div></div>'; wr = document.getElementById('map-grid-wrapper'); }
    const g = document.getElementById('map-grid'); g.innerHTML = ''; const md = s.mapGrid || new Array(1600).fill('transparent'); zoomMap(document.getElementById('map-zoom').value);
    
    md.forEach((c, i) => { 
        const cell = document.createElement('div'); cell.className = 'map-cell'; cell.style.backgroundColor = c; 
        cell.onpointerdown = (e) => { isDrawing = true; drawCell(cell, i); e.preventDefault(); }; 
        cell.onpointerenter = () => { if (isDrawing) drawCell(cell, i); }; 
        g.appendChild(cell); 
    });
    document.onpointerup = () => { isDrawing = false; };
    
    (s.plots || []).forEach(p => {
        const pin = document.createElement('div'); pin.className = 'map-pin'; pin.style.left = `${p.x}%`; pin.style.top = `${p.y}%`; pin.innerHTML = `<div style="font-size:24px;">📍</div><div style="font-size:12px; background:rgba(0,0,0,0.8); color:#fff; padding:2px 6px; border-radius:4px; white-space:nowrap;">${escapeHtml(p.title)}</div>`;
        pin.onpointerdown = (e) => {
            e.stopPropagation(); e.preventDefault(); 
            const sx = e.clientX, sy = e.clientY, r = g.getBoundingClientRect(), il = parseFloat(pin.style.left), it = parseFloat(pin.style.top);
            const mm = (ev) => { let nx = il + ((ev.clientX - sx) / r.width) * 100, ny = it + ((ev.clientY - sy) / r.height) * 100; nx = Math.max(0, Math.min(100, nx)); ny = Math.max(0, Math.min(100, ny)); pin.style.left = `${nx}%`; pin.style.top = `${ny}%`; };
            const mu = () => { document.removeEventListener('pointermove', mm); document.removeEventListener('pointerup', mu); document.removeEventListener('pointercancel', mu); const st = getStories().find(x => x.id === currentManageId), tg = st.plots.find(x => x.id === p.id); if (tg) { tg.x = parseFloat(pin.style.left); tg.y = parseFloat(pin.style.top); saveStories(getStories()); showToast("已保存"); } };
            document.addEventListener('pointermove', mm); document.addEventListener('pointerup', mu); document.addEventListener('pointercancel', mu);
        };
        g.appendChild(pin);
    });
}
function drawCell(c, i) { c.style.backgroundColor = brushColor; const s = getStories().find(x => x.id === currentManageId); if (!s.mapGrid) s.mapGrid = new Array(1600).fill('transparent'); s.mapGrid[i] = brushColor; saveStories(getStories()); }

function openCreateStoryModal() {
    openModal("创建新小说", `<div class="form-group"><label>标题</label><input type="text" id="m-title" value=""></div>`, () => {
        const title = document.getElementById('m-title').value; if(!title) return showToast("请输入标题");
        let authorName = '', authorAvatar = DEFAULT_AVATAR;
        if (currentUser) {
            const p = globalProfilesCache[currentUser.id];
            authorName   = (p && p.username)   ? p.username   : (safeGetLocal('user_name_'   + currentUser.id) || '未命名用户');
            authorAvatar = (p && p.avatar_url) ? p.avatar_url : (safeGetLocal('user_avatar_' + currentUser.id) || DEFAULT_AVATAR);
        }
        const stories = getStories();
        stories.push({ id: 'story_' + Date.now(), title, author: authorName, author_avatar: authorAvatar, intro: '', status: 'private', cover: '', tags: [], chapters: [], characters: [], plots: [], wiki: [], relationships: [], mapGrid: new Array(1600).fill('transparent'), is_draft: true });
        saveStories(stories); renderWorkspace();
    });
}