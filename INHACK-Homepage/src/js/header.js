import { fetchMe } from './auth.js';
import { apiRequest } from './api.js';
import { showToast } from './toast.js';

export async function triggerAdminSessionRenewal() {
  try {
    const credRes = await apiRequest(window.__BASE_PATH__ + '/dreamhack/encrypted-credentials', 'GET');
    if (!credRes.ok || !credRes.data) {
      throw new Error(credRes.message || '자격 증명 데이터 오류');
    }

    const { email, encryptedPassword, iv } = credRes.data;

    const isExtensionInstalled = document.documentElement.dataset.inhackExtensionInstalled === "true";
    if (!isExtensionInstalled) {
      throw new Error('Chrome Extension이 감지되지 않았습니다. 먼저 크롬 익스텐션을 설치 및 활성화해 주세요.');
    }

    showToast('드림핵 공용 계정 세션 재발급 및 갱신 중... (약 10초 소요)', 'info', 0);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('INHACK_ADMIN_AUTO_LOGIN_RESPONSE', responseListener);
        reject(new Error('익스텐션 응답 타임아웃 (15초 초과)'));
      }, 15000);

      function responseListener(event) {
        clearTimeout(timeout);
        window.removeEventListener('INHACK_ADMIN_AUTO_LOGIN_RESPONSE', responseListener);
        const { ok, message } = event.detail;
        if (ok) {
          resolve();
        } else {
          reject(new Error(message || '익스텐션 처리 중 오류가 발생했습니다.'));
        }
      }

      window.addEventListener('INHACK_ADMIN_AUTO_LOGIN_RESPONSE', responseListener);

      window.dispatchEvent(new CustomEvent('INHACK_ADMIN_AUTO_LOGIN_TRIGGER', {
        detail: { email, encryptedPassword, iv }
      }));
    });

    showToast('드림핵 공용 계정 세션 갱신 완료!', 'success');
    
    if (document.getElementById('session-status')) {
      window.location.reload();
    }
  } catch (err) {
    console.error('[Admin Session Renewal] Error:', err);
    showToast(`드림핵 세션 재발급 실패: ${err.message}`, 'error');
  }
}

export async function loadHeader() {
  const header = document.querySelector('header');
  if (!header) return;

  try {
    const res = await fetch(window.__BASE_PATH__ + '/frags/header.html');
    if (res.ok) {
      const html = await res.text();
      header.innerHTML = html;
    }
  } catch (err) {
    console.error('[Header] Failed to load header fragment:', err);
  }
}

export function renderHeaderUI(user) {
  const nav = document.querySelector('nav');
  if (!nav) return;

  nav.innerHTML = '';

  if (user) {
    window.__currentUser = user;

    if (user.isAdmin) {
      const renewbtn = document.createElement('button');
      renewbtn.id = 'renew-btn';
      renewbtn.textContent = 'Renew Session';
      renewbtn.addEventListener('click', async () => { await triggerAdminSessionRenewal(); });
      nav.appendChild(renewbtn);

      // Append Admin Panel to sidebar if we are on index/dreamhack/mypage
      const sidebarList = document.querySelector('aside ul');
      if (sidebarList && !document.getElementById('nav-admin-link')) {
        const adminLi = document.createElement('li');
        adminLi.innerHTML = `<a href="${window.__BASE_PATH__}/admin" id="nav-admin-link" class="nav-item-link" style="color: #ff4b4b; border-left: 2px solid #ff4b4b; font-weight: 700;">Admin Panel</a>`;
        sidebarList.appendChild(adminLi);
      }
    }

    // My Page link (render if not currently on mypage)
    const isMyPage = window.location.pathname === window.__BASE_PATH__ + '/mypage' || window.location.pathname === window.__BASE_PATH__ + '/mypage.html';
    if (!isMyPage) {
      const mypageBtn = document.createElement('button');
      mypageBtn.id = 'mypage-btn';
      mypageBtn.textContent = '마이페이지';
      mypageBtn.addEventListener('click', () => { location.href = window.__BASE_PATH__ + '/mypage'; });
      nav.appendChild(mypageBtn);
    } else {
      // Username chip on mypage
      const userChip = document.createElement('span');
      userChip.id = 'user-chip';
      userChip.textContent = `@${user.username}`;
      userChip.style.cssText = 'font-size:0.82rem;color:rgba(255,255,255,0.5);font-family:"Fira Code",monospace;padding:5px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:6px;';
      nav.appendChild(userChip);
    }

    // Logout button
    const logoutbtn = document.createElement('button');
    logoutbtn.id = 'logout-btn';
    logoutbtn.textContent = 'Logout';
    nav.appendChild(logoutbtn);
    logoutbtn.addEventListener('click', async () => {
      const res = await fetch(window.__BASE_PATH__ + '/logout', { method: 'POST' });
      if (res.ok) location.href = window.__BASE_PATH__;
      else showToast('Logout failed', 'error');
    });
  } else {
    // Guest
    const loginbtn = document.createElement('button');
    loginbtn.id = 'login-btn';
    loginbtn.textContent = 'Sign In / Sign Up';
    loginbtn.addEventListener('click', () => { location.href = window.__BASE_PATH__ + '/login'; });
    nav.appendChild(loginbtn);

    const supportbtn = document.createElement('button');
    supportbtn.id = 'support-btn';
    supportbtn.textContent = 'Support';
    supportbtn.addEventListener('click', () => {
      window.location.href = 'mailto:jaeu1341@naver.com?subject=[INHACK Homepage] Support / Account Request';
    });
    nav.appendChild(supportbtn);
  }
}

export async function initHeader() {
  await loadHeader();
  const me = await fetchMe();
  renderHeaderUI(me);
  return me;
}

if (!window.__headerInitialized) {
  window.__headerInitialized = true;
  document.addEventListener('DOMContentLoaded', initHeader);
}

// Prevent automatic viewport scroll jump when navigation anchors are clicked or hash changes
let lastScrollY = window.scrollY;
window.addEventListener('click', (e) => {
  const anchor = e.target.closest('a');
  if (anchor && anchor.getAttribute('href') && anchor.getAttribute('href').includes('#')) {
    lastScrollY = window.scrollY;
  }
}, { passive: true });

window.addEventListener('hashchange', () => {
  // Restore scroll position to prevent browser anchor jump
  requestAnimationFrame(() => {
    window.scrollTo(window.scrollX, lastScrollY);
  });
});
