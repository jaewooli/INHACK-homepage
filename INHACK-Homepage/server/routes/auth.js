const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const env = require('../config/env');
const { sendJson } = require('../helpers/response');
const { validateLogin } = require('../middlewares/auth');

// Login route
router.post('/login', validateLogin, (req, res) => {
    const { username, password } = req.body;

    const query = `
        SELECT u.*, GROUP_CONCAT(ua.activity, ', ') AS activities 
        FROM users u 
        LEFT JOIN user_activities ua ON u.id = ua.user_id 
        WHERE u.username = ?
        GROUP BY u.id
    `;

    db.get(query, [username], (err, row) => {
        if (err) {
             return sendJson(res, {
              status: 500, ok: false, action: 'auth', resource: 'users',
              message: 'Database error',
              code: 'DB_ERROR'
            });
        }
        if (!row) {
            return sendJson(res, {
                status: 401, ok: false, action: 'auth', resource: 'users',
                message: 'Invalid username or password',
                code: 'INVALID_CREDENTIALS'
            });
        }

        try {
            const passwordMatch = bcrypt.compareSync(password, row.password);
            if (!passwordMatch) {
                return sendJson(res, {
                    status: 401, ok: false, action: 'auth', resource: 'users',
                    message: 'Invalid username or password',
                    code: 'INVALID_CREDENTIALS'
                });
            }

            // Check if user is blocked
            if (row.is_blocked === 1) {
                return sendJson(res, {
                    status: 403, ok: false, action: 'auth', resource: 'users',
                    message: '차단된 계정입니다. 관리자에게 문의해 주세요.',
                    code: 'BLOCKED_USER'
                });
            }

            const adminUser = env.ADMIN_USERNAME;
            const isSuperAdmin = (row.username === 'developer' || row.username === adminUser);
            const isAdmin = (row.is_admin === 1 || row.username === adminUser || isSuperAdmin);
            req.session.user = { 
                id: row.id, 
                username: row.username, 
                name: row.name, 
                isAdmin, 
                isSuperAdmin,
                passwordChanged: row.password_changed || 0,
                createdAsAdmin: row.created_as_admin || 0,
                activities: row.activities ? row.activities.split(', ') : []
            };
            req.session.save((saveErr) => {
                if (saveErr) {
                    console.error('[Session Save Error] Failed to save session:', saveErr.message);
                    return sendJson(res, {
                        status: 500, ok: false, action: 'auth', resource: 'users',
                        message: 'Session creation failed',
                        code: 'SESSION_SAVE_ERROR'
                    });
                }
                sendJson(res, {
                    status: 200, ok: true, action: 'auth', resource: 'users',
                    message: 'Login Success!.',
                    code: 'LOGIN_SUCCESS'
                });
            });
        } catch (e) {
            sendJson(res, {
                status: 500, ok: false, action: 'auth', resource: 'users',
                message: 'Password comparison error',
                code: 'HASH_ERROR'
            });
        }
    });
});

