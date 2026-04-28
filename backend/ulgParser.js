const fs = require('fs');

const ULOG_MAGIC = Buffer.from([0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35]);
const ULOG_HEADER_LENGTH = 16;

function parseUlogHeader(filePath) {
  const stats = fs.statSync(filePath);
  if (stats.size < ULOG_HEADER_LENGTH) {
    throw new Error('ULG_FILE_TOO_SMALL');
  }

  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(ULOG_HEADER_LENGTH);

  try {
    fs.readSync(fd, header, 0, ULOG_HEADER_LENGTH, 0);
  } finally {
    fs.closeSync(fd);
  }

  const magic = header.subarray(0, 7);
  if (!magic.equals(ULOG_MAGIC)) {
    throw new Error('INVALID_ULG_MAGIC');
  }

  const version = header.readUInt8(7);
  const logStartTimestampUs = Number(header.readBigUInt64LE(8));

  return {
    fileSizeBytes: stats.size,
    version,
    logStartTimestampUs,
  };
}

module.exports = {
  parseUlogHeader,
};
