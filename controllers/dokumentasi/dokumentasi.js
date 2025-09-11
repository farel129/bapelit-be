const { supabase, supabaseAdmin } = require("../../config/supabase");
const { uploadDocumentationFile } = require("../../utils/uploadSupabase");

const postDokumentasi = async (req, res) => {
    try {
        const {
            caption = '',
            kategori = 'umum',
            tags = ''
        } = req.body;

        // Validasi - minimal harus ada caption atau file
        if ((!caption || caption.trim() === '') && (!req.files || req.files.length === 0)) {
            return res.status(400).json({
                error: 'Post harus memiliki caption atau minimal 1 file'
            });
        }

        // Insert post dokumentasi
        const postData = {
            user_id: req.user.id,
            caption: caption.trim(),
            kategori,
            tags: tags.trim(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: postResult, error: postError } = await supabase
            .from('dokumentasi_posts')
            .insert([postData])
            .select('*, users:user_id (id, name, email)')
            .single();

        if (postError) {
            console.log('Post creation error:', postError);
            return res.status(400).json({ error: postError.message });
        }

        // Upload files jika ada
        let uploadedFiles = [];
        if (req.files && req.files.length > 0) {
            try {
                const uploadPromises = req.files.map(file =>
                    uploadDocumentationFile(file, 'dokumentasi', req.headers.authorization?.replace('Bearer ', ''))
                );

                const uploadResults = await Promise.all(uploadPromises);

                // Simpan metadata files ke database
                const filesData = uploadResults.map((result, index) => ({
                    post_id: postResult.id,
                    file_url: result.publicUrl,
                    file_name: result.fileName,
                    original_name: result.originalName,
                    file_size: result.size,
                    mime_type: result.mimetype,
                    file_order: index + 1, // untuk urutan tampilan
                    created_at: new Date().toISOString()
                }));

                const { data: filesResult, error: filesError } = await supabase
                    .from('dokumentasi_files')
                    .insert(filesData)
                    .select();

                if (filesError) {
                    // Rollback: hapus post dan files dari storage
                    await supabase.from('dokumentasi_posts').delete().eq('id', postResult.id);

                    const filesToDelete = uploadResults.map(r => r.fileName);
                    await supabaseAdmin.storage.from('documentation-storage').remove(filesToDelete);

                    return res.status(400).json({ error: 'Gagal menyimpan files: ' + filesError.message });
                }

                uploadedFiles = filesResult;
            } catch (uploadError) {
                console.log('Upload error:', uploadError);
                // Rollback post jika upload gagal
                await supabase.from('dokumentasi_posts').delete().eq('id', postResult.id);
                return res.status(400).json({ error: 'Gagal upload files: ' + uploadError.message });
            }
        }

        res.status(201).json({
            message: 'Post dokumentasi berhasil dibuat',
            data: {
                ...postResult,
                files: uploadedFiles
            }
        });

    } catch (error) {
        console.error('Error creating documentation post:', error);
        res.status(500).json({ error: error.message });
    }
}

const getDokumentasi = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            kategori = '',
            search = ''
        } = req.query;

        const offset = (page - 1) * limit;

        // Build query
        let query = supabase
            .from('dokumentasi_posts')
            .select(`
            *,
            users:user_id (
              id,
              name,
              email
            ),
            files:dokumentasi_files (
              id,
              file_url,
              original_name,
              file_size,
              mime_type,
              file_order
            ),
            likes:dokumentasi_likes (
              id,
              user_id
            ),
            comments:dokumentasi_comments (
              id,
              user_id,
              comment,
              created_at,
              users:user_id (
                name
              )
            )
          `)
            .order('created_at', { ascending: false });

        // Filter berdasarkan kategori
        if (kategori && kategori !== '') {
            query = query.eq('kategori', kategori);
        }

        // Search berdasarkan caption atau tags
        if (search && search !== '') {
            query = query.or(`caption.ilike.%${search}%,tags.ilike.%${search}%`);
        }

        // Pagination
        query = query.range(offset, offset + limit - 1);

        const { data: posts, error } = await query;

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // Format data untuk response (seperti Instagram feed)
        const formattedPosts = posts.map(post => ({
            id: post.id,
            caption: post.caption,
            kategori: post.kategori,
            tags: post.tags,
            created_at: post.created_at,
            user: {
                id: post.users.id,
                name: post.users.name,
            },
            files: post.files.sort((a, b) => a.file_order - b.file_order),
            likes_count: post.likes.length,
            is_liked: post.likes.some(like => like.user_id === req.user.id),
            comments_count: post.comments.length,
            latest_comments: post.comments
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 1)
                .map(comment => ({
                    id: comment.id,
                    comment: comment.comment,
                    created_at: comment.created_at,
                    user: {
                        name: comment.users.name,
                    }
                }))
        }));

        res.json({
            data: formattedPosts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                has_more: posts.length === parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error fetching documentation feed:', error);
        res.status(500).json({ error: error.message });
    }
}

