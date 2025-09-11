const { supabase } = require("../../config/supabase");

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
}

module.exports = { buatDisposisi, getKepalaDisposisiAll, getKepalaDetailDisposisi, deleteDisposisi }