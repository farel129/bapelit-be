const { supabase } = require("../../config/supabase");
const { uploadToSupabaseStorage } = require("../../utils/uploadSupabase");

const buatSuratKeluar = async (req, res) => {
    try {
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
            console.log('Supabase error:', suratError);
            return res.status(400).json({ error: suratError.message });
        }

        // Upload lampiran ke Supabase Storage
        let lampiranCount = 0;
        if (req.files && req.files.length > 0) {
            console.log('User info:', req.user);
            
            // PERBAIKAN: Gunakan bucket yang benar, bukan authorization token
            const uploadPromises = req.files.map(file =>
                uploadToSupabaseStorage(file, 'surat-keluar', 'surat-photos') // Perbaikan di sini
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
                    await supabase.storage.from('surat-photos').remove(filesToDelete);

                    return res.status(400).json({ error: 'Gagal menyimpan lampiran: ' + fileError.message });
                }

                lampiranCount = req.files.length;
            } catch (uploadError) {
                console.log('Upload error:', uploadError);
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
        console.error('Server error:', error); // Tambahkan log error
        res.status(500).json({ error: error.message });
    }
}

const getSuratKeluarAll = async (req, res) => {
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
}

const deleteSuratKeluar = async (req, res) => {
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
}

module.exports = { buatSuratKeluar, getSuratKeluarAll, deleteSuratKeluar }