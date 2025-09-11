const express = require('express')
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddlewares')
const upload = require('../middlewares/uploadMiddleware')
const { buatSuratMasuk, getSuratMasuk, deleteSuratMasuk } = require('../controllers/surat-masuk/adminSuratMasuk')
const { getKepalaSuratMasuk, readKepalaSuratMasuk } = require('../controllers/surat-masuk/kepalaSuratMasuk')
const router = express.Router()

router.post('/', authenticateToken, requireAdmin, upload.array('photos', 10), buatSuratMasuk)
router.get('/', authenticateToken, requireAdmin, getSuratMasuk)
router.delete('/:id', authenticateToken, requireAdmin, deleteSuratMasuk)
// =============================================== //
router.get('/kepala', authenticateToken, getKepalaSuratMasuk)
router.get('/kepala/:photoId', authenticateToken, getKepalaSuratMasuk)
router.put('/kepala/:id', authenticateToken, readKepalaSuratMasuk)

module.exports = router