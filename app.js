// ================= 配置区 =================
const SUPABASE_URL = 'https://opzllintslozjchwjcjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wemxsaW50c2xvempjaHdqY2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NjQxNzksImV4cCI6MjEwOTA0MDE3OX0.jrPeGJqWj2oN4hiqjNoSfEsY-U2g06SSEOwmdK6PbAg';

let supabaseClient = null;
let currentUser = null;
let localStoriesCache = []; 

// ================= 安全工具 =================
function safeGetLocal(key) {
    try { return localStorage.getItem(key); } catch(e) { return null; }
}
function safeSetLocal(key, val) {
    try { localStorage.setItem(key, val); } catch(e) { console.warn("无法写入 localStorage", e); }
}
function safeBind(id, event, func) {
    const el = document.getElementById(id);
    if (el) el[event] = func;
}

// ================= 初始化 =================
function initApp() {
    const statusEl = document.getElementById('cloud-status');
    
    let raw = safeGetLocal('vn_stories');
    if (raw) {
        try { localStoriesCache = JSON.parse(raw); } catch(e) { localStoriesCache = []; }
    }
    
    // 兜底：如果完全没数据，注入你的初始模板
    if (localStoriesCache.length === 0) {
        localStoriesCache = [getDefaultStory()];
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache));
    }

    renderWorkspace();

    if (typeof window.supabase !== 'undefined') {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            if(statusEl) { statusEl.innerText = '正在连接云端...'; statusEl.style.color = '#c0a062'; }
            checkSession();
        } catch(e) {
            if(statusEl) { statusEl.innerText = '🟢 本地模式 (云端失败)'; statusEl.style.color = '#52c41a'; }
        }
    } else {
        if(statusEl) { statusEl.innerText = '🟢 本地模式 (SDK离线)'; statusEl.style.color = '#52c41a'; }
    }

    safeBind('confirm-ok-btn', 'onclick', () => { if (confirmCallback) confirmCallback(); closeConfirm(); });
}

function getDefaultStory() {
    let map = new Array(1600).fill('transparent');
    for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) {
            let idx = y * 40 + x;
            if (x < 20) map[idx] = '#2E8B57';
            if (x >= 25) map[idx] = '#4682B4';
            if (x >= 15 && x < 25 && y > 20) map[idx] = '#4682B4';
            if (x >= 20 && x < 25 && y <= 20) map[idx] = '#2E8B57'; 
        }
    }
    return {
        id: 'story_1793443325138',
        title: 'Rainative',
        author: '寒流偏暖',
        intro: '这是一个关于末日、大雨和希望的故事...',
        status: 'private', cover: 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop',
        tags: [], chapters: [], 
        characters: [
            { id: 'char_1', name: '我', desc: '主角，可男可女' },
            { id: 'char_2', name: '露薇娅', desc: '你在天台遇到的白毛少女，她拥有深邃的蓝瞳孔，飘逸洁白的长发和柔软的白色连衣裙，看起来与这个世界格格不入，她会是谁呢......？' },
            { id: 'char_3', name: '苏珊', desc: '你们因为一碗蘑菇汤相识成为朋友，在绝境中萌生的善意、向着太阳的希望，教会你打败其他人、脱离苦海的是......' }
        ],
        plots: [{ id: 'plot_1', title: '大楼', desc: '末日后的安全屋', x: 25, y: 55 }],
        wiki: [], relationships: [], mapGrid: map,
        is_draft: true // 默认是本地草稿
    };
}

async function checkSession() {
    if(!supabaseClient) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            currentUser = session.user;
            updateAuthUI();
        }
        const statusEl = document.getElementById('cloud-status');
        if(statusEl) { statusEl.innerText = '🟢 已连接云端'; statusEl.style.color = '#52c41a'; }
        if(currentUser) pullFromCloud();
    } catch(e) {
        const statusEl = document.getElementById('cloud-status');
        if(statusEl) { statusEl.innerText = '🔴 云端连接失败'; statusEl.style.color = '#d9534f'; }
    }
}

// ================= 账号系统 =================
function openAuthModal() { 
    const el = document.getElementById('auth-overlay'); if(el) el.classList.add('active'); 
}
async function handleAuth(type) {
    if(!supabaseClient) return showToast("云端未连接，无法登录");
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    if(!email || !password) return showToast("请填写邮箱和密码");
    
    try {
        let res;
        if(type === 'login') res = await supabaseClient.auth.signInWithPassword({ email, password });
        else res = await supabaseClient.auth.signUp({ email, password });
        
        if (res.error) throw res.error;
        showToast(type === 'login' ? "登录成功" : "注册成功，请去邮箱验证");
        document.getElementById('auth-overlay').classList.remove('active');
        
        if (res.data.user) {
            currentUser = res.data.user;
            updateAuthUI();
            await pullFromCloud();
        }
    } catch(e) { showToast("操作失败：" + e.message); }
}

async function handleLogout() {
    if(supabaseClient) await supabaseClient.auth.signOut();
    currentUser = null;
    document.getElementById('user-profile-area').style.display = 'none';
    document.getElementById('auth-btn').style.display = 'block';
    document.getElementById('profile-overlay').classList.remove('active');
    renderWorkspace();
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

function openProfileModal() { 
    document.getElementById('profile-overlay').classList.add('active'); 
    loadMyProfileStats();
}
function saveProfile() {
    const avatarUrl = document.getElementById('profile-avatar-input').value;
    const name = document.getElementById('profile-name-input').value;
    safeSetLocal('user_avatar', avatarUrl);
    safeSetLocal('user_name', name);
    updateAuthUI();
    document.getElementById('profile-overlay').classList.remove('active');
    showToast("个人信息已更新");
}

async function loadMyProfileStats() {
    if(!currentUser || !supabaseClient) return;
    try {
        const { count: followingCount } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', currentUser.id);
        const { count: followerCount } = await supabaseClient.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', currentUser.id);
        
        let statsEl = document.getElementById('profile-stats');
        if(!statsEl) {
            statsEl = document.createElement('div');
            statsEl.id = 'profile-stats';
            statsEl.style.cssText = 'margin: 10px 0; font-size: 0.9rem; color: #888;';
            document.querySelector('#profile-overlay .glass-confirm-box').insertBefore(statsEl, document.querySelector('#profile-overlay .confirm-actions'));
        }
        statsEl.innerHTML = `关注: ${followingCount || 0} | 粉丝: ${followerCount || 0}`;
    } catch(e) { console.log("获取粉丝数据失败", e); }
}

// ================= 云端同步 =================
async function pullFromCloud() {
    if (!currentUser || !supabaseClient) return;
    showToast("正在拉取云端数据...");
    try {
        // 拉取所有我能看的（受 RLS 限制，别人未公开的我看不到）
        const { data, error } = await supabaseClient.from('stories').select('*');
        if (error) throw error;
        
        const cloudStories = data.map(s => ({
            id: s.id, title: s.title, author: s.author, intro: s.intro, status: s.status, cover: s.cover,
            tags: s.tags || [], chapters: s.chapters || [], characters: s.characters || [], plots: s.plots || [], 
            wiki: s.wiki || [], relationships: s.relationships || [], mapGrid: s.map_grid || new Array(1600).fill('transparent'),
            is_draft: false, user_id: s.user_id
        }));

        // 合并逻辑：保留本地未上传的草稿，同时用云端数据覆盖本地已上传的
        let newCache = [];
        
        // 1. 把云端的全拿过来
        cloudStories.forEach(cs => newCache.push(cs));
        
        // 2. 把本地有，但云端没有的（也就是你自己新建还没上传的本地草稿）加进来
        localStoriesCache.forEach(ls => {
            const exists = newCache.find(c => c.id === ls.id);
            if (!exists) {
                newCache.push(ls); // 这是一个纯本地草稿
            }
        });

        localStoriesCache = newCache;
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache));
        renderWorkspace();
        showToast("数据同步成功");
    } catch(e) { showToast("拉取失败：" + e.message); }
}

