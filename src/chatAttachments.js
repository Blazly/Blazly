export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_ACCEPT =
  "image/*,.pdf,.txt,.md,.markdown,.csv,.json,.html,.xml,.svg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip";

export function isVideoAttachmentFile(file) {
  if (!file) return false;
  return (
    (file.type && file.type.startsWith("video/")) || /\.(mp4|mov|webm)$/i.test(file.name || "")
  );
}

export function getVideoDurationFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration)) {
        reject(new Error("Could not read video duration."));
        return;
      }
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video duration."));
    };
    video.src = url;
  });
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateAttachmentFile(file) {
  if (!file) return "No file selected.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size >= MAX_ATTACHMENT_BYTES) {
    return `"${file.name}" is too large. Use files under 25 MB.`;
  }
  return "";
}

export function attachmentKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsText(file);
  });
}

export async function fileToAttachment(file) {
  const error = validateAttachmentFile(file);
  if (error) throw new Error(error);

  if (file.type.startsWith("image/")) {
    const dataUrl = await readAsDataUrl(file);
    const base64 = dataUrl.split(",")[1] || "";
    return {
      kind: "image",
      name: file.name,
      mediaType: file.type || "image/png",
      data: base64,
      previewUrl: dataUrl,
      size: file.size,
    };
  }

  if (isVideoAttachmentFile(file)) {
    const dataUrl = await readAsDataUrl(file);
    const base64 = dataUrl.split(",")[1] || "";
    return {
      kind: "video",
      name: file.name,
      mediaType: file.type || "video/mp4",
      data: base64,
      size: file.size,
    };
  }

  const label = `Attached file: ${file.name} (${formatFileSize(file.size)})`;
  const readable =
    /text|json|csv|markdown|xml|svg|html/.test(file.type) ||
    /\.(txt|md|csv|json|html|xml|svg|markdown)$/i.test(file.name);

  let excerpt = "";
  if (readable && file.size <= 500000) {
    excerpt = (await readAsText(file)).slice(0, 12000);
  } else if (readable) {
    excerpt = "(File is too large to inline; describe what you need from it.)";
  } else {
    excerpt = "(Binary file attached — describe how Blazly should use it.)";
  }

  return {
    kind: "file",
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    size: file.size,
    note: `${label}\n${excerpt}`.trim(),
  };
}

export async function buildUserMessagePayload(text, files) {
  const draft = String(text || "").trim();
  const fileNotes = [];
  const attachments = [];

  for (const file of files) {
    const item = await fileToAttachment(file);
    if (item.kind === "image") {
      attachments.push({
        type: "image",
        name: item.name,
        mediaType: item.mediaType,
        data: item.data,
        previewUrl: item.previewUrl,
        size: item.size,
      });
    } else if (item.kind === "video") {
      attachments.push({
        type: "video",
        name: item.name,
        mediaType: item.mediaType,
        data: item.data,
        size: item.size,
      });
    } else {
      fileNotes.push(item.note);
    }
  }

  const content = [draft, ...fileNotes].filter(Boolean).join("\n\n").trim();
  return { content, attachments };
}

export function stripMessagesForStorage(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    const { streaming, ...rest } = message || {};
    if (!rest?.attachments?.length) return rest;
    return {
      ...rest,
      attachments: rest.attachments.map((item) => ({
        type: item.type,
        name: item.name,
        mediaType: item.mediaType,
        size: item.size,
      })),
    };
  });
}
