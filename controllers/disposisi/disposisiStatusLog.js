const { supabase } = require("../../config/supabase");

const getDisposisiStatusLog = async (req, res) => {
    try {
        const { disposisiId } = req.params;

        // Validasi UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(disposisiId)) {
            return res.status(400).json({
                error: 'Invalid disposisi ID format'
            });
        }

        // Query ke database
        const { data, error } = await supabase
            .from('disposisi_status_log')
            .select(`
            id,
            disposisi_id,
            status,
            timestamp,
            keterangan,
            oleh_user_id,
            ke_user_id
          `)
            .eq('disposisi_id', disposisiId)
            .order('timestamp', { ascending: true });

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({
                error: 'Failed to fetch status logs'
            });
        }

        // Return success response
        return res.status(200).json({
            success: true,
            data,
            count: data.length
        });

    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({
            error: 'Internal server error'
        });
    }
}

module.exports = getDisposisiStatusLog