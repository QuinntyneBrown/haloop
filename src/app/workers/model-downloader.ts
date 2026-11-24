/**
 * Real on-device model artifact management (L2-022, L2-027, L2-030, L2-031).
 *
 * Downloads the exact Hugging Face files an engine loads into the `transformers-cache` Cache Storage bucket
 * (the same keys Transformers.js reads), reports live byte progress, resumes across offline/online by skipping
 * files that are already complete, and removes cached artifacts again. This is the only code that talks to the
 * network, and it only runs when the user starts a download.
 */

export const TRANSFORMERS_CACHE = 'transformers-cache';
export const MANIFEST_CACHE = 'haloop-ml-state';
const MANIFEST_PREFIX = '/haloop-ml-state/model-manifest/';
const HF_BASE = 'https://huggingface.co';

export interface ModelSpec {
  readonly id: string;
  readonly repoId: string;
  /** Whether a file of the repository is needed by the engine (dtype-specific weights, tokenizer, config...). */
  readonly include: (path: string) => boolean;
}

const COMMON_CONFIG = /^(?!README|quantize_config)[^/]+\.(json|txt)$/;

function onnxSet(...names: string[]): (path: string) => boolean {
  const wanted = new Set(names.map((n) => `onnx/${n}`));
  return (path) => wanted.has(path);
}

/** File selections match the dtype each engine requests, so a finished download is exactly what it loads. */
export const MODEL_SPECS: Readonly<Record<string, ModelSpec>> = {
  vitpose: {
    id: 'vitpose',
    repoId: 'onnx-community/vitpose-base-simple',
    include: (p) => COMMON_CONFIG.test(p) || onnxSet('model_quantized.onnx')(p),
  },
  whisper: {
    id: 'whisper',
    repoId: 'onnx-community/whisper-base',
    include: (p) =>
      COMMON_CONFIG.test(p) || onnxSet('encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx')(p),
  },
  kokoro: {
    id: 'kokoro',
    // Must match the repository the Kokoro engine loads (`KOKORO_MODEL_ID`), or its cache lookups would miss.
    repoId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    include: (p) => COMMON_CONFIG.test(p) || onnxSet('model_quantized.onnx')(p) || p === 'voices/af_heart.bin',
  },
  minilm: {
    id: 'minilm',
    repoId: 'Xenova/all-MiniLM-L6-v2',
    include: (p) => COMMON_CONFIG.test(p) || p === 'vocab.txt' || onnxSet('model_quantized.onnx')(p),
  },
};

export interface RemoteFile {
  readonly path: string;
  readonly size: number;
}

interface Manifest {
  readonly repoId: string;
  readonly files: readonly RemoteFile[];
}

export interface DownloadProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

export interface DownloadResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** The transfer stopped (connection lost or cancelled) and can be resumed without redownloading finished files. */
  readonly paused?: boolean;
}

export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

export interface ModelDownloaderDeps {
  readonly fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  readonly openCache: (name: string) => Promise<CacheLike>;
}

export interface ModelDownloader {
  /** True when every file of a previously completed download is still present. */
  status(modelId: string): Promise<boolean>;
  download(modelId: string, onProgress: (progress: DownloadProgress) => void): Promise<DownloadResult>;
  /** Aborts the running download of a model; its finished files are kept for resuming. */
  cancel(modelId: string): void;
  remove(modelId: string): Promise<DownloadResult>;
}

