require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", 'attendance.db');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token-change-me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@attendance.local').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (ADMIN_TOKEN === 'dev-admin-token-change-me') {
  console.warn('WARNING: ADMIN_TOKEN is still using the default development value. Set a strong token in your environment before deployment.');
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

app.disable('x-powered-by');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============= HELPER FUNCTIONS =============

// Check admin session from cookie
function isAdminSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').filter(Boolean).map((part) => {
      const [key, ...valueParts] = part.trim().split('=');
      return [key, valueParts.join('=')];
    }),
  );

  return cookies.adminAuth === 'logged-in';
}

// ============= MIDDLEWARE =============

const requireAdmin = (req, res, next) => {
  // Check if user has valid session cookie
  if (isAdminSession(req)) {
    console.log(`[Admin Auth] ✓ Valid session - allowing access to ${req.path}`);
    return next();
  }

  console.log(`[Admin Auth] ✗ No valid session for ${req.path}`);
  return res.status(403).json({ message: 'Admin authorization required. Please login first.' });
};

// ============= ROUTES =============

app.get('/', (req, res) => {
  res.redirect('/login/login.html');
});

// ============= PUBLIC ADMIN ROUTES (NO AUTH REQUIRED) =============

// Admin login - just check password
app.post('/api/admin/login', (req, res) => {
  const password = String(req.body.password || '').trim();

  if (!password) {
    return res.status(400).json({ message: 'Password is required.' });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: 'Invalid password.' });
  }

  // Password is correct - set session cookie
  res.cookie('adminAuth', 'logged-in', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 1000,
    path: '/',
  });

  return res.json({
    success: true,
    message: 'Admin login successful.',
    redirectUrl: '/dashboard.html',
  });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('adminAuth', { path: '/' });
  return res.json({ success: true, message: 'Logged out successfully.' });
})

// Dashboard requires session
app.get('/dashboard.html', (req, res, next) => {
  if (!isAdminSession(req)) {
    return res.redirect('/admin-login.html');
  }
  return next();
});

// ============= PROTECTED ADMIN ROUTES (WITH MIDDLEWARE ABOVE) =============

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function generateCode() {
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

function sendEmail(to, subject, text) {
  return new Promise((resolve, reject) => {
    const email = String(to || '').trim();
    const safeSubject = String(subject || '').trim().slice(0, 200);
    const safeText = String(text || '').trim().slice(0, 5000);

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return reject(new Error('Invalid recipient email address.'));
    }

    if (!process.env.BREVO_API_KEY) {
      return reject(new Error('BREVO_API_KEY is not configured.'));
    }

    if (!process.env.BREVO_SENDER_EMAIL) {
      return reject(new Error('BREVO_SENDER_EMAIL is not configured.'));
    }

    const requestData = JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || 'Attendance App',
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [
        {
          email: email,
        },
      ],
      subject: safeSubject,
      textContent: safeText,
    });

    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(requestData),
      },
    };

    console.log(`[Email] Attempting to send email to ${email}`);

    const request = https.request(options, (response) => {
      let responseData = '';

      response.on('data', (chunk) => {
        responseData += chunk;
      });

      response.on('end', () => {
        let parsedData = {};

        try {
          parsedData = responseData ? JSON.parse(responseData) : {};
        } catch {
          parsedData = { raw: responseData };
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          console.log('[Email] ✓ Brevo email sent successfully.');
          console.log('[Email] Message ID:', parsedData.messageId);

          return resolve(parsedData);
        }

        console.error('[Email] Brevo API error:', {
          statusCode: response.statusCode,
          response: parsedData,
        });

        const errorMessage =
          parsedData.message ||
          `Brevo API returned status ${response.statusCode}.`;

        return reject(new Error(errorMessage));
      });
    });

    request.on('error', (error) => {
      console.error('[Email] Brevo connection error:', error);
      reject(error);
    });

    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Brevo API connection timeout.'));
    });

    request.write(requestData);
    request.end();
  });
}

function toUserRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    code: row.unique_code,
    status: row.status,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

function toAttendanceRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    date: row.date,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    signInTime: row.sign_in_time,
    signOutTime: row.sign_out_time,
    status: row.status,
    note: row.note,
  };
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      unique_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      sign_in_time TEXT,
      sign_out_time TEXT,
      status TEXT NOT NULL DEFAULT 'present',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  const adminRow = await get('SELECT id FROM users WHERE email = ?', ['admin@attendance.local']);
  if (!adminRow) {
    const adminCode = 'ADMIN123';
    await run(
      `INSERT INTO users (full_name, email, unique_code, status, is_admin, approved_at)
       VALUES (?, ?, ?, 'approved', 1, CURRENT_TIMESTAMP)`,
      ['Admin User', 'admin@attendance.local', adminCode],
    );
    console.log('Default admin created. Email: admin@attendance.local | Code: ADMIN123');
  }
}

app.get('/api/users', async (req, res) => {
  try {
    const approvedOnly = String(req.query.approved || '').toLowerCase() === 'true';
    const rows = await all(
      approvedOnly
        ? 'SELECT * FROM users WHERE status = ? ORDER BY full_name ASC'
        : 'SELECT * FROM users ORDER BY full_name ASC',
      approvedOnly ? ['approved'] : [],
    );

    res.json(rows.map(toUserRow));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load users.' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim();

    if (!fullName || !email) {
      return res.status(400).json({ message: 'Full name and email are required.' });
    }

    const existingUser = await get(
      'SELECT * FROM users WHERE LOWER(full_name) = LOWER(?) OR LOWER(email) = LOWER(?)',
      [fullName, email],
    );

    if (existingUser) {
      return res.status(409).json({ message: 'This name or email already exists.' });
    }

    const uniqueCode = generateCode();
    await run(
      `INSERT INTO users (full_name, email, unique_code, status, is_admin, created_at)
       VALUES (?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)`,
      [fullName, email, uniqueCode],
    );

    return res.status(201).json({
      message: 'Registration submitted successfully. Please wait for Admin approval.'
    });

  } catch (error) {
    console.error(error);
    
    res.status(500).json({ message: 'Registration could not be completed.' });
  }
});