const getTrendingDokumentasi = async (req, res) => {
    try {
        const { limit = 10, days = 7 } = req.query;

        // Hitung tanggal batas (misal 7 hari terakhir)
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - days);

        // KODE BARU (DIPERBAIKI):
        const { data: posts, error } = await supabase
            .from('dokumentasi_posts')
            .select(`
        *,
        users:user_id (
          id,
          name
        ),
        files:dokumentasi_files (
          id,
          file_url,
          mime_type,
          file_order
        ),
        likes:dokumentasi_likes (
          id,
          created_at
        )
      `)
            .gte('created_at', daysAgo.toISOString())
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        const postsWithCommentCount = await Promise.all(
            posts.map(async (post) => {
                const { count: commentsCount, error: countError } = await supabase
                    .from('dokumentasi_comments')
                    .select('*', { count: 'exact', head: true })
                    .eq('post_id', post.id);

                return {
                    ...post,
                    comments_count: commentsCount || 0
                };
            })
        );

        const sortedPosts = postsWithCommentCount
            .map(post => ({
                ...post,
                recent_likes_count: post.likes.filter(like =>
                    new Date(like.created_at) >= daysAgo
                ).length
            }))
            .sort((a, b) => b.recent_likes_count - a.recent_likes_count)
            .slice(0, parseInt(limit));

        const formattedPosts = sortedPosts.map(post => ({
            id: post.id,
            caption: post.caption,
            kategori: post.kategori,
            created_at: post.created_at,
            user: {
                id: post.users.id,
                name: post.users.name
            },
            thumbnail: post.files.length > 0 ? post.files[0].file_url : null,
            files_count: post.files.length,
            total_likes: post.likes.length,
            recent_likes: post.recent_likes_count,
            comments_count: post.comments_count
        }));

        res.json({
            data: formattedPosts,
            period: `${days} hari terakhir`
        });

    } catch (error) {
        console.error('Error fetching trending posts:', error);
        res.status(500).json({ error: error.message });
    }
}

