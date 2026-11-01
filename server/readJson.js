export const DEFAULT_MAX_BYTES = 1_000_000; // 1 MB

/**
 * Buffers and parses a JSON request body, rejecting with 413 once `maxBytes` is exceeded
 * (the socket is destroyed so an attacker cannot keep streaming).
 */
export function readJson(req, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers?.["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(tooLarge(maxBytes));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      fn(value);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(reject, tooLarge(maxBytes));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        finish(resolve, text.trim() ? JSON.parse(text) : {});
      } catch {
        finish(reject, Object.assign(new Error("Invalid JSON body."), { status: 400 }));
      }
    });
    req.on("error", (error) => finish(reject, error));
  });
}

function tooLarge(maxBytes) {
  const kb = Math.round(maxBytes / 1000);
  return Object.assign(new Error(`Request body is too large (limit ${kb >= 1000 ? `${kb / 1000} MB` : `${kb} KB`}).`), {
    status: 413,
    code: "payload_too_large",
  });
}
