// Files in both directions. Inbound files are checked against the asset policy,
// downloaded only after sender policy admitted the message, and saved through
// OpenClaw's media store (which owns retention). Outbound files are loaded with
// the host's guarded loader, restricted to the agent's allowed local roots, and
// uploaded natively.
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import type { QualifiedIdLike, WireApi } from "./wire-api.js";

export type InboundAsset = {
  name?: string;
  mimeType: string;
  sizeInBytes: number;
  /** Opaque SDK AssetRemoteData, handed back to downloadAsset. */
  remoteData?: unknown;
};

export type AssetPolicy = { maxBytes: number; mimeAllowlist: string[] };

/** The SDK types sizes as `number | Long`. */
export function toByteCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return Number(value.toNumber());
  }
  return Number(value ?? 0) || 0;
}

const baseMime = (mime: string) => (mime.split(";")[0] ?? "").trim().toLowerCase();

function formatMiB(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Null when acceptable, otherwise a short notice for the sender (no agent turn). */
export function rejectInboundAsset(asset: InboundAsset, policy: AssetPolicy): string | null {
  if (!asset.remoteData) return "I couldn't retrieve that file.";
  if (!policy.mimeAllowlist.includes(baseMime(asset.mimeType))) {
    return "I can't accept that type of file.";
  }
  if (asset.sizeInBytes > policy.maxBytes) {
    return `That file is too large (limit ${formatMiB(policy.maxBytes)}).`;
  }
  return null;
}

export class AssetTooLargeError extends Error {}

export async function ingestInboundAsset(params: {
  asset: InboundAsset;
  api: WireApi;
  core: PluginRuntime;
  maxBytes: number;
}): Promise<{ path: string; contentType?: string; fileName?: string }> {
  const { asset, api, core, maxBytes } = params;
  const bytes = await api.downloadAsset(asset.remoteData);
  // The declared size is sender-controlled; check what actually arrived.
  if (bytes.byteLength > maxBytes) throw new AssetTooLargeError("downloaded file exceeds the size limit");
  const saved = await core.channel.media.saveMediaBuffer(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    asset.mimeType,
    "inbound",
    maxBytes,
    asset.name,
  );
  return {
    path: saved.path,
    ...(saved.contentType ? { contentType: saved.contentType } : {}),
    ...(asset.name ? { fileName: asset.name } : {}),
  };
}

function fileNameFor(mediaUrl: string, loadedName: string | undefined): string {
  if (loadedName) return loadedName;
  try {
    const url = new URL(mediaUrl);
    return path.basename(url.pathname) || "file";
  } catch {
    return path.basename(mediaUrl) || "file";
  }
}

/** Load a media reference with the host loader and send it as a Wire asset. */
export async function sendMediaUrl(params: {
  mediaUrl: string;
  conversation: QualifiedIdLike;
  api: WireApi;
  core: PluginRuntime;
  maxBytes: number;
  localRoots: readonly string[];
}): Promise<string> {
  const media = await params.core.media.loadWebMedia(params.mediaUrl, {
    maxBytes: params.maxBytes,
    localRoots: params.localRoots,
    optimizeImages: false,
  });
  return await params.api.sendAsset(params.conversation, {
    data: new Uint8Array(media.buffer.buffer, media.buffer.byteOffset, media.buffer.byteLength),
    name: fileNameFor(params.mediaUrl, media.fileName),
    mimeType: media.contentType ?? "application/octet-stream",
  });
}
