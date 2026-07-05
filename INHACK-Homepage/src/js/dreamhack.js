import { showToast } from "./toast.js";
import { apiRequest } from "./api.js";
import { triggerAdminSessionRenewal } from "./header.js";

function safeBtoa(uint8Array) {
  let binary = '';
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

async function isLoggedIn() {
  const r = await apiRequest(window.__BASE_PATH__ + '/me', 'GET');
  if (!r.ok) return null;
  
  return r.data;
}

// Auto-seed E2E credentials if plain text exists in env and database is empty
async function autoSeedE2ECredentials(plainEmail, plainPassword) {
  console.log('[E2E Setup] Plain text credentials detected in env. Auto-seeding E2E environment...');

  // CRITICAL: Only seed if the Chrome Extension is installed.
  // If we save an encrypted key to the DB without the extension present,
  // the extension will never receive the master key → permanent key mismatch → 401 on every renewal.
  const isExtensionInstalled = checkExtensionInstalled();
  if (!isExtensionInstalled) {
    console.warn('[E2E Setup] Extension not detected. Skipping auto-seed to prevent DB/key desync. Please install the INHACK extension and reload the page.');
    return;
  }

  try {
    // 1. Generate AES-GCM Key (JWK)
    const key = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const jwk = await window.crypto.subtle.exportKey("jwk", key);

    // 2. Encrypt Password
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode(plainPassword)
    );

    const ciphertextBase64 = safeBtoa(new Uint8Array(encrypted));
    const ivBase64 = safeBtoa(iv);

    // 3. Dispatch master key save to chrome extension
    window.dispatchEvent(new CustomEvent('INHACK_SAVE_MASTER_KEY', {
      detail: { jwk }
    }));

    // Delay to let extension save the key
    await new Promise(resolve => setTimeout(resolve, 600));

    // 4. Save encrypted credentials to server
    const saveRes = await apiRequest(window.__BASE_PATH__ + '/dreamhack/encrypted-credentials', 'POST', {
      encryptedPassword: ciphertextBase64,
      iv: ivBase64
    });

    if (saveRes.ok) {
      console.log('[E2E Setup] E2E Auto-seeding completed successfully.');
      showToast('E2E 보안 환경이 자동으로 안전하게 구축되었습니다!', 'success');
    } else {
      console.error('[E2E Setup] Auto-seeding server save failed:', saveRes.message);
    }
  } catch (err) {
    console.error('[E2E Setup] Fatal error during E2E auto-seeding:', err);
  }
}

function showLoginRequiredToast() {
  showToast('로그인이 필요합니다.', 'error');
}

function checkExtensionInstalled() {
  return document.documentElement.dataset.inhackExtensionInstalled === "true";
}

function updateExtensionStatus() {
  const statusBadge = document.getElementById('ext-status');
  const sessionStatus = document.getElementById('session-status');
  const warningBanner = document.getElementById('session-warning-banner');
  const sharedSessionCard = document.getElementById('shared-session-card');
  const extInstallNotice = document.getElementById('ext-install-notice');

  const installed = checkExtensionInstalled();

  if (statusBadge) {
    if (installed) {
      statusBadge.className = 'status-badge status-connected';
      statusBadge.innerHTML = '<span class="status-dot"></span>확장 프로그램: 연결됨';
    } else {
      statusBadge.className = 'status-badge status-disconnected';
      statusBadge.innerHTML = '<span class="status-dot"></span>확장 프로그램: 감지되지 않음';
    }
  }

  // Show/hide session-dependent elements based on extension presence
  if (sessionStatus)     sessionStatus.style.display    = installed ? '' : 'none';
  if (warningBanner)     warningBanner.style.display     = installed ? '' : 'none';
  if (sharedSessionCard) sharedSessionCard.style.display = installed ? '' : 'none';
  if (extInstallNotice)  extInstallNotice.style.display  = installed ? 'none' : '';
}


