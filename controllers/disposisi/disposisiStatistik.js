const { supabase } = require("../../config/supabase");

const getStatistikDisposisi = async (req, res) => {
    try {
        // Validasi role kepala
        if (req.user.role !== 'kepala' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        // Query untuk mendapatkan semua disposisi dengan informasi lengkap
        const { data: disposisiData, error } = await supabase
            .from('disposisi')
            .select(`
        id,
        status,
        created_at
      `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching disposisi statistics:', error);
            return res.status(400).json({ error: error.message });
        }

        const disposisi = disposisiData || [];

        // 📈 Statistik Status Utama - Diperbaiki dengan normalisasi status
        const statusStats = {
            total: disposisi.length,
            belum_dibaca: disposisi.filter(d =>
                d.status === 'belum dibaca' || d.status === 'belum_dibaca'
            ).length,
            sudah_dibaca: disposisi.filter(d =>
                d.status === 'sudah dibaca' || d.status === 'sudah_dibaca' || d.status === 'dibaca'
            ).length,
            diproses: disposisi.filter(d =>
                d.status === 'diproses' || d.status === 'sedang diproses'
            ).length,
            selesai: disposisi.filter(d =>
                d.status === 'selesai' || d.status === 'completed'
            ).length,
            diteruskan: disposisi.filter(d =>
                d.status === 'diteruskan' || d.status === 'forwarded'
            ).length
        };

        // 📊 Tambahan: Persentase untuk setiap status
        const statusPercentage = {
            belum_dibaca: statusStats.total > 0 ? ((statusStats.belum_dibaca / statusStats.total) * 100).toFixed(1) : '0.0',
            sudah_dibaca: statusStats.total > 0 ? ((statusStats.sudah_dibaca / statusStats.total) * 100).toFixed(1) : '0.0',
            diproses: statusStats.total > 0 ? ((statusStats.diproses / statusStats.total) * 100).toFixed(1) : '0.0',
            selesai: statusStats.total > 0 ? ((statusStats.selesai / statusStats.total) * 100).toFixed(1) : '0.0',
            diteruskan: statusStats.total > 0 ? ((statusStats.diteruskan / statusStats.total) * 100).toFixed(1) : '0.0'
        };

        // 📋 Validasi total (opsional - untuk debugging)
        const totalCalculated = statusStats.belum_dibaca + statusStats.sudah_dibaca +
            statusStats.diproses + statusStats.selesai + statusStats.diteruskan;

        // 🗓️ Statistik berdasarkan periode waktu (opsional)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const periodStats = {
            bulan_ini: disposisi.filter(d => new Date(d.created_at) >= startOfMonth).length,
            minggu_ini: disposisi.filter(d => new Date(d.created_at) >= startOfWeek).length,
            hari_ini: disposisi.filter(d => new Date(d.created_at) >= startOfDay).length
        };

        // Response dengan struktur yang jelas
        res.json({
            success: true,
            data: {
                statistik_status: statusStats,
                persentase_status: statusPercentage,
                statistik_periode: periodStats,
                summary: {
                    total_disposisi: statusStats.total,
                    total_tervalidasi: totalCalculated,
                    data_valid: totalCalculated === statusStats.total
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in disposisi statistics:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}

module.exports = getStatistikDisposisi