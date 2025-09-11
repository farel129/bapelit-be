const { supabase } = require("../../config/supabase");

const getBawahanDisposisi = async (req, res) => {
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
}

const getBawahanDetailDisposisi = async (req, res) => {
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
}

const terimaBawahanDisposisi = async (req, res) => {
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
}

module.exports = { getBawahanDisposisi, getBawahanDetailDisposisi, terimaBawahanDisposisi }