const { supabase, supabaseAdmin } = require("../../config/supabase");
const { generateQRToken } = require("../../utils/qrGenerator");
const QRCode = require('qrcode')

const buatBukuTamu = async (req, res) => {
    try {
        const { nama_acara, tanggal_acara, lokasi, deskripsi } = req.body;

        // Validasi input
        if (!nama_acara || !tanggal_acara || !lokasi) {
            return res.status(400).json({
                error: 'Nama acara, tanggal, dan lokasi harus diisi'
            });
        }

        // Generate unique QR token
        const qr_token = generateQRToken();

        // Insert ke database
        const { data, error } = await supabase
            .from('buku_tamu')
            .insert([{
                nama_acara,
                tanggal_acara,
                lokasi,
                deskripsi: deskripsi || '',
                qr_token,
                created_by: req.user.id,
                status: 'active'
            }])
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        // Generate QR Code
        const qrUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/guest/${qr_token}`;
        const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
            width: 2000,        // Ukuran besar untuk print
            margin: 2,          // Margin minimal agar QR tetap terbaca
            color: {
                dark: '#000000',  // Warna hitam solid
                light: '#ffffff'  // Background putih
            },
            type: 'image/png',  // Format PNG lebih baik untuk print
            quality: 1.0        // Kualitas maksimal (untuk PNG, ini opsional)
        });

        res.status(201).json({
            message: 'Buku tamu berhasil dibuat',
            event: data[0],
            qr_code: qrCodeDataURL,
            guest_url: qrUrl
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal membuat buku tamu' });
    }
};

const getBukuTamu = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, search } = req.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('buku_tamu')
            .select(`
            *,
            kehadiran_tamu(count)
          `)
            .order('created_at', { ascending: false });

        // Filter berdasarkan status jika ada
        if (status && ['active', 'inactive'].includes(status)) {
            query = query.eq('status', status);
        }

        // Search berdasarkan nama acara atau lokasi
        if (search) {
            query = query.or(`nama_acara.ilike.%${search}%,lokasi.ilike.%${search}%`);
        }

        // Pagination
        query = query.range(offset, offset + limit - 1);

        const { data, error, count } = await query;

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({
            message: 'Data buku tamu berhasil diambil',
            data: data,
            pagination: {
                current_page: parseInt(page),
                total_pages: Math.ceil(count / limit),
                total_items: count,
                items_per_page: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal mengambil data buku tamu' });
    }
}

const getListTamu = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 10, search } = req.query;
        const offset = (page - 1) * limit;

        // Cek apakah buku tamu exists
        const { data: bukuTamu, error: bukuTamuError } = await supabase
            .from('buku_tamu')
            .select('id, nama_acara, tanggal_acara, lokasi')
            .eq('id', id)
            .single();

        if (bukuTamuError || !bukuTamu) {
            return res.status(404).json({ error: 'Buku tamu tidak ditemukan' });
        }

        let query = supabase
            .from('kehadiran_tamu')
            .select(`
        *,
        foto_kehadiran_tamu(
          id,
          file_url,
          file_name,
          original_name,
          file_size,
          mime_type
        )
      `)
            .eq('buku_tamu_id', id)
            .order('check_in_time', { ascending: false });

        // Search berdasarkan nama atau instansi
        if (search) {
            query = query.or(`nama_lengkap.ilike.%${search}%,instansi.ilike.%${search}%`);
        }

        // Pagination
        query = query.range(offset, offset + limit - 1);

        const { data: tamu, error: tamuError, count } = await query;

        if (tamuError) {
            console.error('Supabase error:', tamuError);
            return res.status(500).json({ error: tamuError.message });
        }

        res.json({
            message: 'Data tamu berhasil diambil',
            buku_tamu: bukuTamu,
            data: tamu,
            pagination: {
                current_page: parseInt(page),
                total_pages: Math.ceil(count / limit),
                total_items: count,
                items_per_page: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal mengambil data tamu' });
    }
}

const updateStatusBukuTamu = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // Validasi status
        if (!status || !['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                error: 'Status harus berupa "active" atau "inactive"'
            });
        }

        const { data, error } = await supabase
            .from('buku_tamu')
            .update({
                status,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Buku tamu tidak ditemukan' });
        }

        res.json({
            message: `Status buku tamu berhasil diubah menjadi ${status}`,
            data: data[0]
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal mengubah status buku tamu' });
    }
}

const deleteBukuTamu = async (req, res) => {
    try {
        const { id } = req.params;

        // Hapus buku tamu (cascade akan menghapus kehadiran_tamu dan foto_kehadiran_tamu)
        const { data, error } = await supabase
            .from('buku_tamu')
            .delete()
            .eq('id', id)
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Buku tamu tidak ditemukan' });
        }

        res.json({
            message: 'Buku tamu berhasil dihapus',
            deleted_event: data[0]
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal menghapus buku tamu' });
    }
}

const deleteFotoTamu = async (req, res) => {
    try {
        const { foto_id } = req.params;

        // Get foto data terlebih dahulu
        const { data: foto, error: fotoError } = await supabase
            .from('foto_kehadiran_tamu')
            .select('*')
            .eq('id', foto_id)
            .single();

        if (fotoError || !foto) {
            return res.status(404).json({ error: 'Foto tidak ditemukan' });
        }

        // Extract file name dari file_url atau gunakan file_name langsung
        let fileName = foto.file_name;

        // Jika file_name kosong, extract dari file_url
        if (!fileName && foto.file_url) {
            const urlParts = foto.file_url.split('/');
            const bucketIndex = urlParts.findIndex(part => part === 'buku-tamu');
            if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
                // Ambil path setelah bucket name
                fileName = urlParts.slice(bucketIndex + 1).join('/');
            }
        }

        console.log('Attempting to delete file:', fileName);

        // Hapus file dari Supabase Storage terlebih dahulu
        let storageDeleteSuccess = false;
        if (fileName) {
            try {
                const { error: storageError } = await supabaseAdmin.storage
                    .from('buku-tamu')
                    .remove([fileName]);

                if (storageError) {
                    console.error('Storage delete error:', storageError);

                } else {
                    storageDeleteSuccess = true;
                    console.log('File successfully deleted from storage:', fileName);
                }
            } catch (storageError) {
                console.error('Storage delete exception:', storageError);
                // Lanjutkan ke penghapusan database
            }
        }

        // Hapus record dari database
        const { error: deleteError } = await supabase
            .from('foto_kehadiran_tamu')
            .delete()
            .eq('id', foto_id);

        if (deleteError) {
            console.error('Database delete error:', deleteError);
            return res.status(500).json({ error: deleteError.message });
        }

        // Response dengan informasi lengkap
        res.json({
            message: 'Foto tamu berhasil dihapus',
            deleted_photo: {
                id: foto.id,
                file_name: foto.file_name,
                original_name: foto.original_name,
                file_url: foto.file_url
            },
            storage_deleted: storageDeleteSuccess,
            file_path_used: fileName
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Gagal menghapus foto tamu' });
    }
}

module.exports = { buatBukuTamu, getBukuTamu, getListTamu, updateStatusBukuTamu, deleteBukuTamu, deleteFotoTamu }