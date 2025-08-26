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

  console.log('Uploading file:', fileName);
  console.log('User token exists:', !!userToken); // ✅ Debug log

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

    console.log('Login request:', req.body) // debug isi
    console.log('User from Supabase:', user) // debug hasil query
    console.log('User password dari Supabase:', user.password)

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
    console.log('Request body:', req.body); // ✅ Debug log
    console.log('Files received:', req.files ? req.files.length : 0); // ✅ Debug log

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
      console.log('Supabase error:', suratError); // Debug log
      return res.status(400).json({ error: suratError.message });
    }

    console.log('Surat berhasil dibuat:', suratResult); // Debug log

    // Upload files ke Supabase Storage
    let photoCount = 0;
    if (req.files && req.files.length > 0) {
      // PASS USER INFO KE UPLOAD FUNCTION
      console.log('User info:', req.user); // Debug log
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
    console.log('Server error:', error); // ✅ Debug log
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
    console.error(error);
    res.status(500).json({ message: 'Gagal menghapus surat', detail: error.message });
  }
});

// 😁 Endpoint untuk admin membuat surat keluar
app.post('/api/admin/surat-keluar/buat', authenticateToken, requireAdmin, upload.array('lampiran', 10), async (req, res) => {
  try {
    console.log('Request body:', req.body); // ✅ Debug log
    console.log('Files received:', req.files ? req.files.length : 0); // ✅ Debug log

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

    console.log('Surat keluar berhasil dibuat:', suratResult); // Debug log

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
    console.log('Server error:', error); // ✅ Debug log
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
app.get('/api/kabid/disposisi/saya', authenticateToken, async (req, res) => {
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

// 📷 Endpoint untuk kabid mengakses foto/dokumen (sama dengan kepala)
app.get('/api/kabid/surat-masuk/photo/:photoId', authenticateToken, async (req, res) => {
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

async function updateDisposisiStatus(id, newStatus, newStatusKabid, newStatusLog, newKeterangan, userId) {
  const { data, error } = await supabase
    .from('disposisi')
    .update({ status: newStatus, status_dari_kabid: newStatusKabid })
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

// Endpoint untuk menandai dalam proses
app.put('/api/kabid/disposisi/:id/proses', authenticateToken, async (req, res) => {
  await handleDisposisiStatusUpdate(req, res, {
    requiredStatus: 'diterima oleh kabid',
    newStatus: 'diproses',
    newStatusKabid: 'diproses',
    newStatusLog: 'diproses',
    newKeterangan: 'Sedang melaksanakan proses',
    successMessage: 'Status disposisi diperbarui menjadi dalam proses'
  });
});

// Endpoint untuk menandai selesai
app.put('/api/kabid/disposisi/:id/selesai', authenticateToken, async (req, res) => {
  await handleDisposisiStatusUpdate(req, res, {
    requiredStatus: 'diproses',
    newStatus: 'selesai',
    newStatusKabid: 'selesai',
    newStatusLog: 'selesai',
    newKeterangan: 'Tugas disposisi telah selesai',
    successMessage: 'Status disposisi diperbarui menjadi selesai'
  });
});

// Endpoint untuk kabid memberikan feedback ke kepala (dengan update status)
app.post('/api/kabid/disposisi/:disposisiId/feedback', authenticateToken, upload.array('feedback_files', 5), async (req, res) => {
  try {
    const { disposisiId } = req.params;
    const { notes, status, status_dari_kabid } = req.body; // Tambahkan status dari request body
    const userJabatan = req.user.jabatan;

    console.log('Feedback request:', { disposisiId, notes, status, status_dari_kabid, filesCount: req.files?.length });

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
    if (!status_dari_kabid || !['diproses', 'selesai'].includes(status_dari_kabid)) {
      return res.status(400).json({
        error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
      });
    }

    // Pastikan disposisi ada dan ditujukan ke jabatan user
    const { data: disposisi, error: disposisiError } = await supabase
      .from('disposisi')
      .select('id, disposisi_kepada_jabatan, perihal, created_by, surat_masuk_id, status, status_dari_kabid')
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
          status_dari_kabid: status_dari_kabid
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

// 📋 Endpoint untuk kabid melihat feedback yang sudah dikirim
app.get('/api/kabid/feedback/saya', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;

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
          status_dari_kabid,
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
      console.error('Error fetching kabid feedback:', error);
      return res.status(400).json({ error: error.message });
    }

    // Transform data dengan file info
    const transformedData = feedback?.map(item => {
      const files = item.feedback_files?.map(file => {
        let fileUrl = `/api/kabid/feedback/file/${file.id}`;

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
      message: 'Berhasil mengambil feedback kabid',
      data: transformedData,
      total: transformedData.length
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📁 Endpoint untuk kabid mengakses file feedback
app.get('/api/kabid/feedback/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;

    console.log('Feedback file request for ID:', fileId);

    // Pastikan file milik user yang request
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

    if (error) {
      console.error('Database error:', error);
      return res.status(404).json({ error: 'File tidak ditemukan: ' + error.message });
    }

    if (!file) {
      return res.status(404).json({ error: 'File tidak ditemukan atau tidak ada akses' });
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
    console.error('Server error in feedback file endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Endpoint untuk kabid mendapatkan detail feedback yang akan diedit
app.get('/api/kabid/feedback/:feedbackId/edit', authenticateToken, async (req, res) => {
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
          status_dari_kabid,
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
      let fileUrl = `/api/kabid/feedback/file/${file.id}`;

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

// ✏️ Endpoint untuk kabid mengedit feedback
app.put('/api/kabid/feedback/:feedbackId', authenticateToken, upload.array('new_feedback_files', 5), async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { notes, status, status_dari_kabid, remove_file_ids } = req.body;
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;

    console.log('Edit feedback request:', {
      feedbackId,
      notes,
      status,
      status_dari_kabid,
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
          status_dari_kabid
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
        status_dari_kabid: status // Update status sesuai pilihan user
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

// 🗑️ Endpoint untuk kabid menghapus file feedback secara individual
app.delete('/api/kabid/feedback/file/:fileId', authenticateToken, async (req, res) => {
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
app.post('/api/kabid/disposisi/teruskan/:disposisiId', authenticateToken, async (req, res) => {
  try {
    const { disposisiId } = req.params;
    const { diteruskan_kepada_user_id, catatan_kabid } = req.body;

    // ✅ Role check
    if (req.user.role !== 'user') {
      return res.status(403).json({ error: 'Hanya Kabid yang bisa meneruskan disposisi' });
    }

    if (!diteruskan_kepada_user_id) {
      return res.status(400).json({ error: 'Penerima disposisi wajib dipilih' });
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

    // Pastikan disposisi ditujukan ke kabid ini
    if (disposisiAwal.disposisi_kepada_jabatan !== req.user.jabatan) {
      return res.status(403).json({ error: 'Disposisi ini bukan untuk Anda' });
    }

    // Cek penerima di bidang yang sama
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

    // 🔥 Update disposisi dengan penerima baru dan tambahkan catatan kabid
    const updateData = {
      diteruskan_kepada_user_id,
      diteruskan_kepada_jabatan: penerima.jabatan,
      diteruskan_kepada_nama: penerima.name,
      catatan_kabid,
      status_dari_kabid: 'diteruskan',
      status_dari_bawahan: 'belum dibaca',
      updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
    };

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
        ke_user_id: diteruskan_kepada_user_id,
        keterangan: `Disposisi diteruskan dari ${req.user.jabatan} ke ${penerima.name}`
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


// GET /api/kabid/bawahan
app.get('/api/kabid/bawahan', authenticateToken, async (req, res) => {
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

// GET /api/kabid/disposisi/:disposisiId/feedback-bawahan
app.get('/api/kabid/disposisi/:disposisiId/feedback-bawahan', authenticateToken, async (req, res) => {
  try {
    const { disposisiId } = req.params;

    // ✅ Role check - hanya untuk Kabid
    if (req.user.role !== 'user') { // Sesuaikan dengan role Kabid Anda
      return res.status(403).json({ error: 'Hanya Kabid yang bisa mengakses feedback bawahan' });
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

// =======================================KABID END=========================================//

// =======================================STAFF START=========================================//
// endpoint staff untuk memberikan feedback
app.post('/api/bawahan/disposisi/:disposisiId/feedback', authenticateToken, upload.array('feedback_files', 5), async (req, res) => {
  try {
    const { disposisiId } = req.params;
    const { notes, status, status_dari_bawahan } = req.body;
    const userId = req.user.id;
    const userJabatan = req.user.jabatan;

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
          catatan_kabid,
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
          catatan_kabid,
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




// ✅ Daftarkan Handlebars helpers di awal
if (!Handlebars.helpers.eq) {
  Handlebars.registerHelper('eq', (a, b) => a === b);
}

if (!Handlebars.helpers.tanggalIndo) {
  Handlebars.registerHelper('tanggalIndo', function (value) {
    if (!value) return '-';
    const bulan = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const date = new Date(value);
    if (isNaN(date)) return '-';
    return `${date.getDate()} ${bulan[date.getMonth()]} ${date.getFullYear()}`;
  });
}

// 🔥 NEW → helper untuk cek apakah array berisi nilai tertentu
if (!Handlebars.helpers.includes) {
  Handlebars.registerHelper('includes', function (array, value) {
    return Array.isArray(array) && array.includes(value);
  });
}

// 🔧 Fungsi bantu untuk olah tindakan
const prepareTemplateData = (surat) => {
  const tindakanArray = typeof surat.tindakan === 'string'
    ? surat.tindakan.split(',').map(item => item.trim())
    : surat.tindakan || [];

  const tindakanFlags = {
    tanggapan_dan_saran: tindakanArray.includes('Tanggapan dan Saran'),
    wakili_hadir_terima: tindakanArray.includes('Wakili / Hadir / Terima'),
    mendampingi_saya: tindakanArray.includes('Mendampingi Saya'),
    untuk_ditindaklanjuti: tindakanArray.includes('Untuk Ditindaklanjuti'),
    pelajari_telaah_sarannya: tindakanArray.includes("Pelajari / Telaa'h / Sarannya"),
    untuk_dikaji_sesuai_ketentuan: tindakanArray.includes('Untuk Dikaji Sesuai dengan Ketentuan'),
    untuk_dibantu_dipertimbangkan: tindakanArray.includes('Untuk Dibantu / Dipertimbangkan / Sesuai dengan Ketentuan'),
    selesaikan_proses_ketentuan: tindakanArray.includes('Selesaikan / Proses Sesuai Ketentuan'),
    monitor_realisasi_perkembangan: tindakanArray.includes('Monitor Realisasinya / Perkembangannya'),
    siapkan_pointers_sambutan: tindakanArray.includes('Siapkan Pointers / Sambutan / Bahan'),
    menghadap_informasi: tindakanArray.includes('Menghadap / Informasinya'),
    membaca_file_referensi: tindakanArray.includes('Membaca / File / Referensi'),
    agendakan_jadwalkan_koordinasi: tindakanArray.includes('Agendakan / Jadwalkan / Koordinasikan')
  };

  return {
    ...surat,
    tindakanArray,   // ← dibutuhkan oleh {{includes tindakanArray "..."}}
    tindakan: tindakanFlags
  };
};

// 📄 Endpoint untuk generate PDF
app.get('/api/surat/:id/pdf', authenticateToken, async (req, res) => {
  try {
    console.log('📥 Permintaan PDF untuk surat ID:', req.params.id);

    const { data: surat, error } = await supabase
      .from('surat_masuk')
      .select(`
        *,
        users!surat_masuk_created_by_fkey (name, jabatan),
        processed_user:users!surat_masuk_processed_by_fkey (name, jabatan)
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !surat) {
      console.error('❌ Surat tidak ditemukan atau Supabase error:', error?.message || error);
      return res.status(404).json({ error: 'Surat not found', detail: error?.message });
    }

    const templatePath = path.join(__dirname, 'templates', 'disposisi.html');
    const htmlTemplate = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(htmlTemplate);

    const preparedData = prepareTemplateData(surat);
    const tglDiterima = surat.created_at
      ? new Date(surat.created_at).toLocaleDateString('id-ID')
      : '-';

    const html = template({
      ...preparedData,
      tgl_diterima: tglDiterima,
      processed_by: surat.processed_user?.name || '-',
      jabatan: surat.processed_user?.jabatan || '-'
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
      `attachment; filename="disposisi-${surat.nomor_surat || surat.id}.pdf"`
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