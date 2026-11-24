/**
 * On-device `Xenova/all-MiniLM-L6-v2` sentence-embedding engine for semantic KJV search
 * (L2-014, L2-025, L2-027, L2-030). Runs inside the ML Web Worker; queries and verses never leave the browser.
 *
 * The verse vectors are computed once per corpus fingerprint, kept in memory and (when a store is supplied)
 * persisted so later sessions rank with a cosine-similarity lookup and embed only the query.
 */

export const MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const MINILM_TASK = 'feature-extraction';
export const DEFAULT_TOP_K = 4;

export type EmbedDevice = 'webgpu' | 'wasm';
export type EmbedPreferredBackend = 'AutoWebGpu' | 'WasmCpu';

export interface EmbedVerse {
  readonly reference: string;
  readonly text: string;
  readonly themes: readonly string[];
}

export interface EmbedHit {
  readonly reference: string;
  readonly text: string;
  readonly score: number;
}

export interface EmbedSearchResult {
  readonly results: readonly EmbedHit[] | null;
  readonly device: EmbedDevice | null;
  readonly reason?: string;
}

interface EmbedTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

interface EmbedPipeline {
  (input: string[], options: { pooling: 'mean'; normalize: boolean }): Promise<EmbedTensor>;
}

/** The slice of `@huggingface/transformers` this engine depends on. */
export interface EmbedLibrary {
  readonly env: { useBrowserCache: boolean; allowRemoteModels: boolean; allowLocalModels: boolean };
  pipeline(task: string, model: string, options: { device: EmbedDevice; dtype: string }): Promise<EmbedPipeline>;
}

export interface VectorIndex {
  readonly fingerprint: string;
  readonly dimension: number;
  /** `references.length * dimension` unit-length floats, one row per verse. */
  readonly vectors: Float32Array;
  readonly references: readonly string[];
}

export interface EmbedEngineDeps {
  readonly loadLibrary: () => Promise<EmbedLibrary>;
  readonly detectWebGpu: () => Promise<boolean>;
  /** Whether the weights are cached locally; when not, search is skipped without any network. */
  readonly isCached?: () => Promise<boolean>;
  readonly indexStore?: {
    load(fingerprint: string): Promise<VectorIndex | null>;
    save(index: VectorIndex): Promise<void>;
  };
}

export interface EmbedEngine {
  search(query: string, corpus: readonly EmbedVerse[], preferred: EmbedPreferredBackend, topK?: number): Promise<EmbedSearchResult>;
}

/** Cosine similarity of one unit-length query against every unit-length row, best first. */
export function rankByCosine(
  query: Float32Array,
  index: Pick<VectorIndex, 'vectors' | 'dimension'>,
  topK: number,
): { row: number; score: number }[] {
  const rows = index.vectors.length / index.dimension;
  const scored: { row: number; score: number }[] = [];
  for (let row = 0; row < rows; row++) {
    let dot = 0;
    const offset = row * index.dimension;
    for (let i = 0; i < index.dimension; i++) {
      dot += query[i] * index.vectors[offset + i];
    }
    scored.push({ row, score: dot });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** Order-sensitive FNV-1a hash of everything that influences a verse vector. */
export function corpusFingerprint(corpus: readonly EmbedVerse[]): string {
  let hash = 0x811c9dc5;
  for (const char of corpus.map((v) => `${v.reference}|${embeddingText(v)}`).join('\n')) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `${MINILM_MODEL_ID}:${corpus.length}:${hash.toString(16)}`;
}

export function embeddingText(verse: EmbedVerse): string {
  return `${verse.text} ${verse.themes.join(' ')}`.trim();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createEmbedEngine(deps: EmbedEngineDeps): EmbedEngine {
  let session: Promise<{ pipe: EmbedPipeline; device: EmbedDevice }> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let webGpuUnusable = false;
  const indexes = new Map<string, VectorIndex>();

  function load(preferred: EmbedPreferredBackend): Promise<{ pipe: EmbedPipeline; device: EmbedDevice }> {
    session ??= (async () => {
      const lib = await deps.loadLibrary();
      lib.env.useBrowserCache = true;
      // Cache-only: searching Scripture must never reach the network (L2-027).
      lib.env.allowRemoteModels = false;
      lib.env.allowLocalModels = false;
      const wantGpu = preferred === 'AutoWebGpu' && !webGpuUnusable && (await deps.detectWebGpu());
      const create = (device: EmbedDevice) => lib.pipeline(MINILM_TASK, MINILM_MODEL_ID, { device, dtype: 'fp32' });
      if (wantGpu) {
        try {
          return { pipe: await create('webgpu'), device: 'webgpu' as const };
        } catch {
          webGpuUnusable = true; // fall back to WASM CPU (L2-030)
        }
      }
      return { pipe: await create('wasm'), device: 'wasm' as const };
    })();
    session.catch(() => {
      session = null;
    });
    return session;
  }

  async function indexFor(corpus: readonly EmbedVerse[], pipe: EmbedPipeline): Promise<VectorIndex> {
    const fingerprint = corpusFingerprint(corpus);
    const cached = indexes.get(fingerprint) ?? (await deps.indexStore?.load(fingerprint).catch(() => null)) ?? null;
    if (cached) {
      indexes.set(fingerprint, cached);
      return cached;
    }
    const tensor = await pipe(corpus.map(embeddingText), { pooling: 'mean', normalize: true });
    const built: VectorIndex = {
      fingerprint,
      dimension: tensor.dims[tensor.dims.length - 1],
      vectors: new Float32Array(tensor.data),
      references: corpus.map((v) => v.reference),
    };
    indexes.set(fingerprint, built);
    await deps.indexStore?.save(built).catch(() => undefined);
    return built;
  }

  return {
    search(query, corpus, preferred, topK = DEFAULT_TOP_K): Promise<EmbedSearchResult> {
      const run = queue.then(async (): Promise<EmbedSearchResult> => {
        try {
          if (query.trim().length === 0 || corpus.length === 0) {
            return { results: null, device: null, reason: 'Nothing to search.' };
          }
          if (deps.isCached && !(await deps.isCached())) {
            return { results: null, device: null, reason: 'MiniLM is not downloaded on this device.' };
          }
          const { pipe, device } = await load(preferred);
          const index = await indexFor(corpus, pipe);
          const embedded = await pipe([query], { pooling: 'mean', normalize: true });
          const hits = rankByCosine(embedded.data, index, topK).map(({ row, score }) => ({
            reference: corpus[row].reference,
            text: corpus[row].text,
            score: Math.round(score * 1000) / 1000,
          }));
          return { results: hits, device };
        } catch (error) {
          return { results: null, device: null, reason: describeError(error) };
        }
      });
      queue = run;
      return run;
    },
  };
}