export const fileUrl = (repoId: string, path: string): string => `${HF_BASE}/${repoId}/resolve/main/${path}`;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createModelDownloader(deps: ModelDownloaderDeps): ModelDownloader {
  const controllers = new Map<string, AbortController>();

  async function readManifest(modelId: string): Promise<Manifest | null> {
    const cache = await deps.openCache(MANIFEST_CACHE);
    const response = await cache.match(`${MANIFEST_PREFIX}${modelId}`);
    return response ? ((await response.json()) as Manifest) : null;
  }

  async function listFiles(spec: ModelSpec, signal: AbortSignal): Promise<RemoteFile[]> {
    const response = await deps.fetchImpl(`${HF_BASE}/api/models/${spec.repoId}/tree/main?recursive=true`, { signal });
    if (!response.ok) {
      throw new Error(`Hugging Face listing failed (${response.status}).`);
    }
    const entries = (await response.json()) as { type: string; path: string; size?: number }[];
    const files = entries
      .filter((e) => e.type === 'file' && spec.include(e.path))
      .map((e) => ({ path: e.path, size: e.size ?? 0 }));
    if (files.length === 0) {
      throw new Error(`No downloadable files found for ${spec.repoId}.`);
    }
    return files;
  }

  /** Streams one file into the cache while counting bytes; nothing is stored unless it arrives complete. */
  async function fetchIntoCache(
    cache: CacheLike,
    url: string,
    expected: number,
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    const response = await deps.fetchImpl(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status}) for ${url.split('/').pop()}.`);
    }
    let received = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        onBytes(chunk.byteLength);
        controller.enqueue(chunk);
      },
    });
    const headers = new Headers();
    const type = response.headers.get('content-type');
    if (type) headers.set('content-type', type);
    if (expected > 0) headers.set('content-length', String(expected));
    await cache.put(url, new Response(response.body.pipeThrough(counter), { headers }));
    if (expected > 0 && received !== expected) {
      await cache.delete(url);
      throw new Error(`Incomplete download for ${url.split('/').pop()} (${received}/${expected} bytes).`);
    }
  }

  return {
    async status(modelId): Promise<boolean> {
      try {
        const manifest = await readManifest(modelId);
        if (!manifest) return false;
        const cache = await deps.openCache(TRANSFORMERS_CACHE);
        for (const file of manifest.files) {
          if (!(await cache.match(fileUrl(manifest.repoId, file.path)))) return false;
        }
        return true;
      } catch {
        return false;
      }
    },

    async download(modelId, onProgress): Promise<DownloadResult> {
      const spec = MODEL_SPECS[modelId];
      if (!spec) return { ok: false, reason: `Unknown model ${modelId}.` };
      if (controllers.has(modelId)) return { ok: false, reason: 'A download is already running.' };
      const controller = new AbortController();
      controllers.set(modelId, controller);
      try {
        const files = await listFiles(spec, controller.signal);
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        const cache = await deps.openCache(TRANSFORMERS_CACHE);
        let loadedBytes = 0;
        onProgress({ loadedBytes, totalBytes });
        for (const file of files) {
          const url = fileUrl(spec.repoId, file.path);
          const existing = await cache.match(url);
          if (existing) {
            // Finished in an earlier attempt: resuming only fetches what is missing.
            loadedBytes += file.size;
            onProgress({ loadedBytes, totalBytes });
            continue;
          }
          let fileBytes = 0;
          try {
            await fetchIntoCache(cache, url, file.size, controller.signal, (n) => {
              fileBytes += n;
              onProgress({ loadedBytes: loadedBytes + fileBytes, totalBytes });
            });
          } catch (error) {
            await cache.delete(url).catch(() => false);
            throw error;
          }
          loadedBytes += file.size;
          onProgress({ loadedBytes, totalBytes });
        }
        const manifest = await deps.openCache(MANIFEST_CACHE);
        await manifest.put(
          `${MANIFEST_PREFIX}${modelId}`,
          new Response(JSON.stringify({ repoId: spec.repoId, files } satisfies Manifest)),
        );
        return { ok: true };
      } catch (error) {
        const aborted = controller.signal.aborted;
        // A dropped connection surfaces as a TypeError from fetch; both it and a cancel can be resumed later.
        const networkLoss = error instanceof TypeError;
        return {
          ok: false,
          paused: aborted || networkLoss,
          reason: aborted ? 'Download paused.' : networkLoss ? 'The connection was lost.' : describeError(error),
        };
      } finally {
        controllers.delete(modelId);
      }
    },

    cancel(modelId): void {
      controllers.get(modelId)?.abort();
    },

    async remove(modelId): Promise<DownloadResult> {
      try {
        const manifest = await readManifest(modelId);
        const spec = MODEL_SPECS[modelId];
        const cache = await deps.openCache(TRANSFORMERS_CACHE);
        const repoId = manifest?.repoId ?? spec?.repoId;
        for (const file of manifest?.files ?? []) {
          await cache.delete(fileUrl(repoId as string, file.path));
        }
        await (await deps.openCache(MANIFEST_CACHE)).delete(`${MANIFEST_PREFIX}${modelId}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: describeError(error) };
      }
    },
  };
}
