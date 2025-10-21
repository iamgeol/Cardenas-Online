// db.js - Inicializa la base de datos SQLite para Cárdenas Online
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Detectar si estamos en producción (Render) o local
const IS_RENDER = process.env.NODE_ENV === 'production';

// En Render se usa /var/data, en local ./data
const DATA_DIR = IS_RENDER ? '/var/data' : path.join(__dirname, 'data');

// Crea la carpeta si no existe
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Rutas de base de datos y archivo seed
const DB_PATH = path.join(DATA_DIR, 'data.db');
const SEED_PATH = path.join(__dirname, 'data', 'seed.sql'); // 👈 ruta correcta según tu estructura

// Abrir o crear la base de datos
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Tablas principales
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

  db.run(`CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER,
    creado_en TEXT DEFAULT (datetime('now'))
  )`);

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

  db.run(`CREATE TABLE IF NOT EXISTS carritos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    agregado_en TEXT DEFAULT (datetime('now')),
    expira_en TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    total REAL,
    fecha TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS venta_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    precio_unit REAL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    mensaje TEXT,
    tipo TEXT,
    fecha TEXT DEFAULT (datetime('now')),
    activo INTEGER DEFAULT 1,
    leido INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS descuentos_productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    porcentaje REAL,
    inicio TEXT,
    fin TEXT
  )`);

  // Configuración inicial si no existe
  db.get(`SELECT value FROM config WHERE key='ventas_suspendidas'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO config (key, value) VALUES ('ventas_suspendidas', '0')`);
    }
  });

  // 🧩 Cargar el archivo seed.sql automáticamente si existe
  db.get(`SELECT COUNT(*) AS count FROM productos`, (err, row) => {
    if (err) {
      console.error("❌ Error verificando base de datos:", err);
      return;
    }

    const productosCount = row ? row.count : 0;

    if (productosCount === 0 && fs.existsSync(SEED_PATH)) {
      console.log("📦 Base de datos vacía, cargando datos desde seed.sql...");

      try {
        const seedSQL = fs.readFileSync(SEED_PATH, 'utf8');
        db.exec(seedSQL, (err2) => {
          if (err2) {
            console.error("❌ Error ejecutando seed.sql:", err2);
          } else {
            console.log("✅ Datos iniciales cargados correctamente desde seed.sql");
          }
        });
      } catch (e) {
        console.error("❌ Error leyendo seed.sql:", e);
      }
    } else {
      console.log("📦 Base de datos ya contiene productos o no existe seed.sql");
    }
  });

  console.log('✅ Tablas creadas o verificadas en', DB_PATH);
});

db.close();
