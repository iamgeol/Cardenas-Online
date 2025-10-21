const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(bodyParser.json());

// Configurar carpeta de datos
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'data.db');
const db = new sqlite3.Database(DB_PATH); // ⚠️ mantenemos la conexión abierta

// Inicialización de la base de datos
db.serialize(() => {
  // Crear tablas
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
    descuento REAL DEFAULT 0,
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

  // Config default
  db.get(`SELECT value FROM config WHERE key='ventas_suspendidas'`, (err, row) => {
    if (!row) db.run(`INSERT INTO config (key, value) VALUES ('ventas_suspendidas','0')`);
  });

  // Crear usuario admin si no existe
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
    console.log("⚠️ Variables ADMIN_USER y ADMIN_PIN no configuradas.");
  }
});

// Rutas del servidor (manteniendo todo como estaba)
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor Cárdenas Online operativo' });
});

app.post('/api/register', (req, res) => {
  const { nombre, pin, telefono, domicilio } = req.body;
  if (!nombre || !pin) return res.status(400).json({ error: 'Faltan campos requeridos' });

  db.run(
    `INSERT INTO usuarios (nombre, pin, telefono, domicilio) VALUES (?, ?, ?, ?)`,
    [nombre, pin, telefono || '', domicilio || ''],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Login con sesión única
app.post('/api/login', (req, res) => {
  const { nombre, pin } = req.body;
  if (!nombre || !pin) return res.status(400).json({ error: 'Debe ingresar nombre y pin' });

  db.get(`SELECT * FROM usuarios WHERE nombre = ? AND pin = ?`, [nombre, pin], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (user.estado !== 'activo') return res.status(403).json({ error: 'Cuenta suspendida o inactiva' });

    // Eliminar sesiones previas
    db.run(`DELETE FROM sesiones WHERE usuario_id = ?`, [user.id], (err2) => {
      if (err2) console.error('Error limpiando sesión previa:', err2);

      const token = uuidv4();
      db.run(`INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)`, [token, user.id], (err3) => {
        if (err3) return res.status(500).json({ error: 'No se pudo crear sesión' });

        res.json({
          success: true,
          token,
          usuario: { id: user.id, nombre: user.nombre, estado: user.estado },
        });
      });
    });
  });
});

app.post('/api/logout', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Falta token' });

  db.run(`DELETE FROM sesiones WHERE token = ?`, [token], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/session', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Falta token' });

  db.get(
    `SELECT u.id, u.nombre, u.estado FROM sesiones s JOIN usuarios u ON s.usuario_id = u.id WHERE s.token = ?`,
    [token],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
      res.json({ valid: true, user });
    }
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Cárdenas Online activo en puerto ${PORT}`);
});