async function uploadToCloud(storyId) {
    if (!currentUser || !supabaseClient) return showToast("请先登录才能发布！");
    const story = localStoriesCache.find(s => s.id === storyId);
    if (!story) return;

    showToast("正在上传到云端...");
    try {
        const { error } = await supabaseClient.from('stories').upsert({
            id: story.id, title: story.title, author: story.author, intro: story.intro, status: story.status, cover: story.cover,
            tags: story.tags, chapters: story.chapters, characters: story.characters, plots: story.plots, 
            wiki: story.wiki, relationships: story.relationships, map_grid: story.mapGrid,
            user_id: currentUser.id, 
            is_draft: false // 一旦上传，云端标记为已发布
        }, { onConflict: 'id' });
        
        if (error) throw error;
        
        story.is_draft = false;
        story.user_id = currentUser.id;
        safeSetLocal('vn_stories', JSON.stringify(localStoriesCache));
        renderWorkspace();
        showToast("上传成功！已同步到云端。");
    } catch(e) { showToast("上传失败：" + e.message); }
}

// ================= 核心业务逻辑 =================
let currentManageId = null;
let currentChapterId = null;

function router() {
    const hash = window.location.hash || '#workspace';
    const parts = hash.split('/');
    const route = parts[0];
    
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });

    function showView(id) {
        const el = document.getElementById(id);
        if (el) { el.classList.add('active'); el.style.display = 'block'; window.scrollTo(0, 0); }
    }
    
    if (route === '#workspace') { showView('view-workspace'); renderWorkspace(); } 
    else if (route === '#manage') {
        currentManageId = parts[1];
        const story = getStories().find(s => s.id === currentManageId);
        if (!story) {
            showToast("找不到该小说数据，可能已被删除");
            window.location.hash = '#workspace';
            return;
        }
        
        if (parts[2] === 'node-editor') {
            currentChapterId = parts[3];
            showView('view-node-editor');
            renderNodeEditor();
        } else if (parts[2]) { showView('view-' + parts[2]); renderManageSubPage(parts[2]); } 
        else { showView('view-manage'); renderManageMain(); }
    } 
    else if (route === '#square') { showView('view-square'); renderSquare(); } 
    else if (route === '#detail') { showView('view-detail'); renderDetail(parts[1]); } 
    else if (route === '#play') { showView('view-player'); startPlayer(parts[1], parts[2]); }
}
window.addEventListener('hashchange', router);
window.addEventListener('load', initApp); 

