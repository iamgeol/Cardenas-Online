// routes/products.js
const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'data.db');
const db = new sqlite3.Database(dbPath);

// Lista de productos activos con cálculo simple de precio con descuento
router.get('/', (req, res) => {
  db.all(`SELECT * FROM productos WHERE activo = 1`, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error al obtener productos' });
    // aplicar descuento por producto si existe (descuento campo porcentaje)
    const productos = rows.map(p => {
      const precio_final = parseFloat((p.precio * (1 - (p.descuento || 0) / 100)).toFixed(2));
      return {...p, precio_final};
    });
    res.json(productos);
  });
});

// obtener detalles
router.get('/:id', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM productos WHERE id = ?`, [id], (err, p) => {
    if (err || !p) return res.status(404).json({ error: 'Producto no encontrado' });
    p.precio_final = parseFloat((p.precio * (1 - (p.descuento || 0) / 100)).toFixed(2));
    res.json(p);
  });
});

module.exports = router;
