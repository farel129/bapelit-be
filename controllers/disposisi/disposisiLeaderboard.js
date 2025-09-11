const { supabase } = require("../../config/supabase");

const getLeaderboardDisposisi = async (req, res) => {
    try {
        const { tipe } = req.params;
        let selectField;
        let fieldName;

        if (tipe === 'atasan') {
            selectField = 'disposisi_kepada_jabatan';
            fieldName = 'jabatan';
        } else if (tipe === 'bawahan') {
            selectField = 'diteruskan_kepada_nama';
            fieldName = 'name';
        } else {
            return res.status(400).json({
                error: 'Tipe leaderboard tidak valid. Gunakan "atasan" atau "bawahan"'
            });
        }

        // Ambil data disposisi
        const { data: disposisiData, error: disposisiError } = await supabase
            .from('disposisi')
            .select('disposisi_kepada_jabatan, diteruskan_kepada_nama');

        if (disposisiError) {
            console.error(`Error fetching disposisi data:`, disposisiError);
            return res.status(400).json({ error: disposisiError.message });
        }

        // Ambil data users untuk mapping bidang
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('name, jabatan, bidang');

        if (usersError) {
            console.error(`Error fetching users data:`, usersError);
            return res.status(400).json({ error: usersError.message });
        }

        // Buat mapping dari nama/jabatan ke bidang
        const usersBidangMap = {};
        usersData.forEach(user => {
            if (user.name) {
                usersBidangMap[user.name] = user.bidang;
            }
            if (user.jabatan) {
                usersBidangMap[user.jabatan] = user.bidang;
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
                if (key && curr.diteruskan_kepada_nama !== null) {
                    const bidang = usersBidangMap[key] || 'Tidak diketahui';
                    const compositeKey = `${key}|${bidang}`;
                    acc[compositeKey] = (acc[compositeKey] || 0) + 1;
                }
                return acc;
            }, {});

            // Kalkulasi: diterima - diteruskan untuk setiap kabid
            result = Object.entries(disposisiCounts)
                .map(([compositeKey, count]) => {
                    const [jabatan, bidang] = compositeKey.split('|');
                    return {
                        [fieldName]: jabatan,
                        bidang: bidang,
                        jumlah_disposisi: count - (diteruskanCounts[compositeKey] || 0)
                    };
                })
                .sort((a, b) => b.jumlah_disposisi - a.jumlah_disposisi);

        } else {
            // Untuk bawahan: hitung diteruskan_kepada_nama
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
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = getLeaderboardDisposisi