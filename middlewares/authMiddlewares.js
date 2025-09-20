const jwt = require('jsonwebtoken');
const { securityLogger } = require('../utils/logger'); // ← sesuaikan path jika perlu

const JWT_SECRET = process.env.JWT_SECRET || 'bapelit123';

// Helper: Ambil IP client dari berbagai header
const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.connection?.socket?.remoteAddress ||
    'unknown'
  );
};

// Helper: Log aktivitas mencurigakan
const logSuspiciousActivity = (req, errorType, errorMessage) => {
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  const path = req.originalUrl;

  securityLogger.warn(errorMessage, {
    type: errorType,
    ip,
    userAgent,
    path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
};

// Middleware: Verifikasi token JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

  if (!token) {
    logSuspiciousActivity(req, 'MISSING_TOKEN', 'Akses ke route terproteksi tanpa token.');
    return res.status(401).json({
      success: false,
      message: 'Akses ditolak. Token tidak ditemukan.'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      let errorMessage = 'Token tidak valid.';
      let errorType = 'INVALID_TOKEN';

      if (err.name === 'TokenExpiredError') {
        errorMessage = 'Token telah kadaluarsa.';
        errorType = 'EXPIRED_TOKEN';
      }

      logSuspiciousActivity(req, errorType, `${errorMessage} | Detail: ${err.message}`);

      return res.status(403).json({
        success: false,
        message: errorType === 'EXPIRED_TOKEN'
          ? 'Token telah kadaluarsa. Silakan login ulang.'
          : 'Token tidak valid. Silakan login ulang.',
        code: errorType
      });
    }

    // ✅ Token valid — simpan payload ke req.user
    req.user = user;
    next();
  });
};

// Middleware: Hanya izinkan admin
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    logSuspiciousActivity(
      req,
      'UNAUTHORIZED_ADMIN_ACCESS',
      `User (${req.user?.email || 'unknown'}) mencoba akses fitur admin tanpa izin.`
    );

    return res.status(403).json({
      success: false,
      message: 'Akses admin diperlukan.'
    });
  }
  next();
};

module.exports = { authenticateToken, requireAdmin };