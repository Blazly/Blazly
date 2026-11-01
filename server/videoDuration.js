/** Best-effort MP4 duration from buffer (seconds). Returns null if unknown. */
export function getVideoDurationSeconds(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 16) return null;

  let offset = 0;
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset);
    if (size === 0) size = buf.length - offset;
    if (size < 8) break;
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const end = Math.min(offset + size, buf.length);
    if (type === "moov") {
      const duration = findMvhdDuration(buf, offset + 8, end);
      if (duration != null) return duration;
    }
    offset += size;
  }
  return null;
}

function findMvhdDuration(buf, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    if (size === 0) size = end - offset;
    if (size < 8) break;
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const boxEnd = Math.min(offset + size, end);
    if (type === "mvhd" && boxEnd - offset >= 32) {
      const version = buf.readUInt8(offset + 8);
      if (version === 0 && boxEnd - offset >= 28) {
        const timescale = buf.readUInt32BE(offset + 20);
        const duration = buf.readUInt32BE(offset + 24);
        return timescale > 0 ? duration / timescale : null;
      }
      if (version === 1 && boxEnd - offset >= 44) {
        const timescale = buf.readUInt32BE(offset + 28);
        const durationHi = buf.readUInt32BE(offset + 32);
        const durationLo = buf.readUInt32BE(offset + 36);
        const duration = durationHi * 2 ** 32 + durationLo;
        return timescale > 0 ? duration / timescale : null;
      }
    }
    if (type === "moov" || type === "trak" || type === "mdia" || type === "minf" || type === "stbl") {
      const nested = findMvhdDuration(buf, offset + 8, boxEnd);
      if (nested != null) return nested;
    }
    offset += size;
  }
  return null;
}

export const MAX_CONTINUE_VIDEO_SECONDS = 10;

export function assertContinueVideoDuration(durationSeconds) {
  if (durationSeconds == null) return;
  if (durationSeconds > MAX_CONTINUE_VIDEO_SECONDS + 0.35) {
    throw new Error(
      `Previous video must be under ${MAX_CONTINUE_VIDEO_SECONDS} seconds. Trim the clip and try again.`,
    );
  }
}
