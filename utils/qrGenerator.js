const { v4: uuidv4 } = require("uuid");

function generateQRToken() {
  return uuidv4().replace(/-/g, "").substring(0, 16);
}

module.exports = { generateQRToken };