// Register route
router.post('/register', (req, res) => {
    const { username, password, name, signupCode } = req.body;

    if (!username || !password || !name || !signupCode) {
        return sendJson(res, {
            status: 400, ok: false, action: 'auth', resource: 'users',
            message: '아이디, 비밀번호, 이름, 가입 코드를 모두 입력해 주세요.',
            code: 'BAD_REQUEST'
        });
    }

    const trimmedUsername = username.trim();
    const trimmedName = name.trim();
    const trimmedCode = signupCode.trim();

    if (!trimmedUsername || !trimmedName || !trimmedCode) {
        return sendJson(res, {
            status: 400, ok: false, action: 'auth', resource: 'users',
            message: '입력란에 공백만 입력할 수는 없습니다.',
            code: 'BAD_REQUEST'
        });
    }

    // Password strength check
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]).{8,}$/;
    if (!passwordRegex.test(password)) {
        return sendJson(res, {
            status: 400, ok: false, action: 'auth', resource: 'users',
            message: '비밀번호는 최소 8자 이상이어야 하며 숫자, 영문 대문자, 영문 소문자, 특수문자를 각각 최소 1개 이상 포함해야 합니다.',
            code: 'PASSWORD_TOO_WEAK'
        });
    }

    // Verify signup code first
    db.get(`SELECT * FROM signup_codes WHERE code = ?`, [trimmedCode], (codeErr, codeRow) => {
        if (codeErr) {
            console.error('[Signup Error] DB query error on signup_codes:', codeErr.message);
            return sendJson(res, {
                status: 500, ok: false, action: 'auth', resource: 'users',
                message: '데이터베이스 조회 중 오류가 발생했습니다.',
                code: 'DB_ERROR'
            });
        }

        if (!codeRow) {
            return sendJson(res, {
                status: 400, ok: false, action: 'auth', resource: 'users',
                message: '유효하지 않은 가입 코드입니다. 관리자에게 문의하세요.',
                code: 'INVALID_SIGNUP_CODE'
            });
        }

        const targetGeneration = codeRow.generation;

        // Check if username is already taken
        db.get(`SELECT id FROM users WHERE username = ?`, [trimmedUsername], (userErr, userRow) => {
            if (userErr) {
                console.error('[Signup Error] DB query error on users:', userErr.message);
                return sendJson(res, {
                    status: 500, ok: false, action: 'auth', resource: 'users',
                    message: '데이터베이스 조회 중 오류가 발생했습니다.',
                    code: 'DB_ERROR'
                });
            }

            if (userRow) {
                return sendJson(res, {
                    status: 409, ok: false, action: 'auth', resource: 'users',
                    message: '이미 존재하는 아이디입니다.',
                    code: 'ALREADY_EXISTS'
                });
            }

            // Create user
            const hashedPassword = bcrypt.hashSync(password, 10);
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                db.run(
                    `INSERT INTO users (username, password, name, password_changed, is_blocked, is_admin, created_as_admin) 
                     VALUES (?, ?, ?, 1, 0, 0, 0)`,
                    [trimmedUsername, hashedPassword, trimmedName],
                    function (insertErr) {
                        if (insertErr) {
                            db.run('ROLLBACK');
                            console.error('[Signup Error] Failed to insert user:', insertErr.message);
                            return sendJson(res, {
                                status: 500, ok: false, action: 'auth', resource: 'users',
                                message: '회원가입 처리 중 오류가 발생했습니다.',
                                code: 'DB_ERROR'
                            });
                        }

                        const newUserId = this.lastID;

                        // Insert user activity generation
                        db.run(
                            `INSERT INTO user_activities (user_id, activity) VALUES (?, ?)`,
                            [newUserId, targetGeneration],
                            (actErr) => {
                                if (actErr) {
                                    db.run('ROLLBACK');
                                    console.error('[Signup Error] Failed to insert user activity:', actErr.message);
                                    return sendJson(res, {
                                        status: 500, ok: false, action: 'auth', resource: 'users',
                                        message: '활동 기수 등록 중 오류가 발생했습니다.',
                                        code: 'DB_ERROR'
                                    });
                                }

                                db.run('COMMIT', (commitErr) => {
                                    if (commitErr) {
                                        db.run('ROLLBACK');
                                        console.error('[Signup Error] Commit failed:', commitErr.message);
                                        return sendJson(res, {
                                            status: 500, ok: false, action: 'auth', resource: 'users',
                                            message: '트랜잭션 커밋 실패',
                                            code: 'DB_ERROR'
                                        });
                                    }

                                    return sendJson(res, {
                                        status: 200, ok: true, action: 'auth', resource: 'users',
                                        message: `회원가입이 완료되었습니다! 기수: ${targetGeneration}`,
                                        code: 'SIGNUP_SUCCESS'
                                    });
                                });
                            }
                        );
                    }
                );
            });
        });
    });
});

router.get('/me', (req, res) => {
  if (req.session.user) {
    const env = require('../config/env');
    const isSuperAdmin = (req.session.user.username === 'developer' || req.session.user.username === env.ADMIN_USERNAME);
    const isAdmin = !!(req.session.user.isAdmin || isSuperAdmin);
    const userData = { ...req.session.user, isAdmin, isSuperAdmin };
    return sendJson(res, {
      status: 200, ok: true, action: 'auth', resource: 'session',
      message: 'Session active', data: userData, code: 'SESSION_ACTIVE'
    });
  }
  return sendJson(res, {
    status: 401, ok: false, action: 'auth', resource: 'session',
    message: 'No active session', code: 'NO_SESSION'
  });
});

