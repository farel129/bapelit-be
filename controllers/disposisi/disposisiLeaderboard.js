const { supabase } = require("../../config/supabase");

const getLeaderboardDisposisi = async (req, res) => {
    try {
        const { tipe } = req.params;
        let fieldName;

        if (tipe === 'atasan') {
            fieldName = 'jabatan';
        } else if (tipe === 'bawahan') {
            fieldName = 'name';
        } else {
            return res.status(400).json({
                error: 'Tipe leaderboard tidak valid. Gunakan "atasan" atau "bawahan"'
            });
        }

        // 1. Ambil data disposisi (Masih menggunakan snapshot text, jadi aman)
        const { data: disposisiData, error: disposisiError } = await supabase
            .from('disposisi')
            .select('disposisi_kepada_jabatan, diteruskan_kepada_nama');

        if (disposisiError) {
            console.error(`Error fetching disposisi data:`, disposisiError);
            return res.status(400).json({ error: disposisiError.message });
        }

        // 2. Ambil data users dengan JOIN ke tabel referensi
        // KITA UBAH QUERY INI AGAR TIDAK ERROR
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select(`
                name,
                jabatan:jabatan_id(nama),
                bidang:bidang_id(nama)
            `);

        if (usersError) {
            console.error(`Error fetching users data:`, usersError);
            return res.status(400).json({ error: usersError.message });
        }

        // 3. Buat mapping dari nama/jabatan ke bidang
        // KITA SESUAIKAN LOGIC MAPPINGNYA DENGAN STRUKTUR BARU
        const usersBidangMap = {};
        
        usersData.forEach(user => {
            const namaBidang = user.bidang?.nama || 'Umum';
            const namaJabatan = user.jabatan?.nama;

            // Mapping Nama Orang -> Bidang
            if (user.name) {
                usersBidangMap[user.name] = namaBidang;
            }
            // Mapping Nama Jabatan -> Bidang
            if (namaJabatan) {
                usersBidangMap[namaJabatan] = namaBidang;
            }
        });

        let result;

        if (tipe === 'atasan') {
            // Hitung total disposisi yang diterima setiap atasan
            const disposisiCounts = disposisiData.reduce((acc, curr) => {
                const key = curr.disposisi_kepada_jabatan;
                if (key) {
                    const bidang = usersBidangMap[key] || 'Tidak diketahui';
                    const compositeKey = `${key}|${bidang}`;
                    acc[compositeKey] = (acc[compositeKey] || 0) + 1;
                }
                return acc;
            }, {});

            // Hitung disposisi yang diteruskan oleh setiap kabid
            const diteruskanCounts = disposisiData.reduce((acc, curr) => {
                const key = curr.disposisi_kepada_jabatan;
                // Hitung hanya jika diteruskan (ada nama penerus)
                if (key && curr.diteruskan_kepada_nama !== null) {
                    const bidang = usersBidangMap[key] || 'Tidak diketahui';
                    const compositeKey = `${key}|${bidang}`;
                    acc[compositeKey] = (acc[compositeKey] || 0) + 1;
                }
                return acc;
            }, {});

            // Kalkulasi: diterima - diteruskan untuk setiap kabid
            // (Mencari sisa beban kerja yang belum diteruskan/diselesaikan sendiri)
            result = Object.entries(disposisiCounts)
                .map(([compositeKey, count]) => {
                    const [jabatan, bidang] = compositeKey.split('|');
                    // Hindari nilai negatif jika data tidak konsisten
                    const bebanKerja = Math.max(0, count - (diteruskanCounts[compositeKey] || 0));
                    
                    return {
                        [fieldName]: jabatan,
                        bidang: bidang,
                        jumlah_disposisi: bebanKerja
                    };
                })
                .sort((a, b) => b.jumlah_disposisi - a.jumlah_disposisi);

        } else {
            // Untuk bawahan: hitung berapa kali namanya muncul di kolom 'diteruskan_kepada_nama'
            const diteruskanCounts = disposisiData.reduce((acc, curr) => {
                const key = curr.diteruskan_kepada_nama;
                if (key) {
                    const bidang = usersBidangMap[key] || 'Tidak diketahui';
                    const compositeKey = `${key}|${bidang}`;
                    acc[compositeKey] = (acc[compositeKey] || 0) + 1;
                }
                return acc;
            }, {});

            result = Object.entries(diteruskanCounts)
                .map(([compositeKey, count]) => {
                    const [name, bidang] = compositeKey.split('|');
                    return {
                        [fieldName]: name,
                        bidang: bidang,
                        jumlah_disposisi: count
                    };
                })
                .sort((a, b) => b.jumlah_disposisi - a.jumlah_disposisi);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Server error leaderboard:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
}

module.exports = getLeaderboardDisposisi;