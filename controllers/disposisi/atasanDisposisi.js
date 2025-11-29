const { supabase } = require("../../config/supabase");
const { handleBacaDisposisi, handleTerimaDisposisi } = require("../../utils/disposisiHandler");

// --- HELPER: Ambil Detail User Lengkap (Nama Jabatan & Bidang) ---
const fetchUserDetails = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select(`
                id, 
                name, 
                email, 
                role, 
                jabatan:jabatan_id(nama), 
                bidang:bidang_id(nama)
            `)
            .eq('id', userId)
            .single();

        if (error || !data) {
            console.error("Error fetching user details:", error);
            return null;
        }

        return {
            ...data,
            jabatan: data.jabatan?.nama, // Flatten: ambil string namanya saja
            bidang: data.bidang?.nama    // Flatten: ambil string namanya saja
        };
    } catch (err) {
        console.error("Crash in fetchUserDetails:", err);
        return null;
    }
};

const getAtasanDisposisi = async (req, res) => {
    try {
        // 1. Ambil Data User Terbaru
        const userDetail = await fetchUserDetails(req.user.id);

        if (!userDetail || !userDetail.jabatan) {
            return res.status(400).json({ error: 'Jabatan user tidak ditemukan. Pastikan user memiliki jabatan di database.' });
        }

        const userJabatan = userDetail.jabatan;

        // 2. Query Disposisi
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
            console.error('Error fetching disposisi:', error);
            return res.status(400).json({ error: error.message });
        }

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

        res.json({
            message: 'Berhasil mengambil disposisi',
            data: transformedData,
            total: transformedData.length
        });

    } catch (error) {
        console.error('Server error getAtasanDisposisi:', error);
        res.status(500).json({ error: error.message });
    }
}