// User Route: Change password (enforcing security rules)
router.post('/change-password', (req, res) => {
  if (!req.session.user) {
    return sendJson(res, { status: 401, ok: false, message: '로그인이 필요합니다.', code: 'UNAUTHORIZED' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return sendJson(res, { status: 400, ok: false, message: '현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.', code: 'BAD_REQUEST' });
  }

  // Enforce password requirements: Number, Upper/Lower English letter, general special character, at least 8 chars
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]).{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    return sendJson(res, {
      status: 400,
      ok: false,
      message: '새 비밀번호는 최소 8자 이상이어야 하며 숫자, 영문 대문자, 영문 소문자, 특수문자를 각각 최소 1개 이상 포함해야 합니다.',
      code: 'PASSWORD_TOO_WEAK'
    });
  }

  db.get(`SELECT password FROM users WHERE id = ?`, [req.session.user.id], (err, row) => {
    if (err || !row) {
      console.error('[Database Error] Failed to fetch user password:', err ? err.message : 'User not found');
      return sendJson(res, { status: 500, ok: false, message: '데이터베이스 조회 실패', code: 'DB_ERROR' });
    }

    try {
      const match = bcrypt.compareSync(currentPassword, row.password);
      if (!match) {
        return sendJson(res, { status: 400, ok: false, message: '현재 비밀번호가 일치하지 않습니다.', code: 'INVALID_CURRENT_PASSWORD' });
      }

      const hashedNewPassword = bcrypt.hashSync(newPassword, 10);
      db.run(`UPDATE users SET password = ?, password_changed = 1 WHERE id = ?`, [hashedNewPassword, req.session.user.id], (updateErr) => {
        if (updateErr) {
          console.error('[Database Error] Failed to update password:', updateErr.message);
          return sendJson(res, { status: 500, ok: false, message: '비밀번호 변경 실패', code: 'DB_ERROR' });
        }

        req.session.user.passwordChanged = 1;
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[Session Save Error] Failed to save session after password change:', saveErr.message);
            return sendJson(res, { status: 500, ok: false, message: '세션 업데이트 실패', code: 'SESSION_SAVE_ERROR' });
          }
          sendJson(res, { status: 200, ok: true, message: '비밀번호가 성공적으로 변경되었습니다. 이제 포털 서비스를 이용하실 수 있습니다.', code: 'SUCCESS' });
        });
      });
    } catch (e) {
      sendJson(res, { status: 500, ok: false, message: '비밀번호 검증 오류', code: 'HASH_ERROR' });
    }
  });
});

// Add activity generation route
router.post('/add-activity', (req, res) => {
  if (!req.session.user) {
    return sendJson(res, { status: 401, ok: false, message: '로그인이 필요합니다.', code: 'UNAUTHORIZED' });
  }

  const { signupCode } = req.body;
  if (!signupCode) {
    return sendJson(res, { status: 400, ok: false, message: '등록 코드를 입력해 주세요.', code: 'BAD_REQUEST' });
  }

  const trimmedCode = signupCode.trim();

  // Verify signup code
  db.get(`SELECT * FROM signup_codes WHERE code = ?`, [trimmedCode], (codeErr, codeRow) => {
    if (codeErr) {
      console.error('[Add Activity Error] DB query error on signup_codes:', codeErr.message);
      return sendJson(res, { status: 500, ok: false, message: '데이터베이스 조회 실패', code: 'DB_ERROR' });
    }

    if (!codeRow) {
      return sendJson(res, { status: 400, ok: false, message: '유효하지 않은 등록 코드입니다.', code: 'INVALID_SIGNUP_CODE' });
    }

    const targetGeneration = codeRow.generation;
    const userId = req.session.user.id;

    // Check if user already has this activity
    db.get(`SELECT * FROM user_activities WHERE user_id = ? AND activity = ?`, [userId, targetGeneration], (actErr, actRow) => {
      if (actErr) {
        console.error('[Add Activity Error] DB query error on user_activities:', actErr.message);
        return sendJson(res, { status: 500, ok: false, message: '데이터베이스 조회 실패', code: 'DB_ERROR' });
      }

      if (actRow) {
        return sendJson(res, { status: 409, ok: false, message: `이미 '${targetGeneration}' 기수로 등록되어 있습니다.`, code: 'ALREADY_EXISTS' });
      }

      // Insert new activity
      db.run(`INSERT INTO user_activities (user_id, activity) VALUES (?, ?)`, [userId, targetGeneration], (insertErr) => {
        if (insertErr) {
          console.error('[Add Activity Error] Failed to insert activity:', insertErr.message);
          return sendJson(res, { status: 500, ok: false, message: '활동 등록 실패', code: 'DB_ERROR' });
        }

        // Update session
        if (!req.session.user.activities) {
          req.session.user.activities = [];
        }
        if (!req.session.user.activities.includes(targetGeneration)) {
          req.session.user.activities.push(targetGeneration);
        }
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[Add Activity Error] Session save failed:', saveErr.message);
            return sendJson(res, { status: 500, ok: false, message: '세션 업데이트 실패', code: 'SESSION_SAVE_ERROR' });
          }

          return sendJson(res, {
            status: 200,
            ok: true,
            message: `'${targetGeneration}' 기수가 성공적으로 추가되었습니다.`,
            data: { activities: req.session.user.activities },
            code: 'SUCCESS'
          });
        });
      });
    });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {  
      return sendJson(res, {
        status: 500, ok: false, action: 'auth', resource: 'session',
        message: 'Logout failed', code: 'LOGOUT_FAILED'
      });
    }
    sendJson(res, {
      status: 200, ok: true, action: 'auth', resource: 'session',
      message: 'Logout successful', code: 'LOGOUT_SUCCESS'
    });
  });
});

module.exports = router;
