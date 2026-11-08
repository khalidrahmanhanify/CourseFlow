import fs from 'fs';
import path from 'path';

/**
 * Read the duration of a video without spawning an external binary.
 *
 * Course libraries are overwhelmingly MP4/MOV, whose `moov/mvhd` header holds
 * the exact duration. Reading a few kilobytes from the file is dramatically
 * faster than decoding the whole video and works offline on every machine.
 *
 * Other containers return null; the renderer fills those in from the media
 * element the first time a lecture is opened.
 */
const HEADER_EXTS = new Set(['.mp4', '.m4v', '.mov', '.m4a']);

function boxHeader(buffer: Buffer, offset: number, limit: number) {
  if (offset + 8 > limit) return null;
  let size = buffer.readUInt32BE(offset);
  const type = buffer.toString('ascii', offset + 4, offset + 8);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > limit) return null;
    size = Number(buffer.readBigUInt64BE(offset + 8));
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < headerSize || offset + size > limit) return null;
  return { size, headerSize, type };
}

function readMvhd(buffer: Buffer) {
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const box = boxHeader(buffer, offset, buffer.length);
    if (!box) return null;
    if (box.type === 'mvhd') {
      const data = offset + box.headerSize;
      const version = buffer[data];
      try {
        if (version === 1) {
          const timescale = buffer.readUInt32BE(data + 20);
          const duration = Number(buffer.readBigUInt64BE(data + 24));
          return timescale > 0 ? duration / timescale : null;
        }
        const timescale = buffer.readUInt32BE(data + 12);
        const duration = buffer.readUInt32BE(data + 16);
        return timescale > 0 ? duration / timescale : null;
      } catch {
        return null;
      }
    }
    offset += box.size;
  }
  return null;
}

export function probeVideoDuration(filePath: string): number | null {
  if (!HEADER_EXTS.has(path.extname(filePath).toLowerCase())) return null;

  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const fileSize = fs.fstatSync(fd).size;
    let offset = 0;
    const header = Buffer.alloc(16);

    while (offset + 8 <= fileSize) {
      const read = fs.readSync(fd, header, 0, 16, offset);
      if (read < 8) break;

      let size = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      let headerSize = 8;

      if (size === 1) {
        if (read < 16) break;
        size = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }

      if (size < headerSize || offset + size > fileSize) break;

      if (type === 'moov') {
        const moovSize = size - headerSize;
        // A sane moov is a few megabytes at most; skip pathological files.
        if (moovSize <= 0 || moovSize > 256 * 1024 * 1024) return null;
        const moov = Buffer.allocUnsafe(moovSize);
        fs.readSync(fd, moov, 0, moovSize, offset + headerSize);
        const seconds = readMvhd(moov);
        return seconds && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
      }

      offset += size;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}
