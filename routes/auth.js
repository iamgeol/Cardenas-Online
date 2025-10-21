// routes/auth.js
const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'data.db');
const db = new sqlite3.Database(dbPath);
const { validarTelefono, distanciaKm, generarToken } = require('../helpers');

// config base desde env
const BASE_LAT = parseFloat(process.env.BASE_LAT || '23.1140');
const BASE_LON = parseFloat(process.env.BASE_LON || '-82.3640');
const RADIO_KM = parseFloat(process.env.RADIO_KM || '10');

// Registro
router.post('/registro', (req, res) => {
  const { nombre, pin, telefono, domicilio, latitud, longitud } = req.body;
  if (!nombre || !pin || !telefono || !domicilio) return res.status(400).json({ error: 'Faltan campos' });
  if (!validarTelefono(telefono)) return res.status(400).json({ error: 'Teléfono inválido' });

  const dentro = (latitud && longitud) ? (distanciaKm(BASE_LAT, BASE_LON, latitud, longitud) <= RADIO_KM ? 1 : 0) : 0;

  const stmt = db.prepare(`INSERT INTO usuarios (nombre, pin, telefono, domicilio, latitud, longitud, rango_valido) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  stmt.run([nombre, pin, telefono, domicilio, latitud || null, longitud || null, dentro], function(err) {
    if (err) return res.status(400).json({ error: 'Nombre ya existe o error' });
    const usuario_id = this.lastID;
    const token = generarToken();
    db.run(`INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)`, [token, usuario_id]);
    res.json({ ok: true, usuario_id, token, rango_valido: dentro });
  });
});

// Login
router.post('/login', (req, res) => {
  const { nombre, pin } = req.body;
  if (!nombre || !pin) return res.status(400).json({ error: 'Faltan campos' });

  db.get(`SELECT * FROM usuarios WHERE nombre = ? AND pin = ?`, [nombre, pin], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Credenciales incorrectas' });
    if (row.estado === 'suspendido') return res.status(403).json({ error: 'Cuenta suspendida' });

    const token = generarToken();
    db.run(`INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)`, [token, row.id], (e) => {
      if (e) return res.status(500).json({ error: 'No se pudo crear sesión' });
      res.json({ ok: true, usuario: {
        id: row.id, nombre: row.nombre, telefono: row.telefono,
        domicilio: row.domicilio, latitud: row.latitud, longitud: row.longitud,
        bono: row.bono, rango_valido: row.rango_valido
      }, token });
    });
  });
});

// Obtener perfil
router.get('/perfil', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  db.get(`SELECT u.* FROM usuarios u JOIN sesiones s ON s.usuario_id = u.id WHERE s.token = ?`, [token], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Sesión inválida' });
    res.json({ usuario: row });
  });
});

// Actualizar domicilio/telefono/coords
router.put('/perfil', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const { domicilio, telefono, latitud, longitud } = req.body;
  if (telefono && !validarTelefono(telefono)) return res.status(400).json({ error: 'Teléfono inválido' });

  db.get(`SELECT usuario_id FROM sesiones WHERE token = ?`, [token], (err, s) => {
    if (err || !s) return res.status(401).json({ error: 'Sesión inválida' });
    const usuario_id = s.usuario_id;
    const dentro = (latitud && longitud) ? (distanciaKm(BASE_LAT, BASE_LON, latitud, longitud) <= RADIO_KM ? 1 : 0) : null;
    const updates = [];
    const params = [];
    if (domicilio !== undefined) { updates.push('domicilio = ?'); params.push(domicilio); }
    if (telefono !== undefined) { updates.push('telefono = ?'); params.push(telefono); }
    if (latitud !== undefined) { updates.push('latitud = ?'); params.push(latitud); }
    if (longitud !== undefined) { updates.push('longitud = ?'); params.push(longitud); }
    if (dentro !== null) { updates.push('rango_valido = ?'); params.push(dentro); }

    if (updates.length === 0) return res.json({ ok: true, mensaje: 'Nada que actualizar' });

    params.push(usuario_id);
    const sql = `UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`;
    db.run(sql, params, function(err2) {
      if (err2) return res.status(500).json({ error: 'No se pudo actualizar perfil' });
      res.json({ ok: true, mensaje: 'Perfil actualizado', rango_valido: dentro });
    });
  });
});

module.exports = router;
