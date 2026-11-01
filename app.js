// ================= 配置区 =================
const SUPABASE_URL = 'https://opzllintslozjchwjcjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wemxsaW50c2xvempjaHdqY2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NjQxNzksImV4cCI6MjEwOTA0MDE3OX0.jrPeGJqWj2oN4hiqjNoSfEsY-U2g06SSEOwmdK6PbAg';

let supabaseClient = null;
let currentUser = null;
let localStoriesCache = []; 
let currentViewingProfile = null; 

// ================= 安全与工具 =================
function safeGetLocal(k){try{return localStorage.getItem(k)}catch(e){return null}}
function safeSetLocal(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function safeBind(id,e,f){const el=document.getElementById(id);if(el)el[e]=f}

// ================= 初始化 =================
function initApp() {
    const statusEl = document.getElementById('cloud-status');
    let raw = safeGetLocal('vn_stories');
    if (raw) { try { localStoriesCache = JSON.parse(raw); } catch(e) {} }
    
    if (localStoriesCache.length === 0) {
        localStoriesCache = [getDefaultStory()];
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache));
    }

    router(); // 先渲染本地

    if (typeof window.supabase !== 'undefined') {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            if(statusEl) { statusEl.innerText = '连接云端中...'; statusEl.style.color = '#c0a062'; }
            checkSession();
        } catch(e) { if(statusEl) statusEl.innerText = '本地模式'; }
    } else { if(statusEl) statusEl.innerText = '本地模式'; }

    safeBind('confirm-ok-btn', 'onclick', () => { if (confirmCallback) confirmCallback(); closeConfirm(); });
}

function getDefaultStory() {
    let map = new Array(1600).fill('transparent');
    for (let y = 0; y < 40; y++) { for (let x = 0; x < 40; x++) { let idx = y * 40 + x; if (x < 20) map[idx] = '#2E8B57'; if (x >= 25) map[idx] = '#4682B4'; if (x >= 15 && x < 25 && y > 20) map[idx] = '#4682B4'; if (x >= 20 && x < 25 && y <= 20) map[idx] = '#2E8B57'; } }
    return {
        id: 'story_1793443325138', title: 'Rainative', author: '寒流偏暖', intro: '这是一个关于末日、大雨和希望的故事...', status: 'private', cover: 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop', tags: [], chapters: [], 
        characters: [{ id: 'char_1', name: '我', desc: '主角，可男可女' }, { id: 'char_2', name: '露薇娅', desc: '你在天台遇到的白毛少女，她拥有深邃的蓝瞳孔，飘逸洁白的长发和柔软的白色连衣裙，看起来与这个世界格格不入，她会是谁呢......？' }, { id: 'char_3', name: '苏珊', desc: '你们因为一碗蘑菇汤相识成为朋友，在绝境中萌生的善意、向着太阳的希望，教会你打败其他人、脱离苦海的是......' }],
        plots: [{ id: 'plot_1', title: '大楼', desc: '末日后的安全屋', x: 25, y: 55 }], wiki: [], relationships: [], mapGrid: map, is_draft: true 
    };
}

async function checkSession() {
    if(!supabaseClient) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) { currentUser = session.user; updateAuthUI(); }
        document.getElementById('cloud-status').innerText = '🟢 已连接云端';
        document.getElementById('cloud-status').style.color = '#52c41a';
        await pullFromCloud(); 
    } catch(e) { document.getElementById('cloud-status').innerText = '🔴 连接失败'; }
}

// ================= 账号与主页 =================
function openAuthModal() { const el = document.getElementById('auth-overlay'); if(el) el.classList.add('active'); }
async function handleAuth(type) {
    if(!supabaseClient) return showToast("云端未连接");
    const email = document.getElementById('auth-email').value, password = document.getElementById('auth-password').value;
    if(!email || !password) return showToast("请填写完整");
    
    try {
        let res = type === 'login' ? await supabaseClient.auth.signInWithPassword({ email, password }) : await supabaseClient.auth.signUp({ email, password });
        if (res.error) throw res.error;
        showToast("操作成功"); document.getElementById('auth-overlay').classList.remove('active');
        if (res.data.user) { currentUser = res.data.user; updateAuthUI(); await pullFromCloud(); }
    } catch(e) { 
        // 拦截网络错误，给出明确中文提示
        if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
            showToast("❌ 网络被墙或超时！请开启代理/VPN，或连接手机热点后再试！");
        } else {
            showToast("失败：" + e.message); 
        }
    }
}
async function handleLogout() {
    if(supabaseClient) await supabaseClient.auth.signOut();
    currentUser = null;
    document.getElementById('user-profile-area').style.display = 'none';
    document.getElementById('auth-btn').style.display = 'block';
    document.getElementById('profile-overlay').classList.remove('active');
    renderWorkspace(); await pullFromCloud();
}

function updateAuthUI() {
    if (currentUser) {
        document.getElementById('auth-btn').style.display = 'none';
        document.getElementById('user-profile-area').style.display = 'flex';
        const savedAvatar = safeGetLocal('user_avatar') || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100';
        const savedName = safeGetLocal('user_name') || currentUser.email.split('@')[0];
        document.getElementById('nav-avatar').src = savedAvatar;
        document.getElementById('nav-username').innerText = savedName;
        document.getElementById('profile-avatar').src = savedAvatar;
        document.getElementById('profile-avatar-input').value = savedAvatar;
        document.getElementById('profile-name-input').value = savedName;
    }
}

function openProfileModal() { document.getElementById('profile-overlay').classList.add('active'); }
function saveProfile() {
    safeSetLocal('user_avatar', document.getElementById('profile-avatar-input').value);
    safeSetLocal('user_name', document.getElementById('profile-name-input').value);
    updateAuthUI(); document.getElementById('profile-overlay').classList.remove('active'); showToast("已保存");
    if (window.location.hash.startsWith('#profile/')) renderProfilePage();
}

