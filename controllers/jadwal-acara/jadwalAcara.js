const { supabase } = require("../../config/supabase");
const logger = require("../../utils/logger");


const buatJadwalAcara = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user?.id || 'unknown';

    logger.info("Memulai pembuatan jadwal acara", { userId, body: req.body });

    try {
        const {
            nama_acara,
            deskripsi,
            tanggal_mulai,
            tanggal_selesai,
            waktu_mulai,
            waktu_selesai,
            lokasi,
            pic_nama,
            pic_kontak,
            kategori = "",
            status = "aktif",
            prioritas = "biasa",
            peserta_target
        } = req.body;

        // VALIDASI INPUT
        if (!nama_acara || !tanggal_mulai || !waktu_mulai || !lokasi || !pic_nama) {
            const errorMsg = "Field wajib tidak lengkap";
            logger.warn(errorMsg, { userId, received: { nama_acara, tanggal_mulai, waktu_mulai, lokasi, pic_nama } });
            return res.status(400).json({
                error: errorMsg,
                received: { nama_acara, tanggal_mulai, waktu_mulai, lokasi, pic_nama }
            });
        }

        // VALIDASI TANGGAL
        // VALIDASI TANGGAL
        // VALIDASI TANGGAL
const startDate = new Date(tanggal_mulai + " " + waktu_mulai);
const startDateWIB = new Date(startDate.getTime() + 7 * 60 * 60 * 1000); // konversi ke representasi WIB dalam UTC
const nowUTC = new Date();

if (startDateWIB < nowUTC) {
    const errorMsg = "Tanggal dan waktu mulai tidak boleh di masa lalu";
    logger.warn(errorMsg, { 
        userId, 
        startDate: startDate.toISOString(), 
        startDateWIB: startDateWIB.toISOString(), 
        nowUTC: nowUTC.toISOString() 
    });
    return res.status(400).json({ error: errorMsg });
}

const endDate =
    tanggal_selesai && waktu_selesai
        ? new Date(tanggal_selesai + " " + waktu_selesai)
        : null;

if (endDate) {
    const endDateWIB = new Date(endDate.getTime() + 7 * 60 * 60 * 1000);
    if (endDateWIB <= startDateWIB) {
        const errorMsg = "Tanggal dan waktu selesai harus setelah waktu mulai";
        logger.warn(errorMsg, { userId, startDateWIB, endDateWIB });
        return res.status(400).json({ error: errorMsg });
    }
}
        const jadwalData = {
            nama_acara,
            deskripsi: deskripsi || "",
            tanggal_mulai,
            tanggal_selesai: tanggal_selesai || tanggal_mulai,
            waktu_mulai,
            waktu_selesai: waktu_selesai || null,
            lokasi,
            pic_nama,
            pic_kontak: pic_kontak || "",
            kategori,
            status,
            prioritas,
            peserta_target: peserta_target || null,
            created_by: userId,
            created_at: new Date(new Date().getTime() + 7 * 60 * 60 * 1000).toISOString()
        };

        // INSERT KE DATABASE
        const { data, error } = await supabase
            .from("jadwal_acara")
            .insert([jadwalData])
            .select()
            .single();

        if (error) {
            logger.error("Gagal menyimpan jadwal acara ke database", { userId, error: error.message });
            return res.status(400).json({ error: error.message });
        }

        logger.info("Jadwal acara berhasil disimpan", { userId, acaraId: data.id });

        
        logger.info("Permintaan buat jadwal acara berhasil", {
            userId,
            acaraId: data.id,
            duration: Date.now() - startTime
        });
        

        res.status(201).json({
            message: "Jadwal acara berhasil dibuat",
            data: data
        });

    } catch (error) {
        logger.error("Server error saat membuat jadwal acara", {
            userId,
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });
        res.status(500).json({ error: "Gagal membuat jadwal acara" });
    }
};

