const { supabase } = require("../../config/supabase");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// --- HELPER FUNCTION: Cari ID atau Buat Baru ---
// Fungsi ini mengecek apakah nama jabatan/bidang sudah ada. 
// Jika belum, dibuatkan baru. Jika sudah, diambil ID-nya.
const getOrInsertId = async (table, nameValue) => {
    if (!nameValue) return null;

    // 1. Cek apakah sudah ada?
    const { data: existing, error: findError } = await supabase
        .from(table)
        .select('id')
        .ilike('nama', nameValue) // Case insensitive check
        .maybeSingle();

    if (existing) return existing.id;

    // 2. Jika belum ada, insert baru
    const { data: created, error: createError } = await supabase
        .from(table)
        .insert([{ nama: nameValue }])
        .select('id')
        .single();
    
    if (createError) throw createError;
    return created.id;
};

const daftarUser = async (req, res) => {
    try {
        // Kita gunakan Syntax JOIN Supabase: nama_tabel_relasi (kolom)
        // bidang:bidang_id(nama) artinya: ambil kolom 'nama' dari relasi 'bidang_id' dan aliaskan jadi 'bidang'
        const { data, error } = await supabase
            .from('users')
            .select(`
                id, 
                name, 
                role,
                jabatan:jabatan_id(nama), 
                bidang:bidang_id(nama)
            `)
            .order('name', { ascending: true });

        if (error) return res.status(400).json({ error: error.message });

        // Flatten data (Supabase mengembalikan object nested, kita ratakan biar frontend tidak error)
        // Contoh return Supabase: { name: "Budi", bidang: { nama: "IT" } }
        // Kita ubah jadi: { name: "Budi", bidang: "IT" }
        const formattedData = data.map(user => ({
            ...user,
            jabatan: user.jabatan?.nama || '-',
            bidang: user.bidang?.nama || '-'
        }));

        res.json({
            message: 'Berhasil mengambil data user',
            data: formattedData,
            total: formattedData.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const buatAkun = async (req, res) => {
    // Frontend mengirim 'jabatan' dan 'bidang' sebagai String (Teks)
    const { name, email, password, jabatan = '', role = 'user', bidang = '' } = req.body;

    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Hanya admin yang boleh membuat user' });
    }

    try {
        // 1. Proses Jabatan & Bidang (Konversi String ke ID)
        const jabatanId = await getOrInsertId('jabatan', jabatan);
        const bidangId = await getOrInsertId('bidang', bidang);

        // 2. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Insert User (Simpan ID-nya, bukan Teks-nya)
        const { data, error } = await supabase
            .from('users')
            .insert([{ 
                name, 
                email, 
                password: hashedPassword, 
                role, 
                jabatan_id: jabatanId, // Masuk ke kolom ID
                bidang_id: bidangId    // Masuk ke kolom ID
            }])
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.status(201).json({ message: 'User berhasil dibuat', user: data[0] });
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Gagal membuat user: ' + err.message });
    }
}

const adminDaftarUser = async (req, res) => {
    try {
        // Query dengan JOIN relasi
        const { data, error } = await supabase
            .from('users')
            .select(`
                id, 
                email, 
                name, 
                role, 
                created_at,
                jabatan:jabatan_id(nama),
                bidang:bidang_id(nama)
            `)
            .order('created_at', { ascending: false });

        if (error) return res.status(400).json({ error: error.message });

        // Flatten data agar sesuai dengan tabel frontend
        const formattedData = data.map(user => ({
            ...user,
            jabatan: user.jabatan?.nama || '-',
            bidang: user.bidang?.nama || '-'
        }));

        res.json({
            message: 'Daftar semua user',
            data: formattedData,
            total: formattedData.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const deleteUser = async (req, res) => {
    try {
        const userId = req.params.id;

        if (userId == req.user.id) {
            return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
        }

        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);

        if (error) return res.status(400).json({ error: error.message });

        res.json({ message: 'User berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const resetPassword = async (req, res) => {
    try {
        const { newPassword } = req.body;
        const userId = req.params.id;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Password minimal 6 karakter' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const { error } = await supabase
            .from('users')
            .update({ password: hashedPassword })
            .eq('id', userId);

        if (error) return res.status(400).json({ error: error.message });

        res.json({ message: 'Password user berhasil direset' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = { daftarUser, buatAkun, adminDaftarUser, deleteUser, resetPassword }