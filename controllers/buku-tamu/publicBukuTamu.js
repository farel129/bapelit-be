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
        const photos = req.files;

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

        // Insert data kehadiran tamu dengan device_id
        const { data: kehadiran, error: kehadiranError } = await supabase
            .from('kehadiran_tamu')
            .insert([{
                buku_tamu_id: event.id,
                device_id: device_id, // 👈 PENTING: Simpan device_id
                nama_lengkap,
                instansi: instansi || '',
                jabatan: jabatan || '',
                keperluan: keperluan || ''
            }])
            .select();

        if (kehadiranError) {
            console.error('Supabase error:', kehadiranError);
            return res.status(500).json({ error: kehadiranError.message });
        }

        const kehadiranId = kehadiran[0].id;
        const uploadedPhotos = [];

        // Process uploaded photos jika ada
        if (photos && photos.length > 0) {
            for (const photo of photos) {
                try {
                    // Validasi file
                    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
                    const maxSize = 5 * 1024 * 1024; // 5MB

                    if (!allowedTypes.includes(photo.mimetype)) {
                        console.error(`Invalid file type: ${photo.mimetype}`);
                        continue;
                    }

                    if (photo.size > maxSize) {
                        console.error(`File too large: ${photo.size} bytes`);
                        continue;
                    }

                    // Upload menggunakan fungsi uploadBuktiTamu
                    const uploadResult = await uploadBuktiTamu(photo, 'bukti-tamu');

                    // Simpan info foto ke database
                    const { data: fotoData, error: fotoError } = await supabase
                        .from('foto_kehadiran_tamu')
                        .insert([{
                            kehadiran_tamu_id: kehadiranId,
                            file_url: uploadResult.publicUrl,
                            file_name: uploadResult.fileName,
                            original_name: uploadResult.originalName,
                            file_size: uploadResult.size,
                            mime_type: uploadResult.mimetype
                        }])
                        .select();

                    if (fotoError) {
                        console.error('Error saving photo info:', fotoError);
                        // Jika gagal simpan ke DB, hapus file dari storage
                        try {
                            await supabaseAdmin.storage
                                .from('buku-tamu')
                                .remove([uploadResult.fileName]);
                        } catch (removeError) {
                            console.error('Error removing uploaded file:', removeError);
                        }
                    } else {
                        uploadedPhotos.push({
                            ...fotoData[0],
                            public_url: uploadResult.publicUrl
                        });
                    }

                } catch (photoError) {
                    console.error('Error processing photo:', photoError);
                }
            }
        }

        res.status(201).json({
            message: 'Kehadiran berhasil dicatat',
            attendance: kehadiran[0],
            uploaded_photos: uploadedPhotos,
            photo_count: uploadedPhotos.length
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal mencatat kehadiran' });
    }
}

module.exports = { checkDevice, getPublicBukuTamu, submitPublicBukuTamu}