async function updateSharedSessionStatus() {
  const badge = document.getElementById('session-status');
  if (!badge) return;

  try {
    const res = await apiRequest(window.__BASE_PATH__ + '/dreamhack/shared-session', 'GET');
    if (res.ok && res.data && res.data.sessionid) {
      const timeStr = res.data.updated_at ? new Date(res.data.updated_at).toLocaleString() : 'N/A';
      badge.className = 'status-badge status-connected';
      badge.innerHTML = `<span class="status-dot"></span>세션: 활성화됨 (업데이트: ${timeStr})`;
    } else {
      badge.className = 'status-badge status-disconnected';
      badge.innerHTML = '<span class="status-dot"></span>세션: 비활성화됨 (재발급 필요)';
    }
  } catch (err) {
    console.error('Failed to fetch shared session status:', err);
    badge.className = 'status-badge status-disconnected';
    badge.innerHTML = '<span class="status-dot"></span>세션: 상태 확인 오류';
  }
}

async function executeSpecificFeature(userdata) {
  const isExtensionInstalled = checkExtensionInstalled();
  if (!isExtensionInstalled) {
    showToast('크롬 확장 프로그램이 감지되지 않았습니다. 먼저 설치해 주세요.', 'error');
    return;
  }

  showToast('드림핵 세션 동기화 요청 중...', 'info', 0);

  // Trigger cookie sync from Chrome Extension
  window.dispatchEvent(new CustomEvent('INHACK_DREAMHACK_SYNC_TRIGGER'));
}

