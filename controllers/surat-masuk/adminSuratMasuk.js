const { supabase, supabaseAdmin } = require("../../config/supabase");
const { uploadToSupabaseStorage } = require("../../utils/uploadSupabase");

const buatSuratMasuk = async (req, res) => {
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
                uploadToSupabaseStorage(file, 'surat-masuk', 'surat-photos')
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
                    .from('surat_photos')
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
}

const getSuratMasuk = async (req, res) => {
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
                let photoUrl = `/api/v1/surat-masuk/photo/${photo.id}`;
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
}

const getFileSuratMasuk = async (req, res) => {
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
}

const deleteSuratMasuk = async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Ambil semua disposisi terkait surat
    const { data: disposisiList, error: disposisiError } = await supabase
      .from('disposisi')
      .select('id')
      .eq('surat_masuk_id', id);

    if (disposisiError) throw disposisiError;

    // 2. Hapus feedback files untuk setiap disposisi
    if (disposisiList && disposisiList.length > 0) {
      for (const disposisi of disposisiList) {
        // Ambil feedback files untuk disposisi ini
        const { data: feedbackFiles, error: feedbackError } = await supabase
          .from('feedback_files')
          .select('id, storage_path, file_filename')
          .eq('disposisi_id', disposisi.id);

        if (feedbackError) {
          console.error(`Error getting feedback files for disposisi ${disposisi.id}:`, feedbackError);
          continue; // Lanjut ke disposisi berikutnya
        }

        // Hapus file feedback dari storage
        if (feedbackFiles && feedbackFiles.length > 0) {
          const feedbackFilesToDelete = feedbackFiles
            .map(item => item.storage_path)
            .filter(path => path && typeof path === 'string' && path.trim().length > 0);

          if (feedbackFilesToDelete.length > 0) {
            try {
              const { data: removedFeedback, error: feedbackStorageError } = await supabaseAdmin
                .storage
                .from('surat-photos')
                .remove(feedbackFilesToDelete);

              if (feedbackStorageError) {
                console.error(`Storage error for feedback files:`, feedbackStorageError);
                // Jangan throw, lanjut hapus record database
              }
              
              console.log("Removed feedback files:", removedFeedback);
            } catch (storageException) {
              console.error('Feedback storage exception:', storageException);
              // Jangan throw, lanjut hapus record database
            }
          }

          // Hapus record feedback files dari database
          const { error: deleteFeedbackError } = await supabase
            .from('feedback_files')
            .delete()
            .eq('disposisi_id', disposisi.id);

          if (deleteFeedbackError) {
            console.error(`Error deleting feedback files for disposisi ${disposisi.id}:`, deleteFeedbackError);
            // Jangan throw, lanjut ke disposisi berikutnya
          }
        }
      }

      // 3. Hapus semua record disposisi
      const { error: deleteDisposisiError } = await supabase
        .from('disposisi')
        .delete()
        .eq('surat_masuk_id', id);

      if (deleteDisposisiError) {
        console.error('Error deleting disposisi records:', deleteDisposisiError);
        // Jangan throw, lanjut hapus surat photos
      }
    }

    // 4. Ambil semua foto terkait surat
    const { data: photos, error: photoError } = await supabase
      .from('surat_photos')
      .select('storage_path')
      .eq('surat_id', id);

    if (photoError) throw photoError;

    // 5. Hapus file surat dari storage
    if (photos && photos.length > 0) {
      const filesToDelete = photos.map(p => p.storage_path);
      console.log("Deleting surat files:", filesToDelete);

      try {
        const { data: removed, error: storageError } = await supabaseAdmin
          .storage
          .from('surat-photos')
          .remove(filesToDelete);

        if (storageError) {
          console.error('Surat photos storage error:', storageError);
          // Jangan throw, lanjut hapus record database
        }

        console.log("Removed surat files:", removed);
      } catch (storageException) {
        console.error('Surat photos storage exception:', storageException);
        // Jangan throw, lanjut hapus record database
      }
    }

    // 6. Hapus record foto surat di DB
    const { error: deletePhotosError } = await supabase
      .from('surat_photos')
      .delete()
      .eq('surat_id', id);

    if (deletePhotosError) throw deletePhotosError;

    // 7. Hapus surat dari DB (terakhir)
    const { error: suratError } = await supabase
      .from('surat_masuk')
      .delete()
      .eq('id', id);

    if (suratError) throw suratError;

    res.status(200).json({ 
      message: 'Surat, disposisi, feedback files, dan semua file berhasil dihapus',
      deleted_disposisi: disposisiList ? disposisiList.length : 0
    });

  } catch (error) {
    console.error("DeleteSuratMasuk error:", error);
    res.status(500).json({ 
      message: 'Gagal menghapus surat', 
      detail: error.message 
    });
  }
};

module.exports = { buatSuratMasuk, getSuratMasuk, getFileSuratMasuk, deleteSuratMasuk }