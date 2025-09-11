const { supabase } = require("../config/supabase");

const transformFeedbackData = (feedback) => {
  return feedback?.map(item => {
    const files = item.feedback_files?.map(file => ({
      id: file.id,
      filename: file.file_original_name,
      size: file.file_size,
      type: file.file_type,
      url: generateFileUrl(file)
    })) || [];

    return {
      ...item,
      files,
      file_count: files.length,
      has_files: files.length > 0
    };
  }) || [];
};

// Helper function untuk generate URL file
const generateFileUrl = (file) => {
  // Jika sudah URL lengkap, gunakan langsung
  if (file.file_path?.startsWith('http')) {
    return file.file_path;
  }

  // Jika ada storage_path, generate public URL
  if (file.storage_path) {
    const { data: { publicUrl } } = supabase.storage
      .from('surat-photos')
      .getPublicUrl(file.storage_path);
    return publicUrl;
  }

  return `/api/feedback/file/${file.id}`;
};

module.exports = { transformFeedbackData, generateFileUrl }