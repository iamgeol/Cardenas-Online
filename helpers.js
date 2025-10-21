// helpers.js
const crypto = require('crypto');

function distanciaKm(lat1, lon1, lat2, lon2) {
  // Haversine
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function validarTelefono(tel) {
  // Validación simple: dígitos, opcional +, longitud entre 8 y 15
  if (!tel) return false;
  const norm = tel.trim();
  const re = /^\+?\d{8,15}$/;
  return re.test(norm);
}

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  distanciaKm,
  validarTelefono,
  generarToken
};
