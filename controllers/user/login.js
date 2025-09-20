const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const { supabase } = require('../../config/supabase');
const { logger } = require('../../utils/logger');
const JWT_SECRET = process.env.JWT_SECRET;


const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Get user from database
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            // 🔴 Log: Login gagal — email tidak ditemukan
            logger.warn('Login gagal: Email tidak ditemukan', {
                email,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            return res.status(400).json({ error: 'Email atau password salah' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            logger.warn('Login gagal: Password salah', {
                email: user.email,
                userId: user.id,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            return res.status(400).json({ error: 'Email atau password salah' });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                name: user.name,
                jabatan: user.jabatan,
                bidang: user.bidang,
                role: user.role || 'user'
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                jabatan: user.jabatan,
                role: user.role || 'user'
            }
        });
    } catch (error) {

        logger.error('Error sistem saat login', {
            message: error.message,
            stack: error.stack,
            email: req.body?.email,
            ip: req.ip
        });

        res.status(500).json({ error: error.message });

    }
}

module.exports = login