async function renderProfilePage() {
    const parts = window.location.hash.split('/');
    let targetId = parts[1];
    if(targetId === 'me' && currentUser) targetId = currentUser.id;
    if(!targetId) return location.hash = '#workspace';

    const isMe = currentUser && targetId === currentUser.id;
    document.getElementById('btn-follow').style.display = (isMe || !currentUser) ? 'none' : 'block';
    document.getElementById('btn-edit-profile').style.display = isMe ? 'block' : 'none';
    
    const userName = isMe ? (safeGetLocal('user_name') || currentUser.email.split('@')[0]) : '其他作者';
    const userAvatar = isMe ? (safeGetLocal('user_avatar') || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100') : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100';
    
    document.getElementById('prof-big-avatar').src = userAvatar;
    document.getElementById('prof-big-name').innerText = userName;

    const works = localStoriesCache.filter(s => s.user_id === targetId && s.status === 'public' || (isMe && s.user_id === targetId));
    document.getElementById('prof-works-list').innerHTML = works.map(s => `
        <div class="story-card" onclick="location.hash = '#detail/${s.id}'">
            <img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
            <div class="card-info"><h3>${s.title}</h3><p>${s.status === 'public' ? '公开' : '私密'}</p></div>
        </div>
    `).join('') || '<div style="color:#888;">暂无作品</div>';

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

async function toggleFollow() {
    if(!currentUser) return showToast("请先登录");
    const parts = window.location.hash.split('/');
    const targetId = parts[1];
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
            id: s.id, title: s.title, author: s.author, intro: s.intro, status: s.status, cover: s.cover,
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
    showToast("上传中...");
    try {
        const { error } = await supabaseClient.from('stories').upsert({
            id: story.id, title: story.title, author: story.author, intro: story.intro, status: story.status, cover: story.cover,
            tags: story.tags, chapters: story.chapters, characters: story.characters, plots: story.plots, wiki: story.wiki, relationships: story.relationships, map_grid: story.mapGrid,
            user_id: currentUser.id, is_draft: false
        }, { onConflict: 'id' });
        if (error) throw error;
        story.is_draft = false; story.user_id = currentUser.id;
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache)); renderWorkspace(); showToast("已发布到云端");
    } catch(e) { showToast("失败：" + e.message); }
}

// ================= 路由与核心 =================
let currentManageId = null, currentChapterId = null, currentDetailStory = null;

function router() {
    const hash = window.location.hash || '#workspace';
    const parts = hash.split('/');
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
    const showView = (id) => { const el = document.getElementById(id); if (el) { el.classList.add('active'); el.style.display = 'block'; window.scrollTo(0, 0); } };

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

let toastTimer;
function showToast(msg) { const t = document.getElementById('toast'); if(!t) return; document.getElementById('toast-text').innerText = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000); }
function openModal(title, html, cb) { document.getElementById('modal-title').innerText = title; document.getElementById('modal-content').innerHTML = html; document.getElementById('modal-overlay').classList.add('active'); document.getElementById('modal-confirm-btn').onclick = () => { cb(); closeModal(); }; }
function closeModal() { document.getElementById('modal-overlay').classList.remove('active'); }
let confirmCallback = null;
function showConfirm(title, msg, cb) { document.getElementById('confirm-title').innerText = title; document.getElementById('confirm-msg').innerText = msg; document.getElementById('confirm-overlay').classList.add('active'); confirmCallback = cb; }
function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('active'); }

const getStories = () => localStoriesCache;
const saveStories = (data) => { if (!Array.isArray(data)) return; localStoriesCache = data; safeSetLocal('vn_stories', JSON.stringify(localStoriesCache)); };
// ================= 工作台与广场渲染 =================
function renderWorkspace() {
    const container = document.getElementById('workspace-list');
    if (!container) return;
    if (localStoriesCache.length === 0) { container.innerHTML = '<div style="color:#888; padding:50px; text-align:center; width:100%;">暂无数据。尝试创建或从云端拉取。</div>'; return; }
    
    container.innerHTML = localStoriesCache.map(s => {
        const isMine = currentUser && s.user_id === currentUser.id;
        // 如果本地有 user_id，说明曾经绑定过，只是现在没登录或云端没同步过来
        const isUnbound = !s.user_id; 
        
        let syncStatus = '';
        if (isMine) {
            syncStatus = s.is_draft ? '<span style="color:#c0a062;"> [本地草稿]</span>' : '<span style="color:#52c41a;"> [已发布]</span>';
        } else if (isUnbound) {
            syncStatus = '<span style="color:#c0a062;"> [本地私密]</span>';
        } else {
            syncStatus = '<span style="color:#52c41a;"> [云端作品]</span>'; // 别人的或者断网时的自己作品
        }

        let uploadBtn = '';
        // 只有自己的或者没绑定的草稿才显示上传按钮
        if (isMine || isUnbound) {
            if (currentUser) {
                uploadBtn = `<button class="btn-gold" style="position:absolute; bottom:10px; right:10px; font-size:0.8rem; padding:5px 10px;" onclick="event.stopPropagation(); uploadToCloud('${s.id}')">☁️ ${isUnbound?'绑定并发布':'更新'}</button>`;
            } else {
                uploadBtn = `<button class="btn-gold" style="position:absolute; bottom:10px; right:10px; font-size:0.8rem; padding:5px 10px; background:#666;" onclick="event.stopPropagation(); showToast('请先登录');">登录后发布</button>`;
            }
        }
        
        const canManage = isMine || isUnbound;
        const targetHash = canManage ? `#manage/${s.id}` : `#detail/${s.id}`;
        return `
        <div class="story-card" style="position:relative;" onclick="location.hash = '${targetHash}'">
            <img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
            <div class="card-info"><h3>${s.title} ${syncStatus}</h3><p>作者：${s.author || '未知'}</p></div>
            ${uploadBtn}
        </div>`;
    }).join('');
}