const getDokumentasiSearch = async (req, res) => {
    try {
        const { q, kategori, page = 1, limit = 10 } = req.query;

        if (!q || q.trim() === '') {
            return res.status(400).json({ error: 'Query pencarian tidak boleh kosong' });
        }

        const offset = (page - 1) * limit;

        let query = supabase
            .from('dokumentasi_posts')
            .select(`
        *,
        users:user_id (
          id,
          name
        ),
        files:dokumentasi_files (
          id,
          file_url,
          original_name,
          mime_type,
          file_order
        ),
        likes:dokumentasi_likes (count),
        comments:dokumentasi_comments (count)
      `)
            .or(`caption.ilike.%${q}%,tags.ilike.%${q}%`)
            .order('created_at', { ascending: false });

        if (kategori && kategori !== '') {
            query = query.eq('kategori', kategori);
        }

        query = query.range(offset, offset + limit - 1);

        const { data: posts, error } = await query;

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        const formattedPosts = posts.map(post => ({
            id: post.id,
            caption: post.caption,
            kategori: post.kategori,
            tags: post.tags,
            created_at: post.created_at,
            user: {
                id: post.users.id,
                name: post.users.name,
                avatar: post.users.avatar_url || '/default-avatar.png'
            },
            thumbnail: post.files.length > 0 ? post.files[0].file_url : null,
            files_count: post.files.length,
            likes_count: post.likes.length,
            comments_count: post.comments.length
        }));

        res.json({
            data: formattedPosts,
            search_query: q,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                has_more: posts.length === parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error searching posts:', error);
        res.status(500).json({ error: error.message });
    }
}

const getCategories = async (req, res) => {
    try {
        const { data: categories, error } = await supabase
            .from('dokumentasi_posts')
            .select('kategori')
            .not('kategori', 'is', null);

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // Hitung jumlah post per kategori
        const categoryCount = {};
        categories.forEach(item => {
            const cat = item.kategori || 'umum';
            categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        });

        const formattedCategories = Object.entries(categoryCount)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        res.json({ data: formattedCategories });

    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: error.message });
    }
}

const likePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.user.id;

        // Cek apakah sudah like sebelumnya
        const { data: existingLike } = await supabase
            .from('dokumentasi_likes')
            .select('id')
            .eq('post_id', postId)
            .eq('user_id', userId)
            .single();

        if (existingLike) {
            // Unlike - hapus like
            const { error } = await supabase
                .from('dokumentasi_likes')
                .delete()
                .eq('id', existingLike.id);

            if (error) {
                return res.status(400).json({ error: error.message });
            }

            res.json({ message: 'Post di-unlike', action: 'unliked' });
        } else {
            // Like - tambah like
            const { error } = await supabase
                .from('dokumentasi_likes')
                .insert([{
                    post_id: postId,
                    user_id: userId,
                    created_at: new Date().toISOString()
                }]);

            if (error) {
                return res.status(400).json({ error: error.message });
            }

            res.json({ message: 'Post di-like', action: 'liked' });
        }

    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: error.message });
    }
}

const commentPost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { comment } = req.body;

        if (!comment || comment.trim() === '') {
            return res.status(400).json({ error: 'Komentar tidak boleh kosong' });
        }

        const commentData = {
            post_id: postId,
            user_id: req.user.id,
            comment: comment.trim(),
            created_at: new Date().toISOString()
        };

        const { data: commentResult, error } = await supabase
            .from('dokumentasi_comments')
            .insert([commentData])
            .select(`
            *,
            users:user_id (
              name
            )
          `)
            .single();

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.status(201).json({
            message: 'Komentar berhasil ditambahkan',
            data: {
                id: commentResult.id,
                comment: commentResult.comment,
                created_at: commentResult.created_at,
                user: {
                    name: commentResult.users.name
                }
            }
        });

    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: error.message });
    }
}

const getDetaliDokumentasi = async (req, res) => {
    try {
        const { postId } = req.params;

        const { data: post, error } = await supabase
            .from('dokumentasi_posts')
            .select(`
        *,
        users:user_id (
          id,
          name,
          email
        ),
        files:dokumentasi_files (
          id,
          file_url,
          original_name,
          file_size,
          mime_type,
          file_order
        ),
        likes:dokumentasi_likes (
          id,
          user_id,
          users:user_id (
            name
          )
        ),
        comments:dokumentasi_comments (
          id,
          user_id,
          comment,
          created_at,
          users:user_id (
            name
          )
        )
      `)
            .eq('id', postId)
            .single();

        if (error) {
            return res.status(404).json({ error: 'Post tidak ditemukan' });
        }

        // Format response
        const formattedPost = {
            id: post.id,
            caption: post.caption,
            kategori: post.kategori,
            tags: post.tags,
            created_at: post.created_at,
            user: {
                id: post.users.id,
                name: post.users.name
            },
            files: post.files.sort((a, b) => a.file_order - b.file_order),
            likes: {
                count: post.likes.length,
                is_liked: post.likes.some(like => like.user_id === req.user.id),
                users: post.likes.map(like => ({
                    id: like.user_id,
                    name: like.users.name
                }))
            },
            comments: post.comments
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                .map(comment => ({
                    id: comment.id,
                    comment: comment.comment,
                    created_at: comment.created_at,
                    user: {
                        id: comment.user_id,
                        name: comment.users.name
                    }
                }))
        };

        res.json({ data: formattedPost });

    } catch (error) {
        console.error('Error fetching post detail:', error);
        res.status(500).json({ error: error.message });
    }
}

