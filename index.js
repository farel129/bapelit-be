const express = require('express');
const cors = require('cors');
require('dotenv').config();
const helmet = require('helmet');

const loginRoutes = require('./routes/loginRoutes');
const userRoutes = require('./routes/userRoutes');
const bukuTamuRoutes = require('./routes/bukuTamuRoutes');
const dokumentasiRoutes = require('./routes/dokumentasiRoutes');
const jadwalAcaraRoutes = require('./routes/jadwalAcaraRoutes');
const suratMasukRoutes = require('./routes/suratMasukRoutes');
const suratKeluarRoutes = require('./routes/suratKeluarRoutes');
const disposisiRoutes = require('./routes/disposisiRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const requestLogger = require('./middlewares/logger');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.CLIENT_URL
      ? process.env.CLIENT_URL.split(',').map(url => url.trim())
      : ['http://localhost:3000'];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} tidak diizinkan.`));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(requestLogger); 


// 🔍 Log jika ada upaya akses CORS ilegal
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS')) {
    console.warn(`[CORS BLOCKED] ${err.message}`);
    console.warn(`  Origin: ${req.headers.origin}`);
    console.warn(`  Path  : ${req.path}`);
    console.warn(`  IP    : ${req.ip || req.connection?.remoteAddress}`);
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak oleh kebijakan CORS.'
    });
  }
  next(err);
});

app.use(express.json());

app.use('/api/v1/login', loginRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/buku-tamu', bukuTamuRoutes);
app.use('/api/v1/dokumentasi', dokumentasiRoutes);
app.use('/api/v1/jadwal-acara', jadwalAcaraRoutes);
app.use('/api/v1/surat-masuk', suratMasukRoutes);
app.use('/api/v1/surat-keluar', suratKeluarRoutes);
app.use('/api/v1/disposisi', disposisiRoutes);
app.use('/api/v1/feedback-disposisi', feedbackRoutes);


app.use((err, req, res, next) => {
  console.error('❌ [UNHANDLED ERROR]', err);

  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan internal. Tim kami sedang memperbaikinya.'
    });
  }

  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});