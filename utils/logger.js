const winston = require('winston');
const { format, transports } = winston;
const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message} ${stack ? `\n${stack}` : ''} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
});

// 🎯 Logger utama — tetap dipakai untuk log aplikasi
const logger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), logFormat)
    }),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

// 🛡️ Child Logger: Khusus untuk aktivitas mencurigakan / security
const securityLogger = logger.child({});

// Ganti format & transport khusus untuk security — dalam bentuk JSON + file terpisah
securityLogger.clear(); // hapus transport bawaan dari parent

securityLogger.add(
  new transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      printf(({ level, message, timestamp, ...meta }) => {
        return `[SECURITY] ${timestamp} [${level.toUpperCase()}] ${message} | ${JSON.stringify(meta)}`;
      })
    )
  })
);

securityLogger.add(
  new transports.File({
    filename: 'logs/security.log',
    format: combine(
      timestamp(),
      printf(info => JSON.stringify({
        type: 'SECURITY',
        timestamp: info.timestamp,
        level: info.level,
        message: info.message,
        ...info // sertakan semua metadata: ip, userAgent, path, dll
      }))
    )
  })
);

module.exports = {
  logger,           // ← untuk log aplikasi umum
  securityLogger    // ← untuk aktivitas mencurigakan
};