let toastTimer;
function showToast(msg) {
    const toast = document.getElementById('toast');
    if(!toast) return;
    document.getElementById('toast-text').innerText = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function openModal(title, htmlContent, confirmCallback) {
    const titleEl = document.getElementById('modal-title');
    const contentEl = document.getElementById('modal-content');
    const overlayEl = document.getElementById('modal-overlay');
    const btnEl = document.getElementById('modal-confirm-btn');
    
    if(titleEl) titleEl.innerText = title;
    if(contentEl) contentEl.innerHTML = htmlContent;
    if(overlayEl) overlayEl.classList.add('active');
    if(btnEl) btnEl.onclick = () => { confirmCallback(); closeModal(); };
}
function closeModal() { 
    const el = document.getElementById('modal-overlay'); if(el) el.classList.remove('active'); 
}

let confirmCallback = null;
function showConfirm(title, msg, callback) {
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-msg');
    const overlayEl = document.getElementById('confirm-overlay');
    
    if(titleEl) titleEl.innerText = title;
    if(msgEl) msgEl.innerText = msg;
    if(overlayEl) overlayEl.classList.add('active');
    confirmCallback = callback;
}
function closeConfirm() { 
    const el = document.getElementById('confirm-overlay'); if(el) el.classList.remove('active'); 
}

const getStories = () => localStoriesCache;
const saveStories = (data) => {
    if (!Array.isArray(data)) return;
    localStoriesCache = data;
    safeSetLocal('vn_stories', JSON.stringify(localStoriesCache));
};

// ================= 页面渲染 =================
function renderWorkspace() {
    const container = document.getElementById('workspace-list');
    if (!container) return;

    let html = '';
    if (localStoriesCache.length === 0) {
        html += '<div style="color:#888; text-align:center; padding: 50px; width:100%; grid-column: 1/-1;">暂无小说数据。请尝试创建。</div>';
    } else {
        html += localStoriesCache.map(s => {
            const isMine = currentUser && s.user_id === currentUser.id;
            const isUnbound = !s.user_id; // 没有绑定账号的小说（纯本地草稿）
            
            let syncStatus = '';
            if (isMine || isUnbound) {
                if (s.is_draft || isUnbound) {
                    syncStatus = '<span style="color:#c0a062;"> [本地私密]</span>';
                } else {
                    syncStatus = '<span style="color:#52c41a;"> [已同步云端]</span>';
                }
            }

            let uploadBtn = '';
            if (isMine) {
                uploadBtn = `
                    <button class="btn-gold" style="position:absolute; bottom:10px; right:10px; font-size:0.8rem; padding:5px 10px;" onclick="event.stopPropagation(); uploadToCloud('${s.id}')">
                        ☁️ 更新到云端
                    </button>`;
            } else if (isUnbound && currentUser) {
                uploadBtn = `
                    <button class="btn-gold" style="position:absolute; bottom:10px; right:10px; font-size:0.8rem; padding:5px 10px; background:#52c41a;" onclick="event.stopPropagation(); uploadToCloud('${s.id}')">
                        ☁️ 绑定账号并发布
                    </button>`;
            } else if (isUnbound && !currentUser) {
                uploadBtn = `
                    <button class="btn-gold" style="position:absolute; bottom:10px; right:10px; font-size:0.8rem; padding:5px 10px; background:#666;" onclick="event.stopPropagation(); showToast('请先登录再上传');">
                        登录后发布
                    </button>`;
            }
            
            return `
            <div class="story-card" style="position:relative;" onclick="location.hash = '#manage/${s.id}'">
                <img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}">
                <div class="card-info"><h3>${s.title} ${syncStatus}</h3><p>作者：${s.author || '未知'}</p></div>
                ${uploadBtn}
            </div>`
        }).join('');
    }
    container.innerHTML = html;
}

function renderManageMain() {
    const story = getStories().find(s => s.id === currentManageId);
    if (!story) return location.hash = '#workspace';
    
    const titleEl = document.getElementById('manage-title');
    if(titleEl) titleEl.innerText = story.title || '未命名';
    
    const subEl = document.getElementById('manage-subtitle');
    if(subEl) subEl.innerText = story.intro || '';
    
    const metaEl = document.getElementById('manage-meta');
    if(metaEl) metaEl.innerText = `${story.chapters?.length || 0} 章 · ${story.characters?.length || 0} 个角色`;
    
    const toggleEl = document.getElementById('status-toggle');
    if(toggleEl) {
        toggleEl.style.display = 'flex';
        toggleEl.querySelectorAll('span').forEach(span => { 
            span.classList.toggle('active', span.dataset.status === (story.status || 'private')); 
        });
    }
}

function changeStatus(newStatus) {
    const stories = getStories(); const story = stories.find(s => s.id === currentManageId);
    if(!story) return; story.status = newStatus; saveStories(stories); renderManageMain();
}

function deleteStory() {
    showConfirm("删除小说", "确定要删除这本小说吗？此操作不可恢复。", () => {
        const stories = getStories(); const newStories = stories.filter(s => s.id !== currentManageId);
        saveStories(newStories); location.hash = '#workspace';
    });
}

function renderManageSubPage(page) {
    const story = getStories().find(s => s.id === currentManageId);
    if (!story) return;

    if (page === 'chapters') {
        const list = story.chapters || [];
        const el = document.getElementById('chapter-list');
        if(el) el.innerHTML = list.length ? list.map(c => `
            <div class="list-item">
                <div class="list-item-content"><h4>${c.title}</h4></div>
                <div class="list-item-actions">
                    <button class="text-btn" onclick="location.hash = '#manage/${currentManageId}/node-editor/${c.id}'">编辑剧本</button>
                    <button class="text-btn" style="color:#d9534f; margin-left:10px;" onclick="deleteItem('chapters', '${c.id}')">删除</button>
                </div>
            </div>
        `).join('') : `<div style="text-align:center;color:#888;padding:50px;">暂无章节</div>`;
    } else if (page === 'characters') {
        switchCharTab('list');
        let changed = false;
        story.characters = (story.characters || []).map(c => {
            if (typeof c === 'string') { changed = true; return { id: 'char_' + Date.now(), name: c, desc: '' }; }
            return c;
        });
        if (changed) { saveStories(getStories()); }
        const list = story.characters;
        const countEl = document.getElementById('char-count');
        if(countEl) countEl.innerText = `${list.length} 个角色`;
        const contentEl = document.getElementById('char-content-list');
        if(contentEl) contentEl.innerHTML = list.length ? list.map(c => `
            <div class="list-item">
                <div class="list-item-content"><h4>${c.name}</h4><p>${c.desc || '暂无简介'}</p></div>
                <div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('characters', '${c.id}')">删除</button></div>
            </div>
        `).join('') : `<div style="text-align:center;padding:50px;"><p style="color:#888;">还没有角色</p></div>`;
    } else if (page === 'plots') {
        const list = story.plots || [];
        const el = document.getElementById('plot-content-list');
        if(el) el.innerHTML = list.length ? list.map(p => `
            <div class="list-item">
                <div class="list-item-content"><h4>${p.title}</h4><p>${p.desc || ''}</p></div>
                <div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('plots', '${p.id}')">删除</button></div>
            </div>
        `).join('') : `<div style="text-align:center;padding:50px;"><p style="color:#888;">暂无节点</p></div>`;
    } else if (page === 'wiki') {
        const list = story.wiki || [];
        const countEl = document.getElementById('wiki-count');
        if(countEl) countEl.innerText = `共 ${list.length} 个词条`;
        const el = document.getElementById('wiki-list');
        if(el) el.innerHTML = list.length ? list.map(w => `
            <div class="list-item">
                <div class="list-item-content"><h4>${w.term}</h4><p>${w.content}</p></div>
                <div class="list-item-actions"><button class="text-btn" style="color:#d9534f;" onclick="deleteItem('wiki', '${w.id}')">删除</button></div>
            </div>
        `).join('') : `<div style="text-align:center;padding:50px;"><p style="color:#888;">还没有词条</p></div>`;
    } else if (page === 'edit') {
        const titleEl = document.getElementById('edit-title'); if(titleEl) titleEl.value = story.title || '';
        const authEl = document.getElementById('edit-author'); if(authEl) authEl.value = story.author || '';
        const introEl = document.getElementById('edit-intro'); if(introEl) introEl.value = story.intro || '';
        const tagsEl = document.getElementById('edit-tags'); if(tagsEl) tagsEl.value = (story.tags || []).join('，');
        const coverEl = document.getElementById('edit-cover'); if(coverEl) coverEl.value = story.cover || '';
    }
}

function goTo(sub) { window.location.hash = `#manage/${currentManageId}/${sub}`; }
function deleteItem(type, id) {
    showConfirm("删除确认", "确定要删除吗？此操作不可恢复。", () => {
        const stories = getStories(); const story = stories.find(s => s.id === currentManageId);
        if(!story) return;
        story[type] = story[type].filter(item => String(item.id) !== String(id));
        saveStories(stories); router();
    });
}

// ================= 详情页 =================
function renderDetail(id) {
    const story = getStories().find(s => s.id === id); 
    if (!story) return;
    
    const coverEl = document.getElementById('detail-cover'); if(coverEl) coverEl.src = story.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop';
    const titleEl = document.getElementById('detail-title'); if(titleEl) titleEl.innerText = story.title;
    
    const authorEl = document.getElementById('detail-author');
    if (authorEl) {
        authorEl.innerText = `作者：${story.author || '未知'}`;
        if (story.user_id) {
            authorEl.onclick = () => openAuthorProfile(story.user_id, story.author);
            authorEl.style.textDecoration = 'underline';
            authorEl.style.cursor = 'pointer';
        } else {
            authorEl.onclick = null;
            authorEl.style.textDecoration = 'none';
        }
    }

    const tagsEl = document.getElementById('detail-tags'); if(tagsEl) tagsEl.innerHTML = (story.tags || []).map(t => `<span>${t}</span>`).join('');
    const introEl = document.getElementById('detail-intro'); if(introEl) introEl.innerText = story.intro || '';

    renderWikiArea(story);

    // 渲染地图
    const mapArea = document.getElementById('detail-map-area');
    if (mapArea) {
        if (story.mapGrid && story.mapGrid.some(c => c !== 'transparent')) {
            mapArea.style.display = 'block';
            let gridHtml = `<div style="display:grid; grid-template-columns:repeat(40, 1fr); grid-template-rows:repeat(40, 1fr); width:100%; aspect-ratio:1/1; position:relative; background:#1a1a24;">`;
            story.mapGrid.forEach(color => { gridHtml += `<div style="background:${color}; width:100%; height:100%; border: 1px solid rgba(255,255,255,0.01);"></div>`; });
            gridHtml += `</div>`;

            (story.plots || []).forEach(p => {
                gridHtml += `
                <div class="map-pin-detail" style="position:absolute; left:${p.x}%; top:${p.y}%; transform:translate(-50%,-50%); z-index:10; cursor:pointer;"
                     onmouseenter="showMapTooltip(this, '${p.title}', '${(p.desc||'').replace(/'/g, "\\'")}')"
                     onmouseleave="hideMapTooltip(this)">
                    <div style="font-size:24px;">📍</div>
                </div>`;
            });
            mapArea.innerHTML = gridHtml;
        } else { mapArea.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#666;">暂无地图</div>`; }
    }

    // 渲染关系图
    const relArea = document.getElementById('detail-relation-area');
    if (relArea) {
        const chars = story.characters || []; 
        let rels = story.relationships || [];
        if (chars.length < 2) { 
            relArea.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#666;">角色太少</div>`; 
        } else {
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
            svg += `</svg>`; 
            relArea.innerHTML = svg;
        }
    }

    const btn = document.getElementById('btn-start'); 
    if(btn) {
        const chapters = story.chapters || [];
        if (chapters.length === 0) { btn.innerText = "暂无章节"; btn.style.background = "#ccc"; btn.onclick = () => showToast("作者还没写呢！"); } 
        else { btn.innerText = "开始观看"; btn.style.background = "#fff"; btn.onclick = () => { window.location.hash = `#play/${story.id}/${chapters[0].id}`; }; }
    }
}

function showMapTooltip(el, title, desc) {
    let tooltip = document.getElementById('map-tooltip');
    if(!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'map-tooltip';
        tooltip.style.cssText = 'position:absolute; background:rgba(0,0,0,0.9); color:#fff; padding:10px; border-radius:8px; font-size:14px; z-index:100; pointer-events:none; border:1px solid #c0a062; white-space:nowrap; box-shadow:0 4px 10px rgba(0,0,0,0.5);';
        const area = document.getElementById('detail-map-area');
        if(area) area.appendChild(tooltip);
    }
    tooltip.innerHTML = `<div style="color:#c0a062; font-weight:bold; margin-bottom:5px;">${title}</div><div style="font-size:12px;">${desc || '暂无详细描述'}</div>`;
    tooltip.style.left = el.style.left;
    tooltip.style.top = `calc(${el.style.top} - 80px)`;
    tooltip.style.display = 'block';
}
function hideMapTooltip(el) {
    const tooltip = document.getElementById('map-tooltip');
    if(tooltip) tooltip.style.display = 'none';
}

function renderWikiArea(story) {
    const area = document.getElementById('detail-wiki-area');
    if(!area) return;
    area.innerHTML = '';
    const wiki = story.wiki || [];
    if (wiki.length === 0) { area.innerHTML = '<span style="color:#666;">暂无词条</span>'; return; }
    
    wiki.forEach(w => {
        const unlockChapterId = w.unlockChapter; 
        let isUnlocked = true;
        if (unlockChapterId) {
            let readHistory = [];
            try { readHistory = JSON.parse(safeGetLocal('vn_read_history') || '[]'); } catch(e){}
            isUnlocked = readHistory.includes(unlockChapterId);
        }
        if (isUnlocked) {
            area.innerHTML += `
            <div style="background:#1e1e24; border:1px solid #333; border-radius:8px; padding:15px; min-width:200px;">
                <h4 style="color:#c0a062; margin-bottom:8px;">${w.term}</h4>
                <p style="color:#ccc; font-size:0.9rem; line-height:1.5;">${w.content}</p>
            </div>`;
        } else {
            area.innerHTML += `
            <div style="background:#111; border:1px dashed #333; border-radius:8px; padding:15px; min-width:200px; display:flex; align-items:center; justify-content:center; color:#666;">
                🔒 阅读特定章节后解锁
            </div>`;
        }
    });
}

// ================= 导出/导入 =================
function exportData() {
    if (localStoriesCache.length === 0) return showToast("没有数据可导出");
    const dataStr = JSON.stringify(localStoriesCache, null, 2);
    const blob = new Blob([dataStr], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story_backup_${new Date().toLocaleDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            let imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) {
                if (imported.stories) imported = imported.stories; 
                else imported = [imported]; 
            }

            if (Array.isArray(imported)) {
                let newData = [...localStoriesCache];
                let addedCount = 0;
                imported.forEach(imp => {
                    if(!imp.id || !imp.title) return; 
                    const idx = newData.findIndex(x => x.id === imp.id);
                    if (idx === -1) { newData.push(imp); addedCount++; }
                    else { newData[idx] = imp; addedCount++; } 
                });
                saveStories(newData);
                renderWorkspace();
                showToast(`成功导入/更新 ${addedCount} 本小说！`);
                event.target.value = ''; 
            }
        } catch (err) { 
            console.error(err);
            showToast("导入失败：文件内容不是有效的 JSON 格式"); 
        }
    };
    reader.readAsText(file);
}

// ================= 编辑器及其他 =================
function renderNodeEditor() {
    const story = getStories().find(s => s.id === currentManageId);
    if(!story) return;
    const chapter = story.chapters.find(c => c.id === currentChapterId);
    if (!chapter) return;
    
    const titleEl = document.getElementById('node-editor-title');
    if(titleEl) titleEl.innerText = chapter.title || '未命名章节';
    
    const canvas = document.getElementById('node-canvas');
    const svg = document.getElementById('node-svg');
    if(!canvas || !svg) return;
    canvas.innerHTML = ''; svg.innerHTML = '';

    if (!chapter.nodes) chapter.nodes = [];
    if (!chapter.edges) chapter.edges = [];

    let hasStart = chapter.nodes.some(n => n.type === 'start');
    let hasEnd = chapter.nodes.some(n => n.type === 'end');
    let needSave = false;

    if (!hasStart) { chapter.nodes.push({ id: 'n_start_' + Date.now(), type: 'start', x: 100, y: 150 }); needSave = true; }
    if (!hasEnd) { chapter.nodes.push({ id: 'n_end_' + Date.now(), type: 'end', x: 600, y: 150 }); needSave = true; }
    if (needSave) { saveStories(getStories()); }

    chapter.nodes.forEach(node => {
        if (!node || !node.type) return;
        
        if (node.type === 'branch' && (!node.options || node.options.length < 2)) { node.options = [{ text: '选项A' }, { text: '选项B' }]; }

        let content = '';
        if (node.type === 'dialogue') content = `<b>${node.name || '角色'}</b>: ${node.text || '...'}`;
        else if (node.type === 'narration') content = `<span style="color:#888;">旁白:</span> ${node.text || '...'}`;
        else if (node.type === 'figure') content = `🧍 立绘: ${node.img ? '已设置' : '未设置'}`;
        else if (node.type === 'bgm') {
            if (!node.bgm) content = `🔇 BGM: 停止播放`;
            else if (node.bgm.startsWith('http')) content = `🔗 BGM: 云端链接`;
            else content = `🎵 BGM: 本地文件`;
        }
        else if (node.type === 'illustration') content = `🖼️ 插图: ${node.img ? '已设置' : '未设置'}`;
        else if (node.type === 'branch') {
            content = `<div style="color:#c0a062; font-weight:bold;">🔀 分支：</div>
                       <div style="font-size:0.8rem; margin-top:5px;">A: ${node.options[0].text || '未命名'}<br>B: ${node.options[1].text || '未命名'}</div>`;
        }
        else if (node.type === 'end') content = `🛑 结局: ${node.text ? node.text.substring(0, 10) + (node.text.length > 10 ? '...' : '') : '未命名'}`;
        else content = '开始';

        const div = document.createElement('div');
        div.className = 'graph-node'; div.id = `node-${node.id}`; div.style.left = `${node.x || 100}px`; div.style.top = `${node.y || 100}px`;
        
        let inPort = node.type !== 'start' ? `<div class="node-port port-in port-left" data-node="${node.id}" data-dir="left"></div>` : '';
        let outPort = '';
        if (node.type === 'branch') {
            outPort = `<div class="node-port port-out port-out-branch-1" data-node="${node.id}" data-branch="0" data-dir="right"></div>
                       <div class="node-port port-out port-out-branch-2" data-node="${node.id}" data-branch="1" data-dir="right"></div>`;
        } else if (node.type !== 'end') {
            outPort = `<div class="node-port port-out port-right" data-node="${node.id}" data-dir="right"></div>`;
        }

        div.innerHTML = `
            <div class="graph-node-header"><span>${node.type.toUpperCase()}</span><span style="cursor:pointer;color:red;" onclick="deleteNode(event, '${node.id}')">×</span></div>
            <div class="graph-node-body" onclick="editNode('${node.id}')">${content}</div>
            ${inPort}${outPort}
        `;
        canvas.appendChild(div);

        const header = div.querySelector('.graph-node-header');
        header.onmousedown = (e) => {
            if (e.target.tagName === 'SPAN') return;
            let startX = e.clientX - node.x; let startY = e.clientY - node.y;
            const move = (ev) => { 
                node.x = ev.clientX - startX; node.y = ev.clientY - startY; 
                div.style.left = `${node.x}px`; div.style.top = `${node.y}px`; drawEdges(chapter.edges); 
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', () => {
                document.removeEventListener('mousemove', move);
                saveStories(getStories()); 
            }, { once: true });
        };
    });
    drawEdges(chapter.edges); bindPorts(chapter);
}

