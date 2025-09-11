const { supabase } = require("../../config/supabase");

const getKepalaSuratMasuk = async (req, res) => {
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
}

const getKepalaFileSuratMasuk = async (req, res) => {
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

const readKepalaSuratMasuk = async (req, res) => {
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
}

module.exports = { getKepalaSuratMasuk, getKepalaFileSuratMasuk, readKepalaSuratMasuk }