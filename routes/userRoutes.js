const express = require('express')
const { daftarUser, buatAkun, adminDaftarUser, deleteUser, resetPassword } = require('../controllers/user/user')
const { authenticateToken, requireAdmin } = require('../middlewares/authMiddlewares')
const router = express.Router()

router.get('/daftar-user', authenticateToken, daftarUser)
router.post('/', authenticateToken, requireAdmin, buatAkun)
router.get('/admin/daftar-user', authenticateToken, requireAdmin, adminDaftarUser)
router.delete('/:id', authenticateToken, requireAdmin, deleteUser)
router.put('/:id', authenticateToken, requireAdmin, resetPassword)

module.exports = router