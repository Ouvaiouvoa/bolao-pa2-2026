"use client";
import { api } from "./api";

export interface UploadProgress {
  fileName: string;
  sent: number;
  total: number;
  status: "uploading" | "completing" | "done" | "error";
  error?: string;
}

interface InitResponse {
  uploadId: string;
  chunkSize: number;
  totalParts: number;
  partUrls: { partNumber: number; url: string }[];
  driver: "local" | "s3";
}

const STORE = "cmf-uploads";

function remember(key: string, uploadId: string | null) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, string>;
    if (uploadId) all[key] = uploadId;
    else delete all[key];
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage unavailable: resume simply disabled */
  }
}

/**
 * Resumable multipart upload via short-lived signed part URLs. Interrupted uploads are resumed:
 * parts already acknowledged by the server are skipped.
 */
export async function uploadFile(
  file: File,
  target: { projectId?: string; brandId?: string; purpose: "project_media" | "brand_logo" | "brand_font" | "brand_music" },
  onProgress: (p: UploadProgress) => void,
): Promise<{ assetId: string; checksum: string }> {
  const fileKey = `${target.projectId ?? target.brandId}:${file.name}:${file.size}:${file.lastModified}`;
  let init: InitResponse | null = null;
  const received = new Set<number>();
  try {
    const previous = (JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, string>)[fileKey];
    if (previous) {
      // Resume: re-sign only the missing parts of the unfinished upload.
      const r = await api<InitResponse & { receivedParts: number[] }>(`/api/uploads/${previous}/sign`, { body: {} });
      r.receivedParts.forEach((n) => received.add(n));
      init = r;
    }
  } catch {
    init = null;
  }
  init ??= await api<InitResponse>("/api/uploads/init", { body: { ...target, fileName: file.name, sizeBytes: file.size, mimeType: file.type || "application/octet-stream" } });
  remember(fileKey, init.uploadId);
  const parts: { partNumber: number; etag: string }[] = [];
  let sent = 0;
  for (const n of received) sent += Math.min(init.chunkSize, file.size - (n - 1) * init.chunkSize);
  for (const { partNumber, url } of init.partUrls) {
    const start = (partNumber - 1) * init.chunkSize;
    const blob = file.slice(start, Math.min(file.size, start + init.chunkSize));
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(url, { method: "PUT", body: blob, credentials: init.driver === "local" ? "same-origin" : "omit" });
        if (!res.ok) throw new Error(`parte ${partNumber}: HTTP ${res.status}`);
        parts.push({ partNumber, etag: (res.headers.get("ETag") ?? "").replace(/"/g, "") || `${partNumber}-${blob.size}` });
        break;
      } catch (err) {
        if (++attempt >= 4) {
          onProgress({ fileName: file.name, sent, total: file.size, status: "error", error: (err as Error).message });
          throw err;
        }
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
    sent += blob.size;
    onProgress({ fileName: file.name, sent, total: file.size, status: "uploading" });
  }
  onProgress({ fileName: file.name, sent, total: file.size, status: "completing" });
  const done = await api<{ assetId: string; checksum: string }>(`/api/uploads/${init.uploadId}/complete`, { body: { parts: init.driver === "s3" ? parts : [] }, idempotent: true });
  remember(fileKey, null);
  onProgress({ fileName: file.name, sent: file.size, total: file.size, status: "done" });
  return done;
}
