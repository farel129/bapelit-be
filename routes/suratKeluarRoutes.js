const express = require('express')
const { buatSuratKeluar, getSuratKeluarAll, deleteSuratKeluar } = require('../controllers/surat-keluar/suratKeluar')
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddlewares')
const upload = require('../middlewares/uploadMiddleware')
const router = express.Router()

router.post('/',  authenticateToken, requireAdmin, upload.array('lampiran', 10), buatSuratKeluar)
router.get('/',  authenticateToken, requireAdmin, getSuratKeluarAll)
router.delete('/:id',  authenticateToken, requireAdmin, deleteSuratKeluar)

module.exports = router