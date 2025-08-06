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

const app = express();
const PORT = process.env.PORT || 5000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(cors());
app.use(express.json());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'bapelit123';

// Auth middleware
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

// Admin middleware - hanya admin yang bisa akses
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Login endpoint (tetap sama, tapi tambah role dalam response)
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

    // Generate JWT token (include role)
    // Di endpoint login, tambahkan bidang
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        jabatan: user.jabatan,
        bidang: user.bidang, // ✅ Tambahan
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

// Endpoint untuk admin membuat akun baru
app.post('/api/admin/users', authenticateToken, async (req, res) => {
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

// 🆕 Endpoint untuk admin melihat semua user
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
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



// 🆕 Endpoint untuk admin menghapus user
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
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

// 🆕 Endpoint untuk admin reset password user
app.put('/api/admin/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
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

// Get User (untuk dropdown, bisa diakses semua user yang login)
app.get('/api/users/basic', authenticateToken, async (req, res) => {
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

// Create incoming mail
const multer = require('multer');

// Setup multer untuk upload multiple files
const storage = multer.memoryStorage(); // Simpan di memory dulu

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 10
  },
  fileFilter: fileFilter
});

// ===== FUNGSI HELPER UPLOAD KE SUPABASE =====
const uploadToSupabaseStorage = async (file, folder = 'surat-masuk') => {
  const fileExt = path.extname(file.originalname);
  const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;
  
  const { data, error } = await supabase.storage
    .from('surat-photos') // nama bucket
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) {
    throw new Error('Upload failed: ' + error.message);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('surat-photos')
    .getPublicUrl(fileName);

  return {
    fileName: data.path,
    publicUrl: publicUrl,
    size: file.size,
    originalName: file.originalname
  };
};


// POST endpoint dengan upload multiple photos
// ===== GANTI ENDPOINT POST SURAT-MASUK =====
app.post('/api/surat-masuk', authenticateToken, upload.array('photos', 10), async (req, res) => {
  try {
    const {
      asal_instansi,
      nomor_surat,
      tujuan_jabatan,
      keterangan,
      perihal,
      disposisi_kepada,
      tindakan,
      sifat,
      catatan
    } = req.body;

    // Validasi input
    if (!asal_instansi || !nomor_surat || !tujuan_jabatan) {
      return res.status(400).json({
        error: 'Asal instansi, nomor surat, dan tujuan jabatan wajib diisi'
      });
    }

    // Insert surat dulu
    const suratData = {
      asal_instansi,
      nomor_surat,
      tujuan_jabatan,
      keterangan,
      perihal: perihal || null,
      disposisi_kepada: disposisi_kepada || null,
      tindakan: tindakan || null,
      sifat: sifat || null,
      catatan: catatan || null,
      created_by: req.user.id,
      status: 'pending',
      created_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    };

    const { data: suratResult, error: suratError } = await supabase
      .from('surat_masuk')
      .insert([suratData])
      .select()
      .single();

    if (suratError) {
      return res.status(400).json({ error: suratError.message });
    }

    // Upload photos ke Supabase Storage
    let photoCount = 0;
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file => uploadToSupabaseStorage(file, 'surat-masuk'));
      
      try {
        const uploadResults = await Promise.all(uploadPromises);
        
        // Simpan data foto ke database
        const photoData = uploadResults.map(result => ({
          surat_id: suratResult.id,
          foto_path: result.publicUrl, // ✅ Simpan public URL
          foto_filename: result.fileName,
          foto_original_name: result.originalName,
          file_size: result.size,
          storage_path: result.fileName, // path di Supabase Storage
          created_at: new Date().toISOString()
        }));

        const { error: photoError } = await supabase
          .from('surat_photos')
          .insert(photoData);

        if (photoError) {
          // Rollback: hapus surat dan files dari storage
          await supabase.from('surat_masuk').delete().eq('id', suratResult.id);
          
          // Hapus files dari Supabase Storage
          const filesToDelete = uploadResults.map(r => r.fileName);
          await supabase.storage.from('surat-photos').remove(filesToDelete);
          
          return res.status(400).json({ error: 'Gagal menyimpan foto: ' + photoError.message });
        }

        photoCount = req.files.length;
      } catch (uploadError) {
        // Rollback surat jika upload gagal
        await supabase.from('surat_masuk').delete().eq('id', suratResult.id);
        return res.status(400).json({ error: 'Gagal upload foto: ' + uploadError.message });
      }
    }

    // Create notifications (sama seperti sebelumnya)
    const { data: targetUsers } = await supabase
      .from('users')
      .select('id')
      .eq('jabatan', tujuan_jabatan);

    if (targetUsers && targetUsers.length > 0) {
      const notifications = targetUsers.map(user => ({
        user_id: user.id,
        surat_id: suratResult.id,
        message: `Surat masuk baru dari ${asal_instansi} untuk jabatan ${tujuan_jabatan}`,
        is_read: false,
        created_at: new Date().toISOString()
      }));

      await supabase.from('notifications').insert(notifications);
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

// Endpoint untuk mengirim surat ke jabatan lain
// Endpoint untuk mengirim surat ke jabatan lain
app.post('/api/surat/:id/send-to-jabatan', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { tujuan_jabatan, disposisi_kepada } = req.body;

    // Validasi input
    if (!tujuan_jabatan || !disposisi_kepada) {
      return res.status(400).json({
        error: 'Tujuan jabatan dan disposisi kepada wajib diisi'
      });
    }

    // Validasi apakah surat exists
    const { data: existingSurat, error: fetchError } = await supabase
      .from('surat_masuk')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existingSurat) {
      return res.status(404).json({
        error: 'Surat tidak ditemukan'
      });
    }

    // Cek apakah surat sudah diproses sebelumnya
    if (existingSurat.status === 'sent' || existingSurat.status === 'forwarded') {
      return res.status(400).json({
        error: 'Surat sudah dikirim atau diteruskan sebelumnya'
      });
    }

    // Update data surat dengan tujuan jabatan dan disposisi baru
    const updateData = {
      tujuan_jabatan,
      disposisi_kepada,
      processed_at: new Date().toISOString(),
    };

    const { data: updatedSurat, error: updateError } = await supabase
      .from('surat_masuk')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return res.status(400).json({
        error: 'Gagal mengupdate surat: ' + updateError.message
      });
    }

    // Hapus notifikasi lama untuk jabatan sebelumnya jika ada
    if (existingSurat.tujuan_jabatan !== tujuan_jabatan) {
      const { data: oldTargetUsers } = await supabase
        .from('users')
        .select('id')
        .eq('jabatan', existingSurat.tujuan_jabatan);

      if (oldTargetUsers && oldTargetUsers.length > 0) {
        const oldUserIds = oldTargetUsers.map(user => user.id);
        await supabase
          .from('notifications')
          .delete()
          .eq('surat_id', id)
          .in('user_id', oldUserIds);
      }
    }

    // Buat notifikasi untuk jabatan tujuan baru
    console.log('Mencari users dengan jabatan:', tujuan_jabatan);
    const { data: targetUsers, error: userFetchError } = await supabase
      .from('users')
      .select('id, name, jabatan')
      .eq('jabatan', tujuan_jabatan);

    console.log('Target users found:', targetUsers);
    console.log('User fetch error:', userFetchError);

    if (userFetchError) {
      console.error('Error fetching target users:', userFetchError);
    }

    let notificationCount = 0;
    if (targetUsers && targetUsers.length > 0) {
      const notifications = targetUsers.map(user => ({
        user_id: user.id,
        surat_id: id, // jangan parseInt, biarkan sebagai string
        message: `Surat dari ${existingSurat.asal_instansi} telah dikirim ke jabatan ${tujuan_jabatan} (No. ${existingSurat.nomor_surat})`,
        is_read: false,
        created_at: new Date().toISOString()
      }));

      console.log('Notifications to insert:', notifications);

      const { data: insertedNotifications, error: notifError } = await supabase
        .from('notifications')
        .insert(notifications)
        .select();

      if (notifError) {
        console.error('Error creating notifications:', notifError);
        console.error('Notification error details:', JSON.stringify(notifError, null, 2));
      } else {
        console.log('Notifications created successfully:', insertedNotifications);
        notificationCount = insertedNotifications ? insertedNotifications.length : 0;
      }
    } else {
      console.log('No target users found for jabatan:', tujuan_jabatan);
    }

    // Buat notifikasi juga untuk jabatan disposisi_kepada jika berbeda
    let disposisiNotificationCount = 0;
    if (disposisi_kepada && disposisi_kepada !== tujuan_jabatan) {
      console.log('Mencari users untuk disposisi kepada:', disposisi_kepada);
      const { data: disposisiUsers, error: disposisiUserError } = await supabase
        .from('users')
        .select('id, name, jabatan')
        .eq('jabatan', disposisi_kepada);

      console.log('Disposisi users found:', disposisiUsers);
      console.log('Disposisi user fetch error:', disposisiUserError);

      if (disposisiUserError) {
        console.error('Error fetching disposisi users:', disposisiUserError);
      }

      if (disposisiUsers && disposisiUsers.length > 0) {
        const disposisiNotifications = disposisiUsers.map(user => ({
          user_id: user.id,
          surat_id: id, // jangan parseInt, biarkan sebagai string
          message: `Anda mendapat disposisi surat dari ${existingSurat.asal_instansi} (No. ${existingSurat.nomor_surat})`,
          is_read: false,
          created_at: new Date().toISOString()
        }));

        console.log('Disposisi notifications to insert:', disposisiNotifications);

        const { data: insertedDisposisiNotifications, error: disposisiNotifError } = await supabase
          .from('notifications')
          .insert(disposisiNotifications)
          .select();

        if (disposisiNotifError) {
          console.error('Error creating disposisi notifications:', disposisiNotifError);
          console.error('Disposisi notification error details:', JSON.stringify(disposisiNotifError, null, 2));
        } else {
          console.log('Disposisi notifications created successfully:', insertedDisposisiNotifications);
          disposisiNotificationCount = insertedDisposisiNotifications ? insertedDisposisiNotifications.length : 0;
        }
      } else {
        console.log('No disposisi users found for jabatan:', disposisi_kepada);
      }
    }

    // Log activity untuk audit trail
    const activityData = {
      surat_id: id, // jangan parseInt, biarkan sebagai string
      user_id: req.user.id,
      action: 'send_to_jabatan',
      details: `Surat dikirim ke jabatan ${tujuan_jabatan} dengan disposisi kepada ${disposisi_kepada}`,
      old_values: JSON.stringify({
        tujuan_jabatan: existingSurat.tujuan_jabatan,
        disposisi_kepada: existingSurat.disposisi_kepada,
        status: existingSurat.status
      }),
      new_values: JSON.stringify({
        tujuan_jabatan,
        disposisi_kepada,
      }),
      created_at: new Date().toISOString()
    };

    await supabase
      .from('surat_activities')
      .insert([activityData]);

    res.status(200).json({
      message: `Surat berhasil dikirim ke jabatan ${tujuan_jabatan}`,
      data: {
        ...updatedSurat,
        target_users_count: targetUsers ? targetUsers.length : 0,
        notification_count: notificationCount,
        disposisi_notification_count: disposisiNotificationCount,
        sent_to_jabatan: tujuan_jabatan,
        disposisi_kepada: disposisi_kepada
      }
    });

  } catch (error) {
    console.error('Error in send-to-jabatan:', error);
    res.status(500).json({
      error: 'Terjadi kesalahan server: ' + error.message
    });
  }
});

