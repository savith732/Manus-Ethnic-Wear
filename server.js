const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const initSqlJs = require('sql.js');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@manusethnicwear.com').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const DATABASE_URL = process.env.DATABASE_URL || '';

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'store.sqlite');

let sqliteDb = null;
let pgPool = null;
let usingPostgres = false;

function sqlitePlaceholders(sql) {
  return sql.replace(/\$\d+/g, '?');
}

function sqliteRows(stmt) {
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

async function dbQuery(sql, params = []) {
  if (usingPostgres) {
    const result = await pgPool.query(sql, params);
    return result.rows;
  }

  const stmt = sqliteDb.prepare(sqlitePlaceholders(sql));
  if (params.length) stmt.bind(params);
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('SELECT') || upper.includes(' RETURNING ')) {
    return sqliteRows(stmt);
  }
  stmt.step();
  stmt.free();
  return [];
}

async function dbExec(sql) {
  if (usingPostgres) {
    await pgPool.query(sql);
  } else {
    sqliteDb.run(sql);
  }
}

function persistSqlite() {
  if (!usingPostgres && sqliteDb) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, Buffer.from(sqliteDb.export()));
  }
}

async function initPostgres() {
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });

  await pgPool.query('SELECT 1');
  usingPostgres = true;

  await dbExec(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL,
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
      total DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL,
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
}

