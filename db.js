// db.js - inicializa la base de datos SQLite con tablas y datos de ejemplo
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DB_PATH = path.join(DATA_DIR, 'data.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // usuarios
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE,
    pin TEXT,
    telefono TEXT,
    domicilio TEXT,
    latitud REAL,
    longitud REAL,
    rango_valido INTEGER DEFAULT 0,
    bono REAL DEFAULT 0,
    estado TEXT DEFAULT 'activo',
    suspendido_hasta TEXT,
    fecha_registro TEXT DEFAULT (datetime('now'))
  )`);

  // sesiones (token)
  db.run(`CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER,
    creado_en TEXT DEFAULT (datetime('now'))
  )`);

  // productos
  db.run(`CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    descripcion TEXT,
    precio REAL,
    unidades INTEGER,
    descuento REAL DEFAULT 0, -- porcentaje (0..100)
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now'))
  )`);

  // carritos (temporal)
  db.run(`CREATE TABLE IF NOT EXISTS carritos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    agregado_en TEXT DEFAULT (datetime('now')),
    expira_en TEXT
  )`);

  // ventas / orders
  db.run(`CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    total REAL,
    fecha TEXT DEFAULT (datetime('now'))
  )`);

  // detalle de venta
  db.run(`CREATE TABLE IF NOT EXISTS venta_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    precio_unit REAL
  )`);

  // avisos
  db.run(`CREATE TABLE IF NOT EXISTS avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    mensaje TEXT,
    tipo TEXT,
    fecha TEXT DEFAULT (datetime('now')),
    activo INTEGER DEFAULT 1,
    leido INTEGER DEFAULT 0
  )`);

  // config (ventas suspendidas)
  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // descuentos globales por producto histórico
  db.run(`CREATE TABLE IF NOT EXISTS descuentos_productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    porcentaje REAL,
    inicio TEXT,
    fin TEXT
  )`);

  // registrar config default si no existe
  db.get(`SELECT value FROM config WHERE key='ventas_suspendidas'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO config (key, value) VALUES ('ventas_suspendidas', '0')`);
    }
  });

  // 🧩 Crear usuario administrador automáticamente
  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PIN = process.env.ADMIN_PIN;

  if (ADMIN_USER && ADMIN_PIN) {
    db.get(`SELECT * FROM usuarios WHERE nombre = ?`, [ADMIN_USER], (err, row) => {
      if (!row) {
        db.run(
          `INSERT INTO usuarios (nombre, pin, telefono, domicilio, rango_valido, bono, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ADMIN_USER, ADMIN_PIN, '0000000000', 'Oficina central', 1, 0, 'activo'],
          (err2) => {
            if (err2) console.error("❌ Error creando admin:", err2);
            else console.log(`✅ Usuario administrador creado: ${ADMIN_USER}`);
          }
        );
      } else {
        console.log(`ℹ️ Usuario administrador ya existe: ${ADMIN_USER}`);
      }
    });
  } else {
    console.log("⚠️ Variables ADMIN_USER y ADMIN_PIN no configuradas (Render).");
  }

  console.log('Tablas creadas o verificadas en', DB_PATH);
});

db.close();