app.get('/api/pending-users', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM users WHERE status = ? ORDER BY created_at DESC', ['pending']);
    res.json(rows.map(toUserRow));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load pending users.' });
  }
});
// Token-based authentication only - no login/logout routes
// Use x-admin-token header or Authorization: Bearer <token>

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim();
    const code = String(req.body.code || '').trim() || generateCode();

    if (!fullName || !email) {
      return res.status(400).json({ message: 'Student name and email are required.' });
    }

    const existingUser = await get(
      'SELECT * FROM users WHERE LOWER(full_name) = LOWER(?) OR LOWER(email) = LOWER(?)',
      [fullName, email],
    );

    if (existingUser) {
      return res.status(409).json({ message: 'A user with this name or email already exists.' });
    }

    await run(
      `INSERT INTO users (full_name, email, unique_code, status, is_admin, approved_at, created_at)
       VALUES (?, ?, ?, 'approved', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [fullName, email, code],
    );

    return res.status(201).json({ message: 'Student added successfully.', code });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to add student.' });
  }
});

app.post('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    
    if (!userId) {
      return res.status(400).json({ 
        message: 'Invalid user id.' });
    }

    const user = await get(
      'SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) {
      return res.status(404).json({ 
        message: 'User not found.' 
      });
    }
    // Prevent approving an already approved student
    if (user.status === 'approved') {
      return res.status(400).json({
        message: 'This student has already been approved.'
      });
    }
   
    // Generate the access code ONLY when admin approves
    const uniqueCode = generateCode();

    // Update student status and save the new code
  await run(
      `UPDATE users
      SET status = ?,
        unique_code = ?
      WHERE id = ?`,
      ['approved', uniqueCode, userId],
    );

    console.log('Database updated successfully.');

    await sendEmail(
      user.email,
      'Your Attendance Account Has Been Approved',

      `Hello ${user.full_name},
        
      Your attendance account has been approved.
        
      Your access code is: ${uniqueCode}
        
      You can now use this code to sign in.
        
      Attendance Team`

    );
   
 
    console.log('Email sent successfully.');
   
    return res.json({ 
      message: 'User approved successfully.' 
    });
  
    } catch (error) {
    console.error('=================================');
    console.error('APPROVAL/EMAIL ERROR:');
    console.error(error);
    console.error('=================================');
    
    return res.status(500).json({ 
      message: 'Unable to approve user.',
      error: error.message
    });
  }
});

app.post('/api/attendance/signin', async (req, res) => {
  try {
    const fullName = String(req.body.fullName || req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const code = String(req.body.code || '').trim();

    if (!fullName && !email) {
      return res.status(400).json({ message: 'Name or email is required.' });
    }

    if (!code) {
      return res.status(400).json({ message: 'Code is required.' });
    }

    const user = await get(
      `SELECT * FROM users WHERE status = 'approved' AND (
        LOWER(full_name) = LOWER(?) OR LOWER(email) = LOWER(?)
      )`,
      [fullName, email || fullName],
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found or not approved yet.' });
    }

    if (user.unique_code !== code) {
      return res.status(401).json({ message: 'Incorrect access code.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const existing = await get('SELECT * FROM attendance_logs WHERE user_id = ? AND date = ?', [user.id, today]);

    if (existing) {
      return res.status(409).json({ message: 'This user has already signed in today.' });
    }

    await run(
      `INSERT INTO attendance_logs (user_id, date, sign_in_time, sign_out_time, status)
       VALUES (?, ?, ?, NULL, 'present')`,
      [user.id, today, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
    );

    res.json({
      message: 'Signed in successfully.',
      user: { id: user.id, fullName: user.full_name, email: user.email },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to sign in.' });
  }
});

app.post('/api/attendance/signout', async (req, res) => {
  try {
    const fullName = String(req.body.fullName || req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const code = String(req.body.code || '').trim();

    if (!fullName && !email) {
      return res.status(400).json({ message: 'Name or email is required.' });
    }

    if (!code) {
      return res.status(400).json({ message: 'Code is required.' });
    }

    const user = await get(
      `SELECT * FROM users WHERE status = 'approved' AND (
        LOWER(full_name) = LOWER(?) OR LOWER(email) = LOWER(?)
      )`,
      [fullName, email || fullName],
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found or not approved yet.' });
    }

    if (user.unique_code !== code) {
      return res.status(401).json({ message: 'Incorrect access code.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const existing = await get('SELECT * FROM attendance_logs WHERE user_id = ? AND date = ?', [user.id, today]);

    if (!existing) {
      return res.status(404).json({ message: 'This user has not signed in today.' });
    }

    if (existing.sign_out_time) {
      return res.status(409).json({ message: `This user already signed out at ${existing.sign_out_time}.` });
    }

    const signOutTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await run(
      'UPDATE attendance_logs SET sign_out_time = ?, status = ? WHERE id = ?',
      [signOutTime, 'present', existing.id],
    );

    res.json({ message: 'Signed out successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to sign out.' });
  }
});

app.get('/api/attendance', async (req, res) => {
  try {
    const selectedDate = req.query.date;
    const sql = selectedDate
      ? `SELECT a.*, u.full_name, u.email FROM attendance_logs a JOIN users u ON u.id = a.user_id WHERE a.date = ? ORDER BY a.date DESC, u.full_name ASC`
      : `SELECT a.*, u.full_name, u.email FROM attendance_logs a JOIN users u ON u.id = a.user_id ORDER BY a.date DESC, u.full_name ASC`;
    const params = selectedDate ? [selectedDate] : [];
    const rows = await all(sql, params);
    res.json(rows.map(toAttendanceRow));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load attendance records.' });
  }
});

app.post('/api/admin/mark-absent', requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.body.userId);
    const date = String(req.body.date || new Date().toISOString().slice(0, 10)).trim();
    const note = String(req.body.note || '').trim();

    if (!userId || !date) {
      return res.status(400).json({ message: 'User and date are required.' });
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const existing = await get('SELECT * FROM attendance_logs WHERE user_id = ? AND date = ?', [userId, date]);

    if (existing) {
      await run(
        'UPDATE attendance_logs SET status = ?, sign_in_time = ?, sign_out_time = ?, note = ? WHERE id = ?',
        ['absent', null, null, note || 'Marked absent by admin', existing.id],
      );
    } else {
      await run(
        `INSERT INTO attendance_logs (user_id, date, sign_in_time, sign_out_time, status, note)
         VALUES (?, ?, NULL, NULL, 'absent', ?)`,
        [userId, date, note || 'Marked absent by admin'],
      );
    }

    res.json({ message: 'Attendance marked absent successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to mark attendance absent.' });
  }
});

app.get('/api/attendance/export', async (req, res) => {
  try {
    const selectedDate = String(req.query.date || '').trim();
    const days = Number(req.query.days || 0);

    let query = `
      SELECT a.date, u.full_name, u.email, a.status, a.sign_in_time, a.sign_out_time, a.note
      FROM attendance_logs a
      JOIN users u ON u.id = a.user_id
    `;

    const params = [];

    if (selectedDate) {
      query += ' WHERE a.date = ?';
      params.push(selectedDate);
    } else if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const startDate = cutoff.toISOString().slice(0, 10);
      query += ' WHERE a.date >= ?';
      params.push(startDate);
    }

    query += ' ORDER BY a.date DESC, u.full_name ASC';

    const rows = await all(query, params);

    const csvHeader = ['Date', 'Full Name', 'Email', 'Status', 'Sign In Time', 'Sign Out Time', 'Reason'];
    const csvRows = [csvHeader.join(',')];

    rows.forEach((row) => {
      csvRows.push([
        row.date,
        `"${String(row.full_name || '').replace(/"/g, '""')}"`,
        `"${String(row.email || '').replace(/"/g, '""')}"`,
        row.status,
        row.sign_in_time || '',
        row.sign_out_time || '',
        `"${String(row.note || '').replace(/"/g, '""')}"`,
      ].join(','));
    });

    const exportName = selectedDate || (days > 0 ? `last-${days}-days` : 'attendance');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${exportName}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to export attendance.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Attendance backend is running.' });
});

