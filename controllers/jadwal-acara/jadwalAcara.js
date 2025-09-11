const {Resend} = require("resend");
const { supabase } = require("../../config/supabase");
const logger = require("../../utils/logger");

const resend = new Resend(process.env.RESEND_API_KEY);

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
        const startDate = new Date(tanggal_mulai + " " + waktu_mulai);
        const endDate =
            tanggal_selesai && waktu_selesai
                ? new Date(tanggal_selesai + " " + waktu_selesai)
                : null;

        if (startDate < new Date()) {
            const errorMsg = "Tanggal dan waktu mulai tidak boleh di masa lalu";
            logger.warn(errorMsg, { userId, startDate });
            return res.status(400).json({ error: errorMsg });
        }

        if (endDate && endDate <= startDate) {
            const errorMsg = "Tanggal dan waktu selesai harus setelah waktu mulai";
            logger.warn(errorMsg, { userId, startDate, endDate });
            return res.status(400).json({ error: errorMsg });
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

        // 🔹 Ambil semua email user dari tabel users
        const { data: users, error: userError } = await supabase
            .from("users")
            .select("email");

        if (userError) {
            logger.error("Gagal mengambil daftar user untuk notifikasi email", { userId, error: userError.message });
        } else {
            const validEmails = users
                .map(u => u.email)
                .filter(email => email && typeof email === 'string')
                .map(email => email.trim())
                .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

            if (validEmails.length === 0) {
                logger.warn("Tidak ada email valid untuk dikirim", { userId });
            } else {
                logger.info(`Mengirim notifikasi ke ${validEmails.length} pengguna`, { userId });

                const emailPromises = validEmails.map(email =>
                    resend.emails.send({
                        from: 'Sistem Pemkot <onboarding@resend.dev>',
                        to: [email],
                        subject: `[SISTEM PEMKOT] 📅 Jadwal Acara Baru: ${nama_acara}`,
                        text: `JADWAL ACARA BARU

                        Nama Acara: ${nama_acara}
                        Deskripsi: ${deskripsi || "Tidak ada deskripsi"}
                        Tanggal: ${tanggal_mulai} pukul ${waktu_mulai}
                        ${tanggal_selesai && tanggal_selesai !== tanggal_mulai ? `s/d ${tanggal_selesai}` : ''} 
                        ${waktu_selesai ? ` pukul ${waktu_selesai}` : ''}
                        Lokasi: ${lokasi}
                        PIC: ${pic_nama} ${pic_kontak ? `(${pic_kontak})` : ''}
                        ${kategori ? `Kategori: ${kategori}` : ''}
                        ${prioritas !== 'biasa' ? `Prioritas: ${prioritas.toUpperCase()}` : ''}
                        
                        Lihat detail lengkap di: https://sistem-pemkot.local/dashboard  
                        
                        ---
                        Email otomatis dari Sistem Surat Pemkot
                        Mohon tidak membalas email ini`,
                        html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                          <h1 style="color: #2563eb; margin: 0; font-size: 24px;">
                            📅 Jadwal Acara Baru
                          </h1>
                          <div style="width: 100%; height: 3px; background: linear-gradient(90deg, #2563eb, #3b82f6); margin: 10px 0;"></div>
                        </div>
    
                        <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; border-left: 4px solid #2563eb; margin-bottom: 25px;">
                          <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 20px;">
                            ${nama_acara}
                          </h2>
                          
                          <div style="margin-bottom: 15px;">
                            <strong style="color: #374151;">📝 Deskripsi:</strong><br/>
                            <span style="color: #6b7280;">${deskripsi || "Tidak ada deskripsi"}</span>
                          </div>
                          
                          <div style="margin-bottom: 15px;">
                            <strong style="color: #374151;">📅 Tanggal & Waktu:</strong><br/>
                            <span style="color: #059669; font-weight: 600;">
                              ${tanggal_mulai} pukul ${waktu_mulai}
                              ${tanggal_selesai && tanggal_selesai !== tanggal_mulai ?
                                    `<br/>s/d ${tanggal_selesai}` : ''} 
                              ${waktu_selesai ? ` pukul ${waktu_selesai}` : ''}
                            </span>
                          </div>
                          
                          <div style="margin-bottom: 15px;">
                            <strong style="color: #374151;">📍 Lokasi:</strong><br/>
                            <span style="color: #dc2626; font-weight: 600;">${lokasi}</span>
                          </div>
                          
                          <div style="margin-bottom: 15px;">
                            <strong style="color: #374151;">👤 PIC (Person In Charge):</strong><br/>
                            <span style="color: #7c3aed; font-weight: 600;">
                              ${pic_nama} ${pic_kontak ? `<br/>📞 ${pic_kontak}` : ''}
                            </span>
                          </div>
                          
                          ${kategori ? `
                            <div style="margin-bottom: 15px;">
                              <strong style="color: #374151;">🏷️ Kategori:</strong>
                              <span style="background-color: #e5e7eb; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #374151;">${kategori}</span>
                            </div>
                          ` : ''}
                          
                          ${prioritas !== 'biasa' ? `
                            <div style="margin-bottom: 15px;">
                              <strong style="color: #374151;">⚡ Prioritas:</strong>
                              <span style="background-color: #fee2e2; color: #dc2626; padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 14px; text-transform: uppercase;">
                                ${prioritas}
                              </span>
                            </div>
                          ` : ''}
    
                          ${peserta_target ? `
                            <div style="margin-bottom: 15px;">
                              <strong style="color: #374151;">👥 Target Peserta:</strong><br/>
                              <span style="color: #059669; font-weight: 600;">${peserta_target}</span>
                            </div>
                          ` : ''}
                        </div>
                        
                        <div style="text-align: center; margin: 30px 0;">
                          <a href="https://sistem-pemkot.local/dashboard" 
                             style="background: linear-gradient(135deg, #2563eb, #3b82f6); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.25);">
                            🔗 Lihat Detail di Dashboard
                          </a>
                        </div>
                        
                        <div style="border-top: 2px dashed #e5e7eb; padding-top: 20px; text-align: center;">
                          <p style="color: #9ca3af; font-size: 13px; margin: 0; line-height: 1.5;">
                            📧 Email otomatis dari <strong>Sistem Surat Pemkot</strong><br/>
                            🚫 Mohon tidak membalas email ini<br/>
                            📅 Dikirim pada ${new Date().toLocaleString('id-ID', {
                                        timeZone: 'Asia/Jakarta',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })} WIB
                          </p>
                        </div>
                      </div>
                    `
                    }).catch(err => ({ email, error: err.message }))
                );

                const results = await Promise.all(emailPromises);
                const successful = results.filter(r => !r.error).length;
                const failed = results.filter(r => r.error).length;

                logger.info(`Pengiriman email selesai`, {
                    userId,
                    total: validEmails.length,
                    successful,
                    failed,
                    duration: Date.now() - startTime
                });

                if (failed > 0) {
                    logger.warn("Beberapa email gagal dikirim", {
                        userId,
                        failedEmails: results.filter(r => r.error).map(r => ({ email: r.email, error: r.error }))
                    });
                }
            }
        }

        logger.info("Permintaan buat jadwal acara berhasil", {
            userId,
            acaraId: data.id,
            duration: Date.now() - startTime
        });

        res.status(201).json({
            message: "Jadwal acara berhasil dibuat dan notifikasi email terkirim",
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
            `)
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
        if (bulan && tahun) {
            const startDate = `${tahun}-${bulan.padStart(2, '0')}-01`;
            const endDate = `${tahun}-${bulan.padStart(2, '0')}-31`;
            query = query.gte('tanggal_mulai', startDate).lte('tanggal_mulai', endDate);
        } else if (tahun) {
            const startDate = `${tahun}-01-01`;
            const endDate = `${tahun}-12-31`;
            query = query.gte('tanggal_mulai', startDate).lte('tanggal_mulai', endDate);
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