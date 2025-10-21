// routes/cart.js
const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'data.db');
const db = new sqlite3.Database(dbPath);

// helper para obtener usuario por token
function usuarioIdPorToken(token) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT usuario_id FROM sesiones WHERE token = ?`, [token], (err, row) => {
      if (err || !row) return resolve(null);
      resolve(row.usuario_id);
    });
  });
}

// Límite máximo de unidades por carrito
const MAX_UNIDADES = 5;

// Agregar producto al carrito
router.post('/agregar', async (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const usuario_id = await usuarioIdPorToken(token);
  if (!usuario_id) return res.status(401).json({ error: 'Sesión inválida' });

  const { producto_id, cantidad } = req.body;
  if (!producto_id || !cantidad || cantidad <= 0) return res.status(400).json({ error: 'Campos inválidos' });

  // validar total en carrito
  db.get(`SELECT COALESCE(SUM(cantidad),0) as total FROM carritos WHERE usuario_id = ?`, [usuario_id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error' });
    const total = row.total || 0;
    if (total + cantidad > MAX_UNIDADES) return res.status(400).json({ error: `Solo se permiten ${MAX_UNIDADES} unidades en el carrito` });

    // verificar inventario del producto
    db.get(`SELECT unidades, activo FROM productos WHERE id = ?`, [producto_id], (err2, p) => {
      if (err2 || !p) return res.status(404).json({ error: 'Producto no encontrado' });
      if (!p.activo) return res.status(400).json({ error: 'Producto no disponible' });
      if (p.unidades < cantidad) return res.status(400).json({ error: 'No hay suficientes unidades en inventario' });

      // insertar con expiración a +24 horas
      db.run(`INSERT INTO carritos (usuario_id, producto_id, cantidad, expira_en) VALUES (?, ?, ?, datetime('now', '+24 hours'))`, [usuario_id, producto_id, cantidad], function(e) {
        if (e) return res.status(500).json({ error: 'No se pudo agregar al carrito' });
        res.json({ ok: true, mensaje: 'Producto agregado al carrito' });
      });
    });
  });
});

// Obtener carrito del usuario
router.get('/', async (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const usuario_id = await usuarioIdPorToken(token);
  if (!usuario_id) return res.status(401).json({ error: 'Sesión inválida' });

  db.all(`SELECT c.id as carrito_id, c.producto_id, c.cantidad, c.agregado_en, p.nombre, p.precio, p.descuento FROM carritos c JOIN productos p ON p.id = c.producto_id WHERE c.usuario_id = ?`, [usuario_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error al leer carrito' });
    const carrito = rows.map(r => {
      const precio_unit = parseFloat((r.precio * (1 - (r.descuento || 0) / 100)).toFixed(2));
      return {...r, precio_unit};
    });
    res.json(carrito);
  });
});

// Eliminar item del carrito
router.delete('/:carrito_id', (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const carrito_id = req.params.carrito_id;
  db.get(`SELECT usuario_id FROM sesiones WHERE token = ?`, [token], (err, s) => {
    if (err || !s) return res.status(401).json({ error: 'Sesión inválida' });
    db.run(`DELETE FROM carritos WHERE id = ? AND usuario_id = ?`, [carrito_id, s.usuario_id], function(e) {
      if (e) return res.status(500).json({ error: 'No se pudo eliminar' });
      res.json({ ok: true, eliminado: this.changes });
    });
  });
});

// Limpieza de carritos expirados (puede ser llamada por cron o admin)
router.get('/limpiar-expirados', (req, res) => {
  db.run(`DELETE FROM carritos WHERE expira_en <= datetime('now')`, function(err) {
    if (err) return res.status(500).json({ error: 'Error al limpiar' });
    res.json({ ok: true, eliminados: this.changes });
  });
});

module.exports = router;
