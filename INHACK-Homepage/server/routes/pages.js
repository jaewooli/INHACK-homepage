const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../config/db');
const env = require('../config/env');
const { sendJson } = require('../helpers/response');
const basePath = env.BASE_PATH || '/homepage';

const { compilePageHtml } = require('../helpers/template');
const fs = require('fs');

// / serves index.html (the SPA) directly
router.get('/', (req, res) => {
  try {
    const html = compilePageHtml(path.join(__dirname, '../../src/html/index.html'));
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('[Page routing] Error serving index.html:', err);
    res.status(500).send('<h1>500 Internal Server Error</h1>');
  }
});



// Helper to resolve current user's role
function getUserRole(req) {
  if (!req.session.user) return 'guest';
  return req.session.user.isAdmin ? 'admin' : 'member';
}

// Helper to filter menu items based on current role
function filterMenuItems(menuItems, role) {
  if (!Array.isArray(menuItems)) return [];
  return menuItems
    .filter(item => {
      const allowed = item.allowedRoles || ['guest', 'member', 'admin'];
      return allowed.includes(role);
    })
    .map(item => {
      const newItem = { ...item };
      if (newItem.submenus && Array.isArray(newItem.submenus)) {
        newItem.submenus = newItem.submenus.filter(sub => {
          const allowed = sub.allowedRoles || ['guest', 'member', 'admin'];
          return allowed.includes(role);
        });
      }
      return newItem;
    });
}

// Public Route: Fetch filtered navigation menu based on user session role
router.get('/navigation', (req, res) => {
  const role = getUserRole(req);
  
  db.get(`SELECT content_md FROM site_contents WHERE section_id = 'navigation'`, [], (err, row) => {
    if (err || !row) {
      const fallbackPath = path.join(__dirname, '../../src/html/fragments/navigation.json');
      fs.readFile(fallbackPath, 'utf8', (fsErr, data) => {
        if (fsErr) {
          return sendJson(res, { status: 500, ok: false, message: 'Failed to load navigation', code: 'SERVER_ERROR' });
        }
        try {
          const resolvedData = data.replace(/\{\{BASE_PATH\}\}/g, basePath);
          const menuItems = JSON.parse(resolvedData);
          const filtered = filterMenuItems(menuItems, role);
          return sendJson(res, { status: 200, ok: true, data: filtered, code: 'SUCCESS' });
        } catch (e) {
          return sendJson(res, { status: 500, ok: false, message: 'JSON parse error', code: 'JSON_ERROR' });
        }
      });
      return;
    }
    
    try {
      const resolvedContent = row.content_md.replace(/\{\{BASE_PATH\}\}/g, basePath);
      const menuItems = JSON.parse(resolvedContent);
      const filtered = filterMenuItems(menuItems, role);
      return sendJson(res, { status: 200, ok: true, data: filtered, code: 'SUCCESS' });
    } catch (e) {
      return sendJson(res, { status: 500, ok: false, message: 'JSON parse error', code: 'JSON_ERROR' });
    }
  });
});

