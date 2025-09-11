const express = require("express");
const { authenticateToken, requireAdmin } = require("../middlewares/authMiddlewares");
const rekomendasiLokasi = require("../controllers/jadwal-acara/rekomendasiLokasi");
const { 
    buatJadwalAcara, 
    getJadwalAcara, 
    getDetailAcara, 
    updateJadwalAcara, 
    deleteJadwalAcara, 
    updateStatusAcara 
} = require("../controllers/jadwal-acara/jadwalAcara");

const router = express.Router();

// Routes untuk rekomendasi lokasi
router.get('/rekomendasi-lokasi', authenticateToken, rekomendasiLokasi);

// Routes untuk jadwal acara
router.post('/', authenticateToken, requireAdmin, buatJadwalAcara);
router.get('/', authenticateToken, getJadwalAcara);
router.get('/:id', authenticateToken, getDetailAcara);
router.put('/:id', authenticateToken, requireAdmin, updateJadwalAcara);
router.delete('/:id', authenticateToken, requireAdmin, deleteJadwalAcara);
router.patch('/:id', authenticateToken, requireAdmin, updateStatusAcara);

module.exports = router;