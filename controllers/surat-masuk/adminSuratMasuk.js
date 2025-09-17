const { supabase } = require("../../config/supabase");
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
        const { error } = await supabase
            .from('surat_masuk')
            .delete()
            .eq('id', id);
        if (error) throw error;
        res.status(200).json({ message: 'Surat berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus surat', detail: error.message });
    }
}

module.exports = { buatSuratMasuk, getSuratMasuk, getFileSuratMasuk, deleteSuratMasuk }