// GET endpoint untuk mengambil semua surat masuk dengan info foto
app.get('/api/surat-masuk/all', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('surat_masuk')
      .select(`
        *,
        users!surat_masuk_created_by_fkey (name, jabatan),
        processed_user:users!surat_masuk_processed_by_fkey (name, jabatan),
        surat_photos (id, foto_filename, foto_original_name, file_size)
      `)
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
        url: `/api/surat-masuk/photo/${photo.id}`
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

// GET endpoint untuk mengambil foto tertentu berdasarkan photo ID
// ===== GANTI ENDPOINT GET PHOTO =====
app.get('/api/surat-masuk/photo/:photoId', authenticateToken, async (req, res) => {
  try {
    const { photoId } = req.params;

    const { data: photo, error } = await supabase
      .from('surat_photos')
      .select('foto_path, foto_filename, foto_original_name, storage_path')
      .eq('id', photoId)
      .single();

    if (error || !photo) {
      return res.status(404).json({ error: 'Foto tidak ditemukan' });
    }

    // ✅ Redirect langsung ke public URL Supabase
    if (photo.foto_path && photo.foto_path.startsWith('http')) {
      return res.redirect(photo.foto_path);
    }

    // Fallback: generate public URL dari storage_path
    if (photo.storage_path) {
      const { data: { publicUrl } } = supabase.storage
        .from('surat-photos')
        .getPublicUrl(photo.storage_path);
      
      return res.redirect(publicUrl);
    }

    return res.status(404).json({ error: 'File foto tidak ditemukan' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET endpoint untuk mengambil semua foto dari surat tertentu
app.get('/api/surat-masuk/:suratId/photos', authenticateToken, async (req, res) => {
  try {
    const { suratId } = req.params;

    const { data: photos, error } = await supabase
      .from('surat_photos')
      .select('*')
      .eq('surat_id', suratId)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const photosWithUrls = photos.map(photo => ({
      id: photo.id,
      filename: photo.foto_original_name,
      size: photo.file_size,
      url: `/api/surat-masuk/photo/${photo.id}`,
      created_at: photo.created_at
    }));

    res.json({
      message: 'Berhasil mengambil foto surat',
      data: photosWithUrls,
      total: photosWithUrls.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE endpoint untuk menghapus foto tertentu
app.delete('/api/surat-masuk/photo/:photoId', authenticateToken, async (req, res) => {
  try {
    const { photoId } = req.params;

    // Ambil data foto dan surat terkait
    const { data: photo, error: fetchError } = await supabase
      .from('surat_photos')
      .select(`
        *,
        surat_masuk (created_by)
      `)
      .eq('id', photoId)
      .single();

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    if (!photo) {
      return res.status(404).json({ error: 'Foto tidak ditemukan' });
    }

    // Cek authorization
    if (photo.surat_masuk.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Tidak memiliki izin untuk menghapus foto ini' });
    }

    // Hapus dari database
    const { error: deleteError } = await supabase
      .from('surat_photos')
      .delete()
      .eq('id', photoId);

    if (deleteError) {
      return res.status(400).json({ error: deleteError.message });
    }

    // Hapus file fisik
    if (photo.foto_path && fs.existsSync(photo.foto_path)) {
      fs.unlinkSync(photo.foto_path);
    }

    res.json({
      message: 'Foto berhasil dihapus'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE endpoint untuk menghapus surat masuk beserta semua fotonya
app.delete('/api/surat-masuk/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Ambil data surat dan foto-fotonya
    const { data: surat, error: fetchError } = await supabase
      .from('surat_masuk')
      .select(`
        created_by,
        surat_photos (foto_path)
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    if (!surat) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' });
    }

    // Cek authorization
    if (surat.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Tidak memiliki izin untuk menghapus surat ini' });
    }

    // Hapus semua foto dari database (cascade akan menghapus di surat_photos)
    const { error: deleteError } = await supabase
      .from('surat_masuk')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return res.status(400).json({ error: deleteError.message });
    }

    // Hapus semua file foto
    if (surat.surat_photos && surat.surat_photos.length > 0) {
      surat.surat_photos.forEach(photo => {
        if (photo.foto_path && fs.existsSync(photo.foto_path)) {
          fs.unlinkSync(photo.foto_path);
        }
      });
    }

    res.json({
      message: 'Surat masuk dan semua foto berhasil dihapus'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get statistics surat masuk
app.get('/api/surat-masuk/stats', authenticateToken, async (req, res) => {
  try {
    // Total surat masuk
    const { count: totalSurat } = await supabase
      .from('surat_masuk')
      .select('*', { count: 'exact', head: true });

    // Surat pending
    const { count: pendingSurat } = await supabase
      .from('surat_masuk')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Surat processed
    const { count: processedSurat } = await supabase
      .from('surat_masuk')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'processed');

    // Surat per jabatan
    const { data: suratPerJabatan } = await supabase
      .from('surat_masuk')
      .select('tujuan_jabatan')
      .order('tujuan_jabatan');

    // Hitung surat per jabatan
    const jabatanCount = {};
    suratPerJabatan?.forEach(surat => {
      jabatanCount[surat.tujuan_jabatan] = (jabatanCount[surat.tujuan_jabatan] || 0) + 1;
    });

    res.json({
      message: 'Statistik surat masuk',
      stats: {
        total: totalSurat || 0,
        pending: pendingSurat || 0,
        processed: processedSurat || 0,
        byJabatan: jabatanCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select(`
        *,
        surat_masuk (
          id,
          asal_instansi,
          tujuan_jabatan,
          keterangan,
          status,
          created_at
        )
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark notification as read
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.delete('/api/surat/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Hapus notifikasi terlebih dahulu
    await supabase
      .from('notifications')
      .delete()
      .eq('surat_id', id);

    // 2. Baru hapus surat
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



// Process surat with disposisi
app.post('/api/surat/:id/process', authenticateToken, async (req, res) => {
  try {
    const {
      perihal,
      disposisi_kepada,
      tindakan,
      sifat,
      catatan
    } = req.body;

    const { data, error } = await supabase
      .from('surat_masuk')
      .update({
        perihal,
        disposisi_kepada,
        tindakan,
        sifat,
        catatan,
        processed_by: req.user.id,
        status: 'processed'
      })
      .eq('id', req.params.id)
      .eq('tujuan_jabatan', req.user.jabatan)
      .select()
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });

    res.json({
      message: 'Surat berhasil diproses dengan disposisi',
      data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint helper untuk mendapatkan daftar user dalam bidang yang sama (untuk dropdown)
app.get('/api/users/bawahan-bidang-detail', authenticateToken, async (req, res) => {
  try {
    // Ambil bidang user current
    const { data: currentUser, error: userError } = await supabase
      .from('users')
      .select('bidang')
      .eq('id', req.user.id)
      .single();

    if (userError || !currentUser) {
      return res.status(400).json({ error: 'Data user tidak ditemukan' });
    }

    // Ambil semua user dalam bidang yang sama (kecuali diri sendiri)
    const { data: bawahanUsers, error } = await supabase
      .from('users')
      .select('id, name, jabatan, bidang, email')
      .eq('bidang', currentUser.bidang)
      .neq('id', req.user.id)
      .order('jabatan', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Group by jabatan untuk memudahkan di frontend
    const groupedByJabatan = {};
    bawahanUsers?.forEach(user => {
      if (!groupedByJabatan[user.jabatan]) {
        groupedByJabatan[user.jabatan] = [];
      }
      groupedByJabatan[user.jabatan].push({
        id: user.id,
        name: user.name,
        email: user.email
      });
    });

    res.json({
      message: `Daftar bawahan dalam bidang ${currentUser.bidang}`,
      bidang: currentUser.bidang,
      data: bawahanUsers || [],
      grouped_by_jabatan: groupedByJabatan,
      total: bawahanUsers?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bawahan dalam bidang yang sama
app.get('/api/users/bawahan-bidang', authenticateToken, async (req, res) => {
  try {
    // Ambil bidang user current
    const { data: currentUser, error: userError } = await supabase
      .from('users')
      .select('bidang')
      .eq('id', req.user.id)
      .single();

    if (userError || !currentUser) {
      return res.status(400).json({ error: 'Data user tidak ditemukan' });
    }

    // Ambil semua user dalam bidang yang sama (kecuali diri sendiri)
    const { data: bawahanUsers, error } = await supabase
      .from('users')
      .select('id, name, jabatan, bidang')
      .eq('bidang', currentUser.bidang)
      .neq('id', req.user.id)
      .order('name', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: `Daftar bawahan dalam bidang ${currentUser.bidang}`,
      bidang: currentUser.bidang,
      data: bawahanUsers || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    // Ambil data dari Supabase
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

    // Siapkan path & template
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

    // Generate PDF pakai Puppeteer
    const browser = await puppeteer.launch({ headless: 'new' });
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

// Get dashboard data
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('surat_masuk')
      .select(`
        *,
        users!surat_masuk_created_by_fkey (name, jabatan),
        processed_user:users!surat_masuk_processed_by_fkey (name, jabatan),
        surat_photos (id, foto_filename, foto_original_name, file_size)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }
    // Get user's surat masuk
    const { data: suratMasuk } = await supabase
      .from('surat_masuk')
      .select('*')
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: false });

    // Get surat for user's jabatan
    const { data: suratUntukJabatan } = await supabase
      .from('surat_masuk')
      .select('*')
      .eq('tujuan_jabatan', req.user.jabatan)
      .order('created_at', { ascending: false });

    const dataWithPhotoInfo = data?.map(surat => ({
      ...surat,
      photo_count: surat.surat_photos ? surat.surat_photos.length : 0,
      has_photos: surat.surat_photos && surat.surat_photos.length > 0,
      photos: surat.surat_photos?.map(photo => ({
        id: photo.id,
        filename: photo.foto_original_name,
        size: photo.file_size,
        url: `/api/surat-masuk/photo/${photo.id}`
      })) || []
    })) || [];
    // Get unread notifications count
    const { count: unreadNotifications } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    res.json({
      suratMasuk: suratMasuk || [],
      suratUntukJabatan: suratUntukJabatan || [],
      unreadNotifications: unreadNotifications || 0,
      data: dataWithPhotoInfo,
      total: dataWithPhotoInfo.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

//-----------------------staff---------------//
app.get('/api/notifications/staff', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, unread_only = false } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('notifications')
      .select(`
        *,
        surat_masuk:surat_id (
          id,
          nomor_surat,
          asal_instansi,
          tujuan_jabatan,
          perihal,
          keterangan,
          disposisi_kepada,
          tindakan,
          sifat,
          catatan,
          status,
          created_at,
          processed_at
        )
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unread_only === 'true') {
      query = query.eq('is_read', false);
    }

    const { data: notifications, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Hitung total unread notifications
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    res.json({
      notifications,
      unread_count: unreadCount,
      current_page: parseInt(page),
      per_page: parseInt(limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/surat/:id/forwarded-details', authenticateToken, async (req, res) => {
  try {
    // Ambil data surat dengan foto
    const { data: surat, error: suratError } = await supabase
      .from('surat_masuk')
      .select(`
        *,
        surat_photos (
          id,
          foto_path,
          foto_filename,
          foto_original_name,
          file_size
        ),
        users:created_by (
          name,
          jabatan
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (suratError || !surat) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' });
    }

    // Cek apakah user berhak akses surat ini (ada notifikasi untuk surat ini ATAU sesuai jabatan)
    const { data: notification, error: notifError } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('surat_id', req.params.id)
      .maybeSingle(); // maybeSingle karena bisa jadi null

    // Cek juga apakah surat ditujukan untuk jabatan user
    const hasAccess = notification || surat.tujuan_jabatan === req.user.jabatan;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses ke surat ini' });
    }

    // Ambil riwayat forward/disposisi surat ini
    const { data: forwardHistory } = await supabase
      .from('notifications')
      .select(`
        *,
        users:user_id (name, jabatan)
      `)
      .eq('surat_id', req.params.id)
      .order('created_at', { ascending: true });

    res.json({
      surat,
      notification,
      forward_history: forwardHistory || [],
      has_photos: surat.surat_photos && surat.surat_photos.length > 0,
      photo_count: surat.surat_photos ? surat.surat_photos.length : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ENDPOINT UNTUK DASHBOARD SURAT MASUK BAWAHAN (DISESUAIKAN)
app.get('/api/dashboard/forwarded-surat', authenticateToken, async (req, res) => {
  try {
    // Ambil semua surat yang diforward ke user ini
    const { data: notifications } = await supabase
      .from('notifications')
      .select(`
        surat_id,
        created_at,
        is_read,
        message,
        surat_masuk:surat_id (
          id,
          nomor_surat,
          asal_instansi,
          tujuan_jabatan,
          perihal,
          keterangan,
          status,
          disposisi_kepada,
          created_at
        )
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    // Ambil juga surat yang langsung ditujukan ke jabatan user (bukan dari forward)
    const { data: directSurat } = await supabase
      .from('surat_masuk')
      .select(`
        id,
        nomor_surat,
        asal_instansi,
        tujuan_jabatan,
        perihal,
        keterangan,
        status,
        disposisi_kepada,
        created_at
      `)
      .eq('tujuan_jabatan', req.user.jabatan)
      .order('created_at', { ascending: false });

    // Gabungkan dan remove duplicate
    const allSurat = [];

    // Dari notifications (forwarded)
    if (notifications) {
      notifications.forEach(notif => {
        if (notif.surat_masuk) {
          allSurat.push({
            ...notif.surat_masuk,
            is_forwarded: true,
            notification_id: notif.surat_id,
            forward_message: notif.message,
            notification_read: notif.is_read,
            notification_date: notif.created_at
          });
        }
      });
    }

    // Dari direct surat (yang belum ada di notifications)
    if (directSurat) {
      directSurat.forEach(surat => {
        const existingIndex = allSurat.findIndex(s => s.id === surat.id);
        if (existingIndex === -1) {
          allSurat.push({
            ...surat,
            is_forwarded: false,
            notification_read: true // direct surat dianggap sudah "dibaca"
          });
        }
      });
    }

    // Group by status untuk statistik
    const stats = {
      total: allSurat.length,
      unread: allSurat.filter(s => !s.notification_read).length,
      today: allSurat.filter(s => {
        const today = new Date().toDateString();
        const suratDate = new Date(s.notification_date || s.created_at).toDateString();
        return today === suratDate;
      }).length,
      pending: allSurat.filter(s => s.status === 'pending').length,
      processed: allSurat.filter(s => s.status === 'processed').length
    };

    res.json({
      statistics: stats,
      recent_forwarded: allSurat.slice(0, 10),
      all_surat: allSurat
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. ENDPOINT UNTUK MARK NOTIFICATION SEBAGAI DIBACA (SUDAH BENAR)
app.put('/api/notifications/staff/:id/read', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Notifikasi berhasil ditandai sebagai dibaca' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. ENDPOINT UNTUK MARK SEMUA NOTIFICATION SEBAGAI DIBACA (SUDAH BENAR)
app.put('/api/notifications/staff/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Semua notifikasi berhasil ditandai sebagai dibaca' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 7. ENDPOINT UNTUK AMBIL FOTO SURAT
app.get('/api/surat/staff/:id/photos', authenticateToken, async (req, res) => {
  try {
    // Cek akses dulu
    const { data: surat } = await supabase
      .from('surat_masuk')
      .select('tujuan_jabatan')
      .eq('id', req.params.id)
      .single();

    if (!surat) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' });
    }

    const { data: notification } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('surat_id', req.params.id)
      .maybeSingle();

    const hasAccess = notification || surat.tujuan_jabatan === req.user.jabatan;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses ke surat ini' });
    }

    // Ambil foto
    const { data: photos, error } = await supabase
      .from('surat_photos')
      .select('*')
      .eq('surat_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ photos: photos || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --------------------KABID DAN STAFF------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
//-----------------------------------------------------------//
// Endpoint untuk meneruskan surat ke bawahan spesifik (berdasarkan nama)
app.post('/api/surat/:id/forward', authenticateToken, async (req, res) => {
  try {
    const { bawahan_users, catatan } = req.body;

    // Validasi input - bawahan_users harus berupa array dengan format [{nama, jabatan}]
    if (!bawahan_users || !Array.isArray(bawahan_users) || bawahan_users.length === 0) {
      return res.status(400).json({
        error: 'Data bawahan wajib diisi dalam format array: [{"nama": "...", "jabatan": "..."}]'
      });
    }

    // Validasi format setiap item dalam array
    for (const bawahan of bawahan_users) {
      if (!bawahan.nama || !bawahan.jabatan) {
        return res.status(400).json({
          error: 'Setiap bawahan harus memiliki nama dan jabatan'
        });
      }
    }

    // Pastikan surat ada
    const { data: surat, error: suratError } = await supabase
      .from('surat_masuk')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (suratError || !surat) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' });
    }

    // Ambil bidang user yang melakukan forward
    const { data: currentUser, error: userError } = await supabase
      .from('users')
      .select('bidang')
      .eq('id', req.user.id)
      .single();

    if (userError || !currentUser || !currentUser.bidang) {
      return res.status(400).json({ error: 'Data bidang user tidak ditemukan' });
    }

    // Validasi dan ambil data setiap bawahan
    const validatedBawahan = [];
    const notFoundUsers = [];
    const differentBidangUsers = [];

    for (const bawahan of bawahan_users) {
      // Cari user berdasarkan nama dan jabatan
      const { data: targetUser, error: targetError } = await supabase
        .from('users')
        .select('id, name, jabatan, bidang')
        .eq('name', bawahan.nama)
        .eq('jabatan', bawahan.jabatan)
        .single();

      if (targetError || !targetUser) {
        notFoundUsers.push(`${bawahan.nama} (${bawahan.jabatan})`);
        continue;
      }

      // Cek apakah user dalam bidang yang sama
      if (targetUser.bidang !== currentUser.bidang) {
        differentBidangUsers.push(`${bawahan.nama} (${bawahan.jabatan}) - bidang ${targetUser.bidang}`);
        continue;
      }

      // Cek duplikasi (jika ada user yang sama dikirim 2x)
      const isDuplicate = validatedBawahan.find(v => v.id === targetUser.id);
      if (!isDuplicate) {
        validatedBawahan.push(targetUser);
      }
    }

    // Jika ada user yang tidak ditemukan
    if (notFoundUsers.length > 0) {
      return res.status(400).json({
        error: `User tidak ditemukan: ${notFoundUsers.join(', ')}`
      });
    }

    // Jika ada user dengan bidang berbeda
    if (differentBidangUsers.length > 0) {
      return res.status(403).json({
        error: `Tidak dapat meneruskan ke user di bidang berbeda: ${differentBidangUsers.join(', ')}. Hanya bisa meneruskan ke bawahan dalam bidang ${currentUser.bidang}`
      });
    }

    // Jika tidak ada user valid
    if (validatedBawahan.length === 0) {
      return res.status(400).json({
        error: 'Tidak ada user valid untuk diteruskan'
      });
    }

    // Buat notifikasi untuk setiap user yang valid
    const notifications = validatedBawahan.map(user => ({
      user_id: user.id,
      surat_id: req.params.id,
      message: `Surat dan disposisi diteruskan oleh ${req.user.jabatan} kepada ${user.name} (${user.jabatan})` + (catatan ? `: ${catatan}` : ''),
      is_read: false,
      created_at: new Date().toISOString()
    }));

    // Insert notifikasi
    const { data: insertedNotifications, error: notifError } = await supabase
      .from('notifications')
      .insert(notifications)
      .select();

    if (notifError) {
      console.error('Error creating notifications:', notifError);
      return res.status(500).json({
        error: 'Gagal membuat notifikasi: ' + notifError.message
      });
    }

    // Log activity untuk audit trail
    const activityData = {
      surat_id: req.params.id,
      user_id: req.user.id,
      action: 'forward_to_specific_users',
      details: `Surat diteruskan kepada: ${validatedBawahan.map(u => `${u.name} (${u.jabatan})`).join(', ')}`,
      old_values: null,
      new_values: JSON.stringify({
        forwarded_to: validatedBawahan.map(u => ({
          id: u.id,
          name: u.name,
          jabatan: u.jabatan,
          bidang: u.bidang
        })),
        catatan
      }),
      created_at: new Date().toISOString()
    };

    await supabase
      .from('surat_activities')
      .insert([activityData]);

    res.json({
      message: `Surat berhasil diteruskan kepada ${validatedBawahan.length} user dalam bidang ${currentUser.bidang}`,
      forwarded_to: validatedBawahan.map(u => ({
        id: u.id,
        name: u.name,
        jabatan: u.jabatan
      })),
      bidang: currentUser.bidang,
      notification_count: insertedNotifications ? insertedNotifications.length : 0,
      catatan
    });

  } catch (error) {
    console.error('Error in forward to specific users:', error);
    res.status(500).json({
      error: 'Terjadi kesalahan server: ' + error.message
    });
  }
});

// Endpoint untuk accept disposisi oleh bawahan
// Tambahkan multer setup untuk upload feedback photos (tambahkan setelah multer setup yang sudah ada)
const feedbackStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/feedback/';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'feedback-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadFeedback = multer({
  storage: feedbackStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Maksimal 5MB per file
    files: 5 // Maksimal 5 files
  },
  fileFilter: fileFilter // Gunakan fileFilter yang sama
});

// Modifikasi endpoint accept untuk menerima feedback
app.post('/api/surat/:id/accept', authenticateToken, uploadFeedback.array('feedback_photos', 5), async (req, res) => {
  try {
    console.log('req.user:', req.user);

    const { id } = req.params;
    const { atasan_jabatan, feedback_notes } = req.body;

    // Validasi input
    if (!atasan_jabatan) {
      // Hapus file yang sudah diupload jika validasi gagal
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      return res.status(400).json({ error: 'Atasan jabatan wajib diisi' });
    }

    // Cek apakah surat sudah diproses sebelumnya oleh user ini
    const { data: existingFeedback } = await supabase
      .from('surat_feedback')
      .select('*')
      .eq('surat_id', id)
      .eq('user_id', req.user.id)
      .single();

    if (existingFeedback) {
      // Hapus file yang sudah diupload jika sudah ada feedback
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      return res.status(400).json({ error: 'Anda sudah memberikan feedback untuk surat ini' });
    }

    // Update status surat
    const { data: surat, error: suratError } = await supabase
      .from('surat_masuk')
      .update({
        status: 'processed',
        processed_by: req.user.id,
        accepted_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (suratError) {
      // Hapus file yang sudah diupload jika update surat gagal
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      return res.status(400).json({ error: suratError.message });
    }

    // Simpan feedback ke tabel surat_feedback
    const feedbackData = {
      surat_id: id,
      user_id: req.user.id,
      feedback_notes: feedback_notes || null,
      created_at: new Date().toISOString()
    };

    const { data: feedbackResult, error: feedbackError } = await supabase
      .from('surat_feedback')
      .insert([feedbackData])
      .select()
      .single();

    if (feedbackError) {
      // Hapus file dan rollback update surat jika gagal simpan feedback
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      // Rollback surat status
      await supabase
        .from('surat_masuk')
        .update({
          status: 'pending',
          processed_by: null,
          accepted_at: null
        })
        .eq('id', id);

      return res.status(400).json({ error: 'Gagal menyimpan feedback: ' + feedbackError.message });
    }

    // Simpan foto feedback jika ada
    let photoCount = 0;
    if (req.files && req.files.length > 0) {
      const photoData = req.files.map(file => ({
        feedback_id: feedbackResult.id,
        foto_path: file.path,
        foto_filename: file.filename,
        foto_original_name: file.originalname,
        file_size: file.size,
        created_at: new Date().toISOString()
      }));

      const { error: photoError } = await supabase
        .from('feedback_photos')
        .insert(photoData);

      if (photoError) {
        // Rollback semua jika gagal simpan foto
        await supabase.from('surat_feedback').delete().eq('id', feedbackResult.id);
        await supabase
          .from('surat_masuk')
          .update({
            status: 'pending',
            processed_by: null,
            accepted_at: null
          })
          .eq('id', id);

        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });

        return res.status(400).json({ error: 'Gagal menyimpan foto feedback: ' + photoError.message });
      }

      photoCount = req.files.length;
    }

    // Kirim notifikasi ke atasan
    const { data: atasan } = await supabase
      .from('users')
      .select('id')
      .eq('jabatan', atasan_jabatan);

    if (atasan && atasan.length > 0) {
      const notificationMessage = feedback_notes || photoCount > 0 
        ? `${req.user.name} telah menerima disposisi dengan feedback${feedback_notes ? ': ' + feedback_notes.substring(0, 50) + '...' : ''}`
        : `Disposisi telah diterima oleh ${req.user.name}`;

      const notifications = atasan.map(user => ({
        user_id: user.id,
        surat_id: id,
        message: notificationMessage,
        is_read: false,
        created_at: new Date().toISOString()
      }));

      await supabase
        .from('notifications')
        .insert(notifications);
    }

    // Log activity
    const activityData = {
      surat_id: id,
      user_id: req.user.id,
      action: 'accept_with_feedback',
      details: `Disposisi diterima dengan feedback${feedback_notes ? ': ' + feedback_notes.substring(0, 100) : ''}${photoCount > 0 ? ` dan ${photoCount} foto` : ''}`,
      old_values: JSON.stringify({ status: 'pending' }),
      new_values: JSON.stringify({ 
        status: 'processed',
        feedback_notes,
        photo_count: photoCount
      }),
      created_at: new Date().toISOString()
    };

    await supabase
      .from('surat_activities')
      .insert([activityData]);

    res.json({
      message: 'Disposisi berhasil diterima dengan feedback',
      data: {
        ...surat,
        feedback: {
          ...feedbackResult,
          photo_count: photoCount,
          has_photos: photoCount > 0
        }
      }
    });

  } catch (error) {
    // Hapus file yang sudah diupload jika terjadi error
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
    }
    console.error('Error in accept with feedback:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk melihat feedback dari bawahan
app.get('/api/surat/:id/feedback', authenticateToken, async (req, res) => {
  try {
    const { data: feedback, error } = await supabase
      .from('surat_feedback')
      .select(`
        *,
        users (name, jabatan, bidang),
        feedback_photos (
          id,
          foto_filename,
          foto_original_name,
          file_size
        )
      `)
      .eq('surat_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Tambahkan URL untuk setiap foto
    const feedbackWithUrls = feedback?.map(fb => ({
      ...fb,
      feedback_photos: fb.feedback_photos?.map(photo => ({
        ...photo,
        url: `/api/feedback/photo/${photo.id}`
      })) || []
    })) || [];

    res.json({
      message: 'Berhasil mengambil feedback surat',
      data: feedbackWithUrls,
      total: feedbackWithUrls.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk mengambil foto feedback
app.get('/api/feedback/photo/:photoId', authenticateToken, async (req, res) => {
  try {
    const { photoId } = req.params;

    const { data: photo, error } = await supabase
      .from('feedback_photos')
      .select('foto_path, foto_filename, foto_original_name')
      .eq('id', photoId)
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!photo || !photo.foto_path) {
      return res.status(404).json({ error: 'Foto tidak ditemukan' });
    }

    if (!fs.existsSync(photo.foto_path)) {
      return res.status(404).json({ error: 'File foto tidak ditemukan' });
    }

    const ext = path.extname(photo.foto_filename).toLowerCase();
    let contentType = 'image/jpeg';

    switch (ext) {
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${photo.foto_original_name}"`);

    const fileStream = fs.createReadStream(photo.foto_path);
    fileStream.pipe(res);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk hapus foto feedback (opsional)
app.delete('/api/feedback/photo/:photoId', authenticateToken, async (req, res) => {
  try {
    const { photoId } = req.params;

    const { data: photo, error: fetchError } = await supabase
      .from('feedback_photos')
      .select(`
        *,
        surat_feedback (
          user_id,
          surat_feedback (surat_id)
        )
      `)
      .eq('id', photoId)
      .single();

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    if (!photo) {
      return res.status(404).json({ error: 'Foto tidak ditemukan' });
    }

    // Cek authorization
    if (photo.surat_feedback.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Tidak memiliki izin untuk menghapus foto ini' });
    }

    const { error: deleteError } = await supabase
      .from('feedback_photos')
      .delete()
      .eq('id', photoId);

    if (deleteError) {
      return res.status(400).json({ error: deleteError.message });
    }

    // Hapus file fisik
    if (photo.foto_path && fs.existsSync(photo.foto_path)) {
      fs.unlinkSync(photo.foto_path);
    }

    res.json({
      message: 'Foto feedback berhasil dihapus'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk dashboard feedback (untuk atasan/kabid)
app.get('/api/dashboard/feedback-summary', authenticateToken, async (req, res) => {
  try {
    const { date_from, date_to, bidang } = req.query;

    // Base query untuk feedback dalam bidang yang sama
    let feedbackQuery = supabase
      .from('surat_feedback')
      .select(`
        *,
        users!surat_feedback_user_id_fkey (name, jabatan, bidang),
        surat_masuk!surat_feedback_surat_id_fkey (
          nomor_surat, 
          asal_instansi, 
          tujuan_jabatan,
          created_at
        ),
        feedback_photos (id)
      `);

    // Filter berdasarkan bidang jika user bukan admin
    if (req.user.role !== 'admin') {
      // Ambil bidang user current
      const { data: currentUser } = await supabase
        .from('users')
        .select('bidang')
        .eq('id', req.user.id)
        .single();

      if (currentUser && currentUser.bidang) {
        // Join dengan users untuk filter bidang
        feedbackQuery = feedbackQuery.eq('users.bidang', currentUser.bidang);
      }
    }

    // Filter berdasarkan tanggal jika ada
    if (date_from) {
      feedbackQuery = feedbackQuery.gte('created_at', date_from);
    }
    if (date_to) {
      feedbackQuery = feedbackQuery.lte('created_at', date_to);
    }

    // Filter berdasarkan bidang khusus jika admin
    if (bidang && req.user.role === 'admin') {
      feedbackQuery = feedbackQuery.eq('users.bidang', bidang);
    }

    feedbackQuery = feedbackQuery.order('created_at', { ascending: false });

    const { data: feedbacks, error } = await feedbackQuery;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Hitung statistik
    const stats = {
      total_feedback: feedbacks?.length || 0,
      feedback_with_notes: feedbacks?.filter(f => f.feedback_notes?.trim()).length || 0,
      feedback_with_photos: feedbacks?.filter(f => f.feedback_photos?.length > 0).length || 0,
      total_photos: feedbacks?.reduce((sum, f) => sum + (f.feedback_photos?.length || 0), 0) || 0,
      by_jabatan: {},
      by_date: {},
      recent_feedback: feedbacks?.slice(0, 10) || []
    };

    // Group by jabatan
    feedbacks?.forEach(feedback => {
      const jabatan = feedback.users?.jabatan || 'Unknown';
      stats.by_jabatan[jabatan] = (stats.by_jabatan[jabatan] || 0) + 1;
    });

    // Group by date (per hari)
    feedbacks?.forEach(feedback => {
      const date = new Date(feedback.created_at).toISOString().split('T')[0];
      stats.by_date[date] = (stats.by_date[date] || 0) + 1;
    });

    res.json({
      message: 'Summary feedback berhasil diambil',
      statistics: stats,
      feedbacks: feedbacks || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk export feedback ke CSV/Excel
app.get('/api/feedback/export', authenticateToken, async (req, res) => {
  try {
    const { format = 'csv', date_from, date_to, bidang } = req.query;

    // Query feedback lengkap
    let query = supabase
      .from('surat_feedback')
      .select(`
        *,
        users!surat_feedback_user_id_fkey (name, jabatan, bidang, email),
        surat_masuk!surat_feedback_surat_id_fkey (
          nomor_surat, 
          asal_instansi, 
          tujuan_jabatan,
          perihal,
          created_at as surat_created_at
        ),
        feedback_photos (id, foto_original_name, file_size)
      `);

    // Filter berdasarkan role dan bidang
    if (req.user.role !== 'admin') {
      const { data: currentUser } = await supabase
        .from('users')
        .select('bidang')
        .eq('id', req.user.id)
        .single();

      if (currentUser?.bidang) {
        query = query.eq('users.bidang', currentUser.bidang);
      }
    }

    // Filter tanggal
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lte('created_at', date_to);
    if (bidang && req.user.role === 'admin') {
      query = query.eq('users.bidang', bidang);
    }

    query = query.order('created_at', { ascending: false });

    const { data: feedbacks, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Prepare data untuk export
    const exportData = feedbacks?.map(feedback => ({
      'Tanggal Feedback': new Date(feedback.created_at).toLocaleDateString('id-ID'),
      'Nama Pemberi Feedback': feedback.users?.name || '-',
      'Jabatan': feedback.users?.jabatan || '-',
      'Bidang': feedback.users?.bidang || '-',
      'Email': feedback.users?.email || '-',
      'Nomor Surat': feedback.surat_masuk?.nomor_surat || '-',
      'Asal Instansi': feedback.surat_masuk?.asal_instansi || '-',
      'Tujuan Jabatan': feedback.surat_masuk?.tujuan_jabatan || '-',
      'Perihal': feedback.surat_masuk?.perihal || '-',
      'Tanggal Surat': feedback.surat_masuk?.surat_created_at 
        ? new Date(feedback.surat_masuk.surat_created_at).toLocaleDateString('id-ID')
        : '-',
      'Catatan Feedback': feedback.feedback_notes || '-',
      'Jumlah Foto': feedback.feedback_photos?.length || 0,
      'Daftar Foto': feedback.feedback_photos?.map(p => p.foto_original_name).join(', ') || '-'
    })) || [];

    if (format === 'csv') {
      // Generate CSV
      const csv = [
        // Header
        Object.keys(exportData[0] || {}).join(','),
        // Data rows
        ...exportData.map(row => 
          Object.values(row).map(value => 
            typeof value === 'string' && value.includes(',') 
              ? `"${value}"` 
              : value
          ).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="feedback-export-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send('\uFEFF' + csv); // Add BOM for Excel compatibility

    } else {
      // Return JSON for frontend to process
      res.json({
        message: 'Data export berhasil diambil',
        data: exportData,
        total: exportData.length
      });
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk update/edit feedback (dalam waktu terbatas setelah submit)
app.put('/api/feedback/:id/edit', authenticateToken, uploadFeedback.array('new_photos', 3), async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback_notes, remove_photo_ids } = req.body;

    // Cek apakah feedback ada dan milik user
    const { data: existingFeedback, error: fetchError } = await supabase
      .from('surat_feedback')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError || !existingFeedback) {
      if (req.files?.length > 0) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(404).json({ error: 'Feedback tidak ditemukan atau bukan milik Anda' });
    }

    // Cek apakah masih dalam waktu edit (misalnya 1 jam setelah submit)
    const timeDiff = new Date() - new Date(existingFeedback.created_at);
    const oneHour = 60 * 60 * 1000; // 1 jam dalam milliseconds

    if (timeDiff > oneHour) {
      if (req.files?.length > 0) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({ 
        error: 'Waktu edit feedback sudah habis (maksimal 1 jam setelah submit)' 
      });
    }

    // Update feedback notes
    const { error: updateError } = await supabase
      .from('surat_feedback')
      .update({
        feedback_notes: feedback_notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) {
      if (req.files?.length > 0) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({ error: updateError.message });
    }

    // Handle remove photos
    if (remove_photo_ids) {
      const photoIdsToRemove = Array.isArray(remove_photo_ids) 
        ? remove_photo_ids 
        : [remove_photo_ids];

      // Ambil path foto yang akan dihapus
      const { data: photosToRemove } = await supabase
        .from('feedback_photos')
        .select('foto_path')
        .eq('feedback_id', id)
        .in('id', photoIdsToRemove);

      // Hapus dari database
      await supabase
        .from('feedback_photos')
        .delete()
        .eq('feedback_id', id)
        .in('id', photoIdsToRemove);

      // Hapus file fisik
      photosToRemove?.forEach(photo => {
        if (photo.foto_path && fs.existsSync(photo.foto_path)) {
          fs.unlinkSync(photo.foto_path);
        }
      });
    }

    // Handle new photos
    let newPhotoCount = 0;
    if (req.files?.length > 0) {
      const photoData = req.files.map(file => ({
        feedback_id: id,
        foto_path: file.path,
        foto_filename: file.filename,
        foto_original_name: file.originalname,
        file_size: file.size,
        created_at: new Date().toISOString()
      }));

      const { error: photoError } = await supabase
        .from('feedback_photos')
        .insert(photoData);

      if (photoError) {
        req.files.forEach(file => fs.unlinkSync(file.path));
        return res.status(400).json({ error: 'Gagal menambah foto baru: ' + photoError.message });
      }

      newPhotoCount = req.files.length;
    }

    res.json({
      message: 'Feedback berhasil diupdate',
      new_photos_added: newPhotoCount,
      photos_removed: remove_photo_ids ? (Array.isArray(remove_photo_ids) ? remove_photo_ids.length : 1) : 0
    });

  } catch (error) {
    if (req.files?.length > 0) {
      req.files.forEach(file => fs.unlinkSync(file.path));
    }
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk delete feedback (hanya dalam waktu terbatas)
app.delete('/api/feedback/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Cek feedback dan ownership
    const { data: feedback, error: fetchError } = await supabase
      .from('surat_feedback')
      .select(`
        *,
        feedback_photos (foto_path)
      `)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError || !feedback) {
      return res.status(404).json({ error: 'Feedback tidak ditemukan' });
    }

    // Cek waktu (misalnya 30 menit untuk delete)
    const timeDiff = new Date() - new Date(feedback.created_at);
    const thirtyMinutes = 30 * 60 * 1000;

    if (timeDiff > thirtyMinutes) {
      return res.status(400).json({ 
        error: 'Waktu delete feedback sudah habis (maksimal 30 menit setelah submit)' 
      });
    }

    // Hapus feedback (cascade akan hapus photos)
    const { error: deleteError } = await supabase
      .from('surat_feedback')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return res.status(400).json({ error: deleteError.message });
    }

    // Hapus file fisik
    feedback.feedback_photos?.forEach(photo => {
      if (photo.foto_path && fs.existsSync(photo.foto_path)) {
        fs.unlinkSync(photo.foto_path);
      }
    });

    // Reset status surat jika perlu
    await supabase
      .from('surat_masuk')
      .update({
        status: 'pending',
        processed_by: null,
        accepted_at: null
      })
      .eq('id', feedback.surat_id);

    res.json({ message: 'Feedback berhasil dihapus' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk notifikasi real-time feedback baru (untuk atasan)
app.get('/api/notifications/feedback/new', authenticateToken, async (req, res) => {
  try {
    // Cek role - hanya atasan yang bisa akses
    if (!['admin', 'kabid'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // Ambil bidang user
    const { data: currentUser } = await supabase
      .from('users')
      .select('bidang')
      .eq('id', req.user.id)
      .single();

    // Ambil feedback baru dalam 24 jam terakhir
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('surat_feedback')
      .select(`
        *,
        users!surat_feedback_user_id_fkey (name, jabatan, bidang),
        surat_masuk!surat_feedback_surat_id_fkey (nomor_surat, asal_instansi)
      `)
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false });

    // Filter berdasarkan bidang jika bukan admin
    if (req.user.role !== 'admin' && currentUser?.bidang) {
      query = query.eq('users.bidang', currentUser.bidang);
    }

    const { data: newFeedbacks, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Feedback baru berhasil diambil',
      data: newFeedbacks || [],
      count: newFeedbacks?.length || 0
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});