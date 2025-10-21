// routes/admin.js
const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'data.db');
const db = new sqlite3.Database(dbPath);

// middleware admin simple
function esAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'No autorizado (admin)' });
  next();
}

router.use(esAdmin);

// Crear/editar producto
router.post('/producto', (req, res) => {
  const { id, nombre, descripcion, precio, unidades, descuento, activo } = req.body;
  if (!nombre || precio === undefined || unidades === undefined) return res.status(400).json({ error: 'Campos obligatorios: nombre, precio, unidades' });
  if (id) {
    db.run(`UPDATE productos SET nombre=?, descripcion=?, precio=?, unidades=?, descuento=?, activo=? WHERE id=?`, [nombre, descripcion || '', precio, unidades, descuento || 0, activo !== undefined ? activo : 1, id], function(err) {
      if (err) return res.status(500).json({ error: 'No se pudo actualizar producto' });
      res.json({ ok: true, actualizado: this.changes });
    });
  } else {
    db.run(`INSERT INTO productos (nombre, descripcion, precio, unidades, descuento, activo) VALUES (?, ?, ?, ?, ?, ?)`, [nombre, descripcion || '', precio, unidades, descuento || 0, activo !== undefined ? activo : 1], function(err) {
      if (err) return res.status(500).json({ error: 'No se pudo crear producto' });
      res.json({ ok: true, id: this.lastID });
    });
  }
});

// Eliminar producto (marcar inactivo)
router.post('/producto/desactivar', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  db.run(`UPDATE productos SET activo=0 WHERE id=?`, [id], function(err) {
    if (err) return res.status(500).json({ error: 'No se pudo desactivar' });
    res.json({ ok: true, cambiado: this.changes });
  });
});

// Añadir bono a usuario
router.post('/usuario/bono', (req, res) => {
  const { usuario_id, monto } = req.body;
  if (!usuario_id || monto === undefined) return res.status(400).json({ error: 'Campos faltantes' });
  db.run(`UPDATE usuarios SET bono = bono + ? WHERE id = ?`, [monto, usuario_id], function(err) {
    if (err) return res.status(500).json({ error: 'No se pudo aplicar bono' });
    res.json({ ok: true, cambiado: this.changes });
  });
});

// Suspender usuario
router.post('/usuario/suspender', (req, res) => {
  const { usuario_id, hasta } = req.body;
  if (!usuario_id) return res.status(400).json({ error: 'Falta usuario_id' });
  const suspendido_hasta = hasta || null;
  db.run(`UPDATE usuarios SET estado = 'suspendido', suspendido_hasta = ? WHERE id = ?`, [suspendido_hasta, usuario_id], function(err) {
    if (err) return res.status(500).json({ error: 'No se pudo suspender' });
    res.json({ ok: true });
  });
});

// Reactivar usuario
router.post('/usuario/reactivar', (req, res) => {
  const { usuario_id } = req.body;
  if (!usuario_id) return res.status(400).json({ error: 'Falta usuario_id' });
  db.run(`UPDATE usuarios SET estado = 'activo', suspendido_hasta = NULL WHERE id = ?`, [usuario_id], function(err) {
    if (err) return res.status(500).json({ error: 'No se pudo reactivar' });
    res.json({ ok: true });
  });
});

// Suspender/activar ventas global
router.post('/ventas/suspender', (req, res) => {
  const { suspender } = req.body;
  const val = suspender ? '1' : '0';
  db.run(`INSERT OR REPLACE INTO config (key, value) VALUES ('ventas_suspendidas', ?)`, [val], function(err) {
    if (err) return res.status(500).json({ error: 'No se pudo cambiar estado' });
    res.json({ ok: true });
  });
});

// Enviar aviso (global o por usuario)
router.post('/aviso', (req, res) => {
  const { usuario_id, mensaje, tipo } = req.body;
  if (!mensaje) return res.status(400).json({ error: 'Mensaje obligatorio' });
  db.run(`INSERT INTO avisos (usuario_id, mensaje, tipo, activo) VALUES (?, ?, ?, 1)`, [usuario_id || null, mensaje, tipo || 'info'], function(err) {
    if (err) return res.status(500).json({ error: 'No se pudo crear aviso' });
    res.json({ ok: true, id: this.lastID });
  });
});

// Estadísticas: ingresos por dia/mes, productos agotados, top ventas
router.get('/estadisticas', (req, res) => {
  const stats = {};

  // total hoy
  db.get(`SELECT COALESCE(SUM(total),0) as total_hoy FROM ventas WHERE date(fecha) = date('now')`, (err, r1) => {
    stats.total_hoy = r1 ? r1.total_hoy : 0;

    // total mes
    db.get(`SELECT COALESCE(SUM(total),0) as total_mes FROM ventas WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')`, (err2, r2) => {
      stats.total_mes = r2 ? r2.total_mes : 0;

      // usuarios activos (who made purchases this month)
      db.get(`SELECT COUNT(DISTINCT usuario_id) as usuarios_activos FROM ventas WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')`, (err3, r3) => {
        stats.usuarios_activos = r3 ? r3.usuarios_activos : 0;

        // productos bajos en stock
        db.all(`SELECT id, nombre, unidades FROM productos ORDER BY unidades ASC LIMIT 10`, (err4, bajos) => {
          stats.productos_bajos = bajos || [];

          // top ventas (por cantidad) - junta venta_items
          db.all(`SELECT vi.producto_id, p.nombre, SUM(vi.cantidad) as total_vendido FROM venta_items vi JOIN productos p ON p.id = vi.producto_id GROUP BY vi.producto_id ORDER BY total_vendido DESC LIMIT 10`, (err5, top) => {
            stats.top_ventas = top || [];
            res.json(stats);
          });
        });
      });
    });
  });
});

module.exports = router;
