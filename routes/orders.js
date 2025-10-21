// routes/orders.js
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

// Helper: verificar ventas suspendidas
function ventasSuspendidas(cb) {
  db.get(`SELECT value FROM config WHERE key = 'ventas_suspendidas'`, (err, row) => {
    if (err) return cb(false);
    cb(row && row.value === '1');
  });
}

// Checkout: convertir carrito en venta
router.post('/checkout', async (req, res) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const usuario_id = await usuarioIdPorToken(token);
  if (!usuario_id) return res.status(401).json({ error: 'Sesión inválida' });

  // validar suspensión global
  ventasSuspendidas((suspendida) => {
    if (suspendida) return res.status(403).json({ error: 'Ventas suspendidas temporalmente' });

    // validar usuario rango_valido y estado
    db.get(`SELECT rango_valido, estado, bono FROM usuarios WHERE id = ?`, [usuario_id], (err, u) => {
      if (err || !u) return res.status(500).json({ error: 'Usuario no encontrado' });
      if (u.estado === 'suspendido') return res.status(403).json({ error: 'Cuenta suspendida' });
      if (u.rango_valido === 0) return res.status(400).json({ error: 'Ubicación fuera del rango de entrega' });

      // leer carrito
      db.all(`SELECT c.id as carrito_id, c.producto_id, c.cantidad, p.precio, p.descuento, p.unidades as stock FROM carritos c JOIN productos p ON p.id = c.producto_id WHERE c.usuario_id = ?`, [usuario_id], (err2, items) => {
        if (err2) return res.status(500).json({ error: 'Error al leer carrito' });
        if (!items || items.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

        // verificar stock
        for (const it of items) {
          if (it.cantidad > it.stock) return res.status(400).json({ error: `Sin stock suficiente para producto ${it.producto_id}` });
        }

        // calcular total (aplica descuentos de producto). luego aplicar bono usuario (si existe)
        let subtotal = 0;
        const itemsParaVenta = items.map(it => {
          const precio_unit = parseFloat((it.precio * (1 - (it.descuento || 0) / 100)).toFixed(2));
          subtotal += precio_unit * it.cantidad;
          return { producto_id: it.producto_id, cantidad: it.cantidad, precio_unit };
        });

        // aplicar bono del usuario (reducción directa)
        const bono = parseFloat(u.bono || 0);
        let total = subtotal;
        let bono_usado = 0;
        if (bono > 0) {
          bono_usado = Math.min(bono, total);
          total = parseFloat((total - bono_usado).toFixed(2));
        }

        // crear venta y items dentro de transacción (simple)
        db.run('BEGIN TRANSACTION');
        db.run(`INSERT INTO ventas (usuario_id, total) VALUES (?, ?)`, [usuario_id, total], function(err3) {
          if (err3) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'No se pudo crear venta' });
          }
          const venta_id = this.lastID;
          const insertItem = db.prepare(`INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit) VALUES (?, ?, ?, ?)`);
          const updateStock = db.prepare(`UPDATE productos SET unidades = unidades - ? WHERE id = ?`);

          for (const vi of itemsParaVenta) {
            insertItem.run([venta_id, vi.producto_id, vi.cantidad, vi.precio_unit]);
            updateStock.run([vi.cantidad, vi.producto_id]);
          }

          insertItem.finalize();
          updateStock.finalize();

          // actualizar bono del usuario restando lo usado
          if (bono_usado > 0) {
            db.run(`UPDATE usuarios SET bono = bono - ? WHERE id = ?`, [bono_usado, usuario_id]);
          }

          // vaciar carrito del usuario
          db.run(`DELETE FROM carritos WHERE usuario_id = ?`, [usuario_id]);

          // registrar ingreso (simplemente agregamos en ventas; para reports se sumará por fecha)
          db.run('COMMIT', (e) => {
            if (e) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Error al finalizar la compra' });
            }
            res.json({ ok: true, venta_id, total, subtotal, bono_usado });
          });
        });
      });
    });
  });
});

module.exports = router;
