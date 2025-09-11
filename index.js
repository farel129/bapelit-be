const express = require('express');
const cors = require('cors');
require('dotenv').config();

const loginRoutes = require('./routes/loginRoutes')
const userRoutes = require('./routes/userRoutes')
const bukuTamuRoutes = require('./routes/bukuTamuRoutes')
const dokumentasiRoutes = require('./routes/dokumentasiRoutes')
const jadwalAcaraRoutes = require('./routes/jadwalAcaraRoutes')
const suratMasukRoutes = require('./routes/suratMasukRoutes')
const suratKeluarRoutes = require('./routes/suratKeluarRoutes')
const disposisiRoutes = require('./routes/disposisiRoutes')
const feedbackRoutes = require('./routes/feedbackRoutes')

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


app.use('/api/v1/login', loginRoutes)
app.use('/api/v1/users', userRoutes)
app.use('/api/v1/buku-tamu', bukuTamuRoutes)
app.use('/api/v1/dokumentasi', dokumentasiRoutes)
app.use('/api/v1/jadwal-acara', jadwalAcaraRoutes)
app.use('/api/v1/surat-masuk', suratMasukRoutes)
app.use('/api/v1/surat-keluar', suratKeluarRoutes)
app.use('/api/v1/disposisi', disposisiRoutes)
app.use('/api/v1/feedback-disposisi', feedbackRoutes)


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});