const getJadwalAcara = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user?.id || 'unknown';
    const {
        status = '',
        kategori = '',
        bulan = '',
        tahun = new Date().getFullYear(),
        page = 1,
        limit = 10
    } = req.query;

    logger.info("Memulai pengambilan daftar jadwal acara", {
        userId,
        query: { status, kategori, bulan, tahun, page, limit }
    });

    try {
        let query = supabase
    .from('jadwal_acara')
    .select(`
        *,
        creator:created_by(name, email)
    `, { count: 'exact' })  // ← TAMBAHKAN INI
    .order('tanggal_mulai', { ascending: true })
    .order('waktu_mulai', { ascending: true });

        // Filter berdasarkan status
        if (status) {
            query = query.eq('status', status);
        }

        // Filter berdasarkan kategori
        if (kategori) {
            query = query.eq('kategori', kategori);
        }

        // Filter berdasarkan bulan dan tahun
        // Filter berdasarkan bulan dan tahun
        // Filter berdasarkan bulan dan tahun
if (tahun) {
    const yearNum = parseInt(tahun, 10);
    if (!isNaN(yearNum)) {
        if (bulan) {
            // Filter bulan spesifik dalam tahun
            const monthNum = parseInt(bulan, 10);
            if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
                const startDate = new Date(yearNum, monthNum - 1, 1);
                const endDate = new Date(yearNum, monthNum, 0);
                const startStr = startDate.toISOString().split('T')[0];
                const endStr = endDate.toISOString().split('T')[0];

                logger.info("Filter bulan aktif", { startStr, endStr, monthNum, yearNum });
                query = query.gte('tanggal_mulai', startStr).lte('tanggal_mulai', endStr);
            }
            // Jika bulan tidak valid, abaikan — jangan error
        } else {
            // Filter seluruh tahun
            const startOfYear = new Date(yearNum, 0, 1); // 1 Jan
            const endOfYear = new Date(yearNum, 11, 31); // 31 Des
            const startStr = startOfYear.toISOString().split('T')[0];
            const endStr = endOfYear.toISOString().split('T')[0];

            logger.info("Filter tahun aktif", { startStr, endStr, yearNum });
            query = query.gte('tanggal_mulai', startStr).lte('tanggal_mulai', endStr);
        }
    }
}

        // Pagination
        const offset = (page - 1) * limit;
        query = query.range(offset, offset + limit - 1);

        const { data, error, count } = await query;

        if (error) {
            logger.error("Gagal mengambil daftar jadwal acara", { userId, error: error.message });
            return res.status(400).json({ error: error.message });
        }

        logger.info("Berhasil mengambil daftar jadwal acara", {
            userId,
            totalData: data?.length || 0,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 },
            duration: Date.now() - startTime
        });

        res.json({
            message: 'Daftar jadwal acara',
            data: data || [],
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count || data?.length || 0
            }
        });
    } catch (error) {
        logger.error("Server error saat mengambil jadwal acara", {
            userId,
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });
        res.status(500).json({ error: error.message });
    }
};

const getDetailAcara = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user?.id || 'unknown';
    const { id } = req.params;

    logger.info("Memulai pengambilan detail jadwal acara", { userId, acaraId: id });

    try {
        const { data, error } = await supabase
            .from('jadwal_acara')
            .select(`
                *,
                creator:created_by(name, email, jabatan)
            `)
            .eq('id', id)
            .single();

        if (error) {
            logger.error("Gagal mengambil detail jadwal acara", { userId, acaraId: id, error: error.message });
            return res.status(400).json({ error: error.message });
        }

        if (!data) {
            logger.warn("Jadwal acara tidak ditemukan", { userId, acaraId: id });
            return res.status(404).json({ error: 'Jadwal acara tidak ditemukan' });
        }

        logger.info("Berhasil mengambil detail jadwal acara", {
            userId,
            acaraId: id,
            duration: Date.now() - startTime
        });

        res.json({
            message: 'Detail jadwal acara',
            data: data
        });
    } catch (error) {
        logger.error("Server error saat mengambil detail jadwal acara", {
            userId,
            acaraId: id,
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });
        res.status(500).json({ error: error.message });
    }
};

