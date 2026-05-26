// ── OnStep Shared Utilities ────────────────────────────────────
// 이미지 압축 · 네비게이션 · Auth 헬퍼 · Cloudinary 업로드
// 각 페이지의 <script src="shared.js"> 태그가 Firebase SDK 이후에 위치해야 함
// ──────────────────────────────────────────────────────────────

// ═══ Cloudinary 이미지 업로드 ════════════════════════════════════
const _CDN_CLOUD  = 'demntoouc';
const _CDN_PRESET = 'onstep-upload';

// base64 dataUrl → Cloudinary 업로드 → 다운로드 URL 반환
// storagePath는 Cloudinary public_id로 사용 (폴더 구조 유지)
async function uploadImageStorage(uid, base64, storagePath) {
  if (!uid || !base64 || !base64.startsWith('data:')) return null;
  try {
    const publicId = `onstep/${uid}/${storagePath.replace(/\.jpg$/, '')}`;
    const fd = new FormData();
    fd.append('file', base64);
    fd.append('upload_preset', _CDN_PRESET);
    fd.append('public_id', publicId);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${_CDN_CLOUD}/image/upload`, {
      method: 'POST', body: fd
    });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    return data.secure_url || null;
  } catch(e) { console.warn('Cloudinary upload failed:', storagePath, e); return null; }
}

// 이미지 변경 감지용 간단 해시 (base64 앞부분 샘플링)
function _imgHash(base64) {
  if (!base64) return '';
  let h = 0;
  const n = Math.min(base64.length, 3000);
  for (let i = 0; i < n; i++) h = (h * 31 + base64.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// imgData가 바뀐 경우만 업로드, 동일하면 기존 URL 재사용
async function ensureImgUrl(uid, imgData, currentUrl, currentHash, storagePath) {
  if (!imgData) return { url: currentUrl || null, hash: currentHash || '' };
  const hash = _imgHash(imgData);
  if (hash === currentHash && currentUrl) return { url: currentUrl, hash };
  const url = await uploadImageStorage(uid, imgData, storagePath);
  return { url: url || currentUrl || null, hash };
}

// ═══ 이미지 압축 ══════════════════════════════════════════════
// File 객체 → 압축 JPEG dataUrl
// maxPx: 480=제품, 360=보관장소, 600=Muse/Log
function _compressFile(file, maxPx, quality, cb) {
  maxPx = maxPx || 480; quality = quality || 0.68;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const out = c.toDataURL('image/jpeg', quality);
      const kb  = Math.round(out.length * 0.75 / 1024);
      if (typeof showToast === 'function') showToast(`이미지 저장 완료 · ${w}×${h} · ${kb}KB`);
      cb(out);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// dataUrl → 압축 JPEG dataUrl (log.html 등 기존 호환)
function compressImg(dataUrl, cb, maxPx, quality) {
  maxPx = maxPx || 600; quality = quality || 0.68;
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, maxPx / Math.max(img.width, img.height));
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const out = c.toDataURL('image/jpeg', quality);
    const kb  = Math.round(out.length * 0.75 / 1024);
    if (typeof showToast === 'function') showToast(`이미지 저장 완료 · ${w}×${h} · ${kb}KB`);
    cb(out);
  };
  img.src = dataUrl;
}

// 파일 피커 열고 압축까지 한번에 처리
function pickPhotoCompressed(cb, maxPx, quality) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    _compressFile(f, maxPx || 480, quality || 0.68, cb);
  };
  input.click();
}

// ═══ 이미지 소스 선택 액션 시트 ═══════════════════════════════
// 모든 이미지 업로드 영역에서 공통으로 사용
// 클립보드 붙여넣기(iOS 16.4+ / Android Chrome) + 파일 선택 2가지 옵션 제공
let _ipsCb = null, _ipsMaxPx = 480, _ipsQuality = 0.68;

async function pasteImageFromClipboard(cb, maxPx, quality) {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    if (typeof showToast === 'function') showToast('이 브라우저는 클립보드 접근을 지원하지 않습니다.');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (imgType) {
        const blob = await item.getType(imgType);
        const file = new File([blob], 'paste.png', { type: imgType });
        _compressFile(file, maxPx || 480, quality || 0.68, cb);
        return;
      }
    }
    if (typeof showToast === 'function') showToast('클립보드에 이미지가 없습니다.');
  } catch(e) {
    if (e.name === 'NotAllowedError') {
      if (typeof showToast === 'function') showToast('클립보드 권한이 필요합니다.');
    } else {
      if (typeof showToast === 'function') showToast('클립보드 읽기 실패. 파일 선택을 이용해 주세요.');
    }
  }
}

function _phoneRoot() { return document.querySelector('.phone') || document.body; }

function showImgPickSheet(cb, maxPx, quality) {
  _ipsCb = cb; _ipsMaxPx = maxPx || 480; _ipsQuality = quality || 0.68;
  let el = document.getElementById('_ips');
  if (!el) {
    el = document.createElement('div');
    el.id = '_ips';
    el.style.cssText = 'position:absolute;inset:0;z-index:99990;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
    el.addEventListener('click', e => { if (e.target === el) _closeIps(); });
    el.innerHTML =
      '<div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:430px;padding:20px 20px 40px;box-sizing:border-box;">' +
        '<div style="width:32px;height:3px;background:#E0E0E0;border-radius:2px;margin:0 auto 20px;"></div>' +
        '<div style="font-family:\'Inter\',sans-serif;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#9CA3AF;margin-bottom:12px;">이미지 추가</div>' +
        '<button id="_ips-paste" style="width:100%;height:52px;background:#F5F5F3;border:none;border-radius:12px;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;color:#0C1014;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;box-sizing:border-box;">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="#44474A"><path d="M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z"/></svg>' +
          '클립보드에서 붙여넣기' +
        '</button>' +
        '<button id="_ips-file" style="width:100%;height:52px;background:#F5F5F3;border:none;border-radius:12px;font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;color:#0C1014;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;box-sizing:border-box;">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="#44474A"><path d="M20 5h-2.83L15 3H9L6.83 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 13c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3z"/></svg>' +
          '파일에서 선택' +
        '</button>' +
        '<button id="_ips-cancel" style="width:100%;height:44px;background:none;border:none;font-family:\'Inter\',sans-serif;font-size:14px;color:#9CA3AF;cursor:pointer;">취소</button>' +
      '</div>';
    _phoneRoot().appendChild(el);
    document.getElementById('_ips-paste').addEventListener('click', async () => {
      _closeIps();
      await pasteImageFromClipboard(_ipsCb, _ipsMaxPx, _ipsQuality);
    });
    document.getElementById('_ips-file').addEventListener('click', () => {
      _closeIps();
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
      inp.onchange = e => {
        if (document.body.contains(inp)) document.body.removeChild(inp);
        const f = e.target.files[0]; if (!f) return;
        _compressFile(f, _ipsMaxPx, _ipsQuality, _ipsCb);
      };
      document.body.appendChild(inp);
      inp.click();
    });
    document.getElementById('_ips-cancel').addEventListener('click', _closeIps);
  } else {
    el.style.display = 'flex';
  }
}

function _closeIps() {
  const el = document.getElementById('_ips');
  if (el) el.style.display = 'none';
}

// ═══ Auth 헬퍼 ════════════════════════════════════════════════
// data-auth-avatar 속성이 있는 모든 요소를 동시 업데이트
function _updateAuthAvatar(user) {
  document.querySelectorAll('[data-auth-avatar]').forEach(el => {
    if (user) {
      el.innerHTML = user.photoURL
        ? `<img src="${user.photoURL}" style="width:100%;height:100%;object-fit:cover;filter:grayscale(10%)">`
        : `<span style="font-size:11px;color:#fff;font-weight:700;letter-spacing:.02em">${(user.displayName || user.email || '?')[0].toUpperCase()}</span>`;
      el.style.background  = '#1A1C1C';
      el.style.borderColor = '#1A1C1C';
    } else {
      el.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="opacity:.5"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"/></svg>';
      el.style.background  = '';
      el.style.borderColor = '';
    }
  });
}

// 로그인/로그아웃 (각 페이지의 fbAuth, currentUser 전역변수 사용)
let _authPopupOpen = false;
function handleAuthClick() {
  const _auth = typeof fbAuth !== 'undefined' ? fbAuth : firebase.auth();
  const _user = typeof currentUser !== 'undefined' ? currentUser : null;
  if (_user) {
    if (confirm(`${_user.displayName || _user.email}\n로그아웃?`)) _auth.signOut();
  } else {
    if (_authPopupOpen) return;
    _authPopupOpen = true;
    _auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .catch(e => { if (e.code !== 'auth/cancelled-popup-request') alert(e.message); })
      .finally(() => { _authPopupOpen = false; });
  }
}

// ═══ 하단 네비게이션 ══════════════════════════════════════════
const _NAV_SVG = {
  today: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  log:   `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  box:   `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  setup: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
};

// .app-nav 요소 전체에 하단 탭바 주입 (패널마다 하나씩 있어도 동작)
// activeTab: 'today' | 'log' | 'box' | 'setup'
function initNav(activeTab) {
  const mounts = document.querySelectorAll('.app-nav');
  if (!mounts.length) return;

  const tabs = [
    { id: 'today', href: 'today.html', label: 'Today' },
    { id: 'log',   href: 'log.html',   label: 'Log'   },
    { id: 'box',   href: 'box.html',   label: 'Box'   },
    { id: 'setup', href: 'setup.html', label: 'Setup' }
  ];
  const html =
    '<div class="bottom-nav">' +
    tabs.map(t => `
      <a class="nav-item${t.id === activeTab ? ' active' : ''}" href="${t.href}">
        <div class="nav-icon">${_NAV_SVG[t.id]}</div>
        <div class="nav-label">${t.label}</div>
      </a>`).join('') +
    '</div>';
  mounts.forEach(mount => { mount.innerHTML = html; });
}

// ═══ CMS 텍스트 콘텐츠 실시간 Sync ══════════════════════════
// 사용법: 요소에 data-cms-key="키이름" 부여 → initCmsContent() 호출
// 로그인 사용자는 요소 더블클릭으로 편집 · Firestore config/content 문서에 저장

let _cmsKey = null;

function initCmsContent() {
  const db = firebase.firestore();

  // Firestore onSnapshot → data-cms-key 요소 실시간 업데이트
  db.collection('config').doc('content').onSnapshot(snap => {
    const data = snap.exists ? snap.data() : {};
    document.querySelectorAll('[data-cms-key]').forEach(el => {
      const key = el.getAttribute('data-cms-key');
      if (data[key] !== undefined) el.textContent = data[key];
    });
  });

  // 로그인 상태에 따라 더블클릭 편집 활성/비활성
  firebase.auth().onAuthStateChanged(user => {
    document.querySelectorAll('[data-cms-key]').forEach(el => {
      el.ondblclick = user ? () => _cmsOpenEdit(el) : null;
      el.style.cursor = user ? 'text' : '';
      el.title = user ? '더블클릭으로 편집' : '';
    });
  });
}

function _cmsOpenEdit(el) {
  _cmsKey = el.getAttribute('data-cms-key');
  const cur = el.textContent;
  let modal = document.getElementById('_cms-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_cms-modal';
    modal.style.cssText = [
      'position:absolute;inset:0;background:rgba(0,0,0,.5);z-index:99999',
      'display:flex;align-items:flex-end;justify-content:center'
    ].join(';');
    modal.innerHTML =
      '<div id="_cms-sheet" style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:430px;padding:24px 20px 40px;">' +
        '<div style="width:32px;height:3px;background:#ddd;border-radius:2px;margin:0 auto 18px;"></div>' +
        '<div style="font-family:\'Space Grotesk\',sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:10px;">텍스트 편집</div>' +
        '<textarea id="_cms-ta" style="width:100%;height:120px;border:1.5px solid #e0e0e0;border-radius:10px;padding:12px 14px;font-family:\'Georgia\',serif;font-size:14px;font-style:italic;line-height:1.6;resize:none;outline:none;box-sizing:border-box;color:#0A0A0A;"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:12px;">' +
          '<button onclick="_cmsSave()" style="flex:1;height:48px;background:#0A0A0A;color:#fff;border:none;border-radius:10px;font-family:\'Space Grotesk\',sans-serif;font-size:13px;font-weight:700;cursor:pointer;">저장</button>' +
          '<button onclick="document.getElementById(\'_cms-modal\').remove();_cmsKey=null;" style="height:48px;padding:0 20px;background:#f5f5f3;color:#444;border:none;border-radius:10px;font-family:\'Inter\',sans-serif;font-size:13px;cursor:pointer;">취소</button>' +
        '</div>' +
      '</div>';
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); _cmsKey = null; } });
    _phoneRoot().appendChild(modal);
  }
  document.getElementById('_cms-ta').value = cur;
}

function _cmsSave() {
  if (!_cmsKey) return;
  const val = document.getElementById('_cms-ta').value.trim();
  if (!val) return;
  firebase.firestore().collection('config').doc('content')
    .set({ [_cmsKey]: val }, { merge: true })
    .then(() => {
      if (typeof showToast === 'function') showToast('✓ 저장됨');
      document.getElementById('_cms-modal').remove();
      _cmsKey = null;
    })
    .catch(e => { if (typeof showToast === 'function') showToast('오류: ' + e.message); });
}

// ═══ 데이터 병합 유틸리티 ════════════════════════════════════
// careplan local/cloud 병합 — 세션 유실 없이 history 완전 보존
function _mergePlan(local, cloud) {
  if (!local || !local.savedAt) return cloud || {};
  if (!cloud || !cloud.savedAt) return local;
  const localTs = new Date(local.savedAt).getTime();
  const cloudTs = new Date(cloud.savedAt).getTime();
  // 현재 세션: 더 최신 쪽 기준
  const base = cloudTs >= localTs ? cloud : local;
  // history: 세션 번호 기준 dedup, local 우선 (로컬 편집 내용 보존)
  const map = new Map();
  (cloud.history||[]).forEach(function(s){ if(s.session) map.set(Number(s.session), s); });
  (local.history||[]).forEach(function(s){ if(s.session) map.set(Number(s.session), s); });
  // base가 아닌 쪽의 현재 세션도 history에 포함해 유실 방지
  const other = cloudTs >= localTs ? local : cloud;
  if (other.session && other.session !== base.session) {
    const n = Number(other.session);
    if (!map.has(n)) map.set(n, {
      session: other.session, periodStart: other.periodStart,
      periodEnd: other.periodEnd, morning: other.morning, nightly: other.nightly
    });
  }
  return Object.assign({}, base, { history: Array.from(map.values()) });
}

// 배열을 ID 기준 union merge — cloud 항목 기준 + local에만 있는 항목 보존
// (cloud에서 삭제된 항목은 제외, local에 새로 추가된 항목은 유지)
function _mergeArrById(cloudArr, localArr, idKey) {
  idKey = idKey || 'id';
  if (!Array.isArray(cloudArr)) return Array.isArray(localArr) ? localArr : [];
  if (!Array.isArray(localArr)) return cloudArr;
  const cloudIds = new Set(cloudArr.map(function(c){ return c[idKey]; }).filter(Boolean));
  return cloudArr.concat(localArr.filter(function(l){ return l[idKey] && !cloudIds.has(l[idKey]); }));
}

// ═══ Reactive State (BroadcastChannel) ═══════════════════════
// 탭 간 실시간 상태 동기화 — setup 변경 → today 즉시 반영
(function() {
  if (typeof BroadcastChannel === 'undefined') return;
  const _bc   = new BroadcastChannel('onstep_app');
  const _subs = {};

  window._onStateChange = function(key, fn) {
    if (!_subs[key]) _subs[key] = [];
    _subs[key].push(fn);
  };

  window._broadcastState = function(key) {
    (_subs[key] || []).forEach(fn => fn());
    _bc.postMessage(key);
  };

  _bc.onmessage = function(e) {
    (_subs[e.data] || []).forEach(fn => fn());
  };
}());