async function loadActivityLogs(userdata) {
  const currentUser = userdata || window.__currentUser;

  // Hide intercept log card for non-admins
  const interceptCard = document.getElementById('intercept-log-card');
  if (interceptCard) {
    interceptCard.style.display = (currentUser && currentUser.isAdmin) ? '' : 'none';
  }

  const accessBody = document.querySelector('#access-log-table tbody');
  const solveBody = document.querySelector('#solve-log-table tbody');
  const interceptBody = document.querySelector('#intercept-log-table tbody');

  try {
    const res = await apiRequest(window.__BASE_PATH__ + '/dreamhack/logs', 'GET');
    if (res.ok && res.data) {
      const { accessLogs, solveLogs, interceptLogs } = res.data;
      
      // Render access logs
      if (accessBody) {
        if (accessLogs && accessLogs.length > 0) {
          accessBody.innerHTML = accessLogs.map(log => {
            const timeStr = new Date(log.timestamp).toLocaleString();
            return `
              <tr>
                <td>${escapeHtml(log.username)}</td>
                <td>${escapeHtml(log.ip_address)}</td>
                <td>${timeStr}</td>
              </tr>
            `;
          }).join('');
        } else {
          accessBody.innerHTML = `<tr><td colspan="3" class="log-empty">아직 동기화 시도 기록이 없습니다.</td></tr>`;
        }
      }

      // Render solve logs
      if (solveBody) {
        if (solveLogs && solveLogs.length > 0) {
          solveBody.innerHTML = solveLogs.map(log => {
            const timeStr = new Date(log.timestamp).toLocaleString();
            return `
              <tr>
                <td>${escapeHtml(log.username)}</td>
                <td>${escapeHtml(log.challenge_name || log.challenge_id)}</td>
                <td>${timeStr}</td>
              </tr>
            `;
          }).join('');
        } else {
          solveBody.innerHTML = `<tr><td colspan="3" class="log-empty">아직 풀이한 문제가 없습니다.</td></tr>`;
        }
      }

      // Render logout interception logs (admin only)
      if (currentUser && currentUser.isAdmin) {
        if (interceptBody) {
          if (interceptLogs && interceptLogs.length > 0) {
            interceptBody.innerHTML = interceptLogs.map(log => {
              const timeStr = new Date(log.timestamp).toLocaleString();
              return `
                <tr>
                  <td>${escapeHtml(log.username)}</td>
                  <td>${escapeHtml(log.ip_address)}</td>
                  <td>${timeStr}</td>
                </tr>
              `;
            }).join('');
          } else {
            interceptBody.innerHTML = `<tr><td colspan="3" class="log-empty">아직 로그아웃 차단 기록이 없습니다.</td></tr>`;
          }
        }
      }
    } else {
      const errMsg = res.message || '알 수 없는 서버 오류';
      if (accessBody) accessBody.innerHTML = `<tr><td colspan="3" class="log-empty" style="color: #ff3366;">로그 로드 실패 (${escapeHtml(errMsg)})</td></tr>`;
      if (solveBody) solveBody.innerHTML = `<tr><td colspan="3" class="log-empty" style="color: #ff3366;">로그 로드 실패 (${escapeHtml(errMsg)})</td></tr>`;
      if (interceptBody) interceptBody.innerHTML = `<tr><td colspan="3" class="log-empty" style="color: #ff3366;">로그 로드 실패 (${escapeHtml(errMsg)})</td></tr>`;
    }
  } catch (err) {
    console.error('Failed to load activity logs:', err);
    const errMsg = err.message || '네트워크 오류';
    if (accessBody) accessBody.innerHTML = `<tr><td colspan="3" class="log-empty" style="color: #ff3366;">로드 오류 (${escapeHtml(errMsg)})</td></tr>`;
    if (solveBody) solveBody.innerHTML = `<tr><td colspan="3" class="log-empty" style="color: #ff3366;">로드 오류 (${escapeHtml(errMsg)})</td></tr>`;
    if (interceptBody) interceptBody.innerHTML = `<tr><td colspan="3" class="log-empty" style="color: #ff3366;">로드 오류 (${escapeHtml(errMsg)})</td></tr>`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

async function executeLoadSharedSession(userdata) {
  const isExtensionInstalled = checkExtensionInstalled();
  if (!isExtensionInstalled) {
    showToast('크롬 확장 프로그램이 감지되지 않았습니다. 먼저 설치해 주세요.', 'error');
    return;
  }

  showToast('서버에서 공용 세션 정보 가져오는 중...', 'info', 0);
  // Dispatch load trigger event to extension
  window.dispatchEvent(new CustomEvent('INHACK_DREAMHACK_LOAD_TRIGGER'));
}



async function loadSidebarNavigation() {
  try {
    const res = await fetch(window.__BASE_PATH__ + '/navigation');
    if (res.ok) {
      const payload = await res.json();
      if (payload.ok && payload.data) {
        renderSidebarNav(payload.data);
        return;
      }
    }
    // Fallback
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
        if (newItem.submenus && Array.isArray(newItem.submenus)) {
          newItem.submenus = newItem.submenus.filter(sub => {
            const allowed = sub.allowedRoles || ['guest', 'member', 'admin'];
            return allowed.includes(role);
          });
        }
        return newItem;
      });
      renderSidebarNav(filtered);
    }
  } catch (err) {
    console.warn('[Nav] Failed to load dynamic navigation:', err.message);
  }
}

