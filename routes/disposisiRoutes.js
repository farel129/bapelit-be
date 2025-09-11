const express = require('express')
const { authenticateToken } = require('../middlewares/authMiddlewares')
const { buatDisposisi, getKepalaDisposisiAll, getKepalaDetailDisposisi, deleteDisposisi } = require('../controllers/disposisi/kepalaDisposisi')
const { getAtasanDisposisi, getAtasanDetailDisposisi, getAtasanFileDisposisi, kabidBacaDisposisi, kabidTerimaDisposisi, sekretarisBacaDisposisi, sekretarisTerimaDisposisi, listBawahan, atasanTeruskanDisposisi, listJabatan } = require('../controllers/disposisi/atasanDisposisi')
const { getBawahanDisposisi, getBawahanDetailDisposisi, terimaBawahanDisposisi } = require('../controllers/disposisi/bawahanDisposisi')
const getDisposisiStatusLog = require('../controllers/disposisi/disposisiStatusLog')
const getStatistikDisposisi = require('../controllers/disposisi/disposisiStatistik')
const getLeaderboardDisposisi = require('../controllers/disposisi/disposisiLeaderboard')
const downloadPdf = require('../controllers/disposisi/pdfGenerator')
const router = express.Router()

router.post('/:suratId', authenticateToken, buatDisposisi)
router.get('/kepala', authenticateToken, getKepalaDisposisiAll)
router.get('/kepala/:id', authenticateToken, getKepalaDetailDisposisi)
router.delete('/kepala/:id', authenticateToken, deleteDisposisi)
// =================atasan (kabid / sekretaris )=============//
router.get('/atasan', authenticateToken, getAtasanDisposisi)
router.get('/atasan/list-bawahan', authenticateToken, listBawahan)
router.get('/atasan/list-jabatan', authenticateToken, listJabatan)
router.get('/atasan/:disposisiId', authenticateToken, getAtasanDetailDisposisi)
router.get('/atasan/:fileId', authenticateToken, getAtasanFileDisposisi)
router.post('/atasan/:role/teruskan/:disposisiId', authenticateToken, atasanTeruskanDisposisi)

router.put('/kabid/baca/:id', authenticateToken, kabidBacaDisposisi);
router.put('/kabid/terima/:id', authenticateToken, kabidTerimaDisposisi);

// Routes untuk Sekretaris
router.put('/sekretaris/baca/:id', authenticateToken, sekretarisBacaDisposisi);
router.put('/sekretaris/terima/:id', authenticateToken, sekretarisTerimaDisposisi);

// =============== bawahan ===============//
router.get('/bawahan', authenticateToken, getBawahanDisposisi)
router.get('/bawahan/:disposisiId', authenticateToken, getBawahanDetailDisposisi)
router.put('/bawahan/terima/:disposisiId', authenticateToken, terimaBawahanDisposisi)

// ============== disposisi status log ============== //
router.get('/logs/:disposisiId', authenticateToken, getDisposisiStatusLog)

// =============== statistik disposisi ============== //
router.get('/statistik', authenticateToken, getStatistikDisposisi)

// ============= leaderboard disposisi ============== //
router.get('/leaderboard/:tipe', authenticateToken, getLeaderboardDisposisi)

// ============== downloadPDF ============== //
router.get('/download-pdf/:id', authenticateToken, downloadPdf)

module.exports = router