function renderSquare() {
    const list = localStoriesCache.filter(s => {
        // 只要不是草稿，且状态是公开的，就显示在广场
        // 注意：就算你是作者，只要状态是公开的，广场也会显示
        return s.is_draft === false && s.status === 'public';
    });
    const el = document.getElementById('story-list');
    if(el) {
        el.innerHTML = list.map(s => `
            <div class="story-card" onclick="location.hash = '#detail/${s.id}'">
                <img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
                <div class="card-info"><h3>${s.title}</h3><p>作者：${s.author || '未知'}</p></div>
            </div>
        `).join('') || '<div style="color:#888; padding:50px;">广场空空如也，快去发布你的作品吧！</div>';
    }
}

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
    showConfirm("删除小说", "确定要删除这本小说吗？", () => {
        const stories = getStories(); const newStories = stories.filter(s => s.id !== currentManageId);
        saveStories(newStories); location.hash = '#workspace';
    });
}

function renderManageSubPage(page) {
    const story = getStories().find(s => s.id === currentManageId); if (!story) return;
    if (page === 'chapters') {
        const list = story.chapters || [];
        document.getElementById('chapter-list').innerHTML = list.length ? list.map(c => `
            <div class="list-item"><div class="list-item-content"><h4>${c.title}</h4></div>
            <div class="list-item-actions"><button class="text-btn" onclick="location.hash = '#manage/${currentManageId}/node-editor/${c.id}'">编辑</button><button class="text-btn" style="color:#d9534f; margin-left:10px;" onclick="deleteItem('chapters', '${c.id}')">删除</button></div></div>
        `).join('') : `<div style="text-align:center;color:#888;padding:50px;">暂无章节</div>`;
    } else if (page === 'characters') {
        switchCharTab('list');
        let changed = false;
        story.characters = (story.characters || []).map(c => { if (typeof c === 'string') { changed = true; return { id: 'char_' + Date.now(), name: c, desc: '' }; } return c; });
        if (changed) { saveStories(getStories()); }
        document.getElementById('char-count').innerText = `${story.characters.length} 个角色`;
        document.getElementById('char-content-list').innerHTML = story.characters.length ? story.characters.map(c => `
            <div class="list-item"><div class="list-item-content"><h4>${c.name}</h4><p>${c.desc || '暂无'}</p></div><div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('characters', '${c.id}')">删除</button></div></div>
        `).join('') : `<div style="text-align:center;padding:50px;">暂无角色</div>`;
    } else if (page === 'plots') {
        const list = story.plots || [];
        document.getElementById('plot-content-list').innerHTML = list.length ? list.map(p => `
            <div class="list-item"><div class="list-item-content"><h4>${p.title}</h4><p>${p.desc || ''}</p></div><div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('plots', '${p.id}')">删除</button></div></div>
        `).join('') : `<div style="text-align:center;padding:50px;">暂无节点</div>`;
    } else if (page === 'wiki') {
        const list = story.wiki || [];
        document.getElementById('wiki-count').innerText = `共 ${list.length} 个词条`;
        document.getElementById('wiki-list').innerHTML = list.length ? list.map(w => `
            <div class="list-item"><div class="list-item-content"><h4>${w.term}</h4><p>${w.content}</p></div><div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('wiki', '${w.id}')">删除</button></div></div>
        `).join('') : `<div style="text-align:center;padding:50px;">暂无词条</div>`;
    } else if (page === 'edit') {
        document.getElementById('edit-title').value = story.title || ''; document.getElementById('edit-author').value = story.author || '';
        document.getElementById('edit-intro').value = story.intro || ''; document.getElementById('edit-tags').value = (story.tags || []).join('，'); document.getElementById('edit-cover').value = story.cover || '';
    }
}

function goTo(sub) { window.location.hash = `#manage/${currentManageId}/${sub}`; }
function deleteItem(type, id) {
    showConfirm("删除确认", "确定要删除吗？", () => {
        const stories = getStories(); const story = stories.find(s => s.id === currentManageId); if(!story) return;
        story[type] = story[type].filter(item => String(item.id) !== String(id)); saveStories(stories); router();
    });
}