const updateJadwalAcara = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user?.id || 'unknown';
    const { id } = req.params;

    logger.info("Memulai update jadwal acara", { userId, acaraId: id, body: req.body });

    try {
        const {
            nama_acara,
            deskripsi,
            tanggal_mulai,
            tanggal_selesai,
            waktu_mulai,
            waktu_selesai,
            lokasi,
            pic_nama,
            pic_kontak,
            kategori,
            status,
            prioritas,
            peserta_target
        } = req.body;

        // Cek apakah jadwal acara ada
        const { data: existing, error: checkError } = await supabase
            .from('jadwal_acara')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            const errorMsg = 'Jadwal acara tidak ditemukan';
            logger.warn(errorMsg, { userId, acaraId: id });
            return res.status(404).json({ error: errorMsg });
        }

        // VALIDASI TANGGAL jika diubah
        if (tanggal_mulai && waktu_mulai) {
            const startDate = new Date(tanggal_mulai + ' ' + waktu_mulai);
            const endDate = tanggal_selesai && waktu_selesai ? new Date(tanggal_selesai + ' ' + waktu_selesai) : null;

            if (endDate && endDate <= startDate) {
                const errorMsg = 'Tanggal dan waktu selesai harus setelah waktu mulai';
                logger.warn(errorMsg, { userId, startDate, endDate });
                return res.status(400).json({ error: errorMsg });
            }
        }

        const updateData = {
            nama_acara,
            deskripsi,
            tanggal_mulai,
            tanggal_selesai,
            waktu_mulai,
            waktu_selesai,
            lokasi,
            pic_nama,
            pic_kontak,
            kategori,
            status,
            prioritas,
            peserta_target,
            updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        };

        // Hapus field yang undefined
        Object.keys(updateData).forEach(key => {
            if (updateData[key] === undefined) {
                delete updateData[key];
            }
        });

        const { data, error } = await supabase
            .from('jadwal_acara')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            logger.error("Gagal update jadwal acara", { userId, acaraId: id, error: error.message });
            return res.status(400).json({ error: error.message });
        }

        logger.info("Berhasil update jadwal acara", {
            userId,
            acaraId: id,
            updatedFields: Object.keys(updateData),
            duration: Date.now() - startTime
        });

        res.json({
            message: 'Jadwal acara berhasil diupdate',
            data: data
        });
    } catch (error) {
        logger.error("Server error saat update jadwal acara", {
            userId,
            acaraId: id,
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });
        res.status(500).json({ error: error.message });
    }
};

const deleteJadwalAcara = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user?.id || 'unknown';
    const { id } = req.params;

    logger.info("Memulai penghapusan jadwal acara", { userId, acaraId: id });

    try {
        // Cek apakah jadwal acara ada
        const { data: existing, error: checkError } = await supabase
            .from('jadwal_acara')
            .select('nama_acara')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            const errorMsg = 'Jadwal acara tidak ditemukan';
            logger.warn(errorMsg, { userId, acaraId: id });
            return res.status(404).json({ error: errorMsg });
        }

        const { error } = await supabase
            .from('jadwal_acara')
            .delete()
            .eq('id', id);

        if (error) {
            logger.error("Gagal hapus jadwal acara", { userId, acaraId: id, error: error.message });
            return res.status(400).json({ error: error.message });
        }

        logger.info("Berhasil hapus jadwal acara", {
            userId,
            acaraId: id,
            deletedItem: existing.nama_acara,
            duration: Date.now() - startTime
        });

        res.json({
            message: 'Jadwal acara berhasil dihapus',
            deleted_item: existing.nama_acara
        });
    } catch (error) {
        logger.error("Server error saat hapus jadwal acara", {
            userId,
            acaraId: id,
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });
        res.status(500).json({ error: error.message });
    }
};

const updateStatusAcara = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user?.id || 'unknown';
    const { id } = req.params;
    const { status } = req.body;

    logger.info("Memulai update status jadwal acara", { userId, acaraId: id, newStatus: status });

    try {
        // Validasi status
        const validStatus = ['aktif', 'selesai', 'dibatalkan', 'ditunda'];
        if (!status || !validStatus.includes(status)) {
            const errorMsg = `Status harus salah satu dari: ${validStatus.join(', ')}`;
            logger.warn(errorMsg, { userId, acaraId: id, receivedStatus: status });
            return res.status(400).json({ error: errorMsg });
        }

        const { data, error } = await supabase
            .from('jadwal_acara')
            .update({
                status,
                updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            logger.error("Gagal update status jadwal acara", { userId, acaraId: id, error: error.message });
            return res.status(400).json({ error: error.message });
        }

        if (!data) {
            const errorMsg = 'Jadwal acara tidak ditemukan';
            logger.warn(errorMsg, { userId, acaraId: id });
            return res.status(404).json({ error: errorMsg });
        }

        logger.info("Berhasil update status jadwal acara", {
            userId,
            acaraId: id,
            newStatus: status,
            duration: Date.now() - startTime
        });

        res.json({
            message: `Status jadwal acara berhasil diubah menjadi ${status}`,
            data: data
        });
    } catch (error) {
        logger.error("Server error saat update status jadwal acara", {
            userId,
            acaraId: id,
            error: error.message,
            stack: error.stack,
            duration: Date.now() - startTime
        });
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    buatJadwalAcara,
    getJadwalAcara,
    getDetailAcara,
    updateJadwalAcara,
    deleteJadwalAcara,
    updateStatusAcara
};