function renderSidebarNav(menuItems) {
  const navList = document.getElementById('sidebar-nav-list');
  if (!navList) return;

  navList.innerHTML = '';
  menuItems.forEach(item => {
    if (item.type !== 'menu_item') return;
    const li = document.createElement('li');
    li.style.position = 'relative';
    
    const isExternal = item.external;
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
    if (isExternal) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    
    // Highlight active link
    if (window.location.pathname === resolvedUrl) {
      a.classList.add('active');
    }
    
    li.appendChild(a);

    if (hasSubmenu) {
      const toggle = document.createElement('span');
      toggle.className = 'submenu-toggle';
      toggle.innerHTML = '<span>›</span>';
      
      toggle.addEventListener('click', (e) => {
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
        const isHomepage = window.location.pathname === window.__BASE_PATH__ || window.location.pathname === window.__BASE_PATH__ + '/';
        let resolvedSubUrl = sub.url || '#';
        resolvedSubUrl = resolvedSubUrl.replace(/\{\{BASE_PATH\}\}/g, window.__BASE_PATH__);
        if (resolvedSubUrl.startsWith('#') && resolvedSubUrl !== '#') {
          resolvedSubUrl = isHomepage ? resolvedSubUrl : `${window.__BASE_PATH__}/${resolvedSubUrl}`;
        }
        subA.href = resolvedSubUrl;
        subA.className = 'nav-item-link';
        subA.textContent = sub.title;
        if (sub.external) { subA.target = '_blank'; subA.rel = 'noopener noreferrer'; }
        subLi.appendChild(subA);
        subUl.appendChild(subLi);
      });
      li.appendChild(subUl);

      const isPureCategory = !item.url || item.url === '#';
      a.addEventListener('click', (e) => {
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

  // Re-append admin link if the current user is admin
  if (window.__currentUser && window.__currentUser.isAdmin && !document.getElementById('nav-admin-link')) {
    const adminLi = document.createElement('li');
    adminLi.innerHTML = `<a href="${window.__BASE_PATH__}/admin" id="nav-admin-link" class="nav-item-link" style="color: #ff4b4b; border-left: 2px solid #ff4b4b; font-weight: 700;">Admin Panel</a>`;
    navList.appendChild(adminLi);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  updateExtensionStatus();
  // Brief timeout check to avoid injection race conditions
  setTimeout(updateExtensionStatus, 300);

  // Load shared session status badge
  updateSharedSessionStatus();

  const confirmbtn = document.getElementById('dreamhack-confirm');
  const userdata = await isLoggedIn();

  // Render Navigation and User interface elements
  window.__currentUser = userdata;
  await loadSidebarNavigation();

  // Load activity logs after userdata is known (so intercept card is correctly shown/hidden)
  loadActivityLogs(userdata);


  if (confirmbtn) {
    if (userdata) {
      confirmbtn.textContent = '공유 세션 불러오기';
      confirmbtn.addEventListener('click', () => {
        executeLoadSharedSession(userdata);
      });
    } else {
      confirmbtn.addEventListener('click', showLoginRequiredToast);
    }
  } else {
    console.warn("Cannot find the button with id 'dreamhack-confirm'.");
  }

  // Render Admin E2E Credential Setup UI if user is admin
  if (userdata && userdata.isAdmin) {
    // E2E Auto-seeding check
    try {
      const credRes = await apiRequest(window.__BASE_PATH__ + '/dreamhack/encrypted-credentials', 'GET');
      if (credRes.ok && credRes.data && credRes.data.isPlain) {
        await autoSeedE2ECredentials(credRes.data.email, credRes.data.plainPassword);
      }
    } catch (e) {
      console.warn('[E2E Check] Error checking credentials state:', e);
    }

    const container = document.querySelector('.option-container');
    if (container) {
      const adminCard = document.createElement('div');
      adminCard.className = 'option-card admin-only-card';
      adminCard.style.border = '1px solid rgba(255, 75, 75, 0.3)';
      adminCard.innerHTML = `
        <div class="option-title">
            <span style="color: #ff4b4b;">E2E 비밀번호 설정 (관리자 전용)</span>
        </div>
        <div class="option-desc" style="margin-bottom: 12px;">
            드림핵 공용 계정의 <strong>실제 로그인 비밀번호</strong>를 입력해야 합니다. 입력한 비밀번호는 브라우저에서 종단간(E2E) 암호화되어 서버에 저장됩니다.
        </div>
        <div class="form-group" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px;">
            <input type="password" id="dh-admin-password" placeholder="드림핵 포탈 실제 비밀번호" style="padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: #fff;">
        </div>
        <button id="dh-admin-save-btn" class="action-btn" style="background: #ff4b4b; width: 100%;" type="button">비밀번호 저장 (E2E)</button>
        
        <div class="admin-actions" style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed rgba(255, 75, 75, 0.2); display: flex; flex-direction: column; gap: 10px;">
            <button id="dh-admin-renew-btn" class="action-btn" style="margin: 0 auto; width: 100%; border-color: var(--color-green); color: var(--color-green);" type="button">세션 재발급 (Renew)</button>
            <button id="dh-admin-logout-shared-btn" class="action-btn" style="margin: 0 auto; width: 100%; border-color: var(--color-red); color: var(--color-red);" type="button">세션 일괄 파기 (Logout Shared)</button>
        </div>
      `;
      container.appendChild(adminCard);

      const saveBtn = document.getElementById('dh-admin-save-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const password = document.getElementById('dh-admin-password').value;
          if (!password) {
            showToast('비밀번호를 입력해 주세요.', 'error');
            return;
          }

          showToast('보안 대칭키 생성 및 종단간 암호화 중...', 'info', 0);
          try {
            // 1. Generate AES-GCM Key (JWK)
            const key = await window.crypto.subtle.generateKey(
              { name: "AES-GCM", length: 256 },
              true,
              ["encrypt", "decrypt"]
            );
            const jwk = await window.crypto.subtle.exportKey("jwk", key);

            // 2. Encrypt Password
            const enc = new TextEncoder();
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await window.crypto.subtle.encrypt(
              { name: "AES-GCM", iv: iv },
              key,
              enc.encode(password)
            );

            const ciphertextBase64 = safeBtoa(new Uint8Array(encrypted));
            const ivBase64 = safeBtoa(iv);

            // 3. Dispatch master key save to chrome extension
            window.dispatchEvent(new CustomEvent('INHACK_SAVE_MASTER_KEY', {
              detail: { jwk }
            }));

            // Give a small delay to let extension save the key
            await new Promise(resolve => setTimeout(resolve, 600));

            // 4. Save encrypted credentials to server (email bound server-side from env)
            const saveRes = await apiRequest(window.__BASE_PATH__ + '/dreamhack/encrypted-credentials', 'POST', {
              encryptedPassword: ciphertextBase64,
              iv: ivBase64
            });

            if (saveRes.ok) {
              showToast('E2E 암호화 설정이 안전하게 완료되었습니다!', 'success');
              document.getElementById('dh-admin-password').value = '';
            } else {
              showToast(`자격 증명 서버 저장 실패: ${saveRes.message}`, 'error');
            }
          } catch (err) {
            console.error(err);
            showToast(`E2E 암호화 설정 실패: ${err.message}`, 'error');
          }
        });
      }

      // Click handler for renew session
      const adminRenewBtn = document.getElementById('dh-admin-renew-btn');
      if (adminRenewBtn) {
        adminRenewBtn.addEventListener('click', async () => {
          await triggerAdminSessionRenewal();
        });
      }

      // Click handler for logout shared
      const adminLogoutSharedBtn = document.getElementById('dh-admin-logout-shared-btn');
      if (adminLogoutSharedBtn) {
        adminLogoutSharedBtn.addEventListener('click', async () => {
          if (confirm('정말로 공용 드림핵 세션을 서버 및 드림핵 서비스에서 로그아웃하여 모든 사용자의 연동을 끊으시겠습니까?')) {
            await triggerAdminSessionTermination();
          }
        });
      }
    }
  }

  // Listen for load response event from extension content script
  window.addEventListener('INHACK_DREAMHACK_LOAD_RESPONSE', (event) => {
    const { ok, message } = event.detail;
    if (ok) {
      showToast('공용 계정 세션 이식 성공! 새 탭에 드림핵이 열립니다.', 'success');
    } else {
      showToast(`세션 연동 실패: ${message || '알 수 없는 오류'}`, 'error');
      // Auto-reload after 1.5 seconds when session fails (e.g. inactive session)
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
  });
  // Listen for sync response event from extension content script
  window.addEventListener('INHACK_DREAMHACK_SYNC_RESPONSE', async (event) => {
    const { ok, sessionid, csrftoken, message } = event.detail;
    if (ok) {
      if (!sessionid) {
        showToast('드림핵 로그인 세션이 발견되지 않았습니다. 드림핵(dreamhack.io)에 먼저 로그인해주세요.', 'error');
        return;
      }
      showToast('드림핵 세션 정보 획득 완료. 서버 연동 중...', 'info', 0);

      try {
        const syncRes = await apiRequest(window.__BASE_PATH__ + '/dreamhack/login', 'POST', { sessionid, csrftoken });
        if (syncRes.ok) {
          showToast('드림핵 세션 동기화 성공!', 'success');
          // Reload the logs panel to display the new sync attempt immediately
          loadActivityLogs();
          setTimeout(() => {
            window.location.href = 'https://dreamhack.io';
          }, 1200);
        } else {
          showToast(`서버 연동 실패: ${syncRes.message || '서버 오류'}`, 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('서버 통신 오류', 'error');
      }
    } else {
      if (message === 'HOMEPAGE_TAB_CLOSED') {
        showToast('연동 기능을 사용하려면 INHACK 홈페이지에서 DREAMHACK 기능을 이용해주세요.', 'error');
      } else {
        showToast(`쿠키 동기화 실패: ${message}`, 'error');
      }
    }
  });
});



function triggerAdminSessionTermination(silent = false) {
  return new Promise(async (resolve, reject) => {
    const isExtensionInstalled = checkExtensionInstalled();
    if (!isExtensionInstalled) {
      if (!silent) showToast('Chrome Extension이 감지되지 않아 공용 세션을 로그아웃하지 못했습니다.', 'error');
      return reject(new Error('Extension not installed'));
    }

    if (!silent) {
      showToast('드림핵 공용 계정 세션 파기 및 로그아웃 요청 중...', 'info');
    }

    try {
      const sharedRes = await apiRequest(window.__BASE_PATH__ + '/dreamhack/shared-session', 'GET');
      if (!sharedRes.ok) {
        return reject(new Error('서버에서 공용 세션 정보를 가져오는데 실패했습니다.'));
      }
      if (!sharedRes.data || !sharedRes.data.sessionid) {
        await apiRequest(window.__BASE_PATH__ + '/dreamhack/clear-shared-session', 'POST');
        if (!silent) showToast('이미 등록된 공용 세션이 없습니다. 서버 데이터를 초기화했습니다.', 'success');
        return resolve();
      }

      const handleResponse = async (event) => {
        const { ok, message } = event.detail;
        window.removeEventListener('INHACK_ADMIN_LOGOUT_SHARED_RESPONSE', handleResponse);
        if (ok) {
          const clearRes = await apiRequest(window.__BASE_PATH__ + '/dreamhack/clear-shared-session', 'POST');
          if (clearRes.ok) {
            if (!silent) {
              showToast('드림핵 공용 계정 세션 파기 및 일괄 로그아웃 완료!', 'success');
              setTimeout(() => {
                window.location.reload();
              }, 1000);
            }
            resolve();
          } else {
            reject(new Error('서버 데이터 초기화 실패'));
          }
        } else {
          reject(new Error(message || '익스텐션 세션 파기 실패'));
        }
      };
      window.addEventListener('INHACK_ADMIN_LOGOUT_SHARED_RESPONSE', handleResponse);

      window.dispatchEvent(new CustomEvent('INHACK_ADMIN_LOGOUT_SHARED_TRIGGER', {
        detail: {
          sessionid: sharedRes.data.sessionid,
          csrftoken: sharedRes.data.csrftoken || '',
          sessions: sharedRes.data.sessions || []
        }
      }));
    } catch (err) {
      console.error('[Admin Session Logout] Error:', err);
      if (!silent) showToast(`드림핵 공용 세션 로그아웃 실패: ${err.message}`, 'error');
      reject(err);
    }
  });
}