function drawEdges(edges) {
    const svg = document.getElementById('node-svg'); if(!svg) return; svg.innerHTML = ''; if (!edges) return;
    edges.forEach(edge => {
        const fromNode = document.getElementById(`node-${edge.from}`); const toNode = document.getElementById(`node-${edge.to}`);
        if (fromNode && toNode) {
            let x1 = fromNode.offsetLeft + fromNode.offsetWidth; let y1 = fromNode.offsetTop + fromNode.offsetHeight / 2;
            let x2 = toNode.offsetLeft; let y2 = toNode.offsetTop + toNode.offsetHeight / 2;
            
            if (edge.branchIndex !== undefined) {
                const portOut = fromNode.querySelector(`.port-out-branch-${edge.branchIndex + 1}`);
                if(portOut) y1 = fromNode.offsetTop + portOut.offsetTop + 8; 
            } else {
                if (toNode.offsetLeft + toNode.offsetWidth < fromNode.offsetLeft) { x1 = fromNode.offsetLeft; x2 = toNode.offsetLeft + toNode.offsetWidth; }
            }

            const d = `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d); path.setAttribute('stroke', '#c0a062'); path.setAttribute('stroke-width', '3'); path.setAttribute('fill', 'none');
            const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitPath.setAttribute('d', d); hitPath.setAttribute('stroke', 'transparent'); hitPath.setAttribute('stroke-width', '20'); hitPath.setAttribute('fill', 'none'); hitPath.style.pointerEvents = 'stroke'; hitPath.style.cursor = 'pointer';
            
            hitPath.onmouseenter = () => { path.setAttribute('stroke', '#ff4d4f'); path.setAttribute('stroke-width', '4'); };
            hitPath.onmouseleave = () => { path.setAttribute('stroke', '#c0a062'); path.setAttribute('stroke-width', '3'); };
            hitPath.onclick = (e) => {
                e.stopPropagation();
                showConfirm("取消连线", "确定要删除这条连线吗？", () => {
                    const stories = getStories(); const st = stories.find(s => s.id === currentManageId); const ch = st.chapters.find(c => c.id === currentChapterId);
                    ch.edges = ch.edges.filter(e => !(e.from === edge.from && e.to === edge.to && e.branchIndex === edge.branchIndex));
                    saveStories(stories); renderNodeEditor();
                });
            };
            g.appendChild(path); g.appendChild(hitPath); svg.appendChild(g);
        }
    });
}

function bindPorts(chapter) {
    document.querySelectorAll('.node-port').forEach(port => {
        port.onmousedown = (e) => {
            e.stopPropagation(); e.preventDefault();
            const nodeIdA = port.dataset.node; const dirA = port.dataset.dir;
            const branchIndex = port.dataset.branch !== undefined ? parseInt(port.dataset.branch) : undefined;
            const nodeA = document.getElementById(`node-${nodeIdA}`);
            if(!nodeA) return;
            
            let x1 = dirA === 'right' ? nodeA.offsetLeft + nodeA.offsetWidth : nodeA.offsetLeft;
            let y1 = nodeA.offsetTop + port.offsetTop + 8; 
            
            const svg = document.getElementById('node-svg');
            let tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempPath.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y1}`); tempPath.setAttribute('stroke', '#c0a062'); tempPath.setAttribute('stroke-width', '3'); tempPath.setAttribute('stroke-dasharray', '5,5'); tempPath.setAttribute('fill', 'none'); svg.appendChild(tempPath);
            
            const onMouseMove = (ev) => {
                const canvas = document.getElementById('node-canvas'); const rect = canvas.getBoundingClientRect();
                const mouseX = ev.clientX - rect.left; const mouseY = ev.clientY - rect.top;
                tempPath.setAttribute('d', `M ${x1} ${y1} C ${x1 + (dirA==='right'?50:-50)} ${y1}, ${mouseX + (dirA==='right'?-50:50)} ${mouseY}, ${mouseX} ${mouseY}`);
            };
            const onMouseUp = (ev) => {
                document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); if (tempPath) tempPath.remove();
                const targetPort = ev.target.closest('.node-port');
                if (targetPort) {
                    const nodeIdB = targetPort.dataset.node;
                    if (nodeIdA !== nodeIdB) {
                        let fromId = nodeIdA; let toId = nodeIdB;
                        if (dirA === 'left') { fromId = nodeIdB; toId = nodeIdA; }
                        const stories = getStories(); const st = stories.find(s => s.id === currentManageId); const ch = st.chapters.find(c => c.id === currentChapterId);
                        if(!ch.edges) ch.edges = [];
                        ch.edges = ch.edges.filter(edge => !(edge.from === fromId && edge.to === toId));
                        const saveBranchIdx = (dirA === 'right') ? branchIndex : undefined;
                        ch.edges.push({ from: fromId, to: toId, branchIndex: saveBranchIdx });
                        saveStories(stories); renderNodeEditor();
                    }
                }
            };
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        };
    });
}

