const express = require('express')
const { authenticateToken } = require('../middlewares/authMiddlewares')
const { getKepalaFeedback, getKepalaDetailFeedback, getKepalaFileFeedback, getAtasanFileFeedback, deleteFileFeedback, getAtasanFeedback, buatAtasanFeedback, getAtasanFeedbackDariBawahan, getEditFeedbackAtasan, editFeedbackAtasan } = require('../controllers/feedback/feedback')
const { buatFeedbackBawahan, getFeedbackBawahan, getFileFeedbackBawahan, getEditFeedbackBawahan, editFeedbackBawahan } = require('../controllers/feedback/bawahanFeedback')
const upload = require('../middlewares/uploadMiddleware')
const router = express.Router()

router.get('/kepala', authenticateToken, getKepalaFeedback)
router.get('/kepala/:id', authenticateToken, getKepalaDetailFeedback)
router.get('/kepala/:fileId', authenticateToken, getKepalaFileFeedback)
// =============Atasan=============== //
router.get('/atasan/file/:fileId', authenticateToken, getAtasanFileFeedback)
router.delete('/atasan/file/:fileId', authenticateToken, deleteFileFeedback)
router.get('/atasan/role/:role', authenticateToken, getAtasanFeedback)
router.post('/atasan/:role/buat/:disposisiId', authenticateToken, upload.array('feedback_files', 5), buatAtasanFeedback)
router.get('/atasan/:role/feedback-bawahan/:disposisiId', authenticateToken, getAtasanFeedbackDariBawahan)
router.get('/atasan/:role/edit-view/:feedbackId', authenticateToken, getEditFeedbackAtasan)
router.put('/atasan/:role/edit/:feedbackId', authenticateToken, upload.array('new_feedback_files', 5), editFeedbackAtasan)
// =============Bawahan=============//
router.get('/bawahan', authenticateToken, getFeedbackBawahan)
router.post('/bawahan/:disposisiId', authenticateToken,  upload.array('feedback_files', 5), buatFeedbackBawahan)
router.get('/bawahan/:fileId', authenticateToken, getFileFeedbackBawahan)
router.get('/bawahan/edit-view/:feedbackId', authenticateToken, getEditFeedbackBawahan)
router.put('/bawahan/edit/:feedbackId', authenticateToken, upload.array('new_feedback_files', 5), editFeedbackBawahan)



module.exports = router