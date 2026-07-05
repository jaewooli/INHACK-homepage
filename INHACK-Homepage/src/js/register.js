import { apiRequest } from './api.js';
import { showToast } from './toast.js';

document.addEventListener('DOMContentLoaded', () => {
  const registerForm = document.getElementById('register-form');

  // Load existing toast if any
  const message = sessionStorage.getItem('toastMessage');
  const type = sessionStorage.getItem('toastType');
  if (message) {
    sessionStorage.removeItem('toastMessage');
    sessionStorage.removeItem('toastType');
    showToast(message, type || 'info');
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = registerForm.username.value.trim();
      const name = registerForm.name.value.trim();
      const password = registerForm.password.value;
      const signupCode = registerForm.signupCode.value.trim();

      if (!username || !name || !password || !signupCode) {
        showToast('모든 필드를 채워주세요.', 'error');
        return;
      }

      // Password policy validation (number, upper, lower, special character, 8+ chars)
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]).{8,}$/;
      if (!passwordRegex.test(password)) {
        showToast('비밀번호가 복잡성 요구사항을 충족하지 않습니다.', 'error');
        return;
      }

      const body = {
        username,
        name,
        password,
        signupCode
      };

      const r = await apiRequest(window.__BASE_PATH__ + '/register', 'POST', body);
      
      if (r.ok) {
        sessionStorage.setItem('toastMessage', r.message || '회원가입이 완료되었습니다. 로그인해 주세요.');
        sessionStorage.setItem('toastType', 'success');
        location.href = window.__BASE_PATH__ + '/login';
      } else {
        showToast(r.message || '회원가입 중 오류가 발생했습니다.', 'error');
      }
    });
  }
});