// Dynamic Fragment Guard & Server Loader Middleware
router.get('/frags/:id*', (req, res, next) => {
  const originalUrl = req.params.id + (req.params[0] || ''); // e.g. 'admin.html', 'curriculum/week1.html'
  if (!originalUrl) return next();
  
  let fragmentID = originalUrl;
  if (fragmentID.endsWith('.html')) {
    fragmentID = fragmentID.substring(0, fragmentID.length - 5);
  }
  

  
  const role = getUserRole(req);
  
  db.get(`SELECT content_md FROM site_contents WHERE section_id = 'navigation'`, [], (err, row) => {
    let menuItems = [];
    if (!err && row && row.content_md) {
      try {
        menuItems = JSON.parse(row.content_md);
      } catch (e) {}
    }
    
    if (menuItems.length === 0) {
      try {
        const fallbackPath = path.join(__dirname, '../../src/html/fragments/navigation.json');
        const fallbackData = fs.readFileSync(fallbackPath, 'utf8');
        menuItems = JSON.parse(fallbackData);
      } catch (e) {}
    }
    
    let matchedItem = null;
    let requiredRoles = ['guest', 'member', 'admin'];
    const targetUrl = fragmentID.toLowerCase();
    
    for (const item of menuItems) {
      const itemUrl = (item.url || '').replace(/^#/, '').replace(/^\//, '').toLowerCase();
      if (itemUrl === targetUrl) {
        matchedItem = item;
        break;
      }
      
      if (item.submenus && Array.isArray(item.submenus)) {
        for (const sub of item.submenus) {
          const subUrl = (sub.url || '').replace(/^#/, '').replace(/^\//, '').toLowerCase();
          if (subUrl === targetUrl) {
            matchedItem = sub;
            break;
          }
        }
      }
      if (matchedItem) break;
    }
    
    if (!matchedItem && targetUrl.includes('/')) {
      const parentSegment = targetUrl.split('/')[0];
      for (const item of menuItems) {
        const itemUrl = (item.url || '').replace(/^#/, '').replace(/^\//, '').toLowerCase();
        if (itemUrl === parentSegment) {
          matchedItem = item;
          break;
        }
      }
    }
    
    if (matchedItem && matchedItem.allowedRoles) {
      requiredRoles = matchedItem.allowedRoles;
    }
    
    if (!requiredRoles.includes(role)) {
      return res.status(403).send('Forbidden');
    }
    
    const validSections = ['home', 'curriculum', 'other-events', 'past-events', 'ctf', 'navigation', 'projects', 'curriculum/system', 'curriculum/web', 'curriculum/forensic', 'curriculum/cryptography'];
    if (validSections.includes(fragmentID)) {
      db.get(`SELECT content_html FROM site_contents WHERE section_id = ?`, [fragmentID], (dbErr, contentRow) => {
        if (dbErr || !contentRow) {
          return next();
        }
        res.set('Content-Type', 'text/html');
        const resolvedHtml = contentRow.content_html.replace(/\{\{BASE_PATH\}\}/g, basePath);
        return res.send(resolvedHtml);
      });
    } else {
      const fragmentPath = path.join(__dirname, '../../src/html/fragments', originalUrl);
      if (fs.existsSync(fragmentPath)) {
        try {
          const fileContent = fs.readFileSync(fragmentPath, 'utf8');
          const resolvedContent = fileContent.replace(/\{\{BASE_PATH\}\}/g, basePath);
          if (originalUrl.endsWith('.json')) {
            res.set('Content-Type', 'application/json');
          } else {
            res.set('Content-Type', 'text/html');
          }
          return res.send(resolvedContent);
        } catch (readErr) {
          console.error('[Fragment Router] Failed to read static fragment:', readErr);
          return next();
        }
      }
      next();
    }
  });
});

// Serve Admin Page Directly with Session Guard
router.get('/admin', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.redirect(basePath + '/login');
  }
  try {
    const html = compilePageHtml(path.join(__dirname, '../../src/html/admin.html'));
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('[Page routing] Error serving admin.html:', err);
    res.status(500).send('<h1>500 Internal Server Error</h1>');
  }
});

// Serve actual pages directly under /:url
router.get('/:url', (req, res) => {
  let fileName = req.params.url || 'index';
  if (fileName.endsWith('.html')) {
    fileName = fileName.substring(0, fileName.length - 5);
  }
  
  // Guard: Redirect unauthenticated requests to Dreamhack to login page
  if (fileName === 'dreamhack' && !req.session.user) {
    return res.redirect(basePath + '/login');
  }

  // Guard: Redirect unauthenticated requests to My Page to login page
  if (fileName === 'mypage' && !req.session.user) {
    return res.redirect(basePath + '/login');
  }

  // Guard: Redirect authenticated requests on login/register pages to home
  if ((fileName === 'login' || fileName === 'register') && req.session.user) {
    return res.redirect(basePath + '/');
  }

  // Guard: Redirect unauthenticated/non-admin requests to Admin Panel to login page
  if (fileName === 'admin' && (!req.session.user || !req.session.user.isAdmin)) {
    return res.redirect(basePath + '/login');
  }

  const filePath = path.join(__dirname, `../../src/html/${fileName}.html`);
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('<h1>404 Not Found</h1><p>요청하신 페이지를 찾을 수 없습니다.</p>');
    }
    const html = compilePageHtml(filePath);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error(`[Page routing] Error serving ${fileName}.html:`, err);
    res.status(500).send('<h1>500 Internal Server Error</h1>');
  }
});

module.exports = router;