const deleteComment = async (req, res) => {
    try {
        const { commentId } = req.params;

        // Cek apakah komentar milik user atau user adalah admin
        const { data: comment, error: fetchError } = await supabase
            .from('dokumentasi_comments')
            .select('user_id')
            .eq('id', commentId)
            .single();

        if (fetchError || !comment) {
            return res.status(404).json({ error: 'Komentar tidak ditemukan' });
        }

        // Hanya pemilik komentar atau admin yang bisa hapus
        if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Tidak memiliki izin untuk menghapus komentar ini' });
        }

        const { error } = await supabase
            .from('dokumentasi_comments')
            .delete()
            .eq('id', commentId);

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({ message: 'Komentar berhasil dihapus' });

    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: error.message });
    }
}

const updatePostDokumentasi = async (req, res) => {
    try {
        const { postId } = req.params;
        const { caption, kategori, tags } = req.body;

        // Cek apakah post milik user atau user adalah admin
        const { data: post, error: fetchError } = await supabase
            .from('dokumentasi_posts')
            .select('user_id')
            .eq('id', postId)
            .single();

        if (fetchError || !post) {
            return res.status(404).json({ error: 'Post tidak ditemukan' });
        }

        if (post.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Tidak memiliki izin untuk mengedit post ini' });
        }

        // Update post
        const updateData = {
            updated_at: new Date().toISOString()
        };

        if (caption !== undefined) updateData.caption = caption.trim();
        if (kategori !== undefined) updateData.kategori = kategori;
        if (tags !== undefined) updateData.tags = tags.trim();

        const { data: updatedPost, error } = await supabase
            .from('dokumentasi_posts')
            .update(updateData)
            .eq('id', postId)
            .select(`
            *,
            users:user_id (
              id,
              name
            ),
            files:dokumentasi_files (
              id,
              file_url,
              original_name,
              mime_type,
              file_order
            )
          `)
            .single();

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({
            message: 'Post berhasil diupdate',
            data: updatedPost
        });

    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({ error: error.message });
    }
}

const deletePostDokumentasi = async (req, res) => {
    try {
        const { postId } = req.params;

        // Cek apakah post milik user atau user adalah admin
        const { data: post, error: fetchError } = await supabase
            .from('dokumentasi_posts')
            .select(`
        user_id,
        files:dokumentasi_files (
          file_name
        )
      `)
            .eq('id', postId)
            .single();

        if (fetchError || !post) {
            return res.status(404).json({ error: 'Post tidak ditemukan' });
        }

        if (post.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Tidak memiliki izin untuk menghapus post ini' });
        }

        // Hapus files dari storage
        if (post.files && post.files.length > 0) {
            const filesToDelete = post.files.map(file => file.file_name);
            await supabaseAdmin.storage.from('documentation-storage').remove(filesToDelete);
        }

        // Hapus post (cascade akan hapus likes, comments, dan files records)
        const { error } = await supabase
            .from('dokumentasi_posts')
            .delete()
            .eq('id', postId);

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({ message: 'Post berhasil dihapus' });

    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: error.message });
    }
}

