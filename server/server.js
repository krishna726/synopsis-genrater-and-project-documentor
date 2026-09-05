require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const connectDatabase = require('./config/db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/uploads', require('./routes/uploadRoutes'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../client')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));
app.use((error, _req, res, _next) => {
  console.error('Server error handler:', error.message || error);
  const status = error.status || error.statusCode || 500;
  res.status(status).json({ message: error.message || 'Unexpected server error.' });
});

connectDatabase().then(() => app.listen(process.env.PORT || 5000, () => console.log(`Server ready on http://localhost:${process.env.PORT || 5000}`)));

module.exports = app;
