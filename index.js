// index.js - Servidor principal de Cárdenas Online
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(bodyParser.json());

// 📁 Configurar la base de datos
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DB_PATH = path.join(DATA_DIR, 'data.db');
const db = new sqlite3.Database(DB_PATH);

// Ruta de prueba
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor Cárdenas Online operativo' });
});

// 🧍 Registro de usuarios
app.post('/api/register', (req, res) => {
  const { nombre, pin, telefono, domicilio } = req.body;
  if (!nombre || !pin) return res.status(400).json({ error: 'Faltan campos requeridos' });

  db.run(
    `INSERT INTO usuarios (nombre, pin, telefono, domicilio) VALUES (?, ?, ?, ?)`,
    [nombre, pin, telefono || '', domicilio || ''],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'El nombre de usuario ya existe' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 🔐 Login con sesión única
app.post('/api/login', (req, res) => {
  const { nombre, pin } = req.body;
  if (!nombre || !pin) return res.status(400).json({ error: 'Debe ingresar nombre y pin' });

  db.get(`SELECT * FROM usuarios WHERE nombre = ? AND pin = ?`, [nombre, pin], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    if (user.estado !== 'activo') {
      return res.status(403).json({ error: 'Cuenta suspendida o inactiva' });
    }

    // 💡 Eliminar cualquier sesión anterior activa del mismo usuario
    db.run(`DELETE FROM sesiones WHERE usuario_id = ?`, [user.id], (err2) => {
      if (err2) console.error('Error al limpiar sesión previa:', err2);

      const token = uuidv4();
      db.run(
        `INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)`,
        [token, user.id],
        (err3) => {
          if (err3) return res.status(500).json({ error: 'No se pudo crear sesión' });

          res.json({
            success: true,
            token,
            usuario: {
              id: user.id,
              nombre: user.nombre,
              estado: user.estado,
            },
          });
        }
      );
    });
  });
});

// 🚪 Cerrar sesión
app.post('/api/logout', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Falta token' });

  db.run(`DELETE FROM sesiones WHERE token = ?`, [token], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 🧾 Verificar sesión
app.post('/api/session', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Falta token' });

  db.get(
    `SELECT u.id, u.nombre, u.estado
     FROM sesiones s
     JOIN usuarios u ON s.usuario_id = u.id
     WHERE s.token = ?`,
    [token],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
      res.json({ valid: true, user });
    }
  );
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Cárdenas Online activo en puerto ${PORT}`);
});