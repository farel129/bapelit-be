const { supabase } = require("../config/supabase");

async function validateDisposisi(id, userJabatan) {
  const { data: disposisi, error } = await supabase
    .from('disposisi')
    .select('id, status, disposisi_kepada_jabatan')
    .eq('id', id)
    .eq('disposisi_kepada_jabatan', userJabatan)
    .single();

  if (error || !disposisi) {
    throw new Error('Disposisi tidak ditemukan atau tidak ditujukan untuk Anda');
  }

  return disposisi;
}

async function updateDisposisiStatus(disposisiData) {
  const { 
    id, 
    newStatus, 
    newStatusKabid, 
    newStatusSekretaris, 
    newStatusLog, 
    newKeterangan, 
    userId 
  } = disposisiData;

  const updateData = {};
  if (newStatus) updateData.status = newStatus;
  if (newStatusKabid) updateData.status_dari_kabid = newStatusKabid;
  if (newStatusSekretaris) updateData.status_dari_sekretaris = newStatusSekretaris;

  const { data, error } = await supabase
    .from('disposisi')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating disposisi status:', error);
    throw new Error('Gagal mengupdate status disposisi');
  }

  // Insert log
  const { error: logError } = await supabase
    .from('disposisi_status_log')
    .insert([{
      disposisi_id: data.id,
      status: newStatusLog,
      oleh_user_id: userId,
      keterangan: newKeterangan
    }]);

  if (logError) {
    console.error('Error creating status log:', logError);
    // Tidak throw error, karena update status sudah berhasil
  }

  return data;
}

/**
 * Handler untuk proses baca disposisi
 */
async function handleBacaDisposisi(id, userJabatan, userId, role) {
  // Validasi disposisi
  const disposisi = await validateDisposisi(id, userJabatan);

  if (disposisi.status !== 'belum dibaca') {
    return {
      success: false,
      message: 'Status disposisi tidak berubah',
      data: disposisi
    };
  }

  // Prepare update data
  const updateData = {
    id,
    newStatus: 'dibaca',
    newStatusLog: 'dibaca',
    newKeterangan: `Disposisi telah dibaca oleh ${role}`,
    userId
  };

  if (role === 'kabid') {
    updateData.newStatusKabid = 'dibaca';
  } else if (role === 'sekretaris') {
    updateData.newStatusSekretaris = 'dibaca';
  }

  const updatedData = await updateDisposisiStatus(updateData);

  return {
    success: true,
    message: 'Status disposisi diperbarui menjadi sudah dibaca',
    data: updatedData
  };
}

async function handleTerimaDisposisi(id, userJabatan, userId, role) {
  // Validasi disposisi
  const disposisi = await validateDisposisi(id, userJabatan);

  if (disposisi.status !== 'dibaca') {
    return {
      success: false,
      message: 'Status disposisi tidak berubah',
      data: disposisi
    };
  }

  // Prepare update data
  const updateData = {
    id,
    newStatusLog: 'diterima',
    newKeterangan: `Disposisi telah diterima oleh ${role}`,
    userId
  };

  if (role === 'kabid') {
    updateData.newStatusKabid = 'diterima';
  } else if (role === 'sekretaris') {
    updateData.newStatusSekretaris = 'diterima';
  }

  const updatedData = await updateDisposisiStatus(updateData);

  return {
    success: true,
    message: `Status disposisi diperbarui menjadi diterima oleh ${role}`,
    data: updatedData
  };
}

module.exports = {
  validateDisposisi,
  updateDisposisiStatus,
  handleBacaDisposisi,
  handleTerimaDisposisi
};