function addNode(type) {
    const stories = getStories(); const st = stories.find(s => s.id === currentManageId); if (!st) return showToast("找不到数据");
    const ch = st.chapters.find(c => c.id === currentChapterId); if (!ch) return showToast("找不到章节");
    if (!ch.nodes) ch.nodes = []; if (!ch.edges) ch.edges = [];
    const container = document.getElementById('node-canvas-container');
    const x = (container ? container.scrollLeft : 0) + (container ? container.offsetWidth : 800) / 2 - 110; 
    const y = (container ? container.scrollTop : 0) + (container ? container.offsetHeight : 600) / 2 - 50;
    
    const newNode = { id: 'n_' + Date.now() + Math.floor(Math.random()*1000), type: type, x: x, y: y, text: '', name: '', bgm: '', img: '' };
    if (type === 'branch') { newNode.options = [{ text: '选项A' }, { text: '选项B' }]; }
    ch.nodes.push(newNode);
    saveStories(stories); renderNodeEditor();
}

function deleteNode(event, id) {
    event.stopPropagation();
    showConfirm("删除节点", "删除该节点后，相关的连线也会消失，确认删除？", () => {
        const stories = getStories(); const st = stories.find(s => s.id === currentManageId); const ch = st.chapters.find(c => c.id === currentChapterId);
        ch.nodes = ch.nodes.filter(n => n.id !== id); ch.edges = (ch.edges || []).filter(e => e.from !== id && e.to !== id);
        saveStories(stories); renderNodeEditor();
    });
}

