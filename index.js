// index.js - Servidor principal Cárdenas Online
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const { inicializarDB, DB_PATH } = require('./db');

const app = express();
app.use(bodyParser.json());

// Variables de entorno
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PIN = process.env.ADMIN_PIN;
const TIENDA_LAT = parseFloat(process.env.TIENDA_LAT || 0);
const TIENDA_LNG = parseFloat(process.env.TIENDA_LNG || 0);
const MAX_KM = parseFloat(process.env.MAX_KM || 10);

// Inicializamos la DB y luego insertamos admin si es necesario
inicializarDB((db) => {
  if (ADMIN_USER && ADMIN_PIN) {
    db.get(`SELECT * FROM usuarios WHERE nombre = ?`, [ADMIN_USER], (err, row) => {
      if (err) console.error('Error buscando admin:', err);
      else if (!row) {
        db.run(
          `INSERT INTO usuarios (nombre, pin, telefono, domicilio, rango_valido, bono, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ADMIN_USER, ADMIN_PIN, '0000000000', 'Oficina central', 1, 0, 'activo'],
          (err2) => {
            if (err2) console.error('❌ Error creando admin:', err2);
            else console.log(`✅ Usuario administrador creado: ${ADMIN_USER}`);
          }
        );
      } else console.log(`ℹ️ Usuario administrador ya existe: ${ADMIN_USER}`);
    });
  } else console.log("⚠️ Variables ADMIN_USER y ADMIN_PIN no configuradas.");

  // ----------------- Funciones auxiliares -----------------
  function dentroDelRango(latUser, lngUser, latTienda, lngTienda, maxKm) {
    const R = 6371;
    const dLat = (latTienda - latUser) * Math.PI / 180;
    const dLng = (lngTienda - lngUser) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(latUser * Math.PI / 180) *
        Math.cos(latTienda * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c <= maxKm;
  }

  function generarAviso(db, usuarioId, mensaje, tipo='info') {
    db.run(`INSERT INTO avisos (usuario_id, mensaje, tipo) VALUES (?, ?, ?)`, [usuarioId, mensaje, tipo]);
  }

  // ----------------- Checkout y funciones auxiliares -----------------
  function asignarBloqueEntrega(db, fechaDeseada, callback) {
    const bloqueHoras = 3;
    const maxPorBloque = 10;
    const bloqueInicio = new Date(fechaDeseada);
    bloqueInicio.setMinutes(0,0,0);

    function contarBloque(bloque, cb) {
      const bloqueFin = new Date(bloque);
      bloqueFin.setHours(bloque.getHours() + bloqueHoras);
      db.get(
        `SELECT COUNT(*) as count FROM ventas WHERE entrega >= ? AND entrega < ?`,
        [bloque.toISOString(), bloqueFin.toISOString()],
        (err, row) => {
          if (err) return cb(err);
          cb(null, row.count, bloque);
        }
      );
    }

    function buscarBloqueDisponible(bloque, cb) {
      contarBloque(bloque, (err, count, inicio) => {
        if (err) return cb(err);
        if (count < maxPorBloque) return cb(null, inicio);
        const siguienteBloque = new Date(inicio);
        siguienteBloque.setHours(siguienteBloque.getHours() + bloqueHoras);
        buscarBloqueDisponible(siguienteBloque, cb);
      });
    }

    buscarBloqueDisponible(bloqueInicio, callback);
  }

  function calcularTotal(db, usuarioId, carrito, callback) {
    let total = 0;
    const items = [];
    db.all(`SELECT * FROM bonos_usuarios WHERE usuario_id=? AND usado=0`, [usuarioId], (err, bonos) => {
      if (err) return callback(err);
      let bonoTotal = bonos.reduce((sum, b) => sum + b.valor, 0);
      let procesados = 0;
      if (carrito.length === 0) return callback(null, { total:0, items: [] });

      carrito.forEach(({ producto_id, cantidad }) => {
        db.get(`SELECT * FROM productos WHERE id=? AND activo=1`, [producto_id], (err2, prod) => {
          if (err2) return callback(err2);
          if (!prod) return callback(new Error(`Producto ${producto_id} no encontrado o inactivo`));
          if (prod.unidades < cantidad) return callback(new Error(`No hay suficiente inventario de ${prod.nombre}`));
          const precioConDescuento = prod.precio * (1 - (prod.descuento || 0)/100);
          let subtotal = precioConDescuento * cantidad;
          const aplicableBono = Math.min(bonoTotal, subtotal);
          subtotal -= aplicableBono;
          bonoTotal -= aplicableBono;
          items.push({ producto_id, cantidad, precio_unit: precioConDescuento, subtotal });
          total += subtotal;
          procesados++;
          if (procesados === carrito.length) callback(null, { total, items, bonosAplicados: bonos.length - bonoTotal });
        });
      });
    });
  }

  function registrarVenta(db, usuarioId, items, fechaEntrega, callback) {
    const total = items.reduce((sum, i) => sum + i.subtotal, 0);
    db.run(`INSERT INTO ventas (usuario_id, total, entrega) VALUES (?, ?, ?)`, [usuarioId, total, fechaEntrega.toISOString()], function(err) {
      if (err) return callback(err);
      const ventaId = this.lastID;
      let procesados = 0;
      items.forEach(({ producto_id, cantidad, precio_unit }) => {
        db.run(`INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit) VALUES (?, ?, ?, ?)`,
          [ventaId, producto_id, cantidad, precio_unit], (err2) => {
            if (err2) return callback(err2);
            db.run(`UPDATE productos SET unidades = unidades - ? WHERE id=?`, [cantidad, producto_id], (err3) => {
              if (err3) return callback(err3);
              procesados++;
              if (procesados === items.length) callback(null, ventaId);
            });
          });
      });
    });
  }

  // ----------------- Endpoint checkout -----------------
  app.post('/api/checkout', (req, res) => {
    const { token, entregaLat, entregaLng } = req.body;
    if (!token) return res.status(400).json({ error: 'Falta token' });

    db.get(`SELECT u.id, u.latitud, u.longitud FROM sesiones s JOIN usuarios u ON s.usuario_id=u.id WHERE s.token=?`, [token], (err, user) => {
      if (err || !user) return res.status(401).json({ error: 'Sesión inválida' });

      if (!dentroDelRango(entregaLat, entregaLng, TIENDA_LAT, TIENDA_LNG, MAX_KM)) {
        return res.status(400).json({ error: 'Domicilio fuera del rango de entrega' });
      }

      db.all(`SELECT producto_id, cantidad FROM carritos WHERE usuario_id=?`, [user.id], (err2, carrito) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (carrito.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

        calcularTotal(db, user.id, carrito, (err3, { total, items }) => {
          if (err3) return res.status(400).json({ error: err3.message });

          const ahora = new Date();
          asignarBloqueEntrega(db, ahora, (err4, fechaEntrega) => {
            if (err4) return res.status(500).json({ error: err4.message });

            registrarVenta(db, user.id, items, fechaEntrega, (err5, ventaId) => {
              if (err5) return res.status(500).json({ error: err5.message });

              db.run(`DELETE FROM carritos WHERE usuario_id=?`, [user.id]);

              res.json({
                success: true,
                venta_id: ventaId,
                total,
                fecha_entrega: fechaEntrega.toISOString(),
                items
              });
            });
          });
        });
      });
    });
  });

  // ----------------- Suspensiones y retrasos automáticos -----------------
  function suspenderEntregasTemporal(db, horas, callback) {
    const ahora = new Date();
    const finSuspension = new Date(ahora);
    finSuspension.setHours(finSuspension.getHours() + horas);

    db.run(`INSERT OR REPLACE INTO config (key, value) VALUES ('ventas_suspendidas', ?)`, [finSuspension.toISOString()], (err) => {
      if (err) return callback(err);
      db.all(`SELECT * FROM ventas WHERE entrega >= ? AND entrega <= ?`, [ahora.toISOString(), finSuspension.toISOString()], (err2, ventas) => {
        if (err2) return callback(err2);
        ventas.forEach(v => {
          const nuevaEntrega = new Date(v.entrega);
          nuevaEntrega.setHours(nuevaEntrega.getHours() + 3);
          db.run(`UPDATE ventas SET entrega=? WHERE id=?`, [nuevaEntrega.toISOString(), v.id]);
          generarAviso(db, v.usuario_id, `Tu entrega ha sido retrasada hasta ${nuevaEntrega.toISOString()}`, 'retraso');
        });
        callback(null, { message: `Entregas suspendidas por ${horas} horas`, afectadas: ventas.length });
      });
    });
  }

  function suspenderVentasDia(db, callback) {
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const mañana = new Date(hoy);
    mañana.setDate(mañana.getDate() + 1);

    db.all(`SELECT * FROM ventas WHERE fecha >= ? AND fecha < ?`, [hoy.toISOString(), mañana.toISOString()], (err, ventas) => {
      if (err) return callback(err);
      ventas.forEach(v => {
        const nuevaEntrega = new Date(v.entrega);
        nuevaEntrega.setDate(nuevaEntrega.getDate() + 1);
        db.run(`UPDATE ventas SET entrega=? WHERE id=?`, [nuevaEntrega.toISOString(), v.id]);
        generarAviso(db, v.usuario_id, `Debido a suspensión de ventas, tu entrega se retrasa un día. Nueva entrega: ${nuevaEntrega.toISOString()}`, 'retraso');
      });
      callback(null, { message: `Ventas del día retrasadas`, afectadas: ventas.length });
    });
  }

  app.post('/api/admin/suspender/horas', esAdmin, (req, res) => {
    const { horas } = req.body;
    if (!horas) return res.status(400).json({ error: 'Falta duración en horas' });
    suspenderEntregasTemporal(db, horas, (err, info) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(info);
    });
  });

  app.post('/api/admin/suspender/dia', esAdmin, (req, res) => {
    suspenderVentasDia(db, (err, info) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(info);
    });
  });

  // ----------------- Iniciar servidor -----------------
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Servidor Cárdenas Online activo en puerto ${PORT}`));
});