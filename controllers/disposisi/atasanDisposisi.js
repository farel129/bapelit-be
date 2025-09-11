const { supabase } = require("../../config/supabase");
const { handleBacaDisposisi, handleTerimaDisposisi } = require("../../utils/disposisiHandler");

const getAtasanDisposisi = async (req, res) => {
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
}

const getAtasanDetailDisposisi = async (req, res) => {
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
            let fileUrl = `/api/v1/disposisi/atasan/${file.id}`;

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
}

const getAtasanFileDisposisi = async (req, res) => {
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
}

/**
 * Controller untuk kabid baca disposisi
 */
const kabidBacaDisposisi = async (req, res) => {
    try {
        const { id } = req.params;
        const { jabatan: userJabatan, id: userId } = req.user;

        const result = await handleBacaDisposisi(id, userJabatan, userId, 'kabid');

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: result.message,
                data: result.data
            });
        } else {
            return res.status(200).json({
                success: false,
                message: result.message,
                data: result.data
            });
        }
    } catch (error) {
        console.error('Controller error - kabidBacaDisposisi:', error);

        if (error.message.includes('tidak ditemukan')) {
            return res.status(404).json({
                success: false,
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan server'
        });
    }
}

/**
 * Controller untuk kabid terima disposisi
 */
const kabidTerimaDisposisi = async (req, res) => {
    try {
        const { id } = req.params;
        const { jabatan: userJabatan, id: userId } = req.user;

        const result = await handleTerimaDisposisi(id, userJabatan, userId, 'kabid');

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: result.message,
                data: result.data
            });
        } else {
            return res.status(200).json({
                success: false,
                message: result.message,
                data: result.data
            });
        }
    } catch (error) {
        console.error('Controller error - kabidTerimaDisposisi:', error);

        if (error.message.includes('tidak ditemukan')) {
            return res.status(404).json({
                success: false,
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan server'
        });
    }
}

/**
 * Controller untuk sekretaris baca disposisi
 */
const sekretarisBacaDisposisi = async (req, res) => {
    try {
        const { id } = req.params;
        const { jabatan: userJabatan, id: userId } = req.user;

        const result = await handleBacaDisposisi(id, userJabatan, userId, 'sekretaris');

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: result.message,
                data: result.data
            });
        } else {
            return res.status(200).json({
                success: false,
                message: result.message,
                data: result.data
            });
        }
    } catch (error) {
        console.error('Controller error - sekretarisBacaDisposisi:', error);

        if (error.message.includes('tidak ditemukan')) {
            return res.status(404).json({
                success: false,
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan server'
        });
    }
}

/**
 * Controller untuk sekretaris terima disposisi
 */
const sekretarisTerimaDisposisi = async (req, res) => {
    try {
        const { id } = req.params;
        const { jabatan: userJabatan, id: userId } = req.user;

        const result = await handleTerimaDisposisi(id, userJabatan, userId, 'sekretaris');

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: result.message,
                data: result.data
            });
        } else {
            return res.status(200).json({
                success: false,
                message: result.message,
                data: result.data
            });
        }
    } catch (error) {
        console.error('Controller error - sekretarisTerimaDisposisi:', error);

        if (error.message.includes('tidak ditemukan')) {
            return res.status(404).json({
                success: false,
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Terjadi kesalahan server'
        });
    }
}

const listBawahan = async (req, res) => {
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
}

const atasanTeruskanDisposisi = async (req, res) => {
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
}

const listJabatan = async (req, res) => {
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
}

module.exports = {
    getAtasanDisposisi,
    getAtasanDetailDisposisi,
    getAtasanFileDisposisi,
    kabidBacaDisposisi,
    kabidTerimaDisposisi,
    sekretarisBacaDisposisi,
    sekretarisTerimaDisposisi,
    listBawahan,
    atasanTeruskanDisposisi,
    listJabatan
}