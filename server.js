const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const initSqlJs = require('sql.js');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@manusethnicwear.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'store.sqlite');
fs.mkdirSync(DB_DIR, { recursive: true });

let db;

function persistDb() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function rows(stmt) {
  const result = [];
  while (stmt.step()) result.push(stmt.getAsObject());
  stmt.free();
  return result;
}

async function initDb() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  if (fs.existsSync(DB_FILE)) db = new SQL.Database(fs.readFileSync(DB_FILE));
  else db = new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      image TEXT NOT NULL,
      description TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      qty INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enquiries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const adminStmt = db.prepare('SELECT id FROM admins WHERE email = ?');
  adminStmt.bind([ADMIN_EMAIL]);
  const existingAdmin = rows(adminStmt);
  if (existingAdmin.length === 0) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const s = db.prepare('INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)');
    s.run([ADMIN_EMAIL, hash, new Date().toISOString()]);
    s.free();
  }

  const count = rows(db.prepare('SELECT COUNT(*) AS count FROM products'))[0].count;
  if (count === 0) {
    const products = [
      ['Royal Blue Kurta Set',79.99,'Men','blue-kurta.svg','Classic festive kurta set'],
      ['Emerald Anarkali',99.99,'Women','emerald-anarkali.svg','Elegant flowing Anarkali'],
      ['Maroon Silk Saree',119.99,'Women','maroon-saree.svg','Rich silk saree for special occasions'],
      ['Ivory Nehru Jacket Set',89.99,'Men','ivory-jacket.svg','Modern ivory Nehru jacket set'],
      ['Rose Festive Lehenga',139.99,'Women','rose-lehenga.svg','Statement festive lehenga'],
      ['Kids Festive Kurta',49.99,'Kids','kids-kurta.svg','Comfortable kids festive kurta']
    ];
    const insert = db.prepare('INSERT INTO products (name, price, category, image, description, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
    for (const p of products) insert.run([...p, new Date().toISOString()]);
    insert.free();
  }
  persistDb();
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function issueToken(admin) {
  return jwt.sign({ id: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: '8h' });
}
function requireAdmin(req, res, next) {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

app.get('/api/health', (req, res) => res.json({ ok: true, message: "Manu's Ethnic Wear backend is running", database: 'SQLite' }));

app.get('/api/products', (req, res) => {
  res.json(rows(db.prepare('SELECT id, name, price, category, image, description FROM products WHERE active = 1 ORDER BY id DESC')));
});

app.post('/api/orders', (req, res) => {
  try {
    const { customer, items } = req.body;
    if (!customer?.customerName || !customer?.phone || !customer?.address) return res.status(400).json({ error: 'Name, phone and address are required.' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one product is required.' });

    let total = 0;
    const verified = [];
    for (const item of items) {
      const stmt = db.prepare('SELECT id, name, price FROM products WHERE id = ? AND active = 1');
      stmt.bind([Number(item.id)]);
      const product = rows(stmt)[0];
      const qty = Math.max(1, parseInt(item.qty, 10) || 1);
      if (!product) return res.status(400).json({ error: 'One of the selected products is unavailable.' });
      verified.push({ ...product, qty });
      total += Number(product.price) * qty;
    }

    const orderId = 'MEW-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const now = new Date().toISOString();
    const o = db.prepare('INSERT INTO orders (id, customer_name, phone, address, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    o.run([orderId, String(customer.customerName).trim(), String(customer.phone).trim(), String(customer.address).trim(), Number(total.toFixed(2)), 'new', now]);
    o.free();

    const i = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES (?, ?, ?, ?, ?)');
    for (const item of verified) i.run([orderId, item.id, item.name, item.price, item.qty]);
    i.free();
    persistDb();
    res.status(201).json({ success: true, order: { id: orderId, total: Number(total.toFixed(2)) } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save order.' });
  }
});

app.post('/api/contact', (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'All fields are required.' });
    const id = crypto.randomBytes(5).toString('hex');
    const stmt = db.prepare('INSERT INTO enquiries (id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run([id, String(name).trim(), String(email).trim(), String(message).trim(), new Date().toISOString()]);
    stmt.free();
    persistDb();
    res.status(201).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not save enquiry.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  const stmt = db.prepare('SELECT id, email, password_hash FROM admins WHERE email = ?');
  stmt.bind([String(email || '').trim().toLowerCase()]);
  const admin = rows(stmt)[0];
  if (!admin || !(await bcrypt.compare(String(password || ''), admin.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
  res.cookie('admin_token', issueToken(admin), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ success: true, admin: { email: admin.email } });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('admin_token'); res.json({ success: true }); });
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: req.admin }));
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const orderCount = rows(db.prepare('SELECT COUNT(*) AS c FROM orders'))[0].c;
  const revenue = rows(db.prepare("SELECT COALESCE(SUM(total),0) AS r FROM orders WHERE status != 'cancelled'"))[0].r;
  const productCount = rows(db.prepare('SELECT COUNT(*) AS c FROM products WHERE active = 1'))[0].c;
  const enquiryCount = rows(db.prepare('SELECT COUNT(*) AS c FROM enquiries'))[0].c;
  res.json({ orderCount, revenue, productCount, enquiryCount });
});
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = rows(db.prepare('SELECT * FROM orders ORDER BY created_at DESC'));
  for (const order of orders) {
    const s = db.prepare('SELECT product_name, price, qty FROM order_items WHERE order_id = ?');
    s.bind([order.id]);
    order.items = rows(s);
  }
  res.json(orders);
});
app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const allowed = ['new','confirmed','packed','shipped','completed','cancelled'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
  const stmt = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
  stmt.run([req.body.status, req.params.id]);
  stmt.free();
  persistDb();
  res.json({ success: true });
});
app.get('/api/admin/products', requireAdmin, (req, res) => res.json(rows(db.prepare('SELECT * FROM products ORDER BY id DESC'))));
app.post('/api/admin/products', requireAdmin, (req, res) => {
  const { name, price, category, image, description } = req.body;
  if (!name || !price || !category || !image) return res.status(400).json({ error: 'Name, price, category and image are required.' });
  const stmt = db.prepare('INSERT INTO products (name, price, category, image, description, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
  stmt.run([String(name).trim(), Number(price), String(category).trim(), String(image).trim(), String(description || '').trim(), new Date().toISOString()]);
  stmt.free();
  persistDb();
  res.status(201).json({ success: true });
});
app.patch('/api/admin/products/:id/toggle', requireAdmin, (req, res) => {
  const stmt = db.prepare('UPDATE products SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?');
  stmt.run([Number(req.params.id)]);
  stmt.free();
  persistDb();
  res.json({ success: true });
});
app.get('/api/admin/enquiries', requireAdmin, (req, res) => res.json(rows(db.prepare('SELECT * FROM enquiries ORDER BY created_at DESC'))));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Store running on port ${PORT}`));
}).catch(err => {
  console.error('Database startup failed:', err);
  process.exit(1);
});