async function initSqlite() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  sqliteDb = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  usingPostgres = false;

  await dbExec(`
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
}

async function seedAndSyncAdmin() {
  const now = new Date().toISOString();
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admins = await dbQuery('SELECT id FROM admins WHERE email = $1', [ADMIN_EMAIL]);

  if (admins.length === 0) {
    await dbQuery(
      'INSERT INTO admins (email, password_hash, created_at) VALUES ($1, $2, $3)',
      [ADMIN_EMAIL, hash, now]
    );
  } else {
    await dbQuery(
      'UPDATE admins SET password_hash = $1 WHERE email = $2',
      [hash, ADMIN_EMAIL]
    );
  }

  const countRows = await dbQuery('SELECT COUNT(*) AS count FROM products');
  const count = Number(countRows[0]?.count || 0);

  if (count === 0) {
    const products = [
      ['Royal Blue Kurta Set', 79.99, 'Men', 'blue-kurta.svg', 'Classic festive kurta set'],
      ['Emerald Anarkali', 99.99, 'Women', 'emerald-anarkali.svg', 'Elegant flowing Anarkali'],
      ['Maroon Silk Saree', 119.99, 'Women', 'maroon-saree.svg', 'Rich silk saree for special occasions'],
      ['Ivory Nehru Jacket Set', 89.99, 'Men', 'ivory-jacket.svg', 'Modern ivory Nehru jacket set'],
      ['Rose Festive Lehenga', 139.99, 'Women', 'rose-lehenga.svg', 'Statement festive lehenga'],
      ['Kids Festive Kurta', 49.99, 'Kids', 'kids-kurta.svg', 'Comfortable kids festive kurta']
    ];

    for (const p of products) {
      await dbQuery(
        'INSERT INTO products (name, price, category, image, description, active, created_at) VALUES ($1, $2, $3, $4, $5, 1, $6)',
        [...p, now]
      );
    }
  }

  persistSqlite();
}

async function initDb() {
  if (DATABASE_URL) {
    try {
      await initPostgres();
      console.log('Connected to PostgreSQL');
    } catch (err) {
      console.error('PostgreSQL connection failed:', err.message);
      throw err;
    }
  } else {
    await initSqlite();
    console.log('Using local SQLite fallback');
  }

  await seedAndSyncAdmin();
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

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: "Manu's Ethnic Wear backend is running",
    database: usingPostgres ? 'PostgreSQL' : 'SQLite'
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await dbQuery(
      'SELECT id, name, price, category, image, description FROM products WHERE active = 1 ORDER BY id DESC'
    );
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items } = req.body;

    if (!customer?.customerName || !customer?.phone || !customer?.address) {
      return res.status(400).json({ error: 'Name, phone and address are required.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one product is required.' });
    }

    let total = 0;
    const verified = [];

    for (const item of items) {
      const products = await dbQuery(
        'SELECT id, name, price FROM products WHERE id = $1 AND active = 1',
        [Number(item.id)]
      );

      const product = products[0];
      const qty = Math.max(1, parseInt(item.qty, 10) || 1);

      if (!product) {
        return res.status(400).json({ error: 'One of the selected products is unavailable.' });
      }

      verified.push({ ...product, qty });
      total += Number(product.price) * qty;
    }

    const orderId = 'MEW-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const now = new Date().toISOString();

    await dbExec('BEGIN');

    try {
      await dbQuery(
        'INSERT INTO orders (id, customer_name, phone, address, total, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          orderId,
          String(customer.customerName).trim(),
          String(customer.phone).trim(),
          String(customer.address).trim(),
          Number(total.toFixed(2)),
          'new',
          now
        ]
      );

      for (const item of verified) {
        await dbQuery(
          'INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES ($1, $2, $3, $4, $5)',
          [orderId, item.id, item.name, item.price, item.qty]
        );
      }

      await dbExec('COMMIT');
      persistSqlite();
    } catch (err) {
      await dbExec('ROLLBACK');
      throw err;
    }

    res.status(201).json({
      success: true,
      order: { id: orderId, total: Number(total.toFixed(2)) }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save order.' });
  }
});

app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    await dbQuery(
      'INSERT INTO enquiries (id, name, email, message, created_at) VALUES ($1, $2, $3, $4, $5)',
      [
        crypto.randomBytes(5).toString('hex'),
        String(name).trim(),
        String(email).trim(),
        String(message).trim(),
        new Date().toISOString()
      ]
    );

    persistSqlite();
    res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save enquiry.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admins = await dbQuery(
      'SELECT id, email, password_hash FROM admins WHERE email = $1',
      [String(email || '').trim().toLowerCase()]
    );

    const admin = admins[0];

    if (!admin || !(await bcrypt.compare(String(password || ''), admin.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    res.cookie('admin_token', issueToken(admin), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    });

    res.json({ success: true, admin: { email: admin.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [orders, revenue, products, enquiries] = await Promise.all([
      dbQuery('SELECT COUNT(*) AS c FROM orders'),
      dbQuery("SELECT COALESCE(SUM(total),0) AS r FROM orders WHERE status != 'cancelled'"),
      dbQuery('SELECT COUNT(*) AS c FROM products WHERE active = 1'),
      dbQuery('SELECT COUNT(*) AS c FROM enquiries')
    ]);

    res.json({
      orderCount: Number(orders[0]?.c || 0),
      revenue: Number(revenue[0]?.r || 0),
      productCount: Number(products[0]?.c || 0),
      enquiryCount: Number(enquiries[0]?.c || 0)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await dbQuery('SELECT * FROM orders ORDER BY created_at DESC');

    for (const order of orders) {
      order.items = await dbQuery(
        'SELECT product_name, price, qty FROM order_items WHERE order_id = $1',
        [order.id]
      );
    }

    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const allowed = ['new', 'confirmed', 'packed', 'shipped', 'completed', 'cancelled'];

    if (!allowed.includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    await dbQuery(
      'UPDATE orders SET status = $1 WHERE id = $2',
      [req.body.status, req.params.id]
    );

    persistSqlite();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update order.' });
  }
});

app.get('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    res.json(await dbQuery('SELECT * FROM products ORDER BY id DESC'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const { name, price, category, image, description } = req.body;

    if (!name || !price || !category || !image) {
      return res.status(400).json({ error: 'Name, price, category and image are required.' });
    }

    await dbQuery(
      'INSERT INTO products (name, price, category, image, description, active, created_at) VALUES ($1, $2, $3, $4, $5, 1, $6)',
      [
        String(name).trim(),
        Number(price),
        String(category).trim(),
        String(image).trim(),
        String(description || '').trim(),
        new Date().toISOString()
      ]
    );

    persistSqlite();
    res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add product.' });
  }
});

app.patch('/api/admin/products/:id/toggle', requireAdmin, async (req, res) => {
  try {
    await dbQuery(
      'UPDATE products SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = $1',
      [Number(req.params.id)]
    );

    persistSqlite();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update product.' });
  }
});

app.get('/api/admin/enquiries', requireAdmin, async (req, res) => {
  try {
    res.json(await dbQuery('SELECT * FROM enquiries ORDER BY created_at DESC'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load enquiries.' });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found.' });
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Store running on port ${PORT}`);
      console.log(`Database: ${usingPostgres ? 'PostgreSQL' : 'SQLite'}`);
    });
  })
  .catch(err => {
    console.error('Database startup failed:', err);
    process.exit(1);
  });
