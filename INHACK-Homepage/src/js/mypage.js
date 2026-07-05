import { showToast } from "./toast.js";
import { apiRequest } from "./api.js";

// ── Sidebar navigation (shared with dreamhack.js pattern) ──────────────────

function renderSidebarNav(menuItems) {
  const navList = document.getElementById('sidebar-nav-list');
  if (!navList) return;
  navList.innerHTML = '';

  menuItems.forEach(item => {
    if (item.type !== 'menu_item') return;
    const li = document.createElement('li');
    li.style.position = 'relative';
    const hasSubmenu = item.submenus && item.submenus.length > 0;
    if (hasSubmenu) li.classList.add('has-submenu');

    const a = document.createElement('a');
    const isHomepage = window.location.pathname === window.__BASE_PATH__ || window.location.pathname === window.__BASE_PATH__ + '/';
    let resolvedUrl = item.url || '#';
    resolvedUrl = resolvedUrl.replace(/\{\{BASE_PATH\}\}/g, window.__BASE_PATH__);
    if (resolvedUrl.startsWith('#') && resolvedUrl !== '#') {
      resolvedUrl = isHomepage ? resolvedUrl : `${window.__BASE_PATH__}/${resolvedUrl}`;
    }
    a.href = resolvedUrl;
    a.className = 'nav-item-link';
    a.textContent = item.title;
    if (item.title === 'Dreamhack') {
      a.style.color = '#ff6b00';
      a.style.fontWeight = 'bold';
      li.style.borderLeft = '3px solid #ff6b00';
      li.style.background = 'rgba(255, 107, 0, 0.03)';
    }
    if (item.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    if (window.location.pathname === resolvedUrl) a.classList.add('active');
    li.appendChild(a);

    if (hasSubmenu) {
      const toggle = document.createElement('span');
      toggle.className = 'submenu-toggle';
      toggle.innerHTML = '<span>›</span>';
      toggle.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        if (window.innerWidth > 1100 || window.innerWidth <= 500) {
          li.classList.toggle('open');
        }
      });
      li.appendChild(toggle);

      const subUl = document.createElement('ul');
      subUl.className = 'submenu';
      item.submenus.forEach(sub => {
        const subLi = document.createElement('li');
        const subA = document.createElement('a');
        let resolvedSub = sub.url || '#';
        resolvedSub = resolvedSub.replace(/\{\{BASE_PATH\}\}/g, window.__BASE_PATH__);
        if (resolvedSub.startsWith('#') && resolvedSub !== '#') {
          resolvedSub = isHomepage ? resolvedSub : `${window.__BASE_PATH__}/${resolvedSub}`;
        }
        subA.href = resolvedSub;
        subA.className = 'nav-item-link';
        subA.textContent = sub.title;
        if (sub.external) { subA.target = '_blank'; subA.rel = 'noopener noreferrer'; }
        subLi.appendChild(subA);
        subUl.appendChild(subLi);
      });
      li.appendChild(subUl);

      const isPureCategory = !item.url || item.url === '#';
      a.addEventListener('click', e => {
        if (isPureCategory) {
          e.preventDefault();
          if (window.innerWidth > 1100 || window.innerWidth <= 500) {
            li.classList.toggle('open');
          }
        } else {
          if (window.innerWidth > 1100 || window.innerWidth <= 500) {
            li.classList.add('open');
          }
        }
      });
    }
    navList.appendChild(li);
  });

  // Admin panel link
  if (window.__currentUser && window.__currentUser.isAdmin && !document.getElementById('nav-admin-link')) {
    const adminLi = document.createElement('li');
    adminLi.innerHTML = `<a href="${window.__BASE_PATH__}/admin" id="nav-admin-link" class="nav-item-link" style="color:#ff4b4b;border-left:2px solid #ff4b4b;font-weight:700;">Admin Panel</a>`;
    navList.appendChild(adminLi);
  }
}

async function loadSidebarNavigation() {
  try {
    const res = await fetch(window.__BASE_PATH__ + '/navigation');
    if (res.ok) {
      const payload = await res.json();
      if (payload.ok && payload.data) { renderSidebarNav(payload.data); return; }
    }
    const fallback = await fetch(window.__BASE_PATH__ + '/frags/navigation.json');
    if (fallback.ok) {
      const menuItems = await fallback.json();
      const user = window.__currentUser;
      const role = !user ? 'guest' : (user.isAdmin ? 'admin' : 'member');
      const filtered = menuItems.filter(item => {
        const allowed = item.allowedRoles || ['guest', 'member', 'admin'];
        return allowed.includes(role);
      }).map(item => {
        const newItem = { ...item };
        if (newItem.submenus) newItem.submenus = newItem.submenus.filter(sub => {
          const allowed = sub.allowedRoles || ['guest', 'member', 'admin'];
          return allowed.includes(role);
        });
        return newItem;
      });
      renderSidebarNav(filtered);
    }
  } catch (err) {
    console.warn('[Nav] Failed to load navigation:', err.message);
  }
}

// ── Render user profile ────────────────────────────────────────────────────

function getInitials(name, username) {
  if (name && name.trim()) return name.trim()[0].toUpperCase();
  if (username) return username[0].toUpperCase();
  return '?';
}

