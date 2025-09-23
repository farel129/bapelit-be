const { supabase, supabaseAdmin } = require("../../config/supabase");

const buatDisposisi = async (req, res) => {
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
}

const getKepalaDisposisiAll = async (req, res) => {
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
}

const getKepalaDetailDisposisi = async (req, res) => {
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
}

const deleteDisposisi = async (req, res) => {
    const { id } = req.params;

    try {
        // Hanya kepala yang bisa hapus
        if (req.user.role !== 'kepala') {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        // 1. Ambil data disposisi untuk validasi
        const { data: disposisi, error: fetchError } = await supabase
            .from('disposisi')
            .select('surat_masuk_id')
            .eq('id', id)
            .single();

        if (fetchError || !disposisi) {
            return res.status(404).json({ error: 'Disposisi tidak ditemukan' });
        }

        // 2. Ambil data file feedback
        const { data: fileFeedback, error: fileError } = await supabase
            .from('feedback_files')
            .select('id, storage_path, file_filename')
            .eq('disposisi_id', id);

        if (fileError) {
            return res.status(500).json({
                error: 'Gagal mengambil data file: ' + fileError.message
            });
        }

        // 3. Hapus file dari storage jika ada
        if (fileFeedback && fileFeedback.length > 0) {
            const filesToDelete = fileFeedback
                .map(item => item.storage_path)
                .filter(path => path && typeof path === 'string' && path.trim().length > 0);

            if (filesToDelete.length > 0) {
                try {
                    const { data: removed, error: storageError } = await supabaseAdmin
                        .storage
                        .from('surat-photos')
                        .remove(filesToDelete);

                    if (storageError) {
                        console.error('Storage delete error:', storageError);
                        // Log error tapi jangan return, lanjut hapus record database
                    }
                } catch (storageException) {
                    console.error('Storage exception:', storageException);
                    // Log error tapi jangan return, lanjut hapus record database
                }
            }

            // 4. Hapus records feedback_files dari database
            const { error: deleteFeedbackError } = await supabase
                .from('feedback_files')
                .delete()
                .eq('disposisi_id', id);

            if (deleteFeedbackError) {
                return res.status(500).json({
                    error: 'Gagal menghapus file feedback: ' + deleteFeedbackError.message
                });
            }
        }

        // 5. Hapus record disposisi
        const { error: deleteDisposisiError } = await supabase
            .from('disposisi')
            .delete()
            .eq('id', id);

        if (deleteDisposisiError) {
            return res.status(500).json({
                error: 'Gagal menghapus disposisi: ' + deleteDisposisiError.message
            });
        }

        // 6. Update status surat masuk
        const { error: updateError } = await supabase
            .from('surat_masuk')
            .update({ has_disposisi: false })
            .eq('id', disposisi.surat_masuk_id);

        if (updateError) {
            console.error('Error updating has_disposisi:', updateError);
            // Jangan return error karena disposisi sudah terhapus
            // Hanya log untuk monitoring
        }

        res.json({ 
            message: 'Disposisi berhasil dihapus dan status surat diperbarui',
            deleted_files: fileFeedback ? fileFeedback.length : 0
        });

    } catch (error) {
        console.error('Unexpected error in deleteDisposisi:', error);
        res.status(500).json({ error: 'Terjadi kesalahan internal server' });
    }
}

module.exports = { buatDisposisi, getKepalaDisposisiAll, getKepalaDetailDisposisi, deleteDisposisi }