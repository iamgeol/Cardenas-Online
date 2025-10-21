-- seed.sql: ejecutar con cliente sqlite si deseas insertar datos iniciales
INSERT INTO productos (nombre, descripcion, precio, unidades, descuento) VALUES ('Zapatos deportivos', 'Cómodos y resistentes', 1200, 10, 0);
INSERT INTO productos (nombre, descripcion, precio, unidades, descuento) VALUES ('Mochila escolar', 'Espaciosa', 800, 15, 0);
-- Para crear un admin (agregar manualmente en la tabla usuarios):
-- INSERT INTO usuarios (nombre, pin, telefono, domicilio, latitud, longitud, rango_valido) VALUES ('admin', '0000', '+5370000000', 'Cárdenas', 23.1140, -82.3640, 1);
