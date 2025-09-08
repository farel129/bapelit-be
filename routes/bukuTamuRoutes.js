const express = require("express");
const router = express.Router();
const { authenticateToken, requireAdmin } = require("../middlewares/authMiddlewares");
const upload = require("../middlewares/uploadMiddleware");

// admin
const {
    buatBukuTamu,
    getBukuTamu, 
    getListTamu, 
    deleteBukuTamu, 
    updateStatusBukuTamu, 
    deleteFotoTamu 
} = require("../controllers/buku-tamu/adminBukuTamu");

// public
const { 
    checkDevice, 
    getPublicBukuTamu,
    submitPublicBukuTamu
} = require("../controllers/buku-tamu/publicBukuTamu");

// ==========================admin=========================//
router.post('/', authenticateToken, requireAdmin, buatBukuTamu)
router.get('/', authenticateToken, requireAdmin, getBukuTamu)
router.delete('/:id', authenticateToken, requireAdmin, deleteBukuTamu)
router.get('/:id/tamu', authenticateToken, requireAdmin, getListTamu)
router.patch('/:id/status', authenticateToken, requireAdmin, updateStatusBukuTamu)
router.delete('/foto/:foto_id', authenticateToken, requireAdmin, deleteFotoTamu)

// ==========================public===========================//
router.post('/:qr_token/check-device', checkDevice)
router.post('/:qr_token', upload.array('photos', 5), submitPublicBukuTamu)
router.get('/:qr_token', getPublicBukuTamu)


module.exports = router;