const getAtasanDetailDisposisi = async (req, res) => {
    try {
        const { disposisiId } = req.params;
        const userDetail = await fetchUserDetails(req.user.id);
        
        if (!userDetail) return res.status(404).json({ error: 'User tidak ditemukan' });
        const userJabatan = userDetail.jabatan;

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

        if (disposisi.disposisi_kepada_jabatan !== userJabatan) {
            return res.status(403).json({ error: 'Anda tidak memiliki akses ke disposisi ini' });
        }

        const { data: disposisiFiles } = await supabase
            .from('disposisi_photos')
            .select('*')
            .eq('disposisi_id', disposisiId);

        const suratPhotos = disposisi.surat_masuk?.surat_photos?.map(photo => {
             let photoUrl = `/api/atasan/surat-masuk/photo/${photo.id}`;
             if (photo.foto_path && photo.foto_path.startsWith('http')) photoUrl = photo.foto_path;
             else if (photo.storage_path) {
                 const { data: { publicUrl } } = supabase.storage.from('surat-photos').getPublicUrl(photo.storage_path);
                 photoUrl = publicUrl;
             }
             return { id: photo.id, filename: photo.foto_original_name, size: photo.file_size, url: photoUrl };
        }) || [];

        const disposisiPhotos = disposisiFiles?.map(file => {
             let fileUrl = `/api/v1/disposisi/atasan/${file.id}`;
             if (file.foto_path && file.foto_path.startsWith('http')) fileUrl = file.foto_path;
             else if (file.storage_path) {
                 const { data: { publicUrl } } = supabase.storage.from('disposisi-photos').getPublicUrl(file.storage_path);
                 fileUrl = publicUrl;
             }
             return { id: file.id, filename: file.foto_original_name, size: file.file_size, url: fileUrl };
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
        console.error('Server error getDetail:', error);
        res.status(500).json({ error: error.message });
    }
}

const getAtasanFileDisposisi = async (req, res) => {
    try {
        const { photoId } = req.params;
        const { data: photo, error } = await supabase
            .from('surat_photos')
            .select('foto_path, foto_filename, foto_original_name, storage_path')
            .eq('id', photoId)
            .single();

        if (error || !photo) return res.status(404).json({ error: 'Foto tidak ditemukan' });

        if (photo.foto_path && photo.foto_path.startsWith('http')) return res.redirect(photo.foto_path);
        
        if (photo.storage_path) {
             const { data: { publicUrl } } = supabase.storage.from('surat-photos').getPublicUrl(photo.storage_path);
             return res.redirect(publicUrl);
        }
        return res.status(404).json({ error: 'Path foto tidak valid' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// --- CONTROLLER ACTION (BACA & TERIMA) DENGAN TRY-CATCH ---

const kabidBacaDisposisi = async (req, res) => {
    try {
        const userDetail = await fetchUserDetails(req.user.id);
        if (!userDetail) return res.status(404).json({ error: 'Data user tidak ditemukan' });
        
        const result = await handleBacaDisposisi(req.params.id, userDetail.jabatan, req.user.id, 'kabid');
        
        if (!result.success && result.message.includes('tidak ditemukan')) {
            return res.status(404).json(result);
        }
        res.json(result);
    } catch (error) {
        console.error("Error kabidBacaDisposisi:", error);
        res.status(500).json({ error: error.message });
    }
}

const kabidTerimaDisposisi = async (req, res) => {
    try {
        const userDetail = await fetchUserDetails(req.user.id);
        if (!userDetail) return res.status(404).json({ error: 'Data user tidak ditemukan' });

        const result = await handleTerimaDisposisi(req.params.id, userDetail.jabatan, req.user.id, 'kabid');
        res.json(result);
    } catch (error) {
        console.error("Error kabidTerimaDisposisi:", error);
        res.status(500).json({ error: error.message });
    }
}

const sekretarisBacaDisposisi = async (req, res) => {
    try {
        // Ambil detail user (Join ke tabel jabatan)
        const userDetail = await fetchUserDetails(req.user.id);
        if (!userDetail) return res.status(404).json({ error: 'Data user tidak ditemukan' });

        // Panggil handler
        const result = await handleBacaDisposisi(req.params.id, userDetail.jabatan, req.user.id, 'sekretaris');
        
        // Cek hasil
        if (!result.success && result.message.includes('tidak ditemukan')) {
            return res.status(404).json(result);
        }
        res.json(result);
    } catch (error) {
        console.error("Error sekretarisBacaDisposisi:", error);
        res.status(500).json({ error: error.message });
    }
}

const sekretarisTerimaDisposisi = async (req, res) => {
    try {
        const userDetail = await fetchUserDetails(req.user.id);
        if (!userDetail) return res.status(404).json({ error: 'Data user tidak ditemukan' });

        const result = await handleTerimaDisposisi(req.params.id, userDetail.jabatan, req.user.id, 'sekretaris');
        res.json(result);
    } catch (error) {
        console.error("Error sekretarisTerimaDisposisi:", error);
        res.status(500).json({ error: error.message });
    }
}

const listBawahan = async (req, res) => {
    try {
        const currentUser = await fetchUserDetails(req.user.id);
        if (!currentUser) return res.status(404).json({error: "User tidak ditemukan"});

        const { data: userRaw } = await supabase.from('users').select('bidang_id').eq('id', req.user.id).single();
        
        const { data: bawahanList, error: bawahanError } = await supabase
             .from('users')
             .select(`
                id, 
                name, 
                jabatan:jabatan_id(nama), 
                bidang:bidang_id(nama)
            `)
            .eq('bidang_id', userRaw.bidang_id)
            .neq('id', req.user.id)
            .in('role', ['staff']);

        if (bawahanError) return res.status(500).json({ error: bawahanError.message });

        const formattedBawahan = bawahanList.map(u => ({
            id: u.id,
            name: u.name,
            jabatan: u.jabatan?.nama || '-',
            bidang: u.bidang?.nama || '-'
        }));

        res.json({ message: 'Daftar bawahan', data: formattedBawahan });
    } catch (error) {
        console.error('Server error listBawahan:', error);
        res.status(500).json({ error: error.message });
    }
}

const atasanTeruskanDisposisi = async (req, res) => {
    try {
        const { role, disposisiId } = req.params;
        const {
            diteruskan_kepada_user_id,
            diteruskan_kepada_jabatan,
            catatan_atasan,
            tipe_penerusan
        } = req.body;

        const sender = await fetchUserDetails(req.user.id);
        const statusField = role === 'user' ? 'status_dari_kabid' : 'status_dari_sekretaris';

        const { data: disposisiAwal, error: disposisiError } = await supabase
            .from('disposisi')
            .select('*')
            .eq('id', disposisiId)
            .single();

        if (disposisiError || !disposisiAwal) return res.status(404).json({ error: 'Disposisi tidak ditemukan' });

        if (disposisiAwal.disposisi_kepada_jabatan !== sender.jabatan) {
            return res.status(403).json({ error: 'Disposisi ini bukan untuk Anda' });
        }

        let updateData = {};
        let logKeterangan = '';
        let logKeUserId = null;

        if (req.user.role === 'sekretaris' && tipe_penerusan === 'jabatan') {
            updateData = {
                disposisi_kepada_jabatan: diteruskan_kepada_jabatan,
                status: 'belum dibaca',
                status_dari_bawahan: 'belum dibaca'
            };
            logKeterangan = `Disposisi diteruskan dari ${sender.jabatan} ke jabatan ${diteruskan_kepada_jabatan}`;
        } else {
            const { data: penerima, error: penerimaError } = await supabase
                .from('users')
                .select(`id, name, jabatan:jabatan_id(nama), bidang:bidang_id(nama)`)
                .eq('id', diteruskan_kepada_user_id)
                .single();

            if (penerimaError || !penerima) return res.status(404).json({ error: 'User penerima tidak ditemukan' });

            const penerimaFlat = { ...penerima, jabatan: penerima.jabatan?.nama, bidang: penerima.bidang?.nama };

            if (req.user.role !== 'sekretaris' && penerimaFlat.bidang !== sender.bidang) {
                 return res.status(403).json({ error: 'Hanya bisa meneruskan ke user di bidang yang sama' });
            }

            updateData = {
                diteruskan_kepada_user_id: penerimaFlat.id,
                diteruskan_kepada_jabatan: penerimaFlat.jabatan,
                diteruskan_kepada_nama: penerimaFlat.name,
                catatan_atasan,
                [statusField]: 'diteruskan',
                status_dari_bawahan: 'belum dibaca',
                updated_at: new Date().toISOString()
            };
            logKeterangan = `Disposisi diteruskan dari ${sender.jabatan} ke ${penerimaFlat.name}`;
            logKeUserId = penerimaFlat.id;
        }

        const { data: updatedDisposisi, error: updateError } = await supabase
            .from('disposisi')
            .update(updateData)
            .eq('id', disposisiId)
            .select()
            .single();

        if (updateError) return res.status(400).json({ error: updateError.message });

        await supabase.from('disposisi_status_log').insert({
            disposisi_id: disposisiId,
            status: 'diteruskan',
            oleh_user_id: req.user.id,
            ke_user_id: logKeUserId,
            keterangan: logKeterangan
        });

        res.status(200).json({ message: 'Disposisi berhasil diteruskan', data: updatedDisposisi });

    } catch (error) {
        console.error('Server error teruskan:', error);
        res.status(500).json({ error: error.message });
    }
}

const listJabatan = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('jabatan')
            .select('nama')
            .order('nama', { ascending: true });

        if (error) throw error;
        const jabatanList = data.map(j => j.nama);
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