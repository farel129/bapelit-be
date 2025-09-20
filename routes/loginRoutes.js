const express = require("express");
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit'); // ← TAMBAHKAN INI
const login = require("../controllers/user/login");
const router = express.Router();

// 🔒 Rate limiter khusus untuk route login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // maks 5 request per IP dalam 15 menit
  message: {
    success: false,
    message: 'Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit.'
  },
  standardHeaders: true, // kirim header RateLimit-*
  legacyHeaders: false,  // matikan header X-RateLimit-*
});

// 🔒 Validasi input sebelum masuk ke controller
const validateLogin = [
  body('email')
    .isEmail().withMessage('Format email tidak valid')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password wajib diisi')
    .isLength({ min: 6 }).withMessage('Password minimal 6 karakter'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validasi gagal',
        errors: errors.array()
      });
    }
    next(); // lanjut ke controller jika valid
  }
];

router.post('/', loginLimiter, validateLogin, login);

module.exports = router;