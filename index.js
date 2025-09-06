const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios')
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5000;

// 😁 Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 😁 Client khusus untuk operasi admin (upload, delete, dll)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } } // penting: jangan persist session
);

// 😁 Middleware
app.use(cors());
app.use(express.json());

// 😁 JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'bapelit123';

// 😁 Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// 😁 Admin Middleware
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// 😁 Setup multer untuk upload multiple files
const storage = multer.memoryStorage();

// 😁 Filter file - hanya izinkan gambar dan pdf
const fileFilter = (req, file, cb) => {
  // Izinkan tipe file gambar dan PDF
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const isImage = allowedImageTypes.test(path.extname(file.originalname).toLowerCase()) &&
    allowedImageTypes.test(file.mimetype);

  const isPdf = file.mimetype === 'application/pdf' &&
    path.extname(file.originalname).toLowerCase() === '.pdf';

  if (isImage || isPdf) {
    return cb(null, true);
  } else {
    cb(new Error('Hanya file gambar (JPEG, JPG, PNG, GIF, WEBP) dan PDF yang diizinkan!'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 10
  },
  fileFilter: fileFilter
});

// ===== FUNGSI HELPER UPLOAD KE SUPABASE =====
const uploadToSupabaseStorage = async (file, folder = 'surat-masuk', userToken) => {
  const fileExt = path.extname(file.originalname);
  const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

  const { data, error } = await supabaseAdmin.storage
    .from('surat-photos')
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) {
    console.log('Supabase storage error:', error);
    throw new Error(`Upload failed: ${error.message}. Details: ${JSON.stringify(error)}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('surat-photos')
    .getPublicUrl(fileName);

  return {
    fileName: data.path,
    publicUrl: publicUrl,
    size: file.size,
    originalName: file.originalname,
    mimetype: file.mimetype // tambahkan mimetype untuk identifikasi tipe file
  };
};

// Helper function upload ke Supabase (disesuaikan untuk dokumentasi)
const uploadDocumentationFile = async (file, folder = 'dokumentasi', userToken) => {
  const fileExt = path.extname(file.originalname);
  const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

  console.log('Uploading documentation file:', fileName);

  const { data, error } = await supabaseAdmin.storage
    .from('documentation-storage')
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) {
    console.log('Supabase storage error:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('documentation-storage')
    .getPublicUrl(fileName);

  return {
    fileName: data.path,
    publicUrl: publicUrl,
    size: file.size,
    originalName: file.originalname,
    mimetype: file.mimetype
  };
};

const uploadBuktiTamu = async (file, folder = 'bukti-tamu', userToken) => {
  const fileExt = path.extname(file.originalname);
  const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

  console.log('Uploading bukti foto tamu:', fileName);

  const { data, error } = await supabaseAdmin.storage
    .from('buku-tamu')
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) {
    console.log('Supabase storage error:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }

  // Get public URL - gunakan supabaseAdmin untuk konsistensi
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('buku-tamu')
    .getPublicUrl(fileName);

  return {
    fileName: data.path,
    publicUrl: publicUrl,
    size: file.size,
    originalName: file.originalname,
    mimetype: file.mimetype
  };
};

// ========= buat qr untuk tamu ========= //
function generateQRToken() {
  return uuidv4().replace(/-/g, '').substring(0, 16);
}

app.post('/api/admin/buku-tamu', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { nama_acara, tanggal_acara, lokasi, deskripsi } = req.body;

    // Validasi input
    if (!nama_acara || !tanggal_acara || !lokasi) {
      return res.status(400).json({ 
        error: 'Nama acara, tanggal, dan lokasi harus diisi' 
      });
    }

    // Generate unique QR token
    const qr_token = generateQRToken();
    
    // Insert ke database
    const { data, error } = await supabase
      .from('buku_tamu')
      .insert([{
        nama_acara,
        tanggal_acara,
        lokasi,
        deskripsi: deskripsi || '',
        qr_token,
        created_by: req.user.id,
        status: 'active'
      }])
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Generate QR Code
    const qrUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/guest/${qr_token}`;
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl);

    res.status(201).json({
      message: 'Buku tamu berhasil dibuat',
      event: data[0],
      qr_code: qrCodeDataURL,
      guest_url: qrUrl
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal membuat buku tamu' });
  }
});

app.get('/api/admin/buku-tamu', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('buku_tamu')
      .select(`
        *,
        kehadiran_tamu(count)
      `)
      .order('created_at', { ascending: false });

    // Filter berdasarkan status jika ada
    if (status && ['active', 'inactive'].includes(status)) {
      query = query.eq('status', status);
    }

    // Search berdasarkan nama acara atau lokasi
    if (search) {
      query = query.or(`nama_acara.ilike.%${search}%,lokasi.ilike.%${search}%`);
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      message: 'Data buku tamu berhasil diambil',
      data: data,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(count / limit),
        total_items: count,
        items_per_page: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal mengambil data buku tamu' });
  }
});

app.get('/api/admin/buku-tamu/:id/tamu', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, search } = req.query;
    const offset = (page - 1) * limit;

    // Cek apakah buku tamu exists
    const { data: bukuTamu, error: bukuTamuError } = await supabase
      .from('buku_tamu')
      .select('id, nama_acara, tanggal_acara, lokasi')
      .eq('id', id)
      .single();

    if (bukuTamuError || !bukuTamu) {
      return res.status(404).json({ error: 'Buku tamu tidak ditemukan' });
    }

    let query = supabase
      .from('kehadiran_tamu')
      .select(`
        *,
        foto_kehadiran_tamu(
          id,
          file_url,
          file_name,
          original_name,
          file_size,
          mime_type
        )
      `)
      .eq('buku_tamu_id', id)
      .order('check_in_time', { ascending: false });

    // Search berdasarkan nama atau instansi
    if (search) {
      query = query.or(`nama_lengkap.ilike.%${search}%,instansi.ilike.%${search}%`);
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: tamu, error: tamuError, count } = await query;

    if (tamuError) {
      console.error('Supabase error:', tamuError);
      return res.status(500).json({ error: tamuError.message });
    }

    res.json({
      message: 'Data tamu berhasil diambil',
      buku_tamu: bukuTamu,
      data: tamu,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(count / limit),
        total_items: count,
        items_per_page: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal mengambil data tamu' });
  }
});

app.patch('/api/admin/buku-tamu/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validasi status
    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ 
        error: 'Status harus berupa "active" atau "inactive"' 
      });
    }

    const { data, error } = await supabase
      .from('buku_tamu')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Buku tamu tidak ditemukan' });
    }

    res.json({
      message: `Status buku tamu berhasil diubah menjadi ${status}`,
      data: data[0]
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal mengubah status buku tamu' });
  }
});

// 4. Admin: Hapus buku tamu
app.delete('/api/admin/buku-tamu/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Hapus buku tamu (cascade akan menghapus kehadiran_tamu dan foto_kehadiran_tamu)
    const { data, error } = await supabase
      .from('buku_tamu')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Buku tamu tidak ditemukan' });
    }

    res.json({
      message: 'Buku tamu berhasil dihapus',
      deleted_event: data[0]
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal menghapus buku tamu' });
  }
});

app.delete('/api/admin/foto-tamu/:foto_id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { foto_id } = req.params;

    // Get foto data terlebih dahulu
    const { data: foto, error: fotoError } = await supabase
      .from('foto_kehadiran_tamu')
      .select('*')
      .eq('id', foto_id)
      .single();

    if (fotoError || !foto) {
      return res.status(404).json({ error: 'Foto tidak ditemukan' });
    }

    // Extract file name dari file_url atau gunakan file_name langsung
    let fileName = foto.file_name;
    
    // Jika file_name kosong, extract dari file_url
    if (!fileName && foto.file_url) {
      const urlParts = foto.file_url.split('/');
      const bucketIndex = urlParts.findIndex(part => part === 'buku-tamu');
      if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
        // Ambil path setelah bucket name
        fileName = urlParts.slice(bucketIndex + 1).join('/');
      }
    }

    console.log('Attempting to delete file:', fileName);

    // Hapus file dari Supabase Storage terlebih dahulu
    let storageDeleteSuccess = false;
    if (fileName) {
      try {
        const { error: storageError } = await supabaseAdmin.storage
          .from('buku-tamu')
          .remove([fileName]);

        if (storageError) {
          console.error('Storage delete error:', storageError);

        } else {
          storageDeleteSuccess = true;
          console.log('File successfully deleted from storage:', fileName);
        }
      } catch (storageError) {
        console.error('Storage delete exception:', storageError);
        // Lanjutkan ke penghapusan database
      }
    }

    // Hapus record dari database
    const { error: deleteError } = await supabase
      .from('foto_kehadiran_tamu')
      .delete()
      .eq('id', foto_id);

    if (deleteError) {
      console.error('Database delete error:', deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    // Response dengan informasi lengkap
    res.json({
      message: 'Foto tamu berhasil dihapus',
      deleted_photo: {
        id: foto.id,
        file_name: foto.file_name,
        original_name: foto.original_name,
        file_url: foto.file_url
      },
      storage_deleted: storageDeleteSuccess,
      file_path_used: fileName
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal menghapus foto tamu' });
  }
});

app.get('/api/public/buku-tamu/:qr_token', async (req, res) => {
  try {
    const { qr_token } = req.params;

    const { data, error } = await supabase
      .from('buku_tamu')
      .select('id, nama_acara, tanggal_acara, lokasi, deskripsi, status')
      .eq('qr_token', qr_token)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return res.status(404).json({ 
        error: 'buku tamu tidak ditemukan atau sudah tidak aktif' 
      });
    }

    res.json({
      message: 'Info acara berhasil diambil',
      event: data
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal mengambil info acara' });
  }
});

app.post('/api/public/buku-tamu/:qr_token', upload.array('photos', 5), async (req, res) => {
  try {
    const { qr_token } = req.params;
    const { nama_lengkap, instansi, jabatan, keperluan } = req.body;
    const photos = req.files;

    // Validasi input
    if (!nama_lengkap) {
      return res.status(400).json({ error: 'Nama lengkap harus diisi' });
    }

    // Cek apakah buku tamu exists dan active
    const { data: event, error: eventError } = await supabase
      .from('buku_tamu')
      .select('id')
      .eq('qr_token', qr_token)
      .eq('status', 'active')
      .single();

    if (eventError || !event) {
      return res.status(404).json({ 
        error: 'Event tidak ditemukan atau sudah tidak aktif' 
      });
    }

    // Insert data kehadiran tamu
    const { data: kehadiran, error: kehadiranError } = await supabase
      .from('kehadiran_tamu')
      .insert([{
        buku_tamu_id: event.id,
        nama_lengkap,
        instansi: instansi || '',
        jabatan: jabatan || '',
        keperluan: keperluan || ''
      }])
      .select();

    if (kehadiranError) {
      console.error('Supabase error:', kehadiranError);
      return res.status(500).json({ error: kehadiranError.message });
    }

    const kehadiranId = kehadiran[0].id;
    const uploadedPhotos = [];

    // Process uploaded photos jika ada
    if (photos && photos.length > 0) {
      for (const photo of photos) {
        try {
          // Validasi file
          const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
          const maxSize = 5 * 1024 * 1024; // 5MB

          if (!allowedTypes.includes(photo.mimetype)) {
            console.error(`Invalid file type: ${photo.mimetype}`);
            continue; // Skip file ini, lanjut ke file berikutnya
          }

          if (photo.size > maxSize) {
            console.error(`File too large: ${photo.size} bytes`);
            continue; // Skip file ini, lanjut ke file berikutnya
          }

          // Upload menggunakan fungsi uploadBuktiTamu
          const uploadResult = await uploadBuktiTamu(photo, 'bukti-tamu');

          // Simpan info foto ke database
          const { data: fotoData, error: fotoError } = await supabase
            .from('foto_kehadiran_tamu')
            .insert([{
              kehadiran_tamu_id: kehadiranId,
              file_url: uploadResult.publicUrl,
              file_name: uploadResult.fileName,
              original_name: uploadResult.originalName,
              file_size: uploadResult.size,
              mime_type: uploadResult.mimetype
            }])
            .select();

          if (fotoError) {
            console.error('Error saving photo info:', fotoError);
            // Jika gagal simpan ke DB, hapus file dari storage
            try {
              await supabaseAdmin.storage
                .from('buku-tamu')
                .remove([uploadResult.fileName]);
            } catch (removeError) {
              console.error('Error removing uploaded file:', removeError);
            }
          } else {
            uploadedPhotos.push({
              ...fotoData[0],
              public_url: uploadResult.publicUrl
            });
          }

        } catch (photoError) {
          console.error('Error processing photo:', photoError);
          // Continue dengan foto lain jika ada error
        }
      }
    }

    res.status(201).json({
      message: 'Kehadiran berhasil dicatat',
      attendance: kehadiran[0],
      uploaded_photos: uploadedPhotos,
      photo_count: uploadedPhotos.length
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Gagal mencatat kehadiran' });
  }
});

// ===== 1. BUAT POST DOKUMENTASI =====
app.post('/api/dokumentasi/post', authenticateToken, upload.array('files', 5), async (req, res) => {
  try {
    const {
      caption = '',
      kategori = 'umum', // umum, pekerjaan, tutorial, meeting, etc
      tags = '' // hashtags atau tags
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
});


app.get('/api/dokumentasi/feed', authenticateToken, async (req, res) => {
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
});

app.get('/api/dokumentasi/trending', authenticateToken, async (req, res) => {
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
});

app.get('/api/dokumentasi/search', authenticateToken, async (req, res) => {
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
});

// ===== 13. GET KATEGORI YANG TERSEDIA =====
app.get('/api/dokumentasi/categories', authenticateToken, async (req, res) => {
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
});

app.post('/api/dokumentasi/:postId/like', authenticateToken, async (req, res) => {
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
});

app.post('/api/dokumentasi/:postId/comment', authenticateToken, async (req, res) => {
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
});

// ===== 5. GET DETAIL POST =====
app.get('/api/dokumentasi/:postId', authenticateToken, async (req, res) => {
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
});

// ===== 6. HAPUS KOMENTAR (HANYA PEMILIK KOMENTAR) =====
app.delete('/api/dokumentasi/comment/:commentId', authenticateToken, async (req, res) => {
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
});

// ===== 7. EDIT POST (HANYA PEMILIK POST) =====
app.put('/api/dokumentasi/:postId', authenticateToken, async (req, res) => {
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
});

// ===== 8. HAPUS POST (HANYA PEMILIK POST) =====
app.delete('/api/dokumentasi/:postId', authenticateToken, async (req, res) => {
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
});

app.get('/api/dokumentasi/user/:userId', authenticateToken, async (req, res) => {
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
});

// ===== 12. GET USER STATS =====
app.get('/api/dokumentasi/stats/:userId', authenticateToken, async (req, res) => {
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
});

// ===== 11. SEARCH POSTS =====


// =========================================ENDPOINT=======================================//

// 😁 Endpoint untuk login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get user from database
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(400).json({ error: 'Email atau password salah' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Email atau password salah' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        jabatan: user.jabatan,
        bidang: user.bidang,
        role: user.role || 'user'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        jabatan: user.jabatan,
        role: user.role || 'user'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });

  }

});

app.get('/api/daftar-user', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, jabatan, bidang')
      .order('name', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Berhasil mengambil data user (name, jabatan & bidang)',
      data: data || [],
      total: data?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/lokasi-rekomendasi', async (req, res) => {
  try {
    const { q } = req.query;
    const serpApiKey = process.env.SERPAPI_KEY;

    if (!serpApiKey) {
      return res.status(500).json({
        error: 'SerpAPI key not configured in backend environment variables'
      });
    }

    if (!q) {
      return res.status(400).json({
        error: 'Query parameter "q" is required'
      });
    }

    // Panggil SerpAPI
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_maps',
        q: q,
        api_key: serpApiKey,
        ll: '@-7.3279,108.2200,12z',
        limit: 5
      }
    });

    // Filter hanya data yang dibutuhkan untuk mengurangi ukuran response
    const filteredResults = response.data.local_results?.slice(0, 5).map(item => ({
      title: item.title,
      address: item.address,
      place_id: item.place_id,
      coordinates: item.coordinates,
      rating: item.rating,
      reviews: item.reviews
    })) || [];

    res.json({
      local_results: filteredResults,
      search_parameters: response.data.search_parameters
    });

  } catch (error) {
    console.error('Error fetching recommendations:', error.response?.data || error.message);

    if (error.response) {
      // Error dari SerpAPI
      return res.status(error.response.status).json({
        error: 'Failed to fetch recommendations from location service',
        details: error.response.data
      });
    }

    // Error lainnya
    res.status(500).json({
      error: 'Internal server error while fetching recommendations'
    });
  }
});

