const express = require("express");
const { 
    postDokumentasi, 
    getDokumentasi, 
    getTrendingDokumentasi, 
    getDokumentasiSearch, 
    getCategories, 
    likePost, 
    commentPost, 
    getDetaliDokumentasi, 
    deleteComment,
    updatePostDokumentasi,
    deletePostDokumentasi,
    getProfile,
    getProfileStats
} = require("../controllers/dokumentasi/dokumentasi");
const { authenticateToken } = require("../middlewares/authMiddlewares");
const upload = require("../middlewares/uploadMiddleware");
const router = express.Router();

router.get('/', authenticateToken, getDokumentasi)
router.get('/trending', authenticateToken, getTrendingDokumentasi)
router.get('/search', authenticateToken, getDokumentasiSearch)
router.get('/categories', authenticateToken, getCategories)
//like post
router.post('/:postId/like', authenticateToken, likePost)
//comment
router.post('/:postId/comment', authenticateToken, commentPost)
router.delete('/:commentId/comment', authenticateToken, deleteComment)
//detail post
router.get('/:postId', authenticateToken, getDetaliDokumentasi)
//post dokumentasi
router.post('/', authenticateToken, upload.array('files', 5), postDokumentasi)
//edit post
router.put('/:postId', authenticateToken, updatePostDokumentasi)
//deletepost
router.delete('/:postId', authenticateToken, deletePostDokumentasi)
// profile
router.get('/:userId/user', authenticateToken, getProfile)
router.get('/:userId/stats', authenticateToken, getProfileStats)

module.exports = router