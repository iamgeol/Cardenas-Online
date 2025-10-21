// index.js - Servidor principal Cárdenas Online
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const { inicializarDB, DB_PATH } = require('./db');

const app = express();
app.use(bodyParser.json());

// Variables de entorno (Render)
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

  // ----------------- Rutas públicas -----------------
  app.get('/api/test', (req, res) => {
    res.json({ status: 'ok', message: 'Servidor Cárdenas Online operativo' });
  });

  app.post('/api/register', (req, res) => {
    const { nombre, pin, telefono, domicilio, latitud, longitud } = req.body;
    if (!nombre || !pin) return res.status(400).json({ error: 'Faltan campos requeridos' });

    db.run(
      `INSERT INTO usuarios (nombre, pin, telefono, domicilio, latitud, longitud) VALUES (?, ?, ?, ?, ?, ?)`,
      [nombre, pin, telefono || '', domicilio || '', latitud || 0, longitud || 0],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id: this.lastID });
      }
    );
  });

  app.post('/api/login', (req, res) => {
    const { nombre, pin } = req.body;
    if (!nombre || !pin) return res.status(400).json({ error: 'Debe ingresar nombre y pin' });

    db.get(`SELECT * FROM usuarios WHERE nombre = ? AND pin = ?`, [nombre, pin], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

      if (user.estado === 'suspendido') {
        if (!user.suspendido_hasta) return res.status(403).json({ error: 'Usuario suspendido permanentemente' });
        if (new Date(user.suspendido_hasta) > new Date())
          return res.status(403).json({ error: `Usuario suspendido hasta ${user.suspendido_hasta}` });
        db.run(`UPDATE usuarios SET estado='activo', suspendido_hasta=NULL WHERE id=?`, [user.id]);
      }

      // Eliminar sesión previa
      db.run(`DELETE FROM sesiones WHERE usuario_id=?`, [user.id], (err2) => {
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

    db.run(`DELETE FROM sesiones WHERE token=?`, [token], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });

  app.post('/api/session', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Falta token' });

    db.get(
      `SELECT u.id, u.nombre, u.estado FROM sesiones s JOIN usuarios u ON s.usuario_id = u.id WHERE s.token=?`,
      [token],
      (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
        res.json({ valid: true, user });
      }
    );
  });

  // ----------------- Endpoints admin -----------------
  function esAdmin(req, res, next) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Falta token' });

    db.get(
      `SELECT u.nombre FROM sesiones s JOIN usuarios u ON s.usuario_id=u.id WHERE s.token=?`,
      [token],
      (err, user) => {
        if (err || !user) return res.status(403).json({ error: 'Acceso denegado' });
        if (user.nombre !== ADMIN_USER) return res.status(403).json({ error: 'Solo admin permitido' });
        next();
      }
    );
  }

  app.post('/api/admin/avisos', esAdmin, (req, res) => {
    const { usuario_id, mensaje, tipo } = req.body;
    if (!usuario_id || !mensaje) return res.status(400).json({ error: 'Faltan campos' });

    db.run(`INSERT INTO avisos (usuario_id, mensaje, tipo) VALUES (?, ?, ?)`, [usuario_id, mensaje, tipo || 'info'], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });

  app.post('/api/admin/usuarios/:id/suspender', esAdmin, (req, res) => {
    const { id } = req.params;
    const { hasta } = req.body;
    const estado = 'suspendido';

    db.run(
      `UPDATE usuarios SET estado=?, suspendido_hasta=? WHERE id=?`,
      [estado, hasta || null, id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  });

  app.get('/api/admin/estadisticas', esAdmin, (req, res) => {
    db.all(
      `SELECT p.nombre, SUM(vi.cantidad) as unidades_vendidas, SUM(vi.cantidad*vi.precio_unit) as ingresos
       FROM venta_items vi
       JOIN productos p ON vi.producto_id = p.id
       GROUP BY p.id`,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ stats: rows });
      }
    );
  });

  // ----------------- Checkout con bonos y validación de rango -----------------
  app.post('/api/checkout', (req, res) => {
    const { token, entregaLat, entregaLng } = req.body;
    if (!token) return res.status(400).json({ error: 'Falta token' });

    db.get(
      `SELECT u.id, u.latitud, u.longitud FROM sesiones s JOIN usuarios u ON s.usuario_id=u.id WHERE s.token=?`,
      [token],
      (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Sesión inválida' });

        if (!dentroDelRango(entregaLat, entregaLng, TIENDA_LAT, TIENDA_LNG, MAX_KM)) {
          return res.status(400).json({ error: 'Domicilio fuera del rango de entrega (1.6 km máximo)' });
        }

        // Placeholder para calcular total, aplicar bonos y descuentos
        res.json({ success: true, message: 'Checkout válido, aplicar cálculos de bonos y descuentos aquí' });
      }
    );
  });

  // ----------------- 🕒 Nueva lógica para programación de pedidos -----------------
  function obtenerProximoDiaHabil(fecha) {
    let nuevaFecha = new Date(fecha);
    nuevaFecha.setDate(nuevaFecha.getDate() + 1);
    while (nuevaFecha.getDay() === 6 || nuevaFecha.getDay() === 0) { // 6=sábado, 0=domingo
      nuevaFecha.setDate(nuevaFecha.getDate() + 1);
    }
    return nuevaFecha;
  }

  app.post('/api/pedidos/programar', (req, res) => {
    const ahora = new Date();
    const horaActual = ahora.getHours() + ahora.getMinutes() / 60;

    let fechaEntrega = new Date(ahora);
    const horaLimite = 7 + 30 / 60; // 7:30 am

    if (horaActual > horaLimite) {
      fechaEntrega = obtenerProximoDiaHabil(ahora);
    }

    // Contar pedidos en los dos turnos
    db.all(`SELECT COUNT(*) as total, horario FROM pedidos WHERE fecha = date(?) GROUP BY horario`, [fechaEntrega.toISOString().split('T')[0]], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const turnoManana = rows.find(r => r.horario === 'mañana')?.total || 0;
      const turnoTarde = rows.find(r => r.horario === 'tarde')?.total || 0;

      let horario = turnoManana < 20 ? 'mañana' : turnoTarde < 20 ? 'tarde' : null;

      if (!horario) {
        fechaEntrega = obtenerProximoDiaHabil(fechaEntrega);
        horario = 'mañana';
      }

      res.json({
        success: true,
        fechaEntrega: fechaEntrega.toISOString().split('T')[0],
        horario,
      });
    });
  });

  // ----------------- Iniciar servidor -----------------
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Servidor Cárdenas Online activo en puerto ${PORT}`));
});