// ================= 详情页 =================
function goToAuthorProfile() {
    if(currentDetailStory && currentDetailStory.user_id) window.location.hash = `#profile/${currentDetailStory.user_id}`;
    else showToast("该作者未绑定账号");
}
function renderDetail(id) {
    const story = getStories().find(s => s.id === id); if (!story) return;
    document.getElementById('detail-cover').src = story.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop';
    document.getElementById('detail-title').innerText = story.title; document.getElementById('detail-author').innerText = `作者：${story.author || '未知'}`;
    document.getElementById('detail-tags').innerHTML = (story.tags || []).map(t => `<span>${t}</span>`).join(''); document.getElementById('detail-intro').innerText = story.intro || '';
    
    const area = document.getElementById('detail-wiki-area'); area.innerHTML = '';
    (story.wiki || []).forEach(w => {
        let isUnlocked = true;
        if (w.unlockChapter) { try { isUnlocked = JSON.parse(safeGetLocal('vn_read_history') || '[]').includes(w.unlockChapter); } catch(e){} }
        if (isUnlocked) area.innerHTML += `<div style="background:#1e1e24; border:1px solid #333; border-radius:8px; padding:15px; min-width:200px;"><h4 style="color:#c0a062; margin-bottom:8px;">${w.term}</h4><p style="color:#ccc; font-size:0.9rem;">${w.content}</p></div>`;
        else area.innerHTML += `<div style="background:#111; border:1px dashed #333; border-radius:8px; padding:15px; min-width:200px; display:flex; align-items:center; justify-content:center; color:#666;">🔒 阅读特定章节后解锁</div>`;
    });

    const mapArea = document.getElementById('detail-map-area');
    if (story.mapGrid && story.mapGrid.some(c => c !== 'transparent')) {
        let gridHtml = `<div style="display:grid; grid-template-columns:repeat(40, 1fr); grid-template-rows:repeat(40, 1fr); width:100%; aspect-ratio:1/1; position:relative; background:#1a1a24;">`;
        story.mapGrid.forEach(color => { gridHtml += `<div style="background:${color}; width:100%; height:100%; border: 1px solid rgba(255,255,255,0.01);"></div>`; });
        gridHtml += `</div>`;
        (story.plots || []).forEach(p => { gridHtml += `<div class="map-pin-detail" style="position:absolute; left:${p.x}%; top:${p.y}%; transform:translate(-50%,-50%); z-index:10; cursor:pointer;" onmouseenter="showMapTooltip(this, '${p.title}', '${(p.desc||'').replace(/'/g, "\\'")}')" onmouseleave="hideMapTooltip(this)"><div style="font-size:24px;">📍</div></div>`; });
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
        let svg = `<svg width="100%" height="100%" viewBox="0 0 800 400">`;
        uniqueRels.forEach(rel => {
            const n1 = nodes.find(n => n.name === rel.from); const n2 = nodes.find(n => n.name === rel.to);
            if (n1 && n2) { svg += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="#555" stroke-width="2" />`; const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2; svg += `<rect x="${mx-30}" y="${my-12}" width="60" height="24" fill="#121212" rx="12" />`; svg += `<text x="${mx}" y="${my+4}" fill="#c0a062" font-size="13" text-anchor="middle" font-weight="bold">${rel.label}</text>`; }
        });
        nodes.forEach(n => { svg += `<g transform="translate(${n.x}, ${n.y})"><circle r="40" fill="#1a1a24" stroke="#c0a062" stroke-width="2"/><text y="5" fill="#fff" font-size="14" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${n.name}</text></g>`; });
        svg += `</svg>`; relArea.innerHTML = svg;
    }

    const btn = document.getElementById('btn-start'); const chapters = story.chapters || [];
    if (chapters.length === 0) { btn.innerText = "暂无章节"; btn.style.background = "#ccc"; btn.onclick = () => showToast("作者还没写呢！"); } 
    else { btn.innerText = "开始观看"; btn.style.background = "#fff"; btn.onclick = () => { window.location.hash = `#play/${story.id}/${chapters[0].id}`; }; }
}

// ================= 节点编辑器 =================
function renderNodeEditor() {
    const story = getStories().find(s => s.id === currentManageId); if(!story) return;
    const chapter = story.chapters.find(c => c.id === currentChapterId); if (!chapter) return;
    document.getElementById('node-editor-title').innerText = chapter.title || '未命名章节';
    const canvas = document.getElementById('node-canvas'); const svg = document.getElementById('node-svg');
    if(!canvas || !svg) return; canvas.innerHTML = ''; svg.innerHTML = '';
    if (!chapter.nodes) chapter.nodes = []; if (!chapter.edges) chapter.edges = [];
    let needSave = false;
    if (!chapter.nodes.some(n => n.type === 'start')) { chapter.nodes.push({ id: 'n_start_' + Date.now(), type: 'start', x: 100, y: 150 }); needSave = true; }
    if (!chapter.nodes.some(n => n.type === 'end')) { chapter.nodes.push({ id: 'n_end_' + Date.now(), type: 'end', x: 600, y: 150 }); needSave = true; }
    if (needSave) { saveStories(getStories()); }

    chapter.nodes.forEach(node => {
        if (!node || !node.type) return;
        if (node.type === 'branch' && (!node.options || node.options.length < 2)) { node.options = [{ text: '选项A' }, { text: '选项B' }]; }
        let content = '';
        if (node.type === 'dialogue') content = `<b>${node.name || '角色'}</b>: ${node.text || '...'}`;
        else if (node.type === 'narration') content = `<span style="color:#888;">旁白:</span> ${node.text || '...'}`;
        else if (node.type === 'figure') content = `🧍 立绘: ${node.img ? '已设置' : '未设置'}`;
        else if (node.type === 'bgm') content = node.bgm ? (node.bgm.startsWith('http') ? `🔗 BGM: 云端` : `🎵 BGM: 本地`) : `🔇 BGM: 停止`;
        else if (node.type === 'illustration') content = `🖼️ 插图: ${node.img ? '已设置' : '未设置'}`;
        else if (node.type === 'branch') content = `<div style="color:#c0a062; font-weight:bold;">🔀 分支：</div><div style="font-size:0.8rem; margin-top:5px;">A: ${node.options[0].text}<br>B: ${node.options[1].text}</div>`;
        else if (node.type === 'end') content = `🛑 结局: ${node.text ? node.text.substring(0, 10) + '...' : '未命名'}`;
        else content = '开始';

        const div = document.createElement('div'); div.className = 'graph-node'; div.id = `node-${node.id}`; div.style.left = `${node.x || 100}px`; div.style.top = `${node.y || 100}px`;
        let inPort = node.type !== 'start' ? `<div class="node-port port-in port-left" data-node="${node.id}" data-dir="left"></div>` : '';
        let outPort = node.type === 'branch' ? `<div class="node-port port-out port-out-branch-1" data-node="${node.id}" data-branch="0" data-dir="right"></div><div class="node-port port-out port-out-branch-2" data-node="${node.id}" data-branch="1" data-dir="right"></div>` : (node.type !== 'end' ? `<div class="node-port port-out port-right" data-node="${node.id}" data-dir="right"></div>` : '');
        
        div.innerHTML = `<div class="graph-node-header"><span>${node.type.toUpperCase()}</span><span style="cursor:pointer;color:red;" onclick="deleteNode(event, '${node.id}')">×</span></div><div class="graph-node-body" onclick="editNode('${node.id}')">${content}</div>${inPort}${outPort}`;
        canvas.appendChild(div);

        const header = div.querySelector('.graph-node-header');
        header.onmousedown = (e) => {
            if (e.target.tagName === 'SPAN') return;
            let startX = e.clientX - node.x, startY = e.clientY - node.y;
            const move = (ev) => { node.x = ev.clientX - startX; node.y = ev.clientY - startY; div.style.left = `${node.x}px`; div.style.top = `${node.y}px`; drawEdges(chapter.edges); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', () => { document.removeEventListener('mousemove', move); saveStories(getStories()); }, { once: true });
        };
    });
    drawEdges(chapter.edges); bindPorts(chapter);
}

function drawEdges(edges) {
    const svg = document.getElementById('node-svg'); if(!svg) return; svg.innerHTML = ''; if (!edges) return;
    edges.forEach(edge => {
        const fromNode = document.getElementById(`node-${edge.from}`), toNode = document.getElementById(`node-${edge.to}`);
        if (fromNode && toNode) {
            let x1 = fromNode.offsetLeft + fromNode.offsetWidth, y1 = fromNode.offsetTop + fromNode.offsetHeight / 2;
            let x2 = toNode.offsetLeft, y2 = toNode.offsetTop + toNode.offsetHeight / 2;
            if (edge.branchIndex !== undefined) { const p = fromNode.querySelector(`.port-out-branch-${edge.branchIndex + 1}`); if(p) y1 = fromNode.offsetTop + p.offsetTop + 8; } 
            else { if (toNode.offsetLeft + toNode.offsetWidth < fromNode.offsetLeft) { x1 = fromNode.offsetLeft; x2 = toNode.offsetLeft + toNode.offsetWidth; } }
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
        port.onmousedown = (e) => {
            e.stopPropagation(); e.preventDefault();
            const nodeIdA = port.dataset.node, dirA = port.dataset.dir, branchIndex = port.dataset.branch !== undefined ? parseInt(port.dataset.branch) : undefined;
            const nodeA = document.getElementById(`node-${nodeIdA}`); if(!nodeA) return;
            let x1 = dirA === 'right' ? nodeA.offsetLeft + nodeA.offsetWidth : nodeA.offsetLeft, y1 = nodeA.offsetTop + port.offsetTop + 8; 
            const svg = document.getElementById('node-svg');
            let tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); tempPath.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y1}`); tempPath.setAttribute('stroke', '#c0a062'); tempPath.setAttribute('stroke-width', '3'); tempPath.setAttribute('stroke-dasharray', '5,5'); tempPath.setAttribute('fill', 'none'); svg.appendChild(tempPath);
            const onMouseMove = (ev) => { const c = document.getElementById('node-canvas').getBoundingClientRect(); const mX = ev.clientX - c.left, mY = ev.clientY - c.top; tempPath.setAttribute('d', `M ${x1} ${y1} C ${x1 + (dirA==='right'?50:-50)} ${y1}, ${mX + (dirA==='right'?-50:50)} ${mY}, ${mX} ${mY}`); };
            const onMouseUp = (ev) => {
                document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); if (tempPath) tempPath.remove();
                const targetPort = ev.target.closest('.node-port');
                if (targetPort && nodeIdA !== targetPort.dataset.node) {
                    let fromId = nodeIdA, toId = targetPort.dataset.node; if (dirA === 'left') { fromId = toId; toId = nodeIdA; }
                    const st = getStories().find(s => s.id === currentManageId), ch = st.chapters.find(c => c.id === currentChapterId);
                    ch.edges = ch.edges.filter(edge => !(edge.from === fromId && edge.to === toId));
                    ch.edges.push({ from: fromId, to: toId, branchIndex: (dirA === 'right') ? branchIndex : undefined });
                    saveStories(getStories()); renderNodeEditor();
                }
            };
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        };
    });
}

function addNode(type) {
    const st = getStories().find(s => s.id === currentManageId), ch = st.chapters.find(c => c.id === currentChapterId); if (!ch) return;
    if (!ch.nodes) ch.nodes = []; if (!ch.edges) ch.edges = [];
    const c = document.getElementById('node-canvas-container');
    const newNode = { id: 'n_' + Date.now(), type, x: (c?c.scrollLeft:0)+(c?c.offsetWidth:800)/2-110, y: (c?c.scrollTop:0)+(c?c.offsetHeight:600)/2-50, text: '', name: '', bgm: '', img: '' };
    if (type === 'branch') newNode.options = [{ text: '选项A' }, { text: '选项B' }];
    ch.nodes.push(newNode); saveStories(getStories()); renderNodeEditor();
}
function deleteNode(e, id) { e.stopPropagation(); showConfirm("删除", "确认删除节点？", () => { const st = getStories().find(s => s.id === currentManageId), ch = st.chapters.find(c => c.id === currentChapterId); ch.nodes = ch.nodes.filter(n => n.id !== id); ch.edges = ch.edges.filter(e => e.from !== id && e.to !== id); saveStories(getStories()); renderNodeEditor(); }); }
// ================= 编辑节点弹窗 =================
function editNode(id) {
    const story = getStories().find(s => s.id === currentManageId), ch = story.chapters.find(c => c.id === currentChapterId), node = ch.nodes.find(n => n.id === id);
    if (!node || node.type === 'start') return showToast("此节点不可编辑");
    let html = '';
    if (node.type === 'dialogue') html = `<div class="form-group"><label>角色</label><input type="text" id="e-node-name" value="${node.name||''}"></div><div class="form-group"><label>内容</label><textarea id="e-node-text" rows="3">${node.text||''}</textarea></div>`;
    else if (node.type === 'narration') html = `<div class="form-group"><label>旁白</label><textarea id="e-node-text" rows="3">${node.text||''}</textarea></div>`;
    else if (node.type === 'end') html = `<div class="form-group"><label>结局</label><textarea id="e-node-text" rows="4">${node.text||''}</textarea></div>`;
    else if (node.type === 'figure' || node.type === 'illustration') html = `<div class="form-group"><label>图片链接</label><input type="text" id="e-node-img" value="${node.img||''}" oninput="const i=document.getElementById('preview-img'); i.src=this.value; i.style.display=this.value?'block':'none';"><div style="text-align:center;margin-top:10px;"><img id="preview-img" src="${node.img||''}" style="max-width:100%; max-height:150px; display:${node.img?'block':'none'}; margin:0 auto;"></div></div>`;
    else if (node.type === 'bgm') html = `<div class="form-group"><label>上传 BGM</label><input type="file" id="e-node-bgm-file" accept="audio/*" style="width:100%;"></div><div class="form-group"><label>或填直链</label><input type="text" id="e-node-bgm" value="${node.bgm||''}"></div><div style="text-align:right;margin-top:20px;"><button class="text-btn" style="color:#d9534f;" onclick="document.getElementById('clear-bgm-flag').value='1';">清空</button><input type="hidden" id="clear-bgm-flag" value="0"></div>`;
    else if (node.type === 'branch') html = `<div class="form-group"><label>A 选项</label><input type="text" id="e-branch-a" value="${node.options[0]?.text||''}"></div><div class="form-group"><label>B 选项</label><input type="text" id="e-branch-b" value="${node.options[1]?.text||''}"></div>`;
    else return;

    openModal("编辑节点", html, async () => {
        const n = getStories().find(s => s.id === currentManageId).chapters.find(c => c.id === currentChapterId).nodes.find(x => x.id === id);
        if (n.type === 'dialogue') { n.name = document.getElementById('e-node-name').value; n.text = document.getElementById('e-node-text').value; } 
        else if (n.type === 'narration' || n.type === 'end') n.text = document.getElementById('e-node-text').value; 
        else if (n.type === 'figure' || n.type === 'illustration') n.img = document.getElementById('e-node-img').value; 
        else if (n.type === 'branch') n.options = [{text:document.getElementById('e-branch-a').value},{text:document.getElementById('e-branch-b').value}]; 
        else if (n.type === 'bgm') {
            if (document.getElementById('clear-bgm-flag').value === '1') n.bgm = '';
            else if (document.getElementById('e-node-bgm-file').files.length > 0) {
                const file = document.getElementById('e-node-bgm-file').files[0];
                if (supabaseClient && currentUser) {
                    showToast("上传中...");
                    const { data, error } = await supabaseClient.storage.from('audio').upload(`bgm_${Date.now()}_${file.name}`, file);
                    if (!error) n.bgm = supabaseClient.storage.from('audio').getPublicUrl(data.path).data.publicUrl;
                } else {
                    const r = new FileReader(); r.onload = e => { n.bgm = e.target.result; saveStories(getStories()); renderNodeEditor(); }; r.readAsDataURL(file); return;
                }
            } else if (document.getElementById('e-node-bgm').value) n.bgm = document.getElementById('e-node-bgm').value;
        }
        saveStories(getStories()); renderNodeEditor();
    });
}

// ================= 弹出与保存 =================
function openAddChapterModal() { openModal("新章节", `<input type="text" id="m-ch-title" placeholder="标题">`, () => { const t = document.getElementById('m-ch-title').value; if(!t) return; const s = getStories().find(x => x.id === currentManageId); s.chapters.push({ id: 'ch_'+Date.now(), title: t, nodes: [], edges: [] }); saveStories(getStories()); renderManageSubPage('chapters'); }); }
function openAddCharacterModal() { openModal("新角色", `<input type="text" id="m-c-name" placeholder="名字"><textarea id="m-c-desc" rows="3" placeholder="简介" style="margin-top:10px;"></textarea>`, () => { const n = document.getElementById('m-c-name').value; if(!n) return; const s = getStories().find(x => x.id === currentManageId); s.characters.push({ id: 'char_'+Date.now(), name: n, desc: document.getElementById('m-c-desc').value }); saveStories(getStories()); renderManageSubPage('characters'); }); }
function openAddPlotModal() { openModal("新地点", `<input type="text" id="m-p-title" placeholder="名称"><textarea id="m-p-desc" rows="3" placeholder="描述" style="margin-top:10px;"></textarea>`, () => { const t = document.getElementById('m-p-title').value; if(!t) return; const s = getStories().find(x => x.id === currentManageId); s.plots.push({ id: 'plot_'+Date.now(), title: t, desc: document.getElementById('m-p-desc').value, x: 50, y: 50 }); saveStories(getStories()); renderManageSubPage('plots'); }); }
function openAddWikiModal() { openModal("新词条", `<input type="text" id="m-w-term" placeholder="词条名"><textarea id="m-w-content" rows="3" placeholder="内容" style="margin-top:10px;"></textarea><select id="m-w-unlock" style="margin-top:10px;width:100%;padding:5px;"><option value="">所有人可见</option>${getStories().find(x=>x.id===currentManageId).chapters.map(c=>`<option value="${c.id}">读完 ${c.title} 解锁</option>`).join('')}</select>`, () => { const t = document.getElementById('m-w-term').value; if(!t) return; const s = getStories().find(x => x.id === currentManageId); s.wiki.push({ id: 'wiki_'+Date.now(), term: t, content: document.getElementById('m-w-content').value, unlockChapter: document.getElementById('m-w-unlock').value }); saveStories(getStories()); renderManageSubPage('wiki'); }); }
function openAddRelationshipModal() { const s = getStories().find(x=>x.id===currentManageId); if(!s.characters || s.characters.length < 2) return showToast("需要至少2个角色"); const opts = s.characters.map(c=>`<option value="${c.name}">${c.name}</option>`).join(''); openModal("添加关系", `<div class="form-group"><label>A</label><select id="m-rel-from">${opts}</select></div><div class="form-group"><label>B</label><select id="m-rel-to">${opts}</select></div><div class="form-group"><label>标签</label><input type="text" id="m-rel-label"></div>`, () => { const f = document.getElementById('m-rel-from').value, t = document.getElementById('m-rel-to').value, l = document.getElementById('m-rel-label').value; if(f===t || !l) return; s.relationships = s.relationships.filter(r => !(r.from === f && r.to === t) && !(r.from === t && r.to === f)); s.relationships.push({ from: f, to: t, label: l }); saveStories(getStories()); switchCharTab('graph'); }); }
function saveStoryInfo() { const s = getStories().find(x => x.id === currentManageId); s.title = document.getElementById('edit-title').value; s.author = document.getElementById('edit-author').value; s.intro = document.getElementById('edit-intro').value; s.tags = document.getElementById('edit-tags').value.split(/[，,]/); s.cover = document.getElementById('edit-cover').value; saveStories(getStories()); showToast("已保存"); setTimeout(()=>{location.hash=`#manage/${s.id}`}, 500); }
function switchCharTab(t) { document.getElementById('tab-char-list').classList.toggle('active', t==='list'); document.getElementById('tab-char-graph').classList.toggle('active', t==='graph'); document.getElementById('char-content-list').style.display = t==='list'?'flex':'none'; document.getElementById('char-content-graph').style.display = t==='graph'?'block':'none'; if(t==='graph') renderRelationshipGraph(); }

function renderRelationshipGraph() {
    const s = getStories().find(x => x.id === currentManageId); const area = document.getElementById('relationship-graph-area');
    if (!s || !s.characters || s.characters.length < 2) { area.innerHTML = ''; return; }
    const chars = s.characters, rels = s.relationships || [];
    const nodes = chars.map((c, i) => { const a = (i / chars.length) * 2 * Math.PI - Math.PI / 2; return { ...c, x: 400 + 150 * Math.cos(a), y: 250 + 150 * Math.sin(a) }; });
    let svg = `<svg width="100%" height="100%" viewBox="0 0 800 500">`;
    rels.forEach(r => { const n1 = nodes.find(n => n.name === r.from), n2 = nodes.find(n => n.name === r.to); if (n1 && n2) { svg += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="#ccc" stroke-width="2" />`; const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2; svg += `<rect x="${mx-30}" y="${my-12}" width="60" height="24" fill="#fcf9f2" rx="12" /><text x="${mx}" y="${my+4}" fill="#c0a062" font-size="13" text-anchor="middle" font-weight="bold">${r.label}</text>`; } });
    nodes.forEach(n => { svg += `<g transform="translate(${n.x}, ${n.y})"><circle r="45" fill="#fff" stroke="#c0a062" stroke-width="2"/><text y="5" fill="#333" font-size="15" font-weight="bold" text-anchor="middle">${n.name}</text></g>`; });
    area.innerHTML = svg + `</svg>`;
}

// ================= 导出与导入 =================
function exportData() { const dataStr = JSON.stringify(localStoriesCache, null, 2); const blob = new Blob([dataStr], {type: "application/json"}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup.json`; a.click(); }
function importData(e) { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = (ev) => { try { let imp = JSON.parse(ev.target.result); if(!Array.isArray(imp)) imp = imp.stories || [imp]; let nc = [...localStoriesCache]; imp.forEach(x => { if(x.id && x.title) { const idx = nc.findIndex(y => y.id === x.id); if(idx === -1) nc.push(x); else nc[idx] = x; } }); saveStories(nc); renderWorkspace(); showToast("导入成功"); } catch(err) { showToast("格式错误"); } }; r.readAsText(f); }

// ================= 播放器核心 =================
let currNodeId = null, isTyping = false, typeTimer = null, chIdx = 0, txt = "", hist = [], isAuto = false, isSkip = false, autoT = null, skipT = null, playStoryId = null, playChap = null;
function startPlayer(sid, cid) {
    playStoryId = sid; const s = getStories().find(x => x.id === sid); playChap = s.chapters.find(x => x.id === cid);
    document.getElementById('bg-layer').style.backgroundImage = s.bg ? `url('${s.bg}')` : 'none';
    document.getElementById('figure-layer').style.display = 'none'; document.getElementById('choices-container').style.display = 'none';
    document.getElementById('bgm-player').pause(); hist = []; updateHist(); isAuto = false; isSkip = false; clearTimeout(autoT); clearTimeout(skipT); document.getElementById('btn-auto').style.color = '#fff'; document.getElementById('btn-skip').style.color = '#fff';
    const st = (playChap.nodes || []).find(n => n.type === 'start'); if (st) { currNodeId = st.id; processNode(); } else { showToast("无开始节点"); location.hash = `#detail/${sid}`; }
}
function processNode() {
    clearTimeout(autoT); clearTimeout(skipT);
    const n = (playChap.nodes || []).find(x => x.id === currNodeId);
    if (!n || n.type === 'end') { showChapterEnd(n ? n.text : ""); return; }
    if (n.type === 'start') { nextNode(); return; }
    
    if (n.type === 'bgm') { const a = document.getElementById('bgm-player'); if(n.bgm) { a.src = n.bgm; a.play().catch(()=>{}); } else { a.pause(); a.src = ''; } nextNode(); return; }
    if (n.type === 'illustration') { document.getElementById('bg-layer').style.backgroundImage = `url('${n.img}')`; nextNode(); return; }
    if (n.type === 'figure') { const f = document.getElementById('figure-layer'); if(n.img) { f.src = n.img; f.style.display = 'block'; } else { f.style.display = 'none'; } nextNode(); return; }
    if (n.type === 'branch') { const ed = (playChap.edges || []).filter(x => x.from === currNodeId); if (ed.length > 0) showChoices(ed); else nextNode(); return; }
    
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
function updateHist() { const l = document.getElementById('history-list'); l.innerHTML = hist.map(h => `<div style="margin-bottom:10px;"><div style="color:#888;font-size:0.9em;">${h.name}</div><div style="color:#ddd;">${h.text}</div></div>`).join(''); l.scrollTop = l.scrollHeight; }
function toggleHistory() { document.getElementById('history-panel').classList.toggle('open'); }
function showChoices(eds) { document.getElementById('textbox-container').style.display = 'none'; const c = document.getElementById('choices-container'); c.innerHTML = ''; const bn = playChap.nodes.find(x => x.id === currNodeId); eds.forEach((ed, i) => { const btn = document.createElement('button'); btn.className = 'choice-btn'; btn.innerText = (bn && bn.options && ed.branchIndex !== undefined && bn.options[ed.branchIndex]) ? bn.options[ed.branchIndex].text : `选项 ${i+1}`; btn.onclick = () => { c.style.display = 'none'; currNodeId = ed.to; processNode(); }; c.appendChild(btn); }); c.style.display = 'flex'; }
function nextNode() { clearTimeout(autoT); clearTimeout(skipT); const ed = (playChap.edges || []).find(e => e.from === currNodeId); if (ed) { currNodeId = ed.to; processNode(); } else showChapterEnd(""); }
function showChapterEnd(t) { document.getElementById('textbox-container').style.display = 'none'; const ov = document.getElementById('chapter-end-overlay'), c = document.getElementById('end-content-area'); 
    if (playChap) { let rh = []; try { rh = JSON.parse(safeGetLocal('vn_read_history') || '[]'); } catch(e){} if (!rh.includes(playChap.id)) { rh.push(playChap.id); safeSetLocal('vn_read_history', JSON.stringify(rh)); } }
    c.innerHTML = t && t.trim() ? `<h3 style="color:#c0a062; margin-bottom:15px;">结局</h3><p>${t}</p>` : `<h3 style="color:#c0a062; margin-bottom:15px;">本章已看完</h3>`; ov.classList.add('active');
    const s = getStories().find(x => x.id === playStoryId), ci = s.chapters.findIndex(x => x.id === playChap.id), nb = document.getElementById('btn-next-chapter');
    if (ci >= 0 && ci < s.chapters.length - 1) nb.style.display = 'block'; else nb.style.display = 'none';
}
function goNextChapter() { const s = getStories().find(x => x.id === playStoryId), ci = s.chapters.findIndex(x => x.id === playChap.id); if (ci >= 0 && ci < s.chapters.length - 1) { document.getElementById('chapter-end-overlay').classList.remove('active'); location.hash = `#play/${s.id}/${s.chapters[ci+1].id}`; } }
function goHomeFromEnd() { document.getElementById('chapter-end-overlay').classList.remove('active'); document.getElementById('bgm-player').pause(); location.hash = '#workspace'; }
function goBackFromEnd() { document.getElementById('chapter-end-overlay').classList.remove('active'); document.getElementById('bgm-player').pause(); location.hash = `#detail/${playStoryId}`; }
function exitPlayer() { clearTimeout(autoT); clearTimeout(skipT); document.getElementById('bgm-player').pause(); location.hash = `#detail/${playStoryId}`; }

// ================= 地图编辑器 =================
let isDrawing = false, brushColor = '#2E8B57';
function setBrush(c, b) { brushColor = c; document.querySelectorAll('.brush-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); }
function zoomMap(v) { const g = document.getElementById('map-grid'); if(g) { g.style.gridTemplateColumns = `repeat(40, ${v}px)`; g.style.gridTemplateRows = `repeat(40, ${v}px)`; } }
function switchPlotTab(t) { document.getElementById('tab-plot-list').classList.toggle('active', t==='list'); document.getElementById('tab-plot-map').classList.toggle('active', t==='map'); document.getElementById('plot-content-list').style.display = t==='list'?'flex':'none'; document.getElementById('plot-content-map').style.display = t==='map'?'block':'none'; if(t==='map') renderMapEditor(); }
function renderMapEditor() {
    const s = getStories().find(x => x.id === currentManageId); if(!s) return;
    let wr = document.querySelector('.map-grid-wrapper'); if (!wr) { document.getElementById('map-viewport').innerHTML = '<div class="map-grid-wrapper" id="map-grid-wrapper"><div class="map-grid" id="map-grid"></div></div>'; wr = document.getElementById('map-grid-wrapper'); }
    const g = document.getElementById('map-grid'); g.innerHTML = ''; const md = s.mapGrid || new Array(1600).fill('transparent'); zoomMap(document.getElementById('map-zoom').value);
    md.forEach((c, i) => { const cell = document.createElement('div'); cell.className = 'map-cell'; cell.style.backgroundColor = c; cell.onmousedown = (e) => { isDrawing = true; drawCell(cell, i); e.preventDefault(); }; cell.onmouseenter = () => { if (isDrawing) drawCell(cell, i); }; g.appendChild(cell); });
    document.onmouseup = () => { isDrawing = false; };
    (s.plots || []).forEach(p => {
        const pin = document.createElement('div'); pin.className = 'map-pin'; pin.style.left = `${p.x}%`; pin.style.top = `${p.y}%`; pin.innerHTML = `<div style="font-size:24px;">📍</div><div style="font-size:12px; background:rgba(0,0,0,0.8); color:#fff; padding:2px 6px; border-radius:4px; white-space:nowrap;">${p.title}</div>`;
        pin.onmousedown = (e) => {
            e.stopPropagation(); e.preventDefault(); const sx = e.clientX, sy = e.clientY, r = g.getBoundingClientRect(), il = parseFloat(pin.style.left), it = parseFloat(pin.style.top);
            const mm = (ev) => { let nx = il + ((ev.clientX - sx) / r.width) * 100, ny = it + ((ev.clientY - sy) / r.height) * 100; nx = Math.max(0, Math.min(100, nx)); ny = Math.max(0, Math.min(100, ny)); pin.style.left = `${nx}%`; pin.style.top = `${ny}%`; };
            const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); const st = getStories().find(x => x.id === currentManageId), tg = st.plots.find(x => x.id === p.id); if (tg) { tg.x = parseFloat(pin.style.left); tg.y = parseFloat(pin.style.top); saveStories(getStories()); showToast("已保存"); } };
            document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
        };
        g.appendChild(pin);
    });
}
function drawCell(c, i) { c.style.backgroundColor = brushColor; const s = getStories().find(x => x.id === currentManageId); if (!s.mapGrid) s.mapGrid = new Array(1600).fill('transparent'); s.mapGrid[i] = brushColor; saveStories(getStories()); }

// ================= 创建小说 =================
function openCreateStoryModal() {
    openModal("创建新小说", `<div class="form-group"><label>标题</label><input type="text" id="m-title" value=""></div>`, () => {
        const title = document.getElementById('m-title').value; if(!title) return showToast("请输入标题");
        const stories = getStories();
        stories.push({ id: 'story_' + Date.now(), title, author: '', intro: '', status: 'private', cover: '', tags: [], chapters: [], characters: [], plots: [], wiki: [], relationships: [], mapGrid: new Array(1600).fill('transparent'), is_draft: true });
        saveStories(stories); renderWorkspace(); 
    });
}