const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const { supabase } = require('../../config/supabase');
const JWT_SECRET = process.env.JWT_SECRET || 'bapelit123';


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
            return res.status(400).json({ error: 'Email atau password salah' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
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
        res.status(500).json({ error: error.message });

    }
}

module.exports = login