function renderProfile(user) {
  const avatar   = document.getElementById('profile-avatar');
  const nameEl   = document.getElementById('profile-name');
  const userEl   = document.getElementById('profile-username');
  const badgeEl  = document.getElementById('profile-badge');
  const infoUser = document.getElementById('info-username');
  const infoName = document.getElementById('info-name');
  const infoRole = document.getElementById('info-role');

  if (!user) {
    nameEl.textContent = '로그인이 필요합니다.';
    return;
  }

  const displayName = user.name || user.username;
  avatar.textContent = getInitials(user.name, user.username);
  nameEl.textContent = displayName;
  userEl.textContent = `@${user.username}`;

  if (user.isSuperAdmin) {
    badgeEl.textContent = '최고 관리자';
    badgeEl.className = 'profile-badge badge-super';
  } else if (user.isAdmin) {
    badgeEl.textContent = '관리자';
    badgeEl.className = 'profile-badge badge-admin';
  } else {
    badgeEl.textContent = '일반 회원';
    badgeEl.className = 'profile-badge badge-member';
  }

  if (infoUser) infoUser.textContent = user.username;
  if (infoName) infoName.textContent = user.name || '—';
  if (infoRole) {
    infoRole.textContent = user.isSuperAdmin ? '최고 관리자 (Super Admin)' :
                           user.isAdmin      ? '관리자 (Admin)' : '일반 회원 (Member)';
  }

  // Render activity generations list
  const activityList = document.getElementById('activity-list');
  if (activityList) {
    activityList.innerHTML = '';
    const acts = user.activities || [];
    if (acts.length === 0) {
      activityList.innerHTML = '<span style="color: #64748b; font-size: 0.85rem;">참여 중인 활동 기수가 없습니다. 아래 등록 코드를 입력하여 추가해 주세요.</span>';
    } else {
      acts.forEach(act => {
        const badge = document.createElement('span');
        badge.className = 'profile-badge';
        badge.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
        badge.style.color = '#3b82f6';
        badge.style.border = '1px solid rgba(59, 130, 246, 0.3)';
        badge.style.padding = '0.3rem 0.8rem';
        badge.style.borderRadius = '4px';
        badge.style.fontSize = '0.85rem';
        badge.style.fontWeight = '500';
        badge.textContent = act;
        activityList.appendChild(badge);
      });
    }
  }
}

// ── Password strength meter ────────────────────────────────────────────────

function measureStrength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw))    score++;
  if (/[^a-zA-Z\d]/.test(pw)) score++;
  return score; // 0–6
}

function updateStrengthUI(pw) {
  const fill  = document.getElementById('pw-strength-fill');
  const label = document.getElementById('pw-strength-label');
  if (!fill || !label) return;

  const score = measureStrength(pw);
  const pct   = Math.round((score / 6) * 100);
  fill.style.width = pw.length ? `${pct}%` : '0%';

  if (!pw.length) { fill.style.background = ''; label.textContent = ''; return; }

  if (score <= 2)      { fill.style.background = '#ef4444'; label.textContent = '취약'; label.style.color = '#ef4444'; }
  else if (score <= 4) { fill.style.background = '#f59e0b'; label.textContent = '보통'; label.style.color = '#f59e0b'; }
  else                 { fill.style.background = '#22c55e'; label.textContent = '강함'; label.style.color = '#22c55e'; }
}

// ── Change password form ────────────────────────────────────────────────────

function initPasswordForm() {
  const newPwInput = document.getElementById('new-pw');
  if (newPwInput) {
    newPwInput.addEventListener('input', () => updateStrengthUI(newPwInput.value));
  }

  const form = document.getElementById('change-pw-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('change-pw-btn');
    const currentPassword = document.getElementById('cur-pw').value.trim();
    const newPassword     = document.getElementById('new-pw').value;
    const confirmPassword = document.getElementById('confirm-pw').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('모든 필드를 입력해 주세요.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.', 'error');
      return;
    }
    if (newPassword === currentPassword) {
      showToast('새 비밀번호는 현재 비밀번호와 달라야 합니다.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = '변경 중...';

    try {
      const res = await apiRequest(window.__BASE_PATH__ + '/change-password', 'POST', { currentPassword, newPassword });
      if (res.ok) {
        showToast('비밀번호가 성공적으로 변경되었습니다!', 'success');
        form.reset();
        updateStrengthUI('');
      } else {
        showToast(res.message || '비밀번호 변경에 실패했습니다.', 'error');
      }
    } catch (err) {
      showToast('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '비밀번호 변경';
    }
  });
}

function initActivityForm() {
  const form = document.getElementById('add-activity-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('add-activity-btn');
    const input = document.getElementById('activity-code');
    const code = input.value.trim();

    if (!code) {
      showToast('코드를 입력해 주세요.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = '등록 중...';

    try {
      const res = await apiRequest(window.__BASE_PATH__ + '/add-activity', 'POST', { signupCode: code });
      if (res.ok) {
        showToast(res.message || '활동 기수가 성공적으로 등록되었습니다!', 'success');
        input.value = '';
        
        // Update user state and re-render profile
        if (res.data && res.data.activities) {
          window.__currentUser.activities = res.data.activities;
          renderProfile(window.__currentUser);
        }
      } else {
        showToast(res.message || '등록에 실패했습니다.', 'error');
      }
    } catch (err) {
      showToast('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '등록';
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const res = await apiRequest(window.__BASE_PATH__ + '/me', 'GET');
  const user = res.ok ? res.data : null;

  if (!user) {
    // Not logged in → redirect to login
    location.href = window.__BASE_PATH__ + '/login';
    return;
  }

  window.__currentUser = user;
  renderProfile(user);
  await loadSidebarNavigation();
  initPasswordForm();
  initActivityForm();
});