app.post('/api/admin/reset', requireAdmin, async (req, res) => {
  try {
    const action = String(req.body.action || 'attendance').toLowerCase();

    if (action === 'attendance') {
      await run('DELETE FROM attendance_logs');
      return res.json({ message: 'All attendance records cleared.' });
    }

    if (action === 'all') {
      await run('DELETE FROM attendance_logs');
      await run('DELETE FROM users WHERE is_admin = 0');
      return res.json({ message: 'All attendance records and user registrations cleared. Admin user preserved.' });
    }

    res.status(400).json({ message: 'Invalid action. Use "attendance" or "all".' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to reset data.' });
  }
});

app.get('/admin-login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.use('/login', express.static(path.join(__dirname, 'login')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const safeRootFiles = [
  '/dashboard.css',
  '/dashboard.js',
  '/alert.css',
  '/Alert.html',
  '/attendance.jpg',
  '/admin-login.html',
];

safeRootFiles.forEach((filePath) => {
  app.get(filePath, (req, res) => {
    res.sendFile(path.join(__dirname, filePath.replace(/^\//, '')));
  });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'Route not found.' });
  }

  const safePath = req.path === '/' ? '/login/login.html' : req.path;
  const filePath = path.join(__dirname, safePath.replace(/^\//, ''));

  if (!filePath.startsWith(__dirname)) {
    return res.status(403).send('Forbidden');
  }

  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).send('Page not found.');
    }
  });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Attendance backend running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization error:', error);
    process.exit(1);
  });