// =======================================ADMIN START=========================================//
// 😁 Endpoint untuk admin membuat akun
app.post('/api/admin/akun/buat', authenticateToken, async (req, res) => {
  const { name, email, password, jabatan = '', role = 'user', bidang = '' } = req.body;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Hanya admin yang boleh membuat user' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, password: hashedPassword, jabatan, role, bidang }])
      .select();


    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ message: 'User berhasil dibuat', user: data[0] });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Gagal membuat user' });
  }
});

// 😁 Endpoint untuk admin melihat semua user
app.get('/api/admin/akun', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, jabatan, role, bidang, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Daftar semua user',
      data: data || [],
      total: data?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin menghapus user
app.delete('/api/admin/akun/:id/delete', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Jangan biarkan admin hapus dirinya sendiri
    if (userId == req.user.id) {
      return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
    }

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'User berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin reset password user
app.put('/api/admin/akun/:id/reset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const userId = req.params.id;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Password user berhasil direset' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk registrasi surat masuk
app.post('/api/admin/surat-masuk/buat', authenticateToken, upload.array('photos', 10), async (req, res) => {
  try {
    const {
      asal_instansi,
      tanggal_surat,
      diterima_tanggal,
      nomor_agenda,
      nomor_surat,
      tujuan_jabatan,
      keterangan,
    } = req.body;

    // VALIDASI INPUT YANG LEBIH LENGKAP
    if (!asal_instansi || !tanggal_surat || !diterima_tanggal || !nomor_agenda || !nomor_surat || !tujuan_jabatan || !keterangan) {
      return res.status(400).json({
        error: 'Asal instansi, tanggal surat, diterima tanggal, nomor agenda, nomor surat, tujuan jabatan, dan keterangan wajib diisi',
        received: { asal_instansi, tanggal_surat, diterima_tanggal, nomor_agenda, nomor_surat, tujuan_jabatan, keterangan }
      });
    }

    // VALIDASI FILES
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'Minimal 1 file (foto atau PDF) harus diupload'
      });
    }

    // Insert surat dulu
    const suratData = {
      asal_instansi,
      tanggal_surat,
      diterima_tanggal,
      nomor_agenda,
      nomor_surat,
      tujuan_jabatan,
      keterangan,
      created_by: req.user.id,
      status: 'belum dibaca',
      created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

    const { data: suratResult, error: suratError } = await supabase
      .from('surat_masuk')
      .insert([suratData])
      .select()
      .single();

    if (suratError) {
      return res.status(400).json({ error: suratError.message });
    }


    // Upload files ke Supabase Storage
    let photoCount = 0;
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file =>
        uploadToSupabaseStorage(file, 'surat-masuk', req.headers.authorization?.replace('Bearer ', ''))
      );

      try {
        const uploadResults = await Promise.all(uploadPromises);

        // Simpan data file ke database
        const fileData = uploadResults.map(result => ({
          surat_id: suratResult.id,
          foto_path: result.publicUrl,
          foto_filename: result.fileName,
          foto_original_name: result.originalName,
          file_size: result.size,
          storage_path: result.fileName,
          created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        }));

        const { error: fileError } = await supabase
          .from('surat_photos') // Pastikan nama tabel benar
          .insert(fileData);

        if (fileError) {
          // Rollback: hapus surat dan files dari storage
          await supabase.from('surat_masuk').delete().eq('id', suratResult.id);

          // Hapus files dari Supabase Storage
          const filesToDelete = uploadResults.map(r => r.fileName);
          await supabase.storage.from('surat-photos').remove(filesToDelete);

          return res.status(400).json({ error: 'Gagal menyimpan file: ' + fileError.message });
        }

        photoCount = req.files.length;
      } catch (uploadError) {
        console.log('Upload error:', uploadError); // ✅ Debug log
        // Rollback surat jika upload gagal
        await supabase.from('surat_masuk').delete().eq('id', suratResult.id);
        return res.status(400).json({ error: 'Gagal upload file: ' + uploadError.message });
      }
    }

    res.status(201).json({
      message: 'Surat masuk berhasil dibuat',
      data: {
        ...suratResult,
        photo_count: photoCount,
        has_photos: photoCount > 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET endpoint untuk mengambil semua surat masuk dengan info foto
app.get('/api/admin/surat-masuk/all', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('surat_masuk')
      .select(`*`)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Tambahkan info foto untuk setiap surat
    const dataWithPhotoInfo = data?.map(surat => ({
      ...surat,
      photo_count: surat.surat_photos ? surat.surat_photos.length : 0,
      has_photos: surat.surat_photos && surat.surat_photos.length > 0,
      photos: surat.surat_photos?.map(photo => ({
        id: photo.id,
        filename: photo.foto_original_name,
        size: photo.file_size,
        url: `/api/kepala/surat-masuk/photo/${photo.id}`
      })) || []
    })) || [];

    res.json({
      message: 'Berhasil mengambil semua surat masuk',
      data: dataWithPhotoInfo,
      total: dataWithPhotoInfo.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk delete surat masuk
app.delete('/api/admin/surat-masuk/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('surat_masuk')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.status(200).json({ message: 'Surat berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menghapus surat', detail: error.message });
  }
});

// 😁 Endpoint untuk admin membuat surat keluar
app.post('/api/admin/surat-keluar/buat', authenticateToken, requireAdmin, upload.array('lampiran', 10), async (req, res) => {
  try {
    const {
      nama_surat,
      tanggal_surat,
      ditujukan_ke,
      keterangan = ''
    } = req.body;

    // VALIDASI INPUT
    if (!nama_surat || !tanggal_surat || !ditujukan_ke) {
      return res.status(400).json({
        error: 'Nama surat, tanggal surat, dan ditujukan ke wajib diisi',
        received: { nama_surat, tanggal_surat, ditujukan_ke }
      });
    }

    // VALIDASI FILES
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'Minimal 1 file (foto atau PDF) harus diupload sebagai lampiran'
      });
    }

    // Insert surat keluar dulu
    const suratData = {
      nama_surat,
      tanggal_surat,
      ditujukan_ke,
      keterangan,
      created_by: req.user.id,
      created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

    const { data: suratResult, error: suratError } = await supabase
      .from('surat_keluar')
      .insert([suratData])
      .select()
      .single();

    if (suratError) {
      console.log('Supabase error:', suratError); // Debug log
      return res.status(400).json({ error: suratError.message });
    }

    // Upload lampiran ke Supabase Storage
    let lampiranCount = 0;
    if (req.files && req.files.length > 0) {
      console.log('User info:', req.user); // Debug log
      const uploadPromises = req.files.map(file =>
        uploadToSupabaseStorage(file, 'surat-keluar', req.headers.authorization?.replace('Bearer ', ''))
      );

      try {
        const uploadResults = await Promise.all(uploadPromises);

        // Simpan data lampiran ke database
        const lampiranData = uploadResults.map(result => ({
          surat_keluar_id: suratResult.id,
          file_path: result.publicUrl,
          file_filename: result.fileName,
          file_original_name: result.originalName,
          file_size: result.size,
          storage_path: result.fileName,
          created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        }));

        const { error: fileError } = await supabase
          .from('surat_keluar_lampiran')
          .insert(lampiranData);

        if (fileError) {
          // Rollback: hapus surat keluar dan files dari storage
          await supabase.from('surat_keluar').delete().eq('id', suratResult.id);

          // Hapus files dari Supabase Storage
          const filesToDelete = uploadResults.map(r => r.fileName);
          await supabase.storage.from('surat-keluar-photos').remove(filesToDelete);

          return res.status(400).json({ error: 'Gagal menyimpan lampiran: ' + fileError.message });
        }

        lampiranCount = req.files.length;
      } catch (uploadError) {
        console.log('Upload error:', uploadError); // ✅ Debug log
        // Rollback surat jika upload gagal
        await supabase.from('surat_keluar').delete().eq('id', suratResult.id);
        return res.status(400).json({ error: 'Gagal upload lampiran: ' + uploadError.message });
      }
    }

    res.status(201).json({
      message: 'Surat keluar berhasil dibuat',
      data: {
        ...suratResult,
        lampiran_count: lampiranCount,
        has_lampiran: lampiranCount > 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin melihat semua surat keluar
app.get('/api/admin/surat-keluar/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('surat_keluar')
      .select(`
        *,
        surat_keluar_lampiran(*)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Tambahkan info lampiran untuk setiap surat
    const dataWithLampiranInfo = data?.map(surat => ({
      ...surat,
      lampiran_count: surat.surat_keluar_lampiran ? surat.surat_keluar_lampiran.length : 0,
      has_lampiran: surat.surat_keluar_lampiran && surat.surat_keluar_lampiran.length > 0,
      lampiran: surat.surat_keluar_lampiran?.map(file => ({
        id: file.id,
        filename: file.file_original_name,
        size: file.file_size,
        url: file.file_path
      })) || []
    })) || [];

    res.json({
      message: 'Berhasil mengambil semua surat keluar',
      data: dataWithLampiranInfo,
      total: dataWithLampiranInfo.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin menghapus surat keluar
app.delete('/api/admin/surat-keluar/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Hapus lampiran terlebih dahulu
    const { data: lampiranData, error: lampiranError } = await supabase
      .from('surat_keluar_lampiran')
      .select('storage_path')
      .eq('surat_keluar_id', id);

    if (lampiranError) {
      console.error('Error fetching lampiran:', lampiranError);
      return res.status(400).json({ error: lampiranError.message });
    }

    // Hapus file dari storage jika ada
    if (lampiranData && lampiranData.length > 0) {
      const filesToDelete = lampiranData.map(item => item.storage_path);
      await supabase.storage.from('surat-keluar-photos').remove(filesToDelete);
    }

    // Hapus data lampiran dari database
    await supabase.from('surat_keluar_lampiran').delete().eq('surat_keluar_id', id);

    // Hapus surat keluar
    const { error: suratError } = await supabase
      .from('surat_keluar')
      .delete()
      .eq('id', id);

    if (suratError) throw suratError;

    res.status(200).json({ message: 'Surat keluar berhasil dihapus' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Gagal menghapus surat keluar', detail: error.message });
  }
});

// 😁 Endpoint untuk admin membuat jadwal acara
const nodemailer = require("nodemailer");

// Setup transporter Gmail (taruh di luar endpoint biar ga bikin ulang tiap request)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

app.post("/api/admin/jadwal-acara/buat", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const {
        nama_acara,
        deskripsi,
        tanggal_mulai,
        tanggal_selesai,
        waktu_mulai,
        waktu_selesai,
        lokasi,
        pic_nama,
        pic_kontak,
        kategori = "",
        status = "aktif",
        prioritas = "biasa",
        peserta_target
      } = req.body;

      // VALIDASI INPUT
      if (!nama_acara || !tanggal_mulai || !waktu_mulai || !lokasi || !pic_nama) {
        return res.status(400).json({
          error: "Nama acara, tanggal mulai, waktu mulai, lokasi, dan PIC nama wajib diisi",
          received: { nama_acara, tanggal_mulai, waktu_mulai, lokasi, pic_nama }
        });
      }

      // VALIDASI TANGGAL
      const startDate = new Date(tanggal_mulai + " " + waktu_mulai);
      const endDate =
        tanggal_selesai && waktu_selesai
          ? new Date(tanggal_selesai + " " + waktu_selesai)
          : null;

      if (startDate < new Date()) {
        return res.status(400).json({
          error: "Tanggal dan waktu mulai tidak boleh di masa lalu"
        });
      }

      if (endDate && endDate <= startDate) {
        return res.status(400).json({
          error: "Tanggal dan waktu selesai harus setelah waktu mulai"
        });
      }

      const jadwalData = {
        nama_acara,
        deskripsi: deskripsi || "",
        tanggal_mulai,
        tanggal_selesai: tanggal_selesai || tanggal_mulai,
        waktu_mulai,
        waktu_selesai: waktu_selesai || null,
        lokasi,
        pic_nama,
        pic_kontak: pic_kontak || "",
        kategori,
        status,
        prioritas,
        peserta_target: peserta_target || null,
        created_by: req.user.id,
        created_at: new Date(new Date().getTime() + 7 * 60 * 60 * 1000).toISOString()
      };

      const { data, error } = await supabase
        .from("jadwal_acara")
        .insert([jadwalData])
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // 🔹 Ambil semua email user dari tabel users
      const { data: users, error: userError } = await supabase
        .from("users")
        .select("email");

      if (userError) {
        console.error("Gagal ambil data user:", userError);
      } else {
        // 🔹 Kirim email ke semua user
        const mailOptions = {
          from: `"Sistem Surat Pemkot" <${process.env.GMAIL_USER}>`,
          to: users.map((u) => u.email).join(","), // gabung semua email
          subject: `📅 Jadwal Acara Baru: ${nama_acara}`,
          html: `
            <h2>${nama_acara}</h2>
            <p><b>Deskripsi:</b> ${deskripsi || "-"} </p>
            <p><b>Tanggal:</b> ${tanggal_mulai} ${waktu_mulai} 
               ${tanggal_selesai ? "s/d " + tanggal_selesai + " " + (waktu_selesai || "") : ""}</p>
            <p><b>Lokasi:</b> ${lokasi}</p>
            <p><b>PIC:</b> ${pic_nama} (${pic_kontak || "-"})</p>
            <br/>
            <p>Silakan cek detail lengkap di <a href="https://sistem-pemkot.local/dashboard">Dashboard</a></p>
          `
        };

        try {
          const info = await transporter.sendMail(mailOptions);
          console.log("📩 Email info:", info);
        } catch (err) {
          console.error("❌ Gagal kirim email notifikasi:", err);
        }
      }

      res.status(201).json({
        message: "Jadwal acara berhasil dibuat dan notifikasi email terkirim",
        data: data
      });
    } catch (error) {
      console.error("Server error:", error);
      res.status(500).json({ error: "Gagal membuat jadwal acara" });
    }
  }
);


// 😁 Endpoint untuk admin melihat semua jadwal acara
app.get('/api/admin/jadwal-acara', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      status = '',
      kategori = '',
      bulan = '',
      tahun = new Date().getFullYear(),
      page = 1,
      limit = 10
    } = req.query;

    let query = supabase
      .from('jadwal_acara')
      .select(`
        *,
        creator:created_by(name, email)
      `)
      .order('tanggal_mulai', { ascending: true })
      .order('waktu_mulai', { ascending: true });

    // Filter berdasarkan status
    if (status) {
      query = query.eq('status', status);
    }

    // Filter berdasarkan kategori
    if (kategori) {
      query = query.eq('kategori', kategori);
    }

    // Filter berdasarkan bulan dan tahun
    if (bulan && tahun) {
      const startDate = `${tahun}-${bulan.padStart(2, '0')}-01`;
      const endDate = `${tahun}-${bulan.padStart(2, '0')}-31`;
      query = query.gte('tanggal_mulai', startDate).lte('tanggal_mulai', endDate);
    } else if (tahun) {
      const startDate = `${tahun}-01-01`;
      const endDate = `${tahun}-12-31`;
      query = query.gte('tanggal_mulai', startDate).lte('tanggal_mulai', endDate);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Daftar jadwal acara',
      data: data || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || data?.length || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin melihat detail jadwal acara
app.get('/api/admin/jadwal-acara/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('jadwal_acara')
      .select(`
        *,
        creator:created_by(name, email, jabatan)
      `)
      .eq('id', id)
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Jadwal acara tidak ditemukan' });
    }

    res.json({
      message: 'Detail jadwal acara',
      data: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin update jadwal acara
app.put('/api/admin/jadwal-acara/:id/update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nama_acara,
      deskripsi,
      tanggal_mulai,
      tanggal_selesai,
      waktu_mulai,
      waktu_selesai,
      lokasi,
      pic_nama,
      pic_kontak,
      kategori,
      status,
      prioritas,
      peserta_target
    } = req.body;

    // Cek apakah jadwal acara ada
    const { data: existing, error: checkError } = await supabase
      .from('jadwal_acara')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existing) {
      return res.status(404).json({ error: 'Jadwal acara tidak ditemukan' });
    }

    // VALIDASI TANGGAL jika diubah
    if (tanggal_mulai && waktu_mulai) {
      const startDate = new Date(tanggal_mulai + ' ' + waktu_mulai);
      const endDate = tanggal_selesai && waktu_selesai ? new Date(tanggal_selesai + ' ' + waktu_selesai) : null;

      if (endDate && endDate <= startDate) {
        return res.status(400).json({
          error: 'Tanggal dan waktu selesai harus setelah waktu mulai'
        });
      }
    }

    const updateData = {
      nama_acara,
      deskripsi,
      tanggal_mulai,
      tanggal_selesai,
      waktu_mulai,
      waktu_selesai,
      lokasi,
      pic_nama,
      pic_kontak,
      kategori,
      status,
      prioritas,
      peserta_target,
      updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

    // Hapus field yang undefined
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const { data, error } = await supabase
      .from('jadwal_acara')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Jadwal acara berhasil diupdate',
      data: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin hapus jadwal acara
app.delete('/api/admin/jadwal-acara/:id/delete', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Cek apakah jadwal acara ada
    const { data: existing, error: checkError } = await supabase
      .from('jadwal_acara')
      .select('nama_acara')
      .eq('id', id)
      .single();

    if (checkError || !existing) {
      return res.status(404).json({ error: 'Jadwal acara tidak ditemukan' });
    }

    const { error } = await supabase
      .from('jadwal_acara')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Jadwal acara berhasil dihapus',
      deleted_item: existing.nama_acara
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 😁 Endpoint untuk admin ubah status jadwal acara
app.patch('/api/admin/jadwal-acara/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validasi status
    const validStatus = ['aktif', 'selesai', 'dibatalkan', 'ditunda'];
    if (!status || !validStatus.includes(status)) {
      return res.status(400).json({
        error: `Status harus salah satu dari: ${validStatus.join(', ')}`
      });
    }

    const { data, error } = await supabase
      .from('jadwal_acara')
      .update({
        status,
        updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Jadwal acara tidak ditemukan' });
    }

    res.json({
      message: `Status jadwal acara berhasil diubah menjadi ${status}`,
      data: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// =======================================ADMIN END=========================================//


// =======================================KEPALA START=========================================//
app.get('/api/kepala/surat-masuk', authenticateToken, async (req, res) => {
  try {
    // Ambil semua surat masuk dengan foto info
    const { data: allSuratMasuk, error } = await supabase
      .from('surat_masuk')
      .select(`
        *,
        surat_photos (
          id,
          foto_original_name,
          file_size,
          foto_path,
          storage_path
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching surat masuk:', error);
      return res.status(400).json({ error: error.message });
    }

    const dataWithPhotoInfo = allSuratMasuk?.map(surat => {
      const photos = surat.surat_photos?.map(photo => {
        let photoUrl = `/api/kepala/surat-masuk/photo/${photo.id}`;
        if (photo.foto_path && photo.foto_path.startsWith('http')) {
          photoUrl = photo.foto_path;
        } else if (photo.storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('surat-photos')
            .getPublicUrl(photo.storage_path);
          photoUrl = publicUrl;
        }

        return {
          id: photo.id,
          filename: photo.foto_original_name,
          size: photo.file_size,
          url: photoUrl
        };
      }) || [];

      return {
        ...surat,
        photo_count: photos.length,
        has_photos: photos.length > 0,
        photos: photos
      };
    }) || [];

    res.json({
      data: dataWithPhotoInfo,
      total: dataWithPhotoInfo.length,
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk mendapatkan foto dan pdf
app.get('/api/kepala/surats/photo/:photoId', authenticateToken, async (req, res) => {
  try {
    const { photoId } = req.params;

    // Query database dengan field yang dibutuhkan saja
    const { data: photo, error } = await supabase
      .from('surat_photos')
      .select('foto_path, storage_path')
      .eq('id', photoId)
      .single();

    if (error || !photo) {
      return res.status(404).json({ error: 'Foto tidak ditemukan' });
    }

    // Prioritas 1: Jika foto_path sudah berupa URL lengkap
    if (photo.foto_path && photo.foto_path.startsWith('http')) {
      return res.redirect(photo.foto_path);
    }

    // Prioritas 2: Generate public URL dari storage_path
    if (photo.storage_path) {
      const { data: { publicUrl } } = supabase.storage
        .from('surat-photos')
        .getPublicUrl(photo.storage_path);

      if (publicUrl) {
        return res.redirect(publicUrl);
      }
    }

    // Jika semua metode gagal
    return res.status(404).json({ error: 'File foto tidak dapat diakses' });

  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Endpoint untuk mengupdate status surat menjadi "sudah dibaca"
app.put('/api/kepala/surat-masuk/:id/baca', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: surat, error: suratError } = await supabase
      .from('surat_masuk')
      .select('id, status, tujuan_jabatan')
      .eq('id', id)
      .single();

    if (suratError || !surat) {
      console.error('Error finding surat or surat not found:', suratError);
      return res.status(404).json({ error: 'Surat tidak ditemukan.' });
    }

    if (surat.status === 'belum dibaca') {
      const { data, error } = await supabase
        .from('surat_masuk')
        .update({ status: 'sudah dibaca' }) // <-- Status baru
        .eq('id', id)
        .select() // Mengembalikan data yang diupdate
        .single();

      if (error) {
        console.error('Error updating surat status:', error);
        return res.status(500).json({ error: 'Gagal mengupdate status surat.' });
      }

      res.json({ message: 'Status surat diperbarui menjadi sudah dibaca.', data });
    } else {
      res.json({ message: 'Status surat tidak berubah.', data: surat });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// 📝 Endpoint untuk kepala membuat disposisi dari surat masuk
app.post('/api/kepala/disposisi/buat/:suratId', authenticateToken, async (req, res) => {
  try {
    const { suratId } = req.params;
    const {
      sifat,
      perihal,
      disposisi_kepada_jabatan,
      dengan_hormat_harap,
      catatan
    } = req.body;

    // Validasi role kepala
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya kepala kantor yang bisa membuat disposisi' });
    }

    // Validasi input
    if (!sifat || !perihal || !disposisi_kepada_jabatan || !dengan_hormat_harap) {
      return res.status(400).json({
        error: 'Sifat, perihal, diteruskan kepada, dan dengan hormat harap wajib diisi'
      });
    }

    // Ambil data surat masuk
    const { data: suratMasuk, error: suratError } = await supabase
      .from('surat_masuk')
      .select('*')
      .eq('id', suratId)
      .single();

    if (suratError || !suratMasuk) {
      return res.status(404).json({ error: 'Surat masuk tidak ditemukan' });
    }

    // Data disposisi
    const disposisiData = {
      surat_masuk_id: suratId,
      dari_user_id: req.user.id,
      dari_jabatan: req.user.jabatan,
      nomor_surat: suratMasuk.nomor_surat,
      asal_instansi: suratMasuk.asal_instansi,
      tanggal_surat: suratMasuk.tanggal_surat,
      diterima_tanggal: suratMasuk.diterima_tanggal,
      nomor_agenda: suratMasuk.nomor_agenda,
      sifat,
      perihal,
      disposisi_kepada_jabatan,
      dengan_hormat_harap,
      catatan,
      status: 'belum dibaca',
      status_dari_kabid: 'belum dibaca',
      status_dari_sekretaris: 'belum dibaca',
      created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString(),
      created_by: req.user.id
    };

    // Insert disposisi
    const { data: disposisiResult, error: disposisiError } = await supabase
      .from('disposisi')
      .insert([disposisiData])
      .select()
      .single();

    if (disposisiError) {
      console.error('Error creating disposisi:', disposisiError);
      return res.status(400).json({ error: disposisiError.message });
    }

    // Update surat masuk bahwa sudah memiliki disposisi - dengan error handling
    const { error: updateError } = await supabase
      .from('surat_masuk')
      .update({ has_disposisi: true })
      .eq('id', suratId);

    if (updateError) {
      console.error('Error updating surat masuk:', updateError);
      // Tidak return error karena disposisi sudah berhasil dibuat
    }

    // Log status disposisi
    const { error: logError } = await supabase
      .from('disposisi_status_log')
      .insert([{
        disposisi_id: disposisiResult.id,
        status: 'dibuat',
        oleh_user_id: req.user.id,
        keterangan: 'Disposisi dibuat oleh kepala kantor'
      }]);

    if (logError) {
      console.error('Error creating status log:', logError);
    }

    // Kirim respons
    res.status(201).json({
      message: 'Disposisi berhasil dibuat',
      data: {
        ...disposisiResult,
        files_count: 0
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 Endpoint untuk melihat semua disposisi
app.get('/api/kepala/disposisi/all', authenticateToken, async (req, res) => {
  try {
    // ✅ Validasi role: konsisten dengan endpoint lain
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // ✅ FIX: Perbaikan destructuring
    const { data: disposisi, error } = await supabase
      .from('disposisi')
      .select(`
        *,
        surat_masuk (
          id,
          keterangan,
          status
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching disposisi:', error);
      return res.status(400).json({ error: error.message });
    }

    // ✅ Transform data dengan null safety
    const transformedData = disposisi?.map(item => ({
      ...item,
      surat_masuk: {
        ...item.surat_masuk,
        surat_status: item.surat_masuk?.status || 'unknown'
      }
    })) || [];

    // ✅ Kirim respons
    res.status(200).json({
      message: 'Berhasil mengambil semua disposisi',
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 👁️ Endpoint untuk melihat detail disposisi
app.get('/api/kepala/disposisi/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Validasi role: konsisten dengan endpoint lain
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select(`
        *,
        surat_masuk (
          id,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          keterangan,
          status
        )
      `)
      .eq('id', id)
      .single();

    if (disposisiError || !disposisi) {
      return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
    }

    // ✅ Ambil foto surat dengan null safety
    const { data: suratPhotos, error: photoError } = await supabase
      .from('surat_photos')
      .select('id, foto_original_name, file_size, foto_path, storage_path')
      .eq('surat_id', disposisi.surat_masuk?.id);

    if (photoError) {
      console.error('Error fetching surat photos:', photoError);
    }

    // ✅ Helper: generate URL foto dengan error handling
    const generatePhotoUrl = (photo) => {
      try {
        if (photo.foto_path && photo.foto_path.startsWith('http')) {
          return photo.foto_path;
        }
        if (photo.storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('surat-photos')
            .getPublicUrl(photo.storage_path);
          return publicUrl;
        }
        return `/api/kepala/surat-masuk/photo/${photo.id}`;
      } catch (error) {
        console.error('Error generating photo URL:', error);
        return `/api/kepala/surat-masuk/photo/${photo.id}`;
      }
    };

    // ✅ Format foto surat dengan null safety
    const photos = (suratPhotos || []).map(photo => ({
      id: photo.id,
      filename: photo.foto_original_name || 'Unknown file',
      size: photo.file_size || 0,
      url: generatePhotoUrl(photo)
    }));

    // ✅ Kirim respons dengan null safety
    res.status(200).json({
      message: 'Detail disposisi berhasil diambil',
      data: {
        ...disposisi,
        // ✅ Lampirkan foto
        photos,
        photo_count: photos.length,
        has_photos: photos.length > 0,
        // ✅ Perbarui surat_masuk dengan foto
        surat_masuk: {
          ...disposisi.surat_masuk,
          photos,
          photo_count: photos.length,
          has_photos: photos.length > 0
        }
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});


// 🗑️ Endpoint untuk hapus disposisi
app.delete('/api/kepala/disposisi/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Hanya kepala dan admin yang bisa hapus
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // STEP 1: Ambil surat_masuk_id dari disposisi yang akan dihapus
    const { data: disposisi, error: fetchError } = await supabase
      .from('disposisi')
      .select('surat_masuk_id') // ganti dengan nama kolom yang sesuai di tabel disposisi Anda
      .eq('id', id)
      .single();

    if (fetchError || !disposisi) {
      return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
    }

    // STEP 2: Hapus disposisi
    const { error } = await supabase
      .from('disposisi')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // STEP 3: Update has_disposisi = false di surat_masuk
    const { error: updateError } = await supabase
      .from('surat_masuk')
      .update({ has_disposisi: false })
      .eq('id', disposisi.surat_masuk_id); // ← Sekarang pakai ID surat yang benar

    if (updateError) {
      console.error('Error updating has_disposisi:', updateError);
      return res.status(500).json({ error: 'Gagal memperbarui status disposisi surat' });
    }

    res.json({ message: 'Disposisi berhasil dihapus dan status surat diperbarui' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/kepala/feedback/all', authenticateToken, async (req, res) => {
  try {
    // Hanya kepala dan admin yang bisa akses
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    const { data: feedback, error } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          diteruskan_kepada_jabatan,
          dengan_hormat_harap,
          created_by
        ),
        surat_masuk (
          id,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          diterima_tanggal,
          nomor_agenda
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching feedback for kepala:', error);
      return res.status(400).json({ error: error.message });
    }

    // Transform data dengan file info
    const transformedData = feedback?.map(item => {
      const files = item.feedback_files?.map(file => {
        let fileUrl = `/api/kepala/feedback/file/${file.id}`;

        // Jika file_path sudah berupa URL lengkap, gunakan langsung
        if (file.file_path && file.file_path.startsWith('http')) {
          fileUrl = file.file_path;
        } else if (file.storage_path) {
          // Generate public URL dari Supabase
          const { data: { publicUrl } } = supabase.storage
            .from('surat-photos')
            .getPublicUrl(file.storage_path);
          fileUrl = publicUrl;
        }

        return {
          id: file.id,
          filename: file.file_original_name,
          size: file.file_size,
          type: file.file_type,
          url: fileUrl
        };
      }) || [];

      return {
        ...item,
        files,
        file_count: files.length,
        has_files: files.length > 0
      };
    }) || [];

    res.json({
      message: 'Berhasil mengambil semua feedback',
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 👁️ Endpoint untuk kepala melihat detail feedback
app.get('/api/kepala/feedback/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Hanya kepala dan admin yang bisa akses
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    const { data: feedback, error } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          diteruskan_kepada_jabatan,
          dengan_hormat_harap,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          diterima_tanggal,
          nomor_agenda,
          created_by
        ),
        surat_masuk (
          id,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          keterangan,
          diterima_tanggal,
          nomor_agenda
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
      .eq('id', id)
      .single();

    if (error || !feedback) {
      return res.status(404).json({ error: 'Feedback tidak ditemukan' });
    }

    // Transform file data
    const files = feedback.feedback_files?.map(file => {
      let fileUrl = `/api/kepala/feedback/file/${file.id}`;

      if (file.file_path && file.file_path.startsWith('http')) {
        fileUrl = file.file_path;
      } else if (file.storage_path) {
        const { data: { publicUrl } } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(file.storage_path);
        fileUrl = publicUrl;
      }

      return {
        id: file.id,
        filename: file.file_original_name,
        size: file.file_size,
        type: file.file_type,
        url: fileUrl
      };
    }) || [];

    res.json({
      ...feedback,
      files,
      file_count: files.length,
      has_files: files.length > 0
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📁 Endpoint untuk kepala mengakses file feedback
app.get('/api/kepala/feedback/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Hanya kepala dan admin yang bisa akses
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    console.log('Kepala feedback file request for ID:', fileId);

    const { data: file, error } = await supabase
      .from('feedback_files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(404).json({ error: 'File tidak ditemukan: ' + error.message });
    }

    if (!file) {
      return res.status(404).json({ error: 'File tidak ditemukan' });
    }

    console.log('File data from DB:', file);

    // Prioritas 1: Jika file_path sudah berupa URL lengkap, redirect langsung
    if (file.file_path && file.file_path.startsWith('http')) {
      console.log('Redirecting to existing URL:', file.file_path);
      return res.redirect(file.file_path);
    }

    // Prioritas 2: Generate public URL dari storage_path
    if (file.storage_path) {
      try {
        const { data: { publicUrl }, error: urlError } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(file.storage_path);

        if (urlError) {
          console.error('Error generating public URL:', urlError);
        } else {
          console.log('Generated public URL:', publicUrl);
          return res.redirect(publicUrl);
        }
      } catch (urlGenError) {
        console.error('Error in URL generation:', urlGenError);
      }
    }

    // Jika semua gagal
    console.error('All methods failed. File data:', file);
    return res.status(404).json({
      error: 'File tidak dapat diakses',
      debug: {
        fileId,
        file_path: file.file_path,
        storage_path: file.storage_path
      }
    });

  } catch (error) {
    console.error('Server error in kepala feedback file endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});
// =======================================KEPALA END=========================================//


// =======================================KABID START=========================================//
// 📥 Endpoint untuk kabid melihat disposisi yang ditujukan kepadanya
app.get('/api/atasan/disposisi/saya', authenticateToken, async (req, res) => {
  try {
    const userJabatan = req.user.jabatan;

    if (!userJabatan) {
      return res.status(400).json({ error: 'Jabatan user tidak ditemukan' });
    }

    const { data: disposisi, error } = await supabase
      .from('disposisi')
      .select(`
        *,
        surat_masuk (
          id,
          keterangan,
          status,
          surat_photos (
            id,
            foto_original_name,
            file_size,
            foto_path,
            storage_path
          )
        )
      `)
      .eq('disposisi_kepada_jabatan', userJabatan)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching disposisi for kabid:', error);
      return res.status(400).json({ error: error.message });
    }

    // Transform data
    const transformedData = disposisi?.map(item => {
      const photos = item.surat_masuk?.surat_photos?.map(photo => {
        let photoUrl = `/api/kabid/surat-masuk/photo/${photo.id}`;

        if (photo.foto_path && photo.foto_path.startsWith('http')) {
          photoUrl = photo.foto_path;
        } else if (photo.storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('surat-photos')
            .getPublicUrl(photo.storage_path);
          photoUrl = publicUrl;
        }

        return {
          id: photo.id,
          filename: photo.foto_original_name,
          size: photo.file_size,
          url: photoUrl
        };
      }) || [];

      return {
        ...item,
        // Photos
        photos,
        photo_count: photos.length,
        has_photos: photos.length > 0,
        // Surat info
        surat_masuk: {
          ...item.surat_masuk,
          photos,
          photo_count: photos.length,
          has_photos: photos.length > 0
        }
      };
    }) || [];

    res.json({
      message: 'Berhasil mengambil disposisi kabid',
      data: transformedData,
      total: transformedData.length,
      summary: {
        belum_dibaca: transformedData.filter(d => d.status === 'belum dibaca').length,
        sudah_dibaca: transformedData.filter(d => d.status === 'sudah dibaca').length
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/atasan/disposisi/:disposisiId', authenticateToken, async (req, res) => {
  try {
    const { disposisiId } = req.params;
    const userJabatan = req.user.jabatan;

    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select(`
        *,
        surat_masuk (
          id,
          keterangan,
          status,
          surat_photos (
            id,
            foto_original_name,
            file_size,
            foto_path,
            storage_path
          )
        )
      `)
      .eq('id', disposisiId)
      .single();

    if (disposisiError || !disposisi) {
      return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
    }

    // ✅ Validasi bahwa disposisi memang ditujukan untuk user ini
    if (disposisi.disposisi_kepada_jabatan !== userJabatan) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses ke disposisi ini' });
    }

    const { data: disposisiFiles } = await supabase
      .from('disposisi_photos')
      .select('*')
      .eq('disposisi_id', disposisiId);

    // ✅ Transform photos dari surat_masuk
    const suratPhotos = disposisi.surat_masuk?.surat_photos?.map(photo => {
      let photoUrl = `/api/atasan/surat-masuk/photo/${photo.id}`;

      if (photo.foto_path && photo.foto_path.startsWith('http')) {
        photoUrl = photo.foto_path;
      } else if (photo.storage_path) {
        const { data: { publicUrl } } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(photo.storage_path);
        photoUrl = publicUrl;
      }

      return {
        id: photo.id,
        filename: photo.foto_original_name,
        size: photo.file_size,
        url: photoUrl
      };
    }) || [];

    const disposisiPhotos = disposisiFiles?.map(file => {
      let fileUrl = `/api/atasan/disposisi/file/${file.id}`;

      if (file.foto_path && file.foto_path.startsWith('http')) {
        fileUrl = file.foto_path;
      } else if (file.storage_path) {
        const { data: { publicUrl } } = supabase.storage
          .from('disposisi-photos')
          .getPublicUrl(file.storage_path);
        fileUrl = publicUrl;
      }

      return {
        id: file.id,
        filename: file.foto_original_name,
        size: file.file_size,
        url: fileUrl
      };
    }) || [];

    res.status(200).json({
      message: 'Detail disposisi berhasil diambil',
      data: {
        ...disposisi,
        disposisi_files: disposisiPhotos,
        disposisi_files_count: disposisiPhotos.length,
        has_disposisi_files: disposisiPhotos.length > 0,
        surat_masuk: {
          ...disposisi.surat_masuk,
          photos: suratPhotos,
          photo_count: suratPhotos.length,
          has_photos: suratPhotos.length > 0
        },
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
})

// 📷 Endpoint untuk kabid mengakses foto/dokumen (sama dengan kepala)
app.get('/api/atasan/surat-masuk/photo/:photoId', authenticateToken, async (req, res) => {
  try {
    const { photoId } = req.params;
    console.log('kabid photo request for ID:', photoId);

    const { data: photo, error } = await supabase
      .from('surat_photos')
      .select('foto_path, foto_filename, foto_original_name, storage_path')
      .eq('id', photoId)
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(404).json({ error: 'Foto tidak ditemukan di database: ' + error.message });
    }

    if (!photo) {
      console.error('Photo not found for ID:', photoId);
      return res.status(404).json({ error: 'Foto tidak ditemukan' });
    }

    console.log('Photo data from DB:', photo);

    // Prioritas 1: Jika foto_path sudah berupa URL lengkap, redirect langsung
    if (photo.foto_path && photo.foto_path.startsWith('http')) {
      console.log('Redirecting to existing URL:', photo.foto_path);
      return res.redirect(photo.foto_path);
    }

    // Prioritas 2: Generate public URL dari storage_path
    if (photo.storage_path) {
      try {
        const { data: { publicUrl }, error: urlError } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(photo.storage_path);

        if (urlError) {
          console.error('Error generating public URL:', urlError);
        } else {
          console.log('Generated public URL:', publicUrl);
          return res.redirect(publicUrl);
        }
      } catch (urlGenError) {
        console.error('Error in URL generation:', urlGenError);
      }
    }

    // Prioritas 3: Coba gunakan foto_filename sebagai fallback
    if (photo.foto_filename) {
      try {
        const { data: { publicUrl }, error: urlError } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(photo.foto_filename);

        if (!urlError) {
          console.log('Fallback public URL:', publicUrl);
          return res.redirect(publicUrl);
        }
      } catch (fallbackError) {
        console.error('Fallback URL generation failed:', fallbackError);
      }
    }

    // Jika semua gagal
    console.error('All methods failed. Photo data:', photo);
    return res.status(404).json({
      error: 'File foto tidak dapat diakses',
      debug: {
        photoId,
        foto_path: photo.foto_path,
        storage_path: photo.storage_path,
        foto_filename: photo.foto_filename
      }
    });

  } catch (error) {
    console.error('Server error in kabid photo endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function untuk validasi disposisi
async function validateDisposisi(id, userJabatan) {
  const { data: disposisi, error } = await supabase
    .from('disposisi')
    .select('id, status, disposisi_kepada_jabatan')
    .eq('id', id)
    .eq('disposisi_kepada_jabatan', userJabatan)
    .single();

  if (error || !disposisi) {
    throw new Error('Disposisi tidak ditemukan atau tidak ditujukan untuk Anda');
  }

  return disposisi;
}

async function updateDisposisiStatus(id, newStatus, newStatusKabid, newStatusSekretaris, newStatusLog, newKeterangan, userId) {
  const { data, error } = await supabase
    .from('disposisi')
    .update({ status: newStatus, status_dari_kabid: newStatusKabid, status_dari_sekretaris: newStatusSekretaris })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating disposisi status:', error);
    throw new Error('Gagal mengupdate status disposisi');
  }

  const { error: logError } = await supabase
    .from('disposisi_status_log')
    .insert([{
      disposisi_id: data.id,
      status: newStatusLog,
      oleh_user_id: userId,
      keterangan: newKeterangan
    }]);

  if (logError) {
    console.error('Error creating status log:', logError);
    // Tidak throw error, karena update status sudah berhasil
  }

  return data;
}

async function handleDisposisiStatusUpdate(req, res, statusConfig) {
  try {
    const { id } = req.params;
    const userJabatan = req.user.jabatan;

    const disposisi = await validateDisposisi(id, userJabatan);

    if (disposisi.status === statusConfig.requiredStatus) {
      const updatedData = await updateDisposisiStatus(
        id,
        statusConfig.newStatus,
        statusConfig.newStatusKabid,
        statusConfig.newStatusSekretaris,
        statusConfig.newStatusLog,
        statusConfig.newKeterangan,
        req.user.id
      );

      res.json({
        message: statusConfig.successMessage,
        data: updatedData
      });
    } else {
      res.json({
        message: statusConfig.noChangeMessage || 'Status disposisi tidak berubah',
        data: disposisi
      });
    }

  } catch (error) {
    console.error('Server error:', error);

    if (error.message.includes('tidak ditemukan')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: error.message });
  }
}

// Endpoint untuk menandai disposisi sebagai sudah dibaca
app.put('/api/kabid/disposisi/:id/baca', authenticateToken, async (req, res) => {
  await handleDisposisiStatusUpdate(req, res, {
    requiredStatus: 'belum dibaca',
    newStatus: 'dibaca',
    newStatusKabid: 'dibaca',
    newStatusLog: 'dibaca',
    newKeterangan: 'Disposisi telah dibaca oleh kabid terkait',
    successMessage: 'Status disposisi diperbarui menjadi sudah dibaca'
  });
});

app.put('/api/sekretaris/disposisi/:id/baca', authenticateToken, async (req, res) => {
  await handleDisposisiStatusUpdate(req, res, {
    requiredStatus: 'belum dibaca',
    newStatus: 'dibaca',
    newStatusSekretaris: 'dibaca',
    newStatusLog: 'dibaca',
    newKeterangan: 'Disposisi telah dibaca oleh sekretaris',
    successMessage: 'Status disposisi diperbarui menjadi sudah dibaca'
  });
});

// Endpoint untuk menerima disposisi
app.put('/api/kabid/disposisi/:id/terima', authenticateToken, async (req, res) => {
  await handleDisposisiStatusUpdate(req, res, {
    requiredStatus: 'dibaca',
    newStatusKabid: 'diterima',
    newStatusLog: 'diterima',
    newKeterangan: 'Disposisi telah diterima oleh kabid terkait',
    successMessage: 'Status disposisi diperbarui menjadi diterima oleh kabid'
  });
});

app.put('/api/sekretaris/disposisi/:id/terima', authenticateToken, async (req, res) => {
  await handleDisposisiStatusUpdate(req, res, {
    requiredStatus: 'dibaca',
    newStatusSekretaris: 'diterima',
    newStatusLog: 'diterima',
    newKeterangan: 'Disposisi telah diterima oleh sekretaris',
    successMessage: 'Status disposisi diperbarui menjadi diterima oleh sekretaris'
  });
});

// Endpoint untuk kabid memberikan feedback ke kepala (dengan update status)


// 📋 Endpoint untuk kabid melihat feedback yang sudah dikirim
// Helper function untuk transformasi data
const transformFeedbackData = (feedback) => {
  return feedback?.map(item => {
    const files = item.feedback_files?.map(file => ({
      id: file.id,
      filename: file.file_original_name,
      size: file.file_size,
      type: file.file_type,
      url: generateFileUrl(file)
    })) || [];

    return {
      ...item,
      files,
      file_count: files.length,
      has_files: files.length > 0
    };
  }) || [];
};

// Helper function untuk generate URL file
const generateFileUrl = (file) => {
  // Jika sudah URL lengkap, gunakan langsung
  if (file.file_path?.startsWith('http')) {
    return file.file_path;
  }

  // Jika ada storage_path, generate public URL
  if (file.storage_path) {
    const { data: { publicUrl } } = supabase.storage
      .from('surat-photos')
      .getPublicUrl(file.storage_path);
    return publicUrl;
  }

  // Fallback ke endpoint API
  return `/api/feedback/file/${file.id}`;
};

// Unified endpoint untuk feedback


// Simplified file access endpoint
app.get('/api/feedback/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;

    // Get file with ownership check
    const { data: file, error } = await supabase
      .from('feedback_files')
      .select(`
        *,
        feedback_disposisi!inner (user_id)
      `)
      .eq('id', fileId)
      .eq('feedback_disposisi.user_id', userId)
      .single();

    if (error || !file) {
      return res.status(404).json({ error: 'File tidak ditemukan' });
    }

    // Generate URL dan redirect
    const fileUrl = generateFileUrl(file);

    if (fileUrl.startsWith('http')) {
      return res.redirect(fileUrl);
    }

    return res.status(404).json({ error: 'File tidak dapat diakses' });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Endpoint untuk kabid mendapatkan detail feedback yang akan diedit


// 🗑️ Endpoint untuk kabid menghapus file feedback secara individual
app.delete('/api/feedback/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;

    console.log('Delete feedback file request for ID:', fileId);

    // Pastikan file milik user yang request
    const { data: file, error } = await supabase
      .from('feedback_files')
      .select(`
        *,
        feedback_disposisi!inner (
          user_id,
          user_jabatan
        )
      `)
      .eq('id', fileId)
      .eq('feedback_disposisi.user_id', userId)
      .single();

    if (error || !file) {
      return res.status(404).json({
        error: 'File tidak ditemukan atau tidak ada akses untuk menghapus'
      });
    }

    // Hapus dari storage jika ada storage_path
    if (file.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('surat-photos')
        .remove([file.storage_path]);

      if (storageError) {
        console.error('Error removing file from storage:', storageError);
      } else {
        console.log('File removed from storage:', file.storage_path);
      }
    }

    // Hapus dari database
    const { error: deleteError } = await supabase
      .from('feedback_files')
      .delete()
      .eq('id', fileId);

    if (deleteError) {
      console.error('Error deleting file from database:', deleteError);
      return res.status(500).json({ error: 'Gagal menghapus file dari database' });
    }

    res.json({
      message: 'File feedback berhasil dihapus',
      data: {
        deleted_file_id: fileId,
        deleted_filename: file.file_original_name
      }
    });

  } catch (error) {
    console.error('Server error in file deletion:', error);
    res.status(500).json({ error: error.message });
  }
});

//Endpoint untuk kabid meneruskan disposisi kebawahan / staff



// GET /api/kabid/bawahan
app.get('/api/bawahan', authenticateToken, async (req, res) => {
  try {
    // Ambil user di bidang yang sama, kecuali diri sendiri
    const { data: bawahan, error } = await supabase
      .from('users')
      .select('id, name, jabatan, bidang')
      .eq('bidang', req.user.bidang)
      .neq('id', req.user.id) // Kecuali diri sendiri
      .in('role', ['staff']); // Hanya staff

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      message: 'Daftar bawahan',
      data: bawahan
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =======================================KABID END=========================================//

// =======================================STAFF START=========================================//
// endpoint staff untuk memberikan feedback
app.post('/api/bawahan/disposisi/:disposisiId/feedback', authenticateToken, upload.array('feedback_files', 5), async (req, res) => {
  try {
    const { disposisiId } = req.params;
    const { notes, status, status_dari_bawahan } = req.body;
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;
    const userName = req.user.name;

    console.log('Bawahan feedback request:', { disposisiId, notes, status, status_dari_bawahan, filesCount: req.files?.length });

    // Validasi input
    if (!notes || notes.trim() === '') {
      return res.status(400).json({
        error: 'Notes/catatan feedback wajib diisi'
      });
    }

    if (!status || !['diproses', 'selesai'].includes(status)) {
      return res.status(400).json({
        error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
      });
    }

    if (!status_dari_bawahan || !['diproses', 'selesai'].includes(status_dari_bawahan)) {
      return res.status(400).json({
        error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
      });
    }

    // Pastikan disposisi ada dan diteruskan ke user ini
    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select('id, diteruskan_kepada_user_id, perihal, created_by, surat_masuk_id, status, status_dari_bawahan, dari_user_id, dari_jabatan')
      .eq('id', disposisiId)
      .eq('diteruskan_kepada_user_id', userId)
      .single();

    if (disposisiError || !disposisi) {
      return res.status(404).json({
        error: 'Disposisi tidak ditemukan atau tidak diteruskan untuk Anda'
      });
    }

    // Cek apakah feedback sudah ada sebelumnya
    const { data: existingFeedback, error: checkError } = await supabase
      .from('feedback_disposisi')
      .select('id')
      .eq('disposisi_id', disposisiId)
      .eq('user_id', userId) // Tambahkan filter user_id untuk feedback bawahan
      .single();

    if (existingFeedback) {
      return res.status(400).json({
        error: 'Feedback untuk disposisi ini sudah dikirim sebelumnya'
      });
    }

    // Data feedback bawahan (menggunakan tabel yang sama)
    const feedbackData = {
      disposisi_id: disposisiId,
      surat_masuk_id: disposisi.surat_masuk_id,
      user_id: userId,
      user_jabatan: userJabatan,
      user_name: userName,
      notes: notes.trim(),
      created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

    // Insert feedback bawahan
    const { data: feedbackResult, error: feedbackError } = await supabase
      .from('feedback_disposisi')
      .insert([feedbackData])
      .select()
      .single();

    if (feedbackError) {
      console.error('Error creating bawahan feedback:', feedbackError);
      return res.status(400).json({ error: feedbackError.message });
    }

    console.log('Feedback bawahan berhasil dibuat:', feedbackResult);

    // Upload files jika ada
    let fileCount = 0;
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file =>
        uploadToSupabaseStorage(file, 'feedback-bawahan', req.headers.authorization?.replace('Bearer ', ''))
      );

      try {
        const uploadResults = await Promise.all(uploadPromises);

        // Simpan data file ke database (tabel yang sama)
        const fileData = uploadResults.map(result => ({
          feedback_id: feedbackResult.id,
          disposisi_id: disposisiId,
          file_path: result.publicUrl,
          file_filename: result.fileName,
          file_original_name: result.originalName,
          file_size: result.size,
          file_type: result.mimetype,
          storage_path: result.fileName,
          created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        }));

        const { error: fileError } = await supabase
          .from('feedback_files')
          .insert(fileData);

        if (fileError) {
          // Rollback: hapus feedback dan files dari storage
          await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);

          // Hapus files dari Supabase Storage
          const filesToDelete = uploadResults.map(r => r.fileName);
          await supabase.storage.from('surat-photos').remove(filesToDelete);

          return res.status(400).json({ error: 'Gagal menyimpan file: ' + fileError.message });
        }

        fileCount = req.files.length;
        console.log(`${fileCount} files uploaded successfully`);
      } catch (uploadError) {
        console.error('Upload error:', uploadError);
        // Rollback feedback jika upload gagal
        await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);
        return res.status(400).json({ error: 'Gagal upload file: ' + uploadError.message });
      }
    }

    // Update status disposisi dan has_feedback_bawahan
    const { error: updateError } = await supabase
      .from('disposisi')
      .update({
        status: status,
        status_dari_bawahan: status_dari_bawahan, // Update status dari bawahan
        has_feedback: true
      })
      .eq('id', disposisiId);

    if (updateError) {
      console.error('Error updating disposisi status:', updateError);
      return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
    }

    console.log('Status disposisi dari bawahan diupdate menjadi:', status);

    // Insert ke disposisi_status_log
    const statusLogData = {
      disposisi_id: disposisiId,
      status: status,
      oleh_user_id: userId,
      keterangan: `Feedback dari bawahan: ${status} oleh ${userJabatan}`
    };

    const { error: logError } = await supabase
      .from('disposisi_status_log')
      .insert([statusLogData]);

    if (logError) {
      console.error('Error creating status log:', logError);
    }

    res.status(201).json({
      message: `Feedback berhasil dikirim dan status diupdate menjadi "${status}"`,
      data: {
        ...feedbackResult,
        status_dari_bawahan: status,
        file_count: fileCount,
        has_files: fileCount > 0
      }
    });

  } catch (error) {
    console.error('Server error in bawahan feedback creation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk staff melihat feedback yang dibuatnya
app.get('/api/bawahan/feedback/saya', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: feedback, error } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          dengan_hormat_harap,
          status,
          status_dari_bawahan,
          catatan_atasan,
          created_at
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching bawahan feedback:', error);
      return res.status(400).json({ error: error.message });
    }

    // Transform data dengan file info
    const transformedData = feedback?.map(item => {
      const files = item.feedback_files?.map(file => {
        let fileUrl = `/api/bawahan/feedback/file/${file.id}`;

        if (file.file_path && file.file_path.startsWith('http')) {
          fileUrl = file.file_path;
        } else if (file.storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('surat-photos')
            .getPublicUrl(file.storage_path);
          fileUrl = publicUrl;
        }

        return {
          id: file.id,
          filename: file.file_original_name,
          size: file.file_size,
          type: file.file_type,
          url: fileUrl
        };
      }) || [];

      return {
        ...item,
        files,
        file_count: files.length,
        has_files: files.length > 0
      };
    }) || [];

    res.json({
      message: 'Berhasil mengambil feedback bawahan',
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// endpoint untuk bawahan melihat file feedback yang dibuatnya
app.get('/api/bawahan/feedback/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;

    // Pastikan file milik user yang request melalui feedback_disposisi
    const { data: file, error } = await supabase
      .from('feedback_files')
      .select(`
        *,
        feedback_disposisi!inner (
          user_id
        )
      `)
      .eq('id', fileId)
      .eq('feedback_disposisi.user_id', userId)
      .single();

    if (error || !file) {
      return res.status(404).json({ error: 'File tidak ditemukan atau tidak ada akses' });
    }

    // Generate URL
    if (file.file_path && file.file_path.startsWith('http')) {
      return res.redirect(file.file_path);
    }

    if (file.storage_path) {
      const { data: { publicUrl }, error: urlError } = supabase.storage
        .from('surat-photos')
        .getPublicUrl(file.storage_path);

      if (!urlError) {
        return res.redirect(publicUrl);
      }
    }

    return res.status(404).json({ error: 'File tidak dapat diakses' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bawahan/feedback/:feedbackId/edit', authenticateToken, async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;

    // Ambil detail feedback dengan validasi kepemilikan
    const { data: feedback, error } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          disposisi_kepada_jabatan,
          dengan_hormat_harap,
          created_at,
          status,
          status_dari_bawahan,
          catatan_atasan,
          surat_masuk (
            id,
            keterangan
          )
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
      .eq('id', feedbackId)
      .eq('user_id', userId)
      .eq('user_jabatan', userJabatan)
      .single();

    if (error || !feedback) {
      return res.status(404).json({
        error: 'Feedback tidak ditemukan atau tidak ada akses untuk mengedit'
      });
    }

    // Transform file data
    const files = feedback.feedback_files?.map(file => {
      let fileUrl = `/api/bawahan/feedback/file/${file.id}`;

      if (file.file_path && file.file_path.startsWith('http')) {
        fileUrl = file.file_path;
      } else if (file.storage_path) {
        const { data: { publicUrl } } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(file.storage_path);
        fileUrl = publicUrl;
      }

      return {
        id: file.id,
        filename: file.file_original_name,
        size: file.file_size,
        type: file.file_type,
        url: fileUrl
      };
    }) || [];

    const responseData = {
      ...feedback,
      files,
      file_count: files.length,
      has_files: files.length > 0
    };

    res.json({
      message: 'Berhasil mengambil detail feedback untuk edit',
      data: responseData
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Endpoint untuk bawahan update feedback
app.put('/api/bawahan/feedback/:feedbackId', authenticateToken, upload.array('new_feedback_files', 5), async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { notes, status, status_dari_bawahan, remove_file_ids } = req.body;
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;

    console.log('Edit bawahan feedback request:', {
      feedbackId,
      notes,
      status,
      status_dari_bawahan,
      newFilesCount: req.files?.length,
      removeFileIds: remove_file_ids
    });

    // Validasi input
    if (!notes || notes.trim() === '') {
      return res.status(400).json({
        error: 'Notes/catatan feedback wajib diisi'
      });
    }

    if (!status || !['diproses', 'selesai'].includes(status)) {
      return res.status(400).json({
        error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
      });
    }

    // Pastikan feedback ada dan milik user
    const { data: existingFeedback, error: feedbackError } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          created_by,
          surat_masuk_id,
          diteruskan_kepada_user_id,
          status,
          status_dari_bawahan
        )
      `)
      .eq('id', feedbackId)
      .eq('user_id', userId)
      .eq('user_jabatan', userJabatan)
      .single();

    if (feedbackError || !existingFeedback) {
      return res.status(404).json({
        error: 'Feedback tidak ditemukan atau tidak ada akses untuk mengedit'
      });
    }

    // Update data feedback
    const updateData = {
      notes: notes.trim(),
      updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

    const { data: updatedFeedback, error: updateError } = await supabase
      .from('feedback_disposisi')
      .update(updateData)
      .eq('id', feedbackId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating feedback:', updateError);
      return res.status(400).json({ error: updateError.message });
    }

    // Handle penghapusan file lama (sama seperti kabid)
    let removedFileCount = 0;
    if (remove_file_ids) {
      try {
        const removeIds = Array.isArray(remove_file_ids) ? remove_file_ids : [remove_file_ids];

        const { data: filesToRemove, error: fetchError } = await supabase
          .from('feedback_files')
          .select('id, storage_path')
          .eq('feedback_id', feedbackId)
          .in('id', removeIds);

        if (!fetchError && filesToRemove && filesToRemove.length > 0) {
          const storageFilesToDelete = filesToRemove
            .filter(file => file.storage_path)
            .map(file => file.storage_path);

          if (storageFilesToDelete.length > 0) {
            const { error: storageError } = await supabase.storage
              .from('surat-photos')
              .remove(storageFilesToDelete);

            if (storageError) {
              console.error('Error removing files from storage:', storageError);
            }
          }

          const { error: removeError } = await supabase
            .from('feedback_files')
            .delete()
            .eq('feedback_id', feedbackId)
            .in('id', removeIds);

          if (removeError) {
            console.error('Error removing files from database:', removeError);
          } else {
            removedFileCount = filesToRemove.length;
          }
        }
      } catch (removeError) {
        console.error('Error in file removal process:', removeError);
      }
    }

    // Upload file baru (sama seperti kabid)
    let newFileCount = 0;
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file =>
        uploadToSupabaseStorage(file, 'feedback-bawahan', req.headers.authorization?.replace('Bearer ', ''))
      );

      try {
        const uploadResults = await Promise.all(uploadPromises);

        const fileData = uploadResults.map(result => ({
          feedback_id: feedbackId,
          disposisi_id: existingFeedback.disposisi_id,
          file_path: result.publicUrl,
          file_filename: result.fileName,
          file_original_name: result.originalName,
          file_size: result.size,
          file_type: result.mimetype,
          storage_path: result.fileName,
          created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        }));

        const { error: fileError } = await supabase
          .from('feedback_files')
          .insert(fileData);

        if (fileError) {
          const filesToDelete = uploadResults.map(r => r.fileName);
          await supabase.storage.from('surat-photos').remove(filesToDelete);
          return res.status(400).json({ error: 'Gagal menyimpan file baru: ' + fileError.message });
        }

        newFileCount = req.files.length;
      } catch (uploadError) {
        return res.status(400).json({ error: 'Gagal upload file baru: ' + uploadError.message });
      }
    }

    // Update status disposisi
    const { error: updateDisposisiError } = await supabase
      .from('disposisi')
      .update({
        status_dari_bawahan: status_dari_bawahan,
        status: status
      })
      .eq('id', existingFeedback.disposisi_id);

    if (updateDisposisiError) {
      console.error('Error updating disposisi status:', updateDisposisiError);
      return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
    }

    // Insert status log
    const statusLogData = {
      disposisi_id: existingFeedback.disposisi_id,
      status: status,
      oleh_user_id: userId,
      keterangan: `Update feedback bawahan: ${status} oleh ${userJabatan}`
    };

    const { error: logError } = await supabase
      .from('disposisi_status_log')
      .insert([statusLogData]);

    if (logError) {
      console.error('Error creating status log:', logError);
    }

    // Hitung total file setelah update
    const { data: remainingFiles } = await supabase
      .from('feedback_files')
      .select('id')
      .eq('feedback_id', feedbackId);

    const totalFiles = remainingFiles ? remainingFiles.length : 0;

    res.json({
      message: `Feedback berhasil diperbarui dan status diupdate menjadi "${status}"`,
      data: {
        ...updatedFeedback,
        status_dari_bawahan: status,
        file_count: totalFiles,
        has_files: totalFiles > 0,
        changes: {
          removed_files: removedFileCount,
          added_files: newFileCount
        }
      }
    });

  } catch (error) {
    console.error('Server error in bawahan feedback update:', error);
    res.status(500).json({ error: error.message });
  }
});















// Endpoint untuk staff melihat daftar disposisi yang ditujukan untuk mereka
app.get('/api/staff/disposisi', authenticateToken, async (req, res) => {
  try {
    const { status, limit = 10, offset = 0 } = req.query;

    // ✅ Validasi role staff
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Hanya staff yang bisa mengakses disposisi' });
    }

    let query = supabase
      .from('disposisi')
      .select(`
        *,
        surat_masuk (
          id,
          keterangan,
          status,
          surat_photos (
            id,
            foto_original_name,
            file_size,
            foto_path,
            storage_path
          )
        )
      `)
      .eq('diteruskan_kepada_user_id', req.user.id);

    // ✅ Filter berdasarkan status jika ada
    if (status) {
      query = query.eq('status', status);
    }

    // ✅ Pagination dan ordering
    const { data: disposisiList, error: disposisiError } = await query
      .range(offset, parseInt(offset) + parseInt(limit) - 1)
      .order('created_at', { ascending: false });

    if (disposisiError) {
      console.error('Error fetching disposisi:', disposisiError);
      return res.status(400).json({ error: disposisiError.message });
    }

    const transformedData = disposisiList?.map(item => {
      const photos = item.surat_masuk?.surat_photos?.map(photo => {
        let photoUrl = `/api/staff/surat-masuk/photo/${photo.id}`;

        if (photo.foto_path && photo.foto_path.startsWith('http')) {
          photoUrl = photo.foto_path;
        } else if (photo.storage_path) {
          const { data: { publicUrl } } = supabase.storage
            .from('surat-photos')
            .getPublicUrl(photo.storage_path);
          photoUrl = publicUrl;
        }

        return {
          id: photo.id,
          filename: photo.foto_original_name,
          size: photo.file_size,
          url: photoUrl
        };
      }) || [];

      return {
        ...item,
        photos,
        photo_count: photos.length,
        has_photos: photos.length > 0,
        surat_masuk: {
          ...item.surat_masuk,
          photos,
          photo_count: photos.length,
          has_photos: photos.length > 0
        }
      };
    }) || [];

    const { count: total } = await supabase
      .from('disposisi')
      .select('*', { count: 'exact' })
      .eq('diteruskan_kepada_user_id', req.user.id);

    res.status(200).json({
      message: 'Daftar disposisi berhasil diambil',
      data: transformedData,
      total: transformedData.length,
      pagination: {
        total: total || 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      },
      summary: {
        total: transformedData.length,
        belum_dibaca: transformedData.filter(d => d.status === 'belum dibaca').length,
        sudah_dibaca: transformedData.filter(d => d.status === 'dibaca').length
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk staff melihat detail disposisi
app.get('/api/staff/disposisi/:disposisiId', authenticateToken, async (req, res) => {
  try {
    const { disposisiId } = req.params;
    const userId = req.user.id;

    // ✅ Validasi role staff
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Hanya staff yang bisa mengakses disposisi' });
    }

    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select(`
        *,
        surat_masuk (
          id,
          keterangan,
          status,
          surat_photos (
            id,
            foto_original_name,
            file_size,
            foto_path,
            storage_path
          )
        )
      `)
      .eq('id', disposisiId)
      .single();

    if (disposisiError || !disposisi) {
      return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
    }

    // ✅ Validasi bahwa disposisi memang ditujukan untuk user ini
    if (disposisi.diteruskan_kepada_user_id !== userId) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses ke disposisi ini' });
    }

    // ✅ Ambil file attachments dari disposisi
    const { data: disposisiFiles } = await supabase
      .from('disposisi_photos')
      .select('*')
      .eq('disposisi_id', disposisiId);

    // ✅ Transform photos dari surat_masuk
    const suratPhotos = disposisi.surat_masuk?.surat_photos?.map(photo => {
      let photoUrl = `/api/staff/surat-masuk/photo/${photo.id}`;

      if (photo.foto_path && photo.foto_path.startsWith('http')) {
        photoUrl = photo.foto_path;
      } else if (photo.storage_path) {
        const { data: { publicUrl } } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(photo.storage_path);
        photoUrl = publicUrl;
      }

      return {
        id: photo.id,
        filename: photo.foto_original_name,
        size: photo.file_size,
        url: photoUrl
      };
    }) || [];

    // ✅ Transform disposisi files
    const disposisiPhotos = disposisiFiles?.map(file => {
      let fileUrl = `/api/staff/disposisi/file/${file.id}`;

      if (file.foto_path && file.foto_path.startsWith('http')) {
        fileUrl = file.foto_path;
      } else if (file.storage_path) {
        const { data: { publicUrl } } = supabase.storage
          .from('disposisi-photos')
          .getPublicUrl(file.storage_path);
        fileUrl = publicUrl;
      }

      return {
        id: file.id,
        filename: file.foto_original_name,
        size: file.file_size,
        url: fileUrl
      };
    }) || [];

    // ✅ Update status menjadi 'dibaca' jika belum dibaca
    let statusUpdated = false;
    if (disposisi.status_dari_bawahan === 'belum dibaca') {
      const { error: updateError } = await supabase
        .from('disposisi')
        .update({ status_dari_bawahan: 'dibaca' })
        .eq('id', disposisiId);

      if (!updateError) {
        statusUpdated = true;

        // 🔧 INSERT ke disposisi_status_log
        const statusLogData = {
          disposisi_id: disposisiId,
          status: 'dibaca',
          oleh_user_id: userId,
          keterangan: `Disposisi dibaca oleh staff (${req.user.name || userId})`
        };

        const { error: logError } = await supabase
          .from('disposisi_status_log')
          .insert([statusLogData]);

        if (logError) {
          console.error('Error creating status log:', logError);
          // Tidak throw error karena update status sudah berhasil
        }
      } else {
        console.error('Error updating disposisi status to dibaca:', updateError);
      }
    }

    res.status(200).json({
      message: 'Detail disposisi berhasil diambil',
      data: {
        ...disposisi,
        disposisi_files: disposisiPhotos,
        disposisi_files_count: disposisiPhotos.length,
        has_disposisi_files: disposisiPhotos.length > 0,
        surat_masuk: {
          ...disposisi.surat_masuk,
          photos: suratPhotos,
          photo_count: suratPhotos.length,
          has_photos: suratPhotos.length > 0
        },
        status_auto_updated: statusUpdated // info tambahan
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/staff/disposisi/terima/:disposisiId', authenticateToken, async (req, res) => {
  try {
    const { disposisiId } = req.params;

    // ✅ Validasi role staff
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Hanya staff yang bisa menerima disposisi' });
    }

    // ✅ Ambil disposisi yang akan diterima - FIXED: tambahkan data:
    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select('*')
      .eq('id', disposisiId)
      .single();

    if (disposisiError || !disposisi) {
      return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
    }

    // ✅ Validasi bahwa disposisi memang ditujukan untuk user ini
    if (disposisi.diteruskan_kepada_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Disposisi ini bukan untuk Anda' });
    }

    // ✅ Validasi bahwa disposisi dalam status yang bisa diterima
    if (disposisi.status_dari_bawahan !== 'dibaca') {
      return res.status(400).json({ error: 'Disposisi tidak dalam status yang bisa diterima' });
    }

    // ✅ Update status disposisi menjadi 'diterima' - FIXED: tambahkan data:
    const { data: updatedDisposisi, error: updateError } = await supabase
      .from('disposisi')
      .update({
        status_dari_bawahan: 'diterima',
        updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
      })
      .eq('id', disposisiId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating disposisi status:', updateError);
      return res.status(400).json({ error: updateError.message });
    }

    // ✅ INSERT ke disposisi_status_log
    const statusLogData = {
      disposisi_id: disposisiId,
      status: 'diterima',
      oleh_user_id: req.user.id,
      keterangan: `Disposisi diterima oleh staff (${req.user.name || req.user.id})`
    };

    const { error: logError } = await supabase
      .from('disposisi_status_log')
      .insert([statusLogData]);

    if (logError) {
      console.error('Error creating status log:', logError);
      // Tetap lanjutkan response, karena update disposisi sudah berhasil
    }

    // Hitung jumlah file yang terlampir
    const { count: filesCount } = await supabase
      .from('disposisi_photos')
      .select('*', { count: 'exact' })
      .eq('disposisi_id', disposisiId);

    res.status(200).json({
      message: 'Disposisi berhasil diterima',
      data: {
        ...updatedDisposisi,
        files_count: filesCount || 0,
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});
// =======================================STAFF END=========================================//

app.get('/api/disposisi/:disposisiId/logs', async (req, res) => {
  try {
    const { disposisiId } = req.params;

    // Validasi UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(disposisiId)) {
      return res.status(400).json({
        error: 'Invalid disposisi ID format'
      });
    }

    // Query ke database
    const { data, error } = await supabase
      .from('disposisi_status_log')
      .select(`
        id,
        disposisi_id,
        status,
        timestamp,
        keterangan,
        oleh_user_id,
        ke_user_id
      `)
      .eq('disposisi_id', disposisiId)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({
        error: 'Failed to fetch status logs'
      });
    }

    // Return success response
    return res.status(200).json({
      success: true,
      data,
      count: data.length
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});




app.get('/api/kepala/statistik/disposisi', authenticateToken, async (req, res) => {
  try {
    // Validasi role kepala
    if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // Query untuk mendapatkan semua disposisi dengan informasi lengkap
    const { data: disposisiData, error } = await supabase
      .from('disposisi')
      .select(`
        id,
        status,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching disposisi statistics:', error);
      return res.status(400).json({ error: error.message });
    }

    const disposisi = disposisiData || [];

    // 📈 Statistik Status Utama - Diperbaiki dengan normalisasi status
    const statusStats = {
      total: disposisi.length,
      belum_dibaca: disposisi.filter(d =>
        d.status === 'belum dibaca' || d.status === 'belum_dibaca'
      ).length,
      sudah_dibaca: disposisi.filter(d =>
        d.status === 'sudah dibaca' || d.status === 'sudah_dibaca' || d.status === 'dibaca'
      ).length,
      diproses: disposisi.filter(d =>
        d.status === 'diproses' || d.status === 'sedang diproses'
      ).length,
      selesai: disposisi.filter(d =>
        d.status === 'selesai' || d.status === 'completed'
      ).length,
      diteruskan: disposisi.filter(d =>
        d.status === 'diteruskan' || d.status === 'forwarded'
      ).length
    };

    // 📊 Tambahan: Persentase untuk setiap status
    const statusPercentage = {
      belum_dibaca: statusStats.total > 0 ? ((statusStats.belum_dibaca / statusStats.total) * 100).toFixed(1) : '0.0',
      sudah_dibaca: statusStats.total > 0 ? ((statusStats.sudah_dibaca / statusStats.total) * 100).toFixed(1) : '0.0',
      diproses: statusStats.total > 0 ? ((statusStats.diproses / statusStats.total) * 100).toFixed(1) : '0.0',
      selesai: statusStats.total > 0 ? ((statusStats.selesai / statusStats.total) * 100).toFixed(1) : '0.0',
      diteruskan: statusStats.total > 0 ? ((statusStats.diteruskan / statusStats.total) * 100).toFixed(1) : '0.0'
    };

    // 📋 Validasi total (opsional - untuk debugging)
    const totalCalculated = statusStats.belum_dibaca + statusStats.sudah_dibaca +
      statusStats.diproses + statusStats.selesai + statusStats.diteruskan;

    // 🗓️ Statistik berdasarkan periode waktu (opsional)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const periodStats = {
      bulan_ini: disposisi.filter(d => new Date(d.created_at) >= startOfMonth).length,
      minggu_ini: disposisi.filter(d => new Date(d.created_at) >= startOfWeek).length,
      hari_ini: disposisi.filter(d => new Date(d.created_at) >= startOfDay).length
    };

    // Response dengan struktur yang jelas
    res.json({
      success: true,
      data: {
        statistik_status: statusStats,
        persentase_status: statusPercentage,
        statistik_periode: periodStats,
        summary: {
          total_disposisi: statusStats.total,
          total_tervalidasi: totalCalculated,
          data_valid: totalCalculated === statusStats.total
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in disposisi statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.get('/api/leaderboard/:tipe', authenticateToken, async (req, res) => {
  try {
    const { tipe } = req.params;
    let selectField;
    let fieldName;

    if (tipe === 'atasan') {
      selectField = 'disposisi_kepada_jabatan';
      fieldName = 'jabatan';
    } else if (tipe === 'bawahan') {
      selectField = 'diteruskan_kepada_nama';
      fieldName = 'name';
    } else {
      return res.status(400).json({
        error: 'Tipe leaderboard tidak valid. Gunakan "atasan" atau "bawahan"'
      });
    }

    // Ambil data disposisi
    const { data: disposisiData, error: disposisiError } = await supabase
      .from('disposisi')
      .select('disposisi_kepada_jabatan, diteruskan_kepada_nama');

    if (disposisiError) {
      console.error(`Error fetching disposisi data:`, disposisiError);
      return res.status(400).json({ error: disposisiError.message });
    }

    // Ambil data users untuk mapping bidang
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('name, jabatan, bidang');

    if (usersError) {
      console.error(`Error fetching users data:`, usersError);
      return res.status(400).json({ error: usersError.message });
    }

    // Buat mapping dari nama/jabatan ke bidang
    const usersBidangMap = {};
    usersData.forEach(user => {
      if (user.name) {
        usersBidangMap[user.name] = user.bidang;
      }
      if (user.jabatan) {
        usersBidangMap[user.jabatan] = user.bidang;
      }
    });

    let result;

    if (tipe === 'atasan') {
      // Hitung total disposisi yang diterima setiap atasan
      const disposisiCounts = disposisiData.reduce((acc, curr) => {
        const key = curr.disposisi_kepada_jabatan;
        if (key) {
          const bidang = usersBidangMap[key] || 'Tidak diketahui';
          const compositeKey = `${key}|${bidang}`;
          acc[compositeKey] = (acc[compositeKey] || 0) + 1;
        }
        return acc;
      }, {});

      // Hitung disposisi yang diteruskan oleh setiap kabid
      const diteruskanCounts = disposisiData.reduce((acc, curr) => {
        const key = curr.disposisi_kepada_jabatan;
        if (key && curr.diteruskan_kepada_nama !== null) {
          const bidang = usersBidangMap[key] || 'Tidak diketahui';
          const compositeKey = `${key}|${bidang}`;
          acc[compositeKey] = (acc[compositeKey] || 0) + 1;
        }
        return acc;
      }, {});

      // Kalkulasi: diterima - diteruskan untuk setiap kabid
      result = Object.entries(disposisiCounts)
        .map(([compositeKey, count]) => {
          const [jabatan, bidang] = compositeKey.split('|');
          return {
            [fieldName]: jabatan,
            bidang: bidang,
            jumlah_disposisi: count - (diteruskanCounts[compositeKey] || 0)
          };
        })
        .sort((a, b) => b.jumlah_disposisi - a.jumlah_disposisi);

    } else {
      // Untuk bawahan: hitung diteruskan_kepada_nama
      const diteruskanCounts = disposisiData.reduce((acc, curr) => {
        const key = curr.diteruskan_kepada_nama;
        if (key) {
          const bidang = usersBidangMap[key] || 'Tidak diketahui';
          const compositeKey = `${key}|${bidang}`;
          acc[compositeKey] = (acc[compositeKey] || 0) + 1;
        }
        return acc;
      }, {});

      result = Object.entries(diteruskanCounts)
        .map(([compositeKey, count]) => {
          const [name, bidang] = compositeKey.split('|');
          return {
            [fieldName]: name,
            bidang: bidang,
            jumlah_disposisi: count
          };
        })
        .sort((a, b) => b.jumlah_disposisi - a.jumlah_disposisi);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/:role/feedback/saya', authenticateToken, async (req, res) => {
  try {
    const { role } = req.params;
    const userId = req.user.id;

    // Validasi role
    if (!['user', 'sekretaris'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }

    const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

    const { data: feedback, error } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          dengan_hormat_harap,
          status,
          ${statusField},
          created_at
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`Error fetching ${role} feedback:`, error);
      return res.status(400).json({ error: error.message });
    }

    const transformedData = transformFeedbackData(feedback);

    res.json({
      message: `Berhasil mengambil feedback ${role}`,
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:role/disposisi/:disposisiId/feedback', authenticateToken, upload.array('feedback_files', 5), async (req, res) => {
  try {
    const { role } = req.params;
    const { disposisiId } = req.params;
    const { notes, status } = req.body; // Tambahkan status dari request body
    const userJabatan = req.user.jabatan;
    const userName = req.user.name;

    if (!['user', 'sekretaris'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }

    const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

    // Validasi input
    if (!notes || notes.trim() === '') {
      return res.status(400).json({
        error: 'Notes/catatan feedback wajib diisi'
      });
    }

    if (!status || !['diproses', 'selesai'].includes(status)) {
      return res.status(400).json({
        error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
      });
    }

    // Pastikan disposisi ada dan ditujukan ke jabatan user
    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select(`id, disposisi_kepada_jabatan, perihal, created_by, surat_masuk_id, status, ${statusField}`)
      .eq('id', disposisiId)
      .eq('disposisi_kepada_jabatan', userJabatan)
      .single();

    if (disposisiError || !disposisi) {
      return res.status(404).json({
        error: 'Disposisi tidak ditemukan atau tidak ditujukan untuk jabatan Anda'
      });
    }

    // Cek apakah feedback sudah ada sebelumnya
    const { data: existingFeedback, error: checkError } = await supabase
      .from('feedback_disposisi')
      .select('id')
      .eq('disposisi_id', disposisiId)
      .single();

    if (existingFeedback) {
      return res.status(400).json({
        error: 'Feedback untuk disposisi ini sudah dikirim sebelumnya'
      });
    }

    // Data feedback
    const feedbackData = {
      disposisi_id: disposisiId,
      surat_masuk_id: disposisi.surat_masuk_id,
      user_id: req.user.id,
      user_jabatan: userJabatan,
      user_name: userName,
      notes: notes.trim(),
      created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

    // Insert feedback
    const { data: feedbackResult, error: feedbackError } = await supabase
      .from('feedback_disposisi')
      .insert([feedbackData])
      .select()
      .single();

    if (feedbackError) {
      console.error('Error creating feedback:', feedbackError);
      return res.status(400).json({ error: feedbackError.message });
    }

    console.log('Feedback berhasil dibuat:', feedbackResult);

    // Upload files jika ada
    let fileCount = 0;
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file =>
        uploadToSupabaseStorage(file, 'feedback-disposisi', req.headers.authorization?.replace('Bearer ', ''))
      );

      try {
        const uploadResults = await Promise.all(uploadPromises);

        // Simpan data file ke database
        const fileData = uploadResults.map(result => ({
          feedback_id: feedbackResult.id,
          disposisi_id: disposisiId,
          file_path: result.publicUrl,
          file_filename: result.fileName,
          file_original_name: result.originalName,
          file_size: result.size,
          file_type: result.mimetype,
          storage_path: result.fileName,
          created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        }));

        const { error: fileError } = await supabase
          .from('feedback_files')
          .insert(fileData);

        if (fileError) {
          // Rollback: hapus feedback dan files dari storage
          await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);

          // Hapus files dari Supabase Storage
          const filesToDelete = uploadResults.map(r => r.fileName);
          await supabase.storage.from('surat-photos').remove(filesToDelete);

          return res.status(400).json({ error: 'Gagal menyimpan file: ' + fileError.message });
        }

        fileCount = req.files.length;
        console.log(`${fileCount} files uploaded successfully`);
      } catch (uploadError) {
        console.error('Upload error:', uploadError);
        // Rollback feedback jika upload gagal
        await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);
        return res.status(400).json({ error: 'Gagal upload file: ' + uploadError.message });
      }
    }

    // Update status disposisi dan has_feedback
    const { error: updateError } = await supabase
      .from('disposisi')
      .update(
        {
          has_feedback: true,
          status: status,
          [statusField]: status
        }
      )
      .eq('id', disposisiId);

    if (updateError) {
      console.error('Error updating disposisi status:', updateError);
      return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
    }

    console.log('Status disposisi diupdate menjadi:', status);

    // 🔧 TAMBAHAN: Insert ke disposisi_status_log
    const statusLogData = {
      disposisi_id: disposisiId,
      status: status, // status yang dikirimkan adalah 'diproses' atau 'selesai'
      oleh_user_id: req.user.id,
      keterangan: `Disposisi ${status} melalui feedback oleh ${userJabatan}`
    };

    const { error: logError } = await supabase
      .from('disposisi_status_log')
      .insert([statusLogData]);

    if (logError) {
      console.error('Error creating status log:', logError);
      // Tidak throw error karena feedback sudah berhasil dibuat
    }

    res.status(201).json({
      message: `Feedback berhasil dikirim dan status disposisi diupdate menjadi "${status}"`,
      data: {
        ...feedbackResult,
        status_disposisi: status,
        file_count: fileCount,
        has_files: fileCount > 0
      }
    });

  } catch (error) {
    console.error('Server error in feedback creation:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/:role/disposisi/:disposisiId/feedback-bawahan', authenticateToken, async (req, res) => {
  try {
    const { role } = req.params;
    const { disposisiId } = req.params;

    if (!['user', 'sekretaris'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }

    const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

    // ✅ Role check - hanya untuk Kabid
    if (req.user.role !== 'user' && req.user.role !== 'sekretaris') { // Sesuaikan dengan role Kabid Anda
      return res.status(403).json({ error: 'Hanya Sekretaris dan Kabid yang bisa mengakses feedback bawahan' });
    }

    // Ambil disposisi untuk mendapatkan diteruskan_kepada_user_id
    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select('id, diteruskan_kepada_user_id, diteruskan_kepada_jabatan, diteruskan_kepada_nama, status, status_dari_bawahan')
      .eq('id', disposisiId)
      .single();

    if (disposisiError || !disposisi) {
      return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
    }



    // Pastikan disposisi ini diteruskan ke seseorang (bukan null)
    if (!disposisi.diteruskan_kepada_user_id) {
      // Opsional: return empty jika belum ada penerima
      return res.status(404).json({ error: 'Disposisi belum diteruskan ke bawahan' });
    }

    // Ambil feedback dari bawahan (user_id = diteruskan_kepada_user_id)
    const { data: feedback, error: feedbackError } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          diteruskan_kepada_jabatan,
          dengan_hormat_harap,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          diterima_tanggal,
          nomor_agenda,
          created_by,
          status
        ),
        surat_masuk (
          id,
          nomor_surat,
          asal_instansi,
          tanggal_surat,
          keterangan,
          diterima_tanggal,
          nomor_agenda
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
      .eq('disposisi_id', disposisiId)
      .eq('user_id', disposisi.diteruskan_kepada_user_id) // Filter berdasarkan user bawahan
      .single(); // Karena diasumsikan hanya satu feedback per disposisi per user

    if (feedbackError) {
      console.error('Error fetching bawahan feedback:', feedbackError);
      // Jika tidak ditemukan, kirim 404
      if (feedbackError.code === 'PGRST116') { // Kode untuk single() not found
        return res.status(404).json({ error: 'Feedback dari bawahan belum diterima' });
      }
      return res.status(500).json({ error: feedbackError.message });
    }

    if (!feedback) {
      return res.status(404).json({ error: 'Feedback dari bawahan belum diterima' });
    }

    const files = feedback.feedback_files?.map(file => {
      let fileUrl = `/api/feedback/file/${file.id}`;

      if (file.file_path && file.file_path.startsWith('http')) {
        fileUrl = file.file_path;
      } else if (file.storage_path) {
        const { data: { publicUrl } } = supabase.storage
          .from('surat-photos')
          .getPublicUrl(file.storage_path);
        fileUrl = publicUrl;
      }

      return {
        id: file.id,
        filename: file.file_original_name,
        size: file.file_size,
        type: file.file_type,
        url: fileUrl
      };
    }) || [];

    res.json({
      ...feedback,
      files,
      file_count: files.length,
      has_files: files.length > 0
    });

  } catch (error) {
    console.error('Server error in fetching bawahan feedback:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:role/disposisi/teruskan/:disposisiId', authenticateToken, async (req, res) => {
  try {
    const { role } = req.params;
    const { disposisiId } = req.params;
    const {
      diteruskan_kepada_user_id,
      diteruskan_kepada_jabatan,
      catatan_atasan,
      tipe_penerusan
    } = req.body;

    if (!['user', 'sekretaris'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }

    const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

    // ✅ Role check
    if (req.user.role !== 'user' && req.user.role !== 'sekretaris') {
      return res.status(403).json({ error: 'Hanya Sekretaris dan Kabid yang bisa meneruskan disposisi' });
    }

    // Ambil disposisi yang akan diteruskan
    const { data: disposisiAwal, error: disposisiError } = await supabase
      .from('disposisi')
      .select('*')
      .eq('id', disposisiId)
      .single();

    if (disposisiError || !disposisiAwal) {
      return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
    }

    // ✅ Hanya bisa meneruskan disposisi yang ditujukan kepada dirinya
    if (disposisiAwal.disposisi_kepada_jabatan !== req.user.jabatan) {
      return res.status(403).json({ error: 'Disposisi ini bukan untuk Anda' });
    }

    let logKeterangan = '';
    let logKeUserId = null;
    let updateData;
    if (req.user.role === 'sekretaris') {

      if (tipe_penerusan === 'jabatan') {
        if (!diteruskan_kepada_jabatan) {
          return res.status(400).json({ error: 'Jabatan penerima wajib dipilih' });
        }
        updateData = {
          disposisi_kepada_jabatan: diteruskan_kepada_jabatan,
          status: 'belum dibaca',
          status_dari_bawahan: 'belum dibaca'
        };
        logKeterangan = `Disposisi diteruskan dari ${req.user.jabatan} ke jabatan ${diteruskan_kepada_jabatan}`;
      }
      else {
        const { data: penerima, error: penerimaError } = await supabase
          .from('users')
          .select('id, name, bidang, jabatan')
          .eq('id', diteruskan_kepada_user_id)
          .single();

        if (penerimaError || !penerima) {
          return res.status(404).json({ error: 'User penerima tidak ditemukan' });
        }

        if (req.user.role !== 'sekretaris' && penerima.bidang !== req.user.bidang) {
          return res.status(403).json({ error: 'Hanya bisa meneruskan ke user di bidang yang sama' });
        }

        updateData = {
          diteruskan_kepada_user_id: penerima.id,
          diteruskan_kepada_jabatan: penerima.jabatan,
          diteruskan_kepada_nama: penerima.name,
          catatan_atasan,
          [statusField]: 'diteruskan',
          status_dari_bawahan: 'belum dibaca',
          updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        };
        logKeterangan = `Disposisi diteruskan dari ${req.user.jabatan} ke ${penerima.name}`;
        logKeUserId = penerima.id;
      }
    } else {
      const { data: penerima, error: penerimaError } = await supabase
        .from('users')
        .select('id, name, bidang, jabatan')
        .eq('id', diteruskan_kepada_user_id)
        .single();

      if (penerimaError || !penerima) {
        return res.status(404).json({ error: 'User penerima tidak ditemukan' });
      }

      if (penerima.bidang !== req.user.bidang) {
        return res.status(403).json({ error: 'Hanya bisa meneruskan ke user di bidang yang sama' });
      }

      updateData = {
        diteruskan_kepada_user_id: penerima.id,
        diteruskan_kepada_jabatan: penerima.jabatan,
        diteruskan_kepada_nama: penerima.name,
        catatan_atasan,
        [statusField]: 'diteruskan',
        status_dari_bawahan: 'belum dibaca',
        updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
      };
      logKeterangan = `Disposisi diteruskan dari ${req.user.jabatan} ke ${penerima.name}`;
      logKeUserId = penerima.id;
    }

    const { data: updatedDisposisi, error: updateError } = await supabase
      .from('disposisi')
      .update(updateData)
      .eq('id', disposisiId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating disposisi:', updateError);
      return res.status(400).json({ error: updateError.message });
    }

    // 🔥 Tambahkan log status
    await supabase
      .from('disposisi_status_log')
      .insert({
        disposisi_id: disposisiId,
        status: 'diteruskan',
        oleh_user_id: req.user.id,
        ke_user_id: logKeUserId,
        keterangan: logKeterangan
      });

    res.status(200).json({
      message: 'Disposisi berhasil diteruskan',
      data: {
        ...updatedDisposisi,
        disposisi_sebelumnya: disposisiAwal
      }
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk mendapatkan list jabatan
app.get('/api/jabatan/list', authenticateToken, async (req, res) => {
  try {
    // ✅ Ambil dari master data jabatan atau dari database
    const jabatanList = [
      'Kabid Perekonomian, Infrastruktur, dan Kewilayahan',
      'Kabid Pendanaan, Pengendalian, dan Evaluasi',
      'Kabid Pemerintahan dan Pengembangan Manusia',
      'Kabid Penelitian dan Pengembangan',
      'Kasubag Keuangan',
      'Kasubag Umum dan Kepegawaian',
    ];

    res.json(jabatanList);
  } catch (error) {
    console.error('Error fetching jabatan:', error);
    res.status(500).json({ error: 'Gagal memuat daftar jabatan' });
  }
});

app.get('/api/:role/feedback/:feedbackId/edit', authenticateToken, async (req, res) => {
  try {
    const { role } = req.params;
    const { feedbackId } = req.params;
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;

    if (!['user', 'sekretaris'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }

    const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

    // Ambil detail feedback dengan validasi kepemilikan
    const { data: feedback, error } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          sifat,
          disposisi_kepada_jabatan,
          dengan_hormat_harap,
          created_at,
          status,
          ${statusField},
          surat_masuk (
            id,
            keterangan
          )
        ),
        feedback_files (
          id,
          file_original_name,
          file_size,
          file_type,
          file_path,
          storage_path
        )
      `)
      .eq('id', feedbackId)
      .eq('user_id', userId)
      .eq('user_jabatan', userJabatan)
      .single();

    if (error || !feedback) {
      return res.status(404).json({
        error: 'Feedback tidak ditemukan atau tidak ada akses untuk mengedit'
      });
    }

    // Transform file data
    const transformedData = transformFeedbackData(feedback ? [feedback] : [])[0];

    res.json({
      message: 'Berhasil mengambil detail feedback untuk edit',
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Endpoint untuk kabid mengedit feedback
app.put('/api/:role/feedback/:feedbackId', authenticateToken, upload.array('new_feedback_files', 5), async (req, res) => {
  try {
    const { role } = req.params;
    const { feedbackId } = req.params;
    const { notes, status, remove_file_ids } = req.body;
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;
    const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

    console.log('Edit feedback request:', {
      feedbackId,
      notes,
      status,
      statusField,
      newFilesCount: req.files?.length,
      removeFileIds: remove_file_ids
    });

    // Validasi input - sama seperti di create feedback
    if (!notes || notes.trim() === '') {
      return res.status(400).json({
        error: 'Notes/catatan feedback wajib diisi'
      });
    }

    if (!status || !['diproses', 'selesai'].includes(status)) {
      return res.status(400).json({
        error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
      });
    }

    // Pastikan feedback ada dan milik user
    const { data: existingFeedback, error: feedbackError } = await supabase
      .from('feedback_disposisi')
      .select(`
        *,
        disposisi (
          id,
          perihal,
          created_by,
          surat_masuk_id,
          disposisi_kepada_jabatan,
          status,
          ${statusField}
        )
      `)
      .eq('id', feedbackId)
      .eq('user_id', userId)
      .eq('user_jabatan', userJabatan)
      .single();

    if (feedbackError || !existingFeedback) {
      return res.status(404).json({
        error: 'Feedback tidak ditemukan atau tidak ada akses untuk mengedit'
      });
    }

    // Update data feedback
    const updateData = {
      notes: notes.trim(),
      updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

    const { data: updatedFeedback, error: updateError } = await supabase
      .from('feedback_disposisi')
      .update(updateData)
      .eq('id', feedbackId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating feedback:', updateError);
      return res.status(400).json({ error: updateError.message });
    }

    console.log('Feedback berhasil diupdate:', updatedFeedback);

    // Handle penghapusan file lama jika ada
    let removedFileCount = 0;
    if (remove_file_ids) {
      try {
        const removeIds = Array.isArray(remove_file_ids) ? remove_file_ids : [remove_file_ids];

        // Ambil data file yang akan dihapus untuk mendapatkan storage_path
        const { data: filesToRemove, error: fetchError } = await supabase
          .from('feedback_files')
          .select('id, storage_path')
          .eq('feedback_id', feedbackId)
          .in('id', removeIds);

        if (!fetchError && filesToRemove && filesToRemove.length > 0) {
          // Hapus dari storage
          const storageFilesToDelete = filesToRemove
            .filter(file => file.storage_path)
            .map(file => file.storage_path);

          if (storageFilesToDelete.length > 0) {
            const { error: storageError } = await supabase.storage
              .from('surat-photos')
              .remove(storageFilesToDelete);

            if (storageError) {
              console.error('Error removing files from storage:', storageError);
            }
          }

          // Hapus dari database
          const { error: removeError } = await supabase
            .from('feedback_files')
            .delete()
            .eq('feedback_id', feedbackId)
            .in('id', removeIds);

          if (removeError) {
            console.error('Error removing files from database:', removeError);
          } else {
            removedFileCount = filesToRemove.length;
            console.log(`${removedFileCount} files removed successfully`);
          }
        }
      } catch (removeError) {
        console.error('Error in file removal process:', removeError);
      }
    }

    // Upload file baru jika ada - sama seperti di create feedback
    let newFileCount = 0;
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file =>
        uploadToSupabaseStorage(file, 'feedback-disposisi', req.headers.authorization?.replace('Bearer ', ''))
      );

      try {
        const uploadResults = await Promise.all(uploadPromises);

        // Simpan data file baru ke database
        const fileData = uploadResults.map(result => ({
          feedback_id: feedbackId,
          disposisi_id: existingFeedback.disposisi_id,
          file_path: result.publicUrl,
          file_filename: result.fileName,
          file_original_name: result.originalName,
          file_size: result.size,
          file_type: result.mimetype,
          storage_path: result.fileName,
          created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        }));

        const { error: fileError } = await supabase
          .from('feedback_files')
          .insert(fileData);

        if (fileError) {
          console.error('Error saving new files:', fileError);
          // Rollback: hapus files dari storage
          const filesToDelete = uploadResults.map(r => r.fileName);
          await supabase.storage.from('surat-photos').remove(filesToDelete);

          return res.status(400).json({ error: 'Gagal menyimpan file baru: ' + fileError.message });
        }

        newFileCount = req.files.length;
        console.log(`${newFileCount} new files uploaded successfully`);
      } catch (uploadError) {
        console.error('Upload error:', uploadError);
        return res.status(400).json({ error: 'Gagal upload file baru: ' + uploadError.message });
      }
    }

    // Update status disposisi - sama seperti di create feedback
    const { error: updateDisposisiError } = await supabase
      .from('disposisi')
      .update({
        status: status,
        [statusField]: status // Update status sesuai pilihan user
      })
      .eq('id', existingFeedback.disposisi_id);

    if (updateDisposisiError) {
      console.error('Error updating disposisi status:', updateDisposisiError);
      return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
    }

    console.log('Status disposisi diupdate menjadi:', status);

    // 🔧 TAMBAHAN: Insert ke disposisi_status_log
    const statusLogData = {
      disposisi_id: existingFeedback.disposisi_id,
      status: status, // status yang dikirimkan ('diproses' atau 'selesai')
      oleh_user_id: userId,
      keterangan: `Disposisi ${status} melalui update feedback oleh ${userJabatan}`
    };

    const { error: logError } = await supabase
      .from('disposisi_status_log')
      .insert([statusLogData]);

    if (logError) {
      console.error('Error creating status log:', logError);
      // Tidak throw error karena update feedback sudah berhasil
    }

    // Hitung total file setelah update
    const { data: remainingFiles, error: countError } = await supabase
      .from('feedback_files')
      .select('id')
      .eq('feedback_id', feedbackId);

    const totalFiles = remainingFiles ? remainingFiles.length : 0;

    res.json({
      message: `Feedback berhasil diperbarui dan status disposisi diupdate menjadi "${status}"`,
      data: {
        ...updatedFeedback,
        status_disposisi: status,
        file_count: totalFiles,
        has_files: totalFiles > 0,
        changes: {
          removed_files: removedFileCount,
          added_files: newFileCount
        }
      }
    });

  } catch (error) {
    console.error('Server error in feedback update:', error);
    res.status(500).json({ error: error.message });
  }
});

if (!Handlebars.helpers.eq) {
  Handlebars.registerHelper('eq', (a, b) => a === b);
}

if (!Handlebars.helpers.includes) {
  Handlebars.registerHelper('ek', (a, b) => a === b);
}

const prepareTemplateData = (disposisi) => {

  return {
    ...disposisi,
  };
};

// 📄 Endpoint untuk generate PDF
app.get('/api/disposisi/:id/pdf', authenticateToken, async (req, res) => {
  try {
    console.log('📥 Permintaan PDF untuk surat ID:', req.params.id);

    const { data: disposisi, error } = await supabase
      .from('disposisi')
      .select(`
        *
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !disposisi) {
      console.error('❌ disposisi tidak ditemukan atau Supabase error:', error?.message || error);
      return res.status(404).json({ error: 'disposisi not found', detail: error?.message });
    }

    const templatePath = path.join(__dirname, 'templates', 'disposisi.html');
    const htmlTemplate = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(htmlTemplate);

    const preparedData = prepareTemplateData(disposisi);


    const html = template({
      ...preparedData,
    });

    // ✅ Perbaikan: Tambahkan args penting
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    console.log('✅ PDF berhasil dibuat. Mengirim ke client...');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="disposisi-${disposisi.nomor_surat || disposisi.id}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error('❌ Gagal generate PDF:', err);
    res.status(500).json({ error: 'Gagal membuat PDF. Cek log server.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});