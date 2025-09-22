const { supabase, supabaseAdmin } = require("../../config/supabase");
const { uploadBuktiTamu } = require("../../utils/uploadSupabase");

const checkDevice = async (req, res) => {
    try {
        const { qr_token } = req.params;
        const { device_id } = req.body;

        if (!device_id) {
            return res.status(400).json({
                error: 'Device ID required'
            });
        }

        // 1. Get event info
        const { data: event, error: eventError } = await supabase
            .from('buku_tamu')
            .select('id, nama_acara, lokasi, tanggal_acara, deskripsi, status')
            .eq('qr_token', qr_token)
            .eq('status', 'active')
            .single();

        if (eventError || !event) {
            return res.status(404).json({
                error: 'Buku tamu tidak ditemukan atau sudah tidak aktif'
            });
        }

        // 2. Check submission by device_id
        const { data: kehadiran, error: checkError } = await supabase
            .from('kehadiran_tamu')
            .select(`
            id, 
            nama_lengkap, 
            instansi, 
            jabatan, 
            keperluan, 
            check_in_time,
            created_at
          `)
            .eq('buku_tamu_id', event.id)
            .eq('device_id', device_id)
            .single();

        if (kehadiran) {
            // Device sudah pernah submit
            res.json({
                hasSubmitted: true,
                event: event,
                submission: {
                    nama_lengkap: kehadiran.nama_lengkap,
                    instansi: kehadiran.instansi,
                    jabatan: kehadiran.jabatan,
                    keperluan: kehadiran.keperluan,
                    submitted_at: kehadiran.created_at,
                    check_in_time: kehadiran.check_in_time
                }
            });
        } else {
            // Device belum pernah submit
            res.json({
                hasSubmitted: false,
                event: event
            });
        }

    } catch (error) {
        console.error('Check device submission error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
}

const getPublicBukuTamu = async (req, res) => {
    try {
        const { qr_token } = req.params;

        const { data, error } = await supabase
            .from('buku_tamu')
            .select('id, nama_acara, tanggal_acara, lokasi, deskripsi, status')
            .eq('qr_token', qr_token)
            .eq('status', 'active')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'buku tamu tidak ditemukan atau sudah tidak aktif'
            });
        }

        res.json({
            message: 'Info acara berhasil diambil',
            event: data
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal mengambil info acara' });
    }
}

const submitPublicBukuTamu = async (req, res) => {
    try {
        const { qr_token } = req.params;
        const { nama_lengkap, instansi, jabatan, keperluan, device_id } = req.body;

        // Validasi input
        if (!nama_lengkap || !device_id) {
            return res.status(400).json({
                error: 'Nama lengkap dan device ID harus diisi'
            });
        }

        // Cek apakah buku tamu exists dan active
        const { data: event, error: eventError } = await supabase
            .from('buku_tamu')
            .select('id')
            .eq('qr_token', qr_token)
            .eq('status', 'active')
            .single();

        if (eventError || !event) {
            return res.status(404).json({
                error: 'Event tidak ditemukan atau sudah tidak aktif'
            });
        }

        // 🚨 CHECK: Apakah device_id sudah pernah submit untuk event ini?
        const { data: existingSubmission, error: checkError } = await supabase
            .from('kehadiran_tamu')
            .select('id, nama_lengkap, created_at')
            .eq('buku_tamu_id', event.id)
            .eq('device_id', device_id)
            .single();

        if (existingSubmission) {
            return res.status(409).json({
                error: 'Device ini sudah pernah mengisi buku tamu untuk event ini',
                existing_submission: {
                    nama_lengkap: existingSubmission.nama_lengkap,
                    submitted_at: existingSubmission.created_at
                }
            });
        }

        const kehadiranData = {
            buku_tamu_id: event.id,
            device_id: device_id,
            nama_lengkap,
            instansi: instansi || '',
            jabatan: jabatan || '',
            keperluan: keperluan || ''
        }

        // Insert data kehadiran tamu dengan device_id
        const { data: kehadiran, error: kehadiranError } = await supabase
            .from('kehadiran_tamu')
            .insert([kehadiranData])
            .select()
            .single();

        if (kehadiranError) {
            console.error('Supabase error:', kehadiranError);
            return res.status(500).json({ error: kehadiranError.message });
        }

        let photoKehadiranCount = 0;
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(file =>
                uploadBuktiTamu(file, 'bukti-tamu', 'buku-tamu')
            );

            try {
                const uploadResults = await Promise.all(uploadPromises);

                // Simpan data lampiran ke database
                const fotoData = uploadResults.map(result => ({
                    kehadiran_tamu_id: kehadiran.id,
                    file_url: result.publicUrl,
                    file_name: result.fileName,
                    storage_path: result.fileName,
                    original_name: result.originalName,
                    file_size: result.size,
                    mime_type: result.mimetype
                }));

                const { error: fileError } = await supabase
                    .from('foto_kehadiran_tamu')
                    .insert(fotoData);

                if (fileError) {
                    await supabase.from('kehadiran_tamu').delete().eq('id', kehadiran.id);

                    // Hapus files dari Supabase Storage
                    const filesToDelete = uploadResults.map(r => r.fileName);
                    await supabaseAdmin.storage.from('buku-tamu').remove(filesToDelete);

                    return res.status(400).json({ error: 'Gagal menyimpan foto: ' + fileError.message });
                }

                photoKehadiranCount = req.files.length;
            } catch (uploadError) {
                console.log('Upload error:', uploadError);
                await supabase.from('kehadiran_tamu').delete().eq('id', kehadiran.id);
                return res.status(400).json({ error: 'Gagal upload lampiran: ' + uploadError.message });
            }
        }

        res.status(201).json({
            message: 'kehadiran berhasil dibuat',
            data: {
                ...kehadiran,
                photo_count: photoKehadiranCount,
                has_photo: photoKehadiranCount > 0
            }
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = { checkDevice, getPublicBukuTamu, submitPublicBukuTamu }