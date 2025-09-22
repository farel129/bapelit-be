const { supabase, supabaseAdmin } = require("../../config/supabase");
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

        // Proses setiap surat dan lampirannya secara async
        const dataWithLampiranInfo = await Promise.all(
            (data || []).map(async (surat) => {
                const lampiran = surat.surat_keluar_lampiran || [];

                // Proses setiap file lampiran
                const files = await Promise.all(
                    lampiran.map(async (file) => {
                        let fileUrl = `/api/v1/surat-keluar/file/${file.id}`;

                        // Prioritas 1: Jika sudah URL penuh
                        if (file.file_path && file.file_path.startsWith('http')) {
                            fileUrl = file.file_path;
                        }
                        // Prioritas 2: Jika ada storage_path, generate public URL
                        else if (file.storage_path) {
                            const { data: urlData } = await supabase.storage
                                .from('surat-photos') // ✅ KONSISTEN!
                                .getPublicUrl(file.storage_path);

                            if (urlData?.publicUrl) {
                                fileUrl = urlData.publicUrl;
                            }
                        }

                        return {
                            id: file.id,
                            filename: file.file_original_name,
                            size: file.file_size,
                            url: fileUrl,
                        };
                    })
                );

                return {
                    ...surat,
                    file_count: files.length,
                    has_files: files.length > 0,
                    files: files,
                };
            })
        );

        res.json({
            data: dataWithLampiranInfo,
            total: dataWithLampiranInfo.length,
        });

    } catch (error) {
        console.error('Server error in getSuratKeluarAll:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
};

const getFileSuratKeluar = async (req, res) => {
    try {
        const { fileId } = req.params;

        const { data: file, error } = await supabase
            .from('surat_keluar_lampiran')
            .select('file_path, storage_path')
            .eq('id', fileId)
            .single();

        if (error || !file) {
            return res.status(404).json({ error: 'File tidak ditemukan' });
        }

        // Prioritas 1: Redirect langsung jika file_path adalah URL
        if (file.file_path && file.file_path.startsWith('http')) {
            return res.redirect(file.file_path);
        }

        // Prioritas 2: Generate public URL dari storage
        if (file.storage_path) {
            const { data: urlData } = await supabase.storage
                .from('surat-photos') // ✅ KONSISTEN!
                .getPublicUrl(file.storage_path);

            if (urlData?.publicUrl) {
                return res.redirect(urlData.publicUrl);
            }
        }

        // Fallback jika tidak ada cara akses file
        return res.status(404).json({ error: 'File tidak dapat diakses' });

    } catch (error) {
        console.error('Server error in getFileSuratKeluar:', error);
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
};

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
            const { data: removed, error: storageError } = await supabaseAdmin
                .storage
                .from('surat-photos')
                .remove(filesToDelete)
            if (storageError) throw storageError;

            console.log("Removed result:", removed);
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

module.exports = { buatSuratKeluar, getSuratKeluarAll, deleteSuratKeluar, getFileSuratKeluar }