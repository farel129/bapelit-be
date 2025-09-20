const { logger } = require('../utils/logger');

const requestLogger = (req, res, next) => {
  const startTime = Date.now();

  // Tangkap response setelah selesai
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;

    // Warna berdasarkan status code
    const level = statusCode >= 500 ? 'error'
               : statusCode >= 400 ? 'warn'
               : 'info';

    logger.log(level, `${method} ${originalUrl} ${statusCode} ${duration}ms`, {
      method,
      url: originalUrl,
      status: statusCode,
      duration,
      ip: ip || req.headers['x-forwarded-for'] || 'unknown',
      userAgent: req.get('User-Agent')
    });
  });

  next();
};

module.exports = requestLogger;