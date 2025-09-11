const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');
const { supabase } = require('../../config/supabase');

if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper('eq', (a, b) => a === b);
}

if (!Handlebars.helpers.includes) {
    Handlebars.registerHelper('ek', (a, b) => a === b);
}

const prepareTemplateData = (disposisi) => {

    return {
        ...disposisi,
    };
};

// 📄 Endpoint untuk generate PDF
const downloadPdf =  async (req, res) => {
    try {
        console.log('📥 Permintaan PDF untuk surat ID:', req.params.id);

        const { data: disposisi, error } = await supabase
            .from('disposisi')
            .select(`
        *
      `)
            .eq('id', req.params.id)
            .single();

        if (error || !disposisi) {
            console.error('❌ disposisi tidak ditemukan atau Supabase error:', error?.message || error);
            return res.status(404).json({ error: 'disposisi not found', detail: error?.message });
        }

        const templatePath = path.join(__dirname,  '..', '..', 'templates', 'disposisi.html');
        const htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        const template = Handlebars.compile(htmlTemplate);

        const preparedData = prepareTemplateData(disposisi);


        const html = template({
            ...preparedData,
        });

        // ✅ Perbaikan: Tambahkan args penting
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer'
            ]
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        console.log('✅ PDF berhasil dibuat. Mengirim ke client...');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="disposisi-${disposisi.nomor_surat || disposisi.id}.pdf"`
        );
        res.send(pdfBuffer);
    } catch (err) {
        console.error('❌ Gagal generate PDF:', err);
        res.status(500).json({ error: 'Gagal membuat PDF. Cek log server.' });
    }
}

module.exports = downloadPdf