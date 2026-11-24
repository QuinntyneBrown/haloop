// Acceptance Test
// Traces to: L2-014, L2-025, L2-027, L2-030
// Description: Verify MiniLM semantic search ranks verses by cosine similarity in the worker, reuses the verse
// index, never touches the network, and falls back to WASM CPU when WebGPU is unavailable.

import {
  EmbedLibrary,
  EmbedVerse,
  VectorIndex,
  corpusFingerprint,
  createEmbedEngine,
  rankByCosine,
} from './embed-engine';

const VOCAB = ['run', 'race', 'rest', 'peace', 'strength', 'weary'];

function embedText(text: string): number[] {
  const lower = text.toLowerCase();
  const v = VOCAB.map((w) => (lower.includes(w) ? 1 : 0));
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

function fakeLibrary(options: { failWebGpu?: boolean } = {}) {
  const calls = { pipelines: [] as string[], batches: [] as string[][] };
  const lib: EmbedLibrary = {
    env: { useBrowserCache: false, allowRemoteModels: true, allowLocalModels: true },
    pipeline: async (_task, _model, { device }) => {
      calls.pipelines.push(device);
      if (device === 'webgpu' && options.failWebGpu) throw new Error('no webgpu');
      return async (input: string[]) => {
        calls.batches.push(input);
        const rows = input.map(embedText);
        return { data: new Float32Array(rows.flat()), dims: [rows.length, VOCAB.length] };
      };
    },
  };
  return { lib, calls };
}

const CORPUS: EmbedVerse[] = [
  { reference: 'Isaiah 40:31', text: 'they shall run, and not be weary', themes: ['strength'] },
  { reference: 'Psalm 23:2', text: 'he leadeth me beside still waters', themes: ['rest', 'peace'] },
  { reference: '1 Corinthians 9:24', text: 'they which run in a race run all', themes: ['race'] },
];

describe('embed engine', () => {
  it('ranks verses by cosine similarity and embeds the corpus only once (L2-014)', async () => {
    const { lib, calls } = fakeLibrary();
    const engine = createEmbedEngine({ loadLibrary: async () => lib, detectWebGpu: async () => false });

    const first = await engine.search('peace and rest', CORPUS, 'AutoWebGpu', 2);
    expect(first.results?.[0].reference).toBe('Psalm 23:2');
    expect(first.results?.length).toBe(2);
    expect(first.results![0].score).toBeGreaterThan(first.results![1].score);

    const second = await engine.search('run a race', CORPUS, 'AutoWebGpu', 1);
    expect(second.results?.[0].reference).toBe('1 Corinthians 9:24');
    // corpus batch once, then one single-query batch per search
    expect(calls.batches.map((b) => b.length)).toEqual([3, 1, 1]);
  });

  it('runs cache-only so no network request can be made (L2-027)', async () => {
    const { lib } = fakeLibrary();
    const engine = createEmbedEngine({ loadLibrary: async () => lib, detectWebGpu: async () => false });
    await engine.search('rest', CORPUS, 'AutoWebGpu');
    expect(lib.env).toMatchObject({ useBrowserCache: true, allowRemoteModels: false, allowLocalModels: false });
  });

  it('skips the model entirely when the weights are not cached (L2-027)', async () => {
    const { lib, calls } = fakeLibrary();
    const engine = createEmbedEngine({ loadLibrary: async () => lib, detectWebGpu: async () => true, isCached: async () => false });
    const result = await engine.search('rest', CORPUS, 'AutoWebGpu');
    expect(result.results).toBeNull();
    expect(result.reason).toContain('not downloaded');
    expect(calls.pipelines).toEqual([]);
  });

  it('falls back to WASM CPU when WebGPU is unavailable or fails (L2-030)', async () => {
    const noGpu = fakeLibrary();
    expect((await createEmbedEngine({ loadLibrary: async () => noGpu.lib, detectWebGpu: async () => false }).search('rest', CORPUS, 'AutoWebGpu')).device).toBe('wasm');

    const broken = fakeLibrary({ failWebGpu: true });
    const result = await createEmbedEngine({ loadLibrary: async () => broken.lib, detectWebGpu: async () => true }).search('rest', CORPUS, 'AutoWebGpu');
    expect(result.device).toBe('wasm');
    expect(broken.calls.pipelines).toEqual(['webgpu', 'wasm']);
  });

  it('persists the verse index and reuses it in a new session without re-embedding the corpus (L2-025)', async () => {
    const stored = new Map<string, VectorIndex>();
    const store = {
      load: async (f: string) => stored.get(f) ?? null,
      save: async (i: VectorIndex) => void stored.set(i.fingerprint, i),
    };
    const first = fakeLibrary();
    await createEmbedEngine({ loadLibrary: async () => first.lib, detectWebGpu: async () => false, indexStore: store }).search('rest', CORPUS, 'WasmCpu');
    expect(stored.size).toBe(1);

    const second = fakeLibrary();
    const result = await createEmbedEngine({ loadLibrary: async () => second.lib, detectWebGpu: async () => false, indexStore: store }).search('rest', CORPUS, 'WasmCpu');
    expect(result.results?.[0].reference).toBe('Psalm 23:2');
    expect(second.calls.batches.map((b) => b.length)).toEqual([1]);
  });

  it('rebuilds the index when the corpus changes (L2-025)', () => {
    expect(corpusFingerprint(CORPUS)).not.toBe(corpusFingerprint(CORPUS.slice(0, 2)));
    expect(corpusFingerprint(CORPUS)).toBe(corpusFingerprint([...CORPUS]));
  });

  it('reports a failed load as a reason instead of throwing, and retries next time (L2-030)', async () => {
    let attempts = 0;
    const { lib } = fakeLibrary();
    const engine = createEmbedEngine({
      loadLibrary: async () => {
        if (++attempts === 1) throw new Error('boom');
        return lib;
      },
      detectWebGpu: async () => false,
    });
    expect((await engine.search('rest', CORPUS, 'AutoWebGpu')).reason).toBe('boom');
    expect((await engine.search('rest', CORPUS, 'AutoWebGpu')).results).not.toBeNull();
  });

  it('rankByCosine orders rows by dot product of unit vectors', () => {
    const index = { dimension: 2, vectors: new Float32Array([1, 0, 0, 1, 0.6, 0.8]) };
    expect(rankByCosine(new Float32Array([0, 1]), index, 2).map((r) => r.row)).toEqual([1, 2]);
  });

  it('rejects empty queries without loading the model', async () => {
    const { lib, calls } = fakeLibrary();
    const result = await createEmbedEngine({ loadLibrary: async () => lib, detectWebGpu: async () => true }).search('  ', CORPUS, 'AutoWebGpu');
    expect(result.results).toBeNull();
    expect(calls.pipelines).toEqual([]);
  });
});
