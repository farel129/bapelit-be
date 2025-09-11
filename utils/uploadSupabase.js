const path = require("path");
const { supabase, supabaseAdmin } = require("../config/supabase");

// Helper umum upload ke Supabase
async function uploadToSupabaseStorage(file, folder = "surat-masuk", bucket = "surat-photos") {
  try {
    const fileExt = path.extname(file.originalname);
    const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    // Perbaikan: cara mengambil publicUrl yang benar
    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return {
      fileName: data.path,
      publicUrl: publicData.publicUrl,
      size: file.size,
      originalName: file.originalname,
      mimetype: file.mimetype,
    };
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
}

// Alias khusus
const uploadDocumentationFile = (file) =>
  uploadToSupabaseStorage(file, "dokumentasi", "documentation-storage");

const uploadBuktiTamu = (file) =>
  uploadToSupabaseStorage(file, "bukti-tamu", "buku-tamu");

module.exports = { uploadToSupabaseStorage, uploadDocumentationFile, uploadBuktiTamu };