function editNode(id) {
    const story = getStories().find(s => s.id === currentManageId); if(!story) return;
    const ch = story.chapters.find(c => c.id === currentChapterId); if(!ch) return;
    const node = (ch.nodes || []).find(n => n.id === id); if (!node) return;
    if (node.type === 'start') return showToast("开始节点无法编辑内容");

    let html = '';
    if (node.type === 'dialogue') {
        html = `<div class="form-group"><label>角色名</label><input type="text" id="e-node-name" value="${node.name||''}"></div><div class="form-group"><label>对话内容</label><textarea id="e-node-text" rows="3">${node.text||''}</textarea></div>`;
    } else if (node.type === 'narration') {
        html = `<div class="form-group"><label>旁白内容</label><textarea id="e-node-text" rows="3">${node.text||''}</textarea></div>`;
    } else if (node.type === 'end') {
        html = `<div class="form-group"><label>结局内容</label><textarea id="e-node-text" rows="4">${node.text||''}</textarea></div>`;
    } else if (node.type === 'figure') {
        html = `<div class="form-group"><label>立绘图片链接（在线URL）</label><input type="text" id="e-node-img" value="${node.img||''}" oninput="const img=document.getElementById('preview-img'); img.src=this.value; img.style.display=this.value?'block':'none';"><div style="margin-top:10px; border:1px dashed #ccc; border-radius:8px; padding:5px; text-align:center;"><img id="preview-img" src="${node.img||''}" style="max-width:100%; max-height:150px; display:${node.img?'block':'none'}; margin:0 auto;" onerror="this.style.display='none'"></div></div>`;
    } else if (node.type === 'bgm') {
        html = `<div class="form-group">
                    <label style="color: #c0a062; font-weight: bold; font-size: 1rem;">⬆️ 上传音乐文件</label>
                    <div style="margin-top: 8px; padding: 15px; border: 2px dashed #c0a062; border-radius: 8px; text-align: center; background: rgba(192,160,98,0.05);">
                        <input type="file" id="e-node-bgm-file" accept="audio/*" style="width: 100%; color: #333;">
                    </div>
                </div>
                <div class="form-group" style="margin-top: 25px; padding-top: 15px; border-top: 1px dashed #ccc;">
                    <label>或者：填写在线音频直链</label>
                    <input type="text" id="e-node-bgm" value="${node.bgm||''}" placeholder="https://... .mp3">
                </div>
                <div class="form-group" style="margin-top: 20px; text-align: right;">
                    <button class="text-btn" style="color:#d9534f; background: rgba(217,83,79,0.1); padding: 8px 15px; border-radius: 6px;" onclick="document.getElementById('clear-bgm-flag').value='1';">🗑️ 清空音乐</button>
                    <input type="hidden" id="clear-bgm-flag" value="0">
                </div>`;
    } else if (node.type === 'illustration') {
        html = `<div class="form-group"><label>背景插图链接</label><input type="text" id="e-node-img" value="${node.img||''}" oninput="const img=document.getElementById('preview-img'); img.src=this.value; img.style.display=this.value?'block':'none';"><div style="margin-top:10px; border:1px dashed #ccc; border-radius:8px; padding:5px; text-align:center;"><img id="preview-img" src="${node.img||''}" style="max-width:100%; max-height:150px; display:${node.img?'block':'none'}; margin:0 auto;" onerror="this.style.display='none'"></div></div>`;
    } else if (node.type === 'branch') {
        html = `<div class="form-group"><label style="color:#c0a062; font-weight:bold;">选项 A</label><input type="text" id="e-branch-a" value="${node.options && node.options[0] ? node.options[0].text : ''}" placeholder="选项A"></div>
                <div class="form-group"><label style="color:#c0a062; font-weight:bold;">选项 B</label><input type="text" id="e-branch-b" value="${node.options && node.options[1] ? node.options[1].text : ''}" placeholder="选项B"></div>`;
    } else { showToast("此节点无需编辑"); return; }

    openModal("编辑节点", html, async () => {
        const stories = getStories(); const st = stories.find(s => s.id === currentManageId); const chData = st.chapters.find(c => c.id === currentChapterId); const n = chData.nodes.find(x => x.id === id);
        
        if (n.type === 'dialogue') { n.name = document.getElementById('e-node-name').value; n.text = document.getElementById('e-node-text').value; saveStories(stories); renderNodeEditor(); } 
        else if (n.type === 'narration' || n.type === 'end') { n.text = document.getElementById('e-node-text').value; saveStories(stories); renderNodeEditor(); } 
        else if (n.type === 'figure' || n.type === 'illustration') { n.img = document.getElementById('e-node-img').value; saveStories(stories); renderNodeEditor(); }
        else if (n.type === 'branch') {
            n.options = [{ text: document.getElementById('e-branch-a').value || 'A' }, { text: document.getElementById('e-branch-b').value || 'B' }];
            saveStories(stories); renderNodeEditor();
        }
        else if (n.type === 'bgm') {
            const clearFlag = document.getElementById('clear-bgm-flag').value;
            const urlInput = document.getElementById('e-node-bgm').value.trim();
            const fileInput = document.getElementById('e-node-bgm-file');
            
            if (clearFlag === '1') {
                n.bgm = ''; saveStories(stories); renderNodeEditor();
            } else if (fileInput && fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                if (supabaseClient && currentUser) {
                    showToast("正在上传音频到云端...");
                    const fileName = `bgm_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
                    const { data, error } = await supabaseClient.storage.from('audio').upload(fileName, file);
                    if (error) { showToast("音频上传失败！"); console.error(error); return; }
                    
                    const { data: publicUrlData } = supabaseClient.storage.from('audio').getPublicUrl(fileName);
                    n.bgm = publicUrlData.publicUrl; 
                    showToast("音频云端上传成功！");
                } else {
                    const reader = new FileReader();
                    reader.onload = (e) => { n.bgm = e.target.result; saveStories(stories); renderNodeEditor(); };
                    reader.readAsDataURL(file);
                    return;
                }
                saveStories(stories); renderNodeEditor();
            } else if (urlInput) {
                n.bgm = urlInput; saveStories(stories); renderNodeEditor();
            } else {
                renderNodeEditor();
            }
        }
    });
}

// ================= 保存与新增 =================
function openAddChapterModal() {
    openModal("新增章节", `<div class="form-group"><label>标题</label><input type="text" id="m-ch-title"></div>`, () => {
        const title = document.getElementById('m-ch-title').value; if(!title) return;
        const stories = getStories(); const story = stories.find(s => s.id === currentManageId);
        if(!story.chapters) story.chapters = [];
        story.chapters.push({ id: 'ch_' + Date.now(), title, nodes: [], edges: [] }); saveStories(stories); renderManageSubPage('chapters'); 
    });
}
function openAddCharacterModal() {
    openModal("新增角色", `<div class="form-group"><label>名字</label><input type="text" id="m-char-name"></div><div class="form-group"><label>简介</label><textarea id="m-char-desc" rows="3"></textarea></div>`, () => {
        const name = document.getElementById('m-char-name').value; const desc = document.getElementById('m-char-desc').value; if(!name) return;
        const stories = getStories(); const story = stories.find(s => s.id === currentManageId);
        if(!story.characters) story.characters = [];
        story.characters.push({ id: 'char_' + Date.now(), name, desc }); saveStories(stories); renderManageSubPage('characters');
    });
}
function openAddPlotModal() {
    openModal("新增情节点", `<div class="form-group"><label>名称</label><input type="text" id="m-plot-title"></div><div class="form-group"><label>简介/地点描述（悬浮显示）</label><textarea id="m-plot-desc" rows="3"></textarea></div>`, () => {
        const title = document.getElementById('m-plot-title').value; const desc = document.getElementById('m-plot-desc').value; if(!title) return;
        const stories = getStories(); const story = stories.find(s => s.id === currentManageId);
        if(!story.plots) story.plots = [];
        story.plots.push({ id: Date.now(), title, desc, x: 50, y: 50 }); saveStories(stories); renderManageSubPage('plots');
    });
}
function openAddWikiModal() {
    openModal("新增词条", `
        <div class="form-group"><label>词条名称</label><input type="text" id="m-wiki-term"></div>
        <div class="form-group"><label>解释内容</label><textarea id="m-wiki-content" rows="3"></textarea></div>
        <div class="form-group"><label>解锁条件（阅读完某章后可见）</label>
            <select id="m-wiki-unlock" style="width:100%;padding:10px;">
                <option value="">默认全部可见</option>
                ${(getStories().find(s=>s.id===currentManageId).chapters||[]).map(c => `<option value="${c.id}">读完：${c.title}</option>`).join('')}
            </select>
        </div>
    `, () => {
        const term = document.getElementById('m-wiki-term').value;
        const content = document.getElementById('m-wiki-content').value;
        const unlockChapter = document.getElementById('m-wiki-unlock').value;
        if(!term) return;
        
        const stories = getStories(); const story = stories.find(s => s.id === currentManageId);
        if(!story.wiki) story.wiki = [];
        story.wiki.push({ id: 'wiki_'+Date.now(), term, content, unlockChapter }); 
        saveStories(stories); renderManageSubPage('wiki');
    });
}
function openAddRelationshipModal() {
    const story = getStories().find(s => s.id === currentManageId);
    if (!story || !story.characters || story.characters.length < 2) return showToast("需要至少2个角色");
    const options = story.characters.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    openModal("新增/修改关系", `<div class="form-group"><label>A</label><select id="m-rel-from" style="width:100%;padding:10px;">${options}</select></div><div class="form-group"><label>B</label><select id="m-rel-to" style="width:100%;padding:10px;">${options}</select></div><div class="form-group"><label>关系</label><input type="text" id="m-rel-label"></div>`, () => {
        const from = document.getElementById('m-rel-from').value; const to = document.getElementById('m-rel-to').value; const label = document.getElementById('m-rel-label').value;
        if (from === to) return showToast("不能和自己建立关系");
        const stories = getStories(); const s = stories.find(x => x.id === currentManageId);
        if (!s.relationships) s.relationships = [];
        const existing = s.relationships.find(r => (r.from === from && r.to === to) || (r.from === to && r.to === from));
        if (existing) { existing.label = label; } else { s.relationships.push({ id: Date.now(), from, to, label }); }
        saveStories(stories); switchCharTab('graph'); 
    });
}
function saveStoryInfo() {
    const stories = getStories(); const story = stories.find(s => s.id === currentManageId); if (!story) return;
    story.title = document.getElementById('edit-title').value; story.author = document.getElementById('edit-author').value;
    story.intro = document.getElementById('edit-intro').value; story.tags = document.getElementById('edit-tags').value.split(/[，,]/).map(t => t.trim()).filter(Boolean);
    story.cover = document.getElementById('edit-cover').value;
    saveStories(stories); showToast("保存成功！"); setTimeout(() => { location.hash = `#manage/${currentManageId}`; }, 500);
}
function renderSquare() {
    // 只显示别人已发布且公开的，或者自己的小说
    const list = getStories().filter(s => {
        if (currentUser && s.user_id === currentUser.id) return true; // 自己的书
        return s.is_draft === false && s.status === 'public'; // 别人的公开书
    });
    const el = document.getElementById('story-list');
    if(el) el.innerHTML = list.map(s => `<div class="story-card" onclick="location.hash = '#detail/${s.id}'"><img src="${s.cover || 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'}"><div class="card-info"><h3>${s.title}</h3><p>${s.author || '未知'}</p></div></div>`).join('');
}
function switchCharTab(tab) {
    document.getElementById('tab-char-list').classList.toggle('active', tab === 'list'); document.getElementById('tab-char-graph').classList.toggle('active', tab === 'graph');
    if (tab === 'list') { document.getElementById('char-content-list').style.display = 'flex'; document.getElementById('char-content-graph').style.display = 'none'; } 
    else { document.getElementById('char-content-list').style.display = 'none'; document.getElementById('char-content-graph').style.display = 'block'; renderRelationshipGraph(); }
}
function renderRelationshipGraph() {
    const story = getStories().find(s => s.id === currentManageId);
    const area = document.getElementById('relationship-graph-area');
    if (!story || !story.characters || story.characters.length < 2) { area.innerHTML = '<div style="text-align:center;padding:50px;color:#888;">至少需要2个角色</div>'; return; }
    const chars = story.characters; let rels = story.relationships || [];
    const uniqueRels = []; const pairs = new Set();
    rels.forEach(rel => { const key = [rel.from, rel.to].sort().join('_'); if (!pairs.has(key)) { pairs.add(key); uniqueRels.push(rel); } });
    const width = 800, height = 500, cx = width/2, cy = height/2, r = 180;
    const nodes = chars.map((c, i) => { const angle = (i / chars.length) * 2 * Math.PI - Math.PI / 2; return { ...c, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }; });
    let svg = `<svg width="100%" height="100%" viewBox="0 0 800 500">`;
    uniqueRels.forEach(rel => {
        const n1 = nodes.find(n => n.name === rel.from); const n2 = nodes.find(n => n.name === rel.to);
        if (n1 && n2) { svg += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="#ccc" stroke-width="2" />`; const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2; svg += `<rect x="${mx-30}" y="${my-12}" width="60" height="24" fill="#fcf9f2" rx="12" />`; svg += `<text x="${mx}" y="${my+4}" fill="#c0a062" font-size="13" text-anchor="middle" font-weight="bold">${rel.label}</text>`; }
    });
    nodes.forEach(n => { svg += `<g transform="translate(${n.x}, ${n.y})"><circle r="45" fill="#fff" stroke="#c0a062" stroke-width="2"/><text y="5" fill="#333" font-size="15" font-weight="bold" text-anchor="middle">${n.name}</text></g>`; });
    svg += `</svg>`; area.innerHTML = svg;
}

// ================= 播放器核心逻辑 =================
let currentNodeId = null; let isTyping = false, typingTimer = null, charIndex = 0, currentText = "";
let history = []; let currentStoryId = null, currentChapterObj = null;
let isAuto = false, isSkip = false, autoTimer = null, skipTimer = null;

function startPlayer(storyId, chapterId) {
    currentStoryId = storyId;
    const story = getStories().find(s => s.id === storyId);
    if(!story) return;
    currentChapterObj = story.chapters.find(c => c.id === chapterId);
    if(!currentChapterObj) return;
    document.getElementById('bg-layer').style.backgroundImage = story.bg ? `url('${story.bg}')` : 'none';
    const fig = document.getElementById('figure-layer'); fig.src = ''; fig.style.display = 'none';
    document.getElementById('choices-container').style.display = 'none';
    document.getElementById('history-panel').classList.remove('open');
    
    const audio = document.getElementById('bgm-player');
    audio.pause(); audio.removeAttribute('src'); audio.load(); audio.loop = true; 
    document.getElementById('bgm-indicator').style.display = 'none'; 

    history = []; updateHistoryUI(); isAuto = false; isSkip = false;
    clearTimeout(autoTimer); clearTimeout(skipTimer);
    document.getElementById('btn-auto').style.color = '#fff'; document.getElementById('btn-skip').style.color = '#fff';

    const startNode = (currentChapterObj.nodes || []).find(n => n.type === 'start');
    if (startNode) { currentNodeId = startNode.id; processNode(); } 
    else { showToast("无开始节点，请重新进入编辑器保存"); exitPlayer(); }
}

function processNode() {
    clearTimeout(autoTimer); clearTimeout(skipTimer);
    const node = (currentChapterObj.nodes || []).find(n => n.id === currentNodeId);
    
    if (!node) { showChapterEnd(""); return; }
    if (node.type === 'end') { showChapterEnd(node.text || ""); return; }
    if (node.type === 'start') { nextNode(); return; }
    
    if (node.type === 'bgm') { 
        const audio = document.getElementById('bgm-player');
        const indicator = document.getElementById('bgm-indicator');
        if (node.bgm && node.bgm.trim() !== '') {
            if (audio.src !== node.bgm) {
                audio.src = node.bgm;
                audio.load(); indicator.style.display = 'flex'; 
                const playPromise = audio.play();
                if (playPromise !== undefined) { playPromise.catch(error => { indicator.innerText = '🎵 音乐被拦截，点击此处播放'; }); }
            } else if (audio.paused) { audio.play().catch(e => { indicator.innerText = '🎵 音乐被暂停，点击恢复'; }); }
        } else {
            audio.pause(); audio.removeAttribute('src'); audio.load(); indicator.style.display = 'none';
        }
        nextNode(); return; 
    }
    
    if (node.type === 'illustration') { document.getElementById('bg-layer').style.backgroundImage = `url('${node.img}')`; nextNode(); return; }
    if (node.type === 'figure') {
        const fig = document.getElementById('figure-layer');
        if (node.img && node.img.trim() !== '') { fig.src = node.img; fig.style.display = 'block'; } else { fig.style.display = 'none'; }
        nextNode(); return;
    }
    if (node.type === 'branch') {
        const edges = (currentChapterObj.edges || []).filter(e => e.from === currentNodeId);
        if (edges.length > 0) { showChoices(edges); } else { nextNode(); }
        return;
    }
    
    if (node.type === 'dialogue' || node.type === 'narration') {
        const nameEl = document.getElementById('char-name');
        document.getElementById('textbox-container').style.display = 'block';
        
        if (node.type === 'narration') { nameEl.style.display = 'none'; } 
        else { nameEl.style.display = 'flex'; nameEl.innerText = node.name || '角色'; }

        currentText = node.text || '...'; charIndex = 0; document.getElementById('dialogue-text').innerText = "";
        document.getElementById('next-indicator').style.display = 'none'; isTyping = true;
        history.push({ name: node.type === 'dialogue' ? node.name : '旁白', text: node.text }); updateHistoryUI(); 
        
        if (isSkip) {
            document.getElementById('dialogue-text').innerText = currentText; isTyping = false; document.getElementById('next-indicator').style.display = 'block'; skipTimer = setTimeout(nextNode, 100);
        } else { typeText(); }
    }
}

function typeText() { 
    if (charIndex < currentText.length) { 
        document.getElementById('dialogue-text').innerText += currentText.charAt(charIndex); 
        charIndex++; typingTimer = setTimeout(typeText, isSkip ? 10 : 30); 
    } else { 
        isTyping = false; document.getElementById('next-indicator').style.display = 'block'; 
        if (isAuto) { clearTimeout(autoTimer); autoTimer = setTimeout(nextNode, 1500); }
        if (isSkip) { clearTimeout(skipTimer); skipTimer = setTimeout(nextNode, 100); }
    } 
}

function nextLine() { 
    const audio = document.getElementById('bgm-player');
    if (audio && audio.src && audio.paused && audio.src !== window.location.href) { 
        audio.play().then(()=>{ const indicator = document.getElementById('bgm-indicator'); if(indicator) indicator.innerText = '🎵 音乐播放中'; }).catch((err)=>{ }); 
    }
    if (isTyping) { 
        clearTimeout(typingTimer); document.getElementById('dialogue-text').innerText = currentText; isTyping = false; document.getElementById('next-indicator').style.display = 'block'; 
        if (isAuto) { clearTimeout(autoTimer); autoTimer = setTimeout(nextNode, 1500); }
        if (isSkip) { clearTimeout(skipTimer); skipTimer = setTimeout(nextNode, 100); }
    } else { nextNode(); } 
}
document.getElementById('textbox-container').onclick = nextLine;
document.addEventListener('keydown', (e) => { if (document.getElementById('view-player').classList.contains('active') && (e.code === 'Space' || e.code === 'Enter')) nextLine(); });

function toggleAuto() {
    isAuto = !isAuto; isSkip = false; 
    document.getElementById('btn-auto').style.color = isAuto ? '#c0a062' : '#fff'; document.getElementById('btn-skip').style.color = '#fff';
    if (isAuto && !isTyping) { clearTimeout(autoTimer); autoTimer = setTimeout(nextNode, 1500); } else { clearTimeout(autoTimer); }
    clearTimeout(skipTimer);
}
function toggleSkip() {
    isSkip = !isSkip; isAuto = false; 
    document.getElementById('btn-skip').style.color = isSkip ? '#c0a062' : '#fff'; document.getElementById('btn-auto').style.color = '#fff';
    if (isSkip) {
        if (isTyping) { clearTimeout(typingTimer); document.getElementById('dialogue-text').innerText = currentText; isTyping = false; document.getElementById('next-indicator').style.display = 'block'; }
        clearTimeout(skipTimer); skipTimer = setTimeout(nextNode, 100);
    } else { clearTimeout(skipTimer); }
    clearTimeout(autoTimer);
}

document.addEventListener('click', function(e) {
    const panel = document.getElementById('history-panel');
    if (panel && panel.classList.contains('open')) {
        const historyBtn = e.target.closest('button[onclick="toggleHistory()"]');
        if (!panel.contains(e.target) && !historyBtn) { panel.classList.remove('open'); }
    }
});

function showChoices(edges) {
    clearTimeout(autoTimer); clearTimeout(skipTimer);
    document.getElementById('textbox-container').style.display = 'none';
    const choicesContainer = document.getElementById('choices-container');
    choicesContainer.innerHTML = '';
    const branchNode = (currentChapterObj.nodes || []).find(n => n.id === currentNodeId);

    edges.forEach((edge, index) => {
        let btnText = `选项 ${index + 1}`;
        if (branchNode && branchNode.options && edge.branchIndex !== undefined) {
            if (branchNode.options[edge.branchIndex]) btnText = branchNode.options[edge.branchIndex].text;
        }
        const btn = document.createElement('button');
        btn.className = 'choice-btn'; btn.innerText = btnText;
        btn.onclick = () => { choicesContainer.style.display = 'none'; currentNodeId = edge.to; processNode(); };
        choicesContainer.appendChild(btn);
    });
    choicesContainer.style.display = 'flex';
}

function nextNode() { 
    clearTimeout(autoTimer); clearTimeout(skipTimer);
    const edge = (currentChapterObj.edges || []).find(e => e.from === currentNodeId); 
    if (edge) { currentNodeId = edge.to; processNode(); } else { showChapterEnd(""); } 
}

function showChapterEnd(endText) {
    clearTimeout(autoTimer); clearTimeout(skipTimer);
    document.getElementById('textbox-container').style.display = 'none';
    const overlay = document.getElementById('chapter-end-overlay'); const contentArea = document.getElementById('end-content-area');
    
    if (currentChapterObj) {
        let readHistory = [];
        try { readHistory = JSON.parse(safeGetLocal('vn_read_history') || '[]'); } catch(e){}
        if (!readHistory.includes(currentChapterObj.id)) {
            readHistory.push(currentChapterObj.id);
            safeSetLocal('vn_read_history', JSON.stringify(readHistory));
        }
    }

    if (endText && endText.trim() !== '') { contentArea.innerHTML = `<h3>结局</h3><p>${endText}</p>`; } 
    else { contentArea.innerHTML = `<h3>本章已看完</h3><p style="text-align:center;">感谢您的阅读，接下来去哪里？</p>`; }
    overlay.classList.add('active');
    const story = getStories().find(s => s.id === currentStoryId); const chIndex = story.chapters.findIndex(c => c.id === currentChapterObj.id); const nextBtn = document.getElementById('btn-next-chapter');
    if (chIndex >= 0 && chIndex < story.chapters.length - 1) { nextBtn.style.display = 'block'; } else { nextBtn.style.display = 'none'; }
}

function goNextChapter() {
    const story = getStories().find(s => s.id === currentStoryId); const chIndex = story.chapters.findIndex(c => c.id === currentChapterObj.id);
    if (chIndex >= 0 && chIndex < story.chapters.length - 1) { document.getElementById('chapter-end-overlay').classList.remove('active'); window.location.hash = `#play/${story.id}/${story.chapters[chIndex + 1].id}`; }
}

function goHomeFromEnd() { document.getElementById('chapter-end-overlay').classList.remove('active'); document.getElementById('bgm-player').pause(); location.hash = '#workspace'; }
function goBackFromEnd() { document.getElementById('chapter-end-overlay').classList.remove('active'); document.getElementById('bgm-player').pause(); location.hash = `#detail/${currentStoryId}`; }
function exitPlayer() { clearTimeout(autoTimer); clearTimeout(skipTimer); document.getElementById('bgm-player').pause(); location.hash = `#detail/${currentStoryId}`; }

function updateHistoryUI() {
    const list = document.getElementById('history-list');
    list.innerHTML = history.map(h => `<div class="history-item"><div style="color:#888;font-size:0.9em;margin-bottom:5px;">${h.name}</div><div style="line-height:1.6; color:#ddd;">${h.text}</div></div>`).join('');
    list.scrollTop = list.scrollHeight;
}
function toggleHistory() { document.getElementById('history-panel').classList.toggle('open'); }

// 地图与弹窗功能
let isDrawing = false; let currentBrushColor = '#2E8B57';
function setBrush(color, btn) { currentBrushColor = color; document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
function zoomMap(val) { const grid = document.getElementById('map-grid'); if(grid) { grid.style.gridTemplateColumns = `repeat(40, ${val}px)`; grid.style.gridTemplateRows = `repeat(40, ${val}px)`; } }
function switchPlotTab(tab) {
    document.getElementById('tab-plot-list').classList.toggle('active', tab === 'list'); document.getElementById('tab-plot-map').classList.toggle('active', tab === 'map');
    document.getElementById('plot-content-list').style.display = tab === 'list' ? 'flex' : 'none'; document.getElementById('plot-content-map').style.display = tab === 'map' ? 'block' : 'none';
    if (tab === 'map') renderMapEditor();
}

function renderMapEditor() {
    const story = getStories().find(s => s.id === currentManageId); if(!story) return;
    let wrapper = document.querySelector('.map-grid-wrapper');
    if (!wrapper) { const viewport = document.getElementById('map-viewport'); if(viewport) { viewport.innerHTML = '<div class="map-grid-wrapper" id="map-grid-wrapper"><div class="map-grid" id="map-grid"></div></div>'; wrapper = document.getElementById('map-grid-wrapper'); } }
    const gridEl = document.getElementById('map-grid'); if(!gridEl) return; gridEl.innerHTML = '';
    const mapData = story.mapGrid || new Array(1600).fill('transparent'); zoomMap(document.getElementById('map-zoom').value);
    mapData.forEach((color, i) => {
        const cell = document.createElement('div'); cell.className = 'map-cell'; cell.style.backgroundColor = color;
        cell.onmousedown = (e) => { isDrawing = true; drawCell(cell, i); e.preventDefault(); }; cell.onmouseenter = () => { if (isDrawing) drawCell(cell, i); };
        gridEl.appendChild(cell);
    });
    document.onmouseup = () => { isDrawing = false; };
    (story.plots || []).forEach(p => {
        const pin = document.createElement('div'); pin.className = 'map-pin'; pin.style.left = `${p.x}%`; pin.style.top = `${p.y}%`;
        pin.innerHTML = `<div style="font-size:24px;">📍</div><div style="font-size:12px; background:rgba(0,0,0,0.8); color:#fff; padding:2px 6px; border-radius:4px; white-space:nowrap;">${p.title}</div>`;
        pin.onmousedown = (e) => {
            e.stopPropagation(); e.preventDefault();
            const startX = e.clientX; const startY = e.clientY; const rect = gridEl.getBoundingClientRect();
            const initialLeft = parseFloat(pin.style.left); const initialTop = parseFloat(pin.style.top);
            const onMouseMove = (ev) => {
                const dx = ev.clientX - startX; const dy = ev.clientY - startY; const dxPercent = (dx / rect.width) * 100; const dyPercent = (dy / rect.height) * 100;
                let newX = initialLeft + dxPercent; let newY = initialTop + dyPercent;
                newX = Math.max(0, Math.min(100, newX)); newY = Math.max(0, Math.min(100, newY));
                pin.style.left = `${newX}%`; pin.style.top = `${newY}%`;
            };
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
                const stories = getStories(); const st = stories.find(s => s.id === currentManageId); const target = st.plots.find(x => x.id === p.id);
                if (target) { target.x = parseFloat(pin.style.left); target.y = parseFloat(pin.style.top); saveStories(stories); showToast("位置已保存"); }
            };
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        };
        gridEl.appendChild(pin);
    });
}
function drawCell(cell, index) {
    cell.style.backgroundColor = currentBrushColor;
    const stories = getStories(); const st = stories.find(s => s.id === currentManageId);
    if (!st.mapGrid) st.mapGrid = new Array(1600).fill('transparent');
    st.mapGrid[index] = currentBrushColor; saveStories(stories);
}
function openCreateStoryModal() {
    openModal("创建新小说", `<div class="form-group"><label>标题</label><input type="text" id="m-title" value=""></div>`, () => {
        const title = document.getElementById('m-title').value; if(!title) return showToast("请输入标题");
        const stories = getStories();
        stories.push({ id: 'story_' + Date.now(), title, author: '', intro: '', status: 'private', cover: '', tags: [], chapters: [], characters: [], plots: [], wiki: [], relationships: [], mapGrid: new Array(1600).fill('transparent'), is_draft: true });
        saveStories(stories); renderWorkspace(); 
    });
}