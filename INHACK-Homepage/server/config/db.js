const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { marked, Lexer } = require('marked');
if (Lexer && Lexer.rules && Lexer.rules.block) {
    if (Lexer.rules.block.normal) Lexer.rules.block.normal.code = /$^/;
    if (Lexer.rules.block.gfm) Lexer.rules.block.gfm.code = /$^/;
}
const env = require('./env');

const dbPath = path.join(__dirname, '../../users.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Create users table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        name TEXT
    )`);
    
    // Add password_changed column for tracking initial login states (E2E Migration)
    db.run(`ALTER TABLE users ADD COLUMN password_changed INTEGER DEFAULT 0`, [], (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('[Database Migration] Failed to add password_changed column:', err.message);
        }
    });

    // Add is_blocked column for blocking users (Admin Panel Upgrade)
    db.run(`ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0`, [], (err) => {
        if (err && !err.message.includes('duplicate column name') && !err.message.includes('already exists')) {
            console.error('[Database Migration] Failed to add is_blocked column:', err.message);
        }
    });

    // Add is_admin column for user roles (Admin User Management)
    db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, [], (err) => {
        if (err && !err.message.includes('duplicate column name') && !err.message.includes('already exists')) {
            console.error('[Database Migration] Failed to add is_admin column:', err.message);
        }
    });

    // Add created_as_admin column for enforcing initial admin password changes
    db.run(`ALTER TABLE users ADD COLUMN created_as_admin INTEGER DEFAULT 0`, [], (err) => {
        if (err && !err.message.includes('duplicate column name') && !err.message.includes('already exists')) {
            console.error('[Database Migration] Failed to add created_as_admin column:', err.message);
        }
    });
    
    // Create dreamhack access tracking log table
    db.run(`CREATE TABLE IF NOT EXISTS dreamhack_access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        ip_address TEXT,
        timestamp TEXT
    )`);

    // Create dreamhack challenge solve logs table
    db.run(`CREATE TABLE IF NOT EXISTS dreamhack_solves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        challenge_id TEXT,
        challenge_name TEXT,
        timestamp TEXT
    )`);

    // Create shared session table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS shared_session (
        id INTEGER PRIMARY KEY,
        sessionid TEXT,
        csrftoken TEXT,
        updated_at TEXT
    )`);

    // Create dreamhack logout interception logs table
    db.run(`CREATE TABLE IF NOT EXISTS dreamhack_intercept_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        ip_address TEXT,
        timestamp TEXT
    )`);

    // Create admin encrypted credentials table for E2E security
    db.run(`CREATE TABLE IF NOT EXISTS admin_credentials (
        id INTEGER PRIMARY KEY,
        email TEXT,
        encrypted_password TEXT,
        iv TEXT,
        updated_at TEXT
    )`);

    // Create site contents table for dynamic content editing (with content_md)
    db.run(`CREATE TABLE IF NOT EXISTS site_contents (
        section_id TEXT PRIMARY KEY,
        content_md TEXT,
        content_html TEXT,
        updated_at TEXT
    )`);

    // Create signup codes table
    db.run(`CREATE TABLE IF NOT EXISTS signup_codes (
        code TEXT PRIMARY KEY,
        generation TEXT NOT NULL,
        created_at TEXT
    )`);

    // Create user activities table for tracking multiple generations per user
    db.run(`CREATE TABLE IF NOT EXISTS user_activities (
        user_id INTEGER,
        activity TEXT,
        PRIMARY KEY (user_id, activity),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`);

    // Seed default signup codes
    const nowIso = new Date().toISOString();
    db.run(`INSERT OR IGNORE INTO signup_codes (code, generation, created_at) VALUES ('INHACK_2026_1', '2026-1 활동', ?)`, [nowIso]);
    db.run(`INSERT OR IGNORE INTO signup_codes (code, generation, created_at) VALUES ('INHACK_2026_2', '2026-2 활동', ?)`, [nowIso]);

    // Perform database migration to add content_md to site_contents if it doesn't exist
    db.run(`ALTER TABLE site_contents ADD COLUMN content_md TEXT`, [], (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('[Database Migration] Failed to add content_md column:', err.message);
        }
    });

    // Seed default developer account dynamically from environment variables
    const adminUser = env.ADMIN_USERNAME;
    const adminPass = env.ADMIN_PASSWORD;
    
    if (adminPass) {
        const hashedPassword = bcrypt.hashSync(adminPass, 10);
        db.run(`INSERT OR IGNORE INTO users (username, password, name, is_admin) 
                VALUES (?, ?, 'Developer', 1)`, [adminUser, hashedPassword], (err) => {
            if (err) {
                console.error('[Database Seed Error] Failed to seed admin user:', err.message);
            }
        });
        // Ensure the developer account has admin privileges in case it was already created
        db.run(`UPDATE users SET is_admin = 1 WHERE username = ?`, [adminUser], (err) => {
            if (err) {
                console.error('[Database Seed Error] Failed to set admin role for developer:', err.message);
            }
        });
    } else {
        console.warn('WARNING: ADMIN_PASSWORD environment variable is not set. Default admin seeding skipped.');
    }

    // Only seed test account if NOT in production
    if (env.NODE_ENV !== 'production') {
        db.run(`INSERT OR IGNORE INTO users (username, password, name) 
                VALUES ('123', '$2a$10$eTZ.B/MOrL.i7qceTaDnM.fLD627Xp/yFhTqQZaeFbgNGPBhWyXay', 'TestUser123')`);
    }

    // Seed and compile site contents from JSON files on server startup
    const { compileJsonToHtml } = require('../helpers/template');
    const sections = [
        'home',
        'curriculum',
        'curriculum/system',
        'curriculum/web',
        'curriculum/forensic',
        'curriculum/cryptography',
        'projects',
        'other-events',
        'past-events',
        'ctf',
        'navigation'
    ];
    
    sections.forEach(sec => {
        try {
            const jsonPath = path.join(__dirname, `../../src/html/fragments/${sec}.json`);
            const htmlPath = path.join(__dirname, `../../src/html/fragments/${sec}.html`);
            
            if (fs.existsSync(jsonPath)) {
                const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
                const jsonData = JSON.parse(jsonRaw);
                
                // Compile JSON to HTML using our template helper
                const contentHtml = compileJsonToHtml(sec, jsonData);
                
                // Write HTML to physical file
                fs.writeFileSync(htmlPath, contentHtml, 'utf8');
                
                // Update database: content_md stores the JSON stringified data
                const timestamp = new Date().toISOString();
                db.run(`INSERT OR REPLACE INTO site_contents (section_id, content_md, content_html, updated_at) VALUES (?, ?, ?, ?)`,
                    [sec, jsonRaw, contentHtml, timestamp]);
            } else {
                console.error(`[Startup Seed Error] JSON file not found for section ${sec}`);
            }
        } catch (e) {
            console.error(`[Startup Seed/Compile Error] Failed for section ${sec}:`, e.message);
        }
    });
});

module.exports = db;
