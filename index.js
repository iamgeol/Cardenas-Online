// index.js
const express = require('express');
const bodyParser = require('body-parser');
const app = express();

const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const ordersRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');

app.use(bodyParser.json());

app.use((req, res, next) => {
  // CORS básico
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-admin-secret, x-user-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use('/auth', authRoutes);
app.use('/productos', productsRoutes);
app.use('/carrito', cartRoutes);
app.use('/orden', ordersRoutes);
app.use('/admin', adminRoutes);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Cárdenas Online backend escuchando en puerto ${PORT}`));
