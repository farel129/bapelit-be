const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

// Filter file (gambar & PDF)
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const isImage =
    allowedImageTypes.test(path.extname(file.originalname).toLowerCase()) &&
    allowedImageTypes.test(file.mimetype);

  const isPdf =
    file.mimetype === "application/pdf" &&
    path.extname(file.originalname).toLowerCase() === ".pdf";

  if (isImage || isPdf) {
    return cb(null, true);
  } else {
    cb(new Error("Hanya file gambar (JPEG, JPG, PNG, GIF, WEBP) dan PDF yang diizinkan!"));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }, // 5MB max, 10 files
  fileFilter,
});

module.exports = upload;