const getProfile = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 12 } = req.query;
        const offset = (page - 1) * limit;

        // Query tanpa count yang bermasalah
        const { data: posts, error } = await supabase
            .from('dokumentasi_posts')
            .select(`
        *,
        users:user_id (
          id,
          name
        ),
        files:dokumentasi_files (
          id,
          file_url,
          mime_type,
          file_order
        ),
        likes:dokumentasi_likes (
          id
        )
      `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // Hitung comments secara terpisah untuk setiap post
        const postsWithCommentCount = await Promise.all(
            posts.map(async (post) => {
                const { count: commentsCount, error: countError } = await supabase
                    .from('dokumentasi_comments')
                    .select('*', { count: 'exact', head: true })
                    .eq('post_id', post.id);

                if (countError) {
                    console.error('Error counting comments for post', post.id, ':', countError);
                }

                return {
                    ...post,
                    comments_count: commentsCount || 0
                };
            })
        );

        // Format untuk grid view (seperti profile Instagram)
        const formattedPosts = postsWithCommentCount.map(post => ({
            id: post.id,
            caption: post.caption,
            created_at: post.created_at,
            thumbnail: post.files.length > 0 ? post.files[0].file_url : null,
            files_count: post.files.length,
            likes_count: post.likes.length,
            comments_count: post.comments_count,
            is_multiple: post.files.length > 1
        }));

        res.json({
            data: formattedPosts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                has_more: posts.length === parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error fetching user posts:', error);
        res.status(500).json({ error: error.message });
    }
}

const getProfileStats = async (req, res) => {
    try {
        const { userId } = req.params;

        // Hitung total posts
        const { count: postsCount, error: countError } = await supabase // Tambahkan penanganan error
            .from('dokumentasi_posts')
            .select('*', { count: 'exact', head: true }) // Perlu spesifik kolom untuk count, atau gunakan head: true
            .eq('user_id', userId);

        if (countError) { // Tambahkan penanganan error
            console.error('Error counting posts:', countError);
            // Anda bisa memilih untuk mengembalikan error atau melanjutkan dengan count 0
            // return res.status(400).json({ error: countError.message });
        }

        // --- PERBAIKAN DIMULAI DI SINI ---
        // 1. Jalankan query untuk mendapatkan ID post user terlebih dahulu
        const { data: userPostIdsData, error: idsError } = await supabase
            .from('dokumentasi_posts')
            .select('id') // Hanya pilih kolom 'id'
            .eq('user_id', userId);

        if (idsError) { // Tambahkan penanganan error
            console.error('Error fetching user post IDs:', idsError);
            // Anda bisa memilih untuk mengembalikan error atau melanjutkan dengan likes 0
            // return res.status(400).json({ error: idsError.message });
            // Untuk sementara, kita bisa lewatkan dan anggap tidak ada post ID
            userPostIdsData = []; // Atau tetap lempar error
            // Misalnya, lempar error:
            // return res.status(400).json({ error: idsError.message });
        }

        // 2. Ekstrak array ID dari hasil query
        const userPostIds = userPostIdsData.map(post => post.id);
        // --- PERBAIKAN BERAKHIR DI SINI ---

        // 3. Gunakan array ID dalam query .in()
        let likesData = [];
        let likesError = null;
        if (userPostIds.length > 0) { // Hanya lakukan query jika ada ID
            const result = await supabase
                .from('dokumentasi_likes')
                .select('post_id') // Pastikan ini hanya mengambil post_id
                .in('post_id', userPostIds); // Gunakan array yang sudah diekstrak

            likesData = result.data || [];
            likesError = result.error;
        }

        if (likesError) { // Tambahkan penanganan error
            console.error('Error counting likes:', likesError);
            // Anda bisa memilih untuk mengembalikan error
            // return res.status(400).json({ error: likesError.message });
        }

        res.json({
            data: {
                posts_count: postsCount || 0,
                total_likes_received: likesData.length || 0 // Gunakan panjang array likesData
            }
        });

    } catch (error) {
        console.error('Error fetching user stats:', error);
        // Memberikan pesan error yang lebih spesifik bisa membantu debugging
        res.status(500).json({ error: 'Internal server error while fetching stats' });
    }
}
module.exports = {
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
}