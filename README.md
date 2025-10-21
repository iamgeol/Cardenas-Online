# Cárdenas Online - Backend

Backend en Node.js + Express + SQLite para Cárdenas Online.

## Requisitos
- Node.js >= 16
- Git

## Cómo usar (local)
1. Clonar el repositorio.
2. `npm install`
3. Opcional: editar `data/seed.sql` para datos iniciales.
4. Inicializar DB: `npm run init-db` (crea `data/data.db`).
5. Crear archivo `.env` con:# Cardenas-Online
6. `npm start`
7. Endpoints disponibles en `http://localhost:10000/`

## Despliegue en Render
1. Subir repo a GitHub.
2. Crear Web Service en Render conectado al repo.
3. Configurar variables de entorno en Render (ADMIN_SECRET, BASE_LAT, BASE_LON, RADIO_KM, PORT).
4. Build command: `npm install`
5. Start command: `npm start`

## Seguridad
- Endpoints administrativos requieren el header `x-admin-secret: <ADMIN_SECRET>`.
- Las cuentas admin las agregas manualmente (o con seed SQL).

## Notas
- Carrito expira en 24 horas. Límite máximo: 5 unidades por usuario.
- Teléfono validado con expresión regular simple.
