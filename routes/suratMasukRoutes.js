const express = require('express')
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddlewares')
const upload = require('../middlewares/uploadMiddleware')
const { buatSuratMasuk, getSuratMasuk, deleteSuratMasuk, getFileSuratMasuk } = require('../controllers/surat-masuk/adminSuratMasuk')
const { getKepalaSuratMasuk, readKepalaSuratMasuk, getKepalaFileSuratMasuk } = require('../controllers/surat-masuk/kepalaSuratMasuk')
const router = express.Router()

router.post('/', authenticateToken, requireAdmin, upload.array('photos', 10), buatSuratMasuk)
router.get('/', authenticateToken, requireAdmin, getSuratMasuk)
router.delete('/:id', authenticateToken, requireAdmin, deleteSuratMasuk)
// =============================================== //
router.get('/kepala', authenticateToken, getKepalaSuratMasuk)
router.get('/kepala/:photoId', authenticateToken, getKepalaFileSuratMasuk)
router.put('/kepala/:id', authenticateToken, readKepalaSuratMasuk)

router.get('/file/:id', authenticateToken, getFileSuratMasuk)


module.exports = router