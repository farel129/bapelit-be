const { supabase } = require("../../config/supabase");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const daftarUser = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, name, jabatan, bidang')
            .order('name', { ascending: true });

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({
            message: 'Berhasil mengambil data user (name, jabatan & bidang)',
            data: data || [],
            total: data?.length || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const buatAkun = async (req, res) => {
    const { name, email, password, jabatan = '', role = 'user', bidang = '' } = req.body;

    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Hanya admin yang boleh membuat user' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const { data, error } = await supabase
            .from('users')
            .insert([{ name, email, password: hashedPassword, jabatan, role, bidang }])
            .select();


        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.status(201).json({ message: 'User berhasil dibuat', user: data[0] });
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Gagal membuat user' });
    }
}

const adminDaftarUser = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, email, name, jabatan, role, bidang, created_at')
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({
            message: 'Daftar semua user',
            data: data || [],
            total: data?.length || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const deleteUser = async (req, res) => {
    try {
        const userId = req.params.id;

        // Jangan biarkan admin hapus dirinya sendiri
        if (userId == req.user.id) {
            return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
        }

        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);

        if (error) {
            return res.status(400).json({ error: error.message });
        }

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

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({ message: 'Password user berhasil direset' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
module.exports = { daftarUser, buatAkun, adminDaftarUser, deleteUser, resetPassword }