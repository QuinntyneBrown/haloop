// Acceptance Test
// Traces to: L2-005, L2-022, L2-027, L2-030, L2-031
// Description: Verify real model downloads stream Hugging Face files into Cache Storage with live byte progress,
// resume after a lost connection without refetching finished files, can be cancelled, report removal accurately,
// and never keep a partial file.

import { MODEL_SPECS, TRANSFORMERS_CACHE, createModelDownloader, fileUrl } from './model-downloader';

const KB = 1024;

function body(bytes: number, chunk = 256): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      const n = Math.min(chunk, bytes - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n));
    },
  });
}

class FakeCache {
  readonly entries = new Map<string, number>();
  private readonly json = new Map<string, string>();
  async match(url: string): Promise<Response | undefined> {
    return this.entries.has(url) ? new Response(this.json.get(url) ?? '{}') : undefined;
  }
  async put(url: string, response: Response): Promise<void> {
    const buffer = await response.arrayBuffer();
    this.entries.set(url, buffer.byteLength);
    this.json.set(url, new TextDecoder().decode(buffer));
  }
  async delete(url: string): Promise<boolean> {
    this.json.delete(url);
    return this.entries.delete(url);
  }
}

const TREE = [
  { type: 'file', path: 'README.md', size: 10 },
  { type: 'file', path: 'config.json', size: 512 },
  { type: 'file', path: 'tokenizer.json', size: 1024 },
  { type: 'file', path: 'quantize_config.json', size: 99 },
  { type: 'file', path: 'onnx/model.onnx', size: 99_999 },
  { type: 'file', path: 'onnx/model_quantized.onnx', size: 4 * KB },
  { type: 'file', path: 'vocab.txt', size: 256 },
];

function setup(options: { failOn?: string; offlineAfterBytes?: number; sizes?: Record<string, number> } = {}) {
  const caches = new Map<string, FakeCache>();
  const requested: string[] = [];
  let fail = options.failOn;
  const deps = {
    openCache: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache());
      return caches.get(name)!;
    },
    fetchImpl: async (url: string, init?: { signal?: AbortSignal }): Promise<Response> => {
      requested.push(url);
      if (url.includes('/api/models/')) {
        return new Response(JSON.stringify(TREE), { status: 200 });
      }
      if (fail && url.endsWith(fail)) {
        throw new TypeError('Failed to fetch');
      }
      const path = url.split('/resolve/main/')[1];
      const size = TREE.find((f) => f.path === path)!.size;
      const stream = body(size);
      init?.signal?.addEventListener('abort', () => undefined);
      return new Response(stream, { status: 200 });
    },
  };
  return {
    deps,
    requested,
    caches,
    clearFailure: () => (fail = undefined),
    cache: () => caches.get(TRANSFORMERS_CACHE)!,
  };
}

describe('model downloader', () => {
  it('downloads only the engine files, reports rising byte progress, and writes a manifest (L2-022)', async () => {
    const { deps, requested, cache } = setup();
    const downloader = createModelDownloader(deps);
    const progress: number[] = [];
    let total = 0;

    const result = await downloader.download('minilm', (p) => {
      progress.push(p.loadedBytes);
      total = p.totalBytes;
    });

    expect(result).toEqual({ ok: true });
    expect(total).toBe(512 + 1024 + 4 * KB + 256);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(total);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(new Set(progress).size).toBeGreaterThan(5);
    expect([...cache().entries.keys()].map((u) => u.split('/resolve/main/')[1]).sort()).toEqual([
      'config.json',
      'onnx/model_quantized.onnx',
      'tokenizer.json',
      'vocab.txt',
    ]);
    // Unneeded variants and docs are never fetched.
    expect(requested.some((u) => u.endsWith('onnx/model.onnx') || u.endsWith('README.md'))).toBe(false);
    expect(await downloader.status('minilm')).toBe(true);
  });

  it('uses the Transformers.js cache key so engines load the files without any network (L2-027)', async () => {
    const { deps, cache } = setup();
    await createModelDownloader(deps).download('minilm', () => undefined);
    expect(cache().entries.has(fileUrl('Xenova/all-MiniLM-L6-v2', 'config.json'))).toBe(true);
    expect(fileUrl('Xenova/all-MiniLM-L6-v2', 'config.json')).toBe(
      'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json',
    );
  });

  it('pauses on a lost connection, keeps finished files, and resumes fetching only what is missing (L2-005)', async () => {
    const env = setup({ failOn: 'onnx/model_quantized.onnx' });
    const downloader = createModelDownloader(env.deps);

    const first = await downloader.download('minilm', () => undefined);
    expect(first.ok).toBe(false);
    expect(first.paused).toBe(true);
    expect(await downloader.status('minilm')).toBe(false);
    expect(env.cache().entries.has(fileUrl('Xenova/all-MiniLM-L6-v2', 'config.json'))).toBe(true);
    expect(env.cache().entries.has(fileUrl('Xenova/all-MiniLM-L6-v2', 'onnx/model_quantized.onnx'))).toBe(false);

    env.requested.length = 0;
    env.clearFailure();
    const progress: number[] = [];
    const second = await downloader.download('minilm', (p) => progress.push(p.loadedBytes));

    expect(second).toEqual({ ok: true });
    expect(
      env.requested.filter((u) => u.includes('/resolve/main/')).map((u) => u.split('/resolve/main/')[1]),
    ).toEqual(['onnx/model_quantized.onnx', 'vocab.txt']);
    // Resumed progress starts from the bytes already on disk, not from zero.
    expect(progress[1]).toBeGreaterThan(0);
    expect(await downloader.status('minilm')).toBe(true);
  });

  it('cancels a running download, reports it as paused, and allows a later retry (L2-005)', async () => {
    const env = setup();
    const downloader = createModelDownloader({
      ...env.deps,
      fetchImpl: async (url, init) => {
        const res = await env.deps.fetchImpl(url, init);
        if (url.endsWith('onnx/model_quantized.onnx')) {
          return new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          );
        }
        return res;
      },
    });

    const running = downloader.download('minilm', () => undefined);
    await vi.waitFor(() => expect(env.cache().entries.has(fileUrl('Xenova/all-MiniLM-L6-v2', 'tokenizer.json'))).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    downloader.cancel('minilm');
    const result = await running;

    expect(result).toMatchObject({ ok: false, paused: true, reason: 'Download paused.' });
    expect(await downloader.status('minilm')).toBe(false);
  });

  it('never keeps a truncated file (L2-030)', async () => {
    const env = setup();
    const downloader = createModelDownloader({
      ...env.deps,
      fetchImpl: async (url, init) => {
        if (url.endsWith('config.json')) return new Response(body(100), { status: 200 });
        return env.deps.fetchImpl(url, init);
      },
    });
    const result = await downloader.download('minilm', () => undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Incomplete download');
    expect(result.paused).toBeFalsy();
    expect(env.cache().entries.size).toBe(0);
  });

  it('surfaces server errors as a failure, not a pause (L2-030)', async () => {
    const env = setup();
    const downloader = createModelDownloader({
      ...env.deps,
      fetchImpl: async (url, init) =>
        url.includes('/api/models/') ? new Response('nope', { status: 503 }) : env.deps.fetchImpl(url, init),
    });
    expect(await downloader.download('minilm', () => undefined)).toMatchObject({ ok: false, reason: expect.stringContaining('503') });
  });

  it('removes every cached file and reports the model as not cached (L2-022)', async () => {
    const env = setup();
    const downloader = createModelDownloader(env.deps);
    await downloader.download('minilm', () => undefined);
    expect(await downloader.status('minilm')).toBe(true);

    expect(await downloader.remove('minilm')).toEqual({ ok: true });

    expect(env.cache().entries.size).toBe(0);
    expect(await downloader.status('minilm')).toBe(false);
  });

  it('reports a removal failure instead of throwing (L2-022)', async () => {
    const env = setup();
    const downloader = createModelDownloader(env.deps);
    await downloader.download('minilm', () => undefined);
    env.cache().delete = async () => {
      throw new Error('storage blocked');
    };
    expect(await downloader.remove('minilm')).toEqual({ ok: false, reason: 'storage blocked' });
  });

  it('rejects unknown models and double starts (L2-022)', async () => {
    const env = setup();
    const downloader = createModelDownloader(env.deps);
    expect((await downloader.download('nope', () => undefined)).ok).toBe(false);
    const first = downloader.download('minilm', () => undefined);
    expect((await downloader.download('minilm', () => undefined)).reason).toContain('already running');
    await first;
  });

  it('selects dtype-matched files for every core model (L2-022)', () => {
    expect(MODEL_SPECS['whisper'].include('onnx/encoder_model_quantized.onnx')).toBe(true);
    expect(MODEL_SPECS['whisper'].include('onnx/decoder_model_merged_quantized.onnx')).toBe(true);
    expect(MODEL_SPECS['whisper'].include('onnx/decoder_model.onnx')).toBe(false);
    expect(MODEL_SPECS['kokoro'].include('voices/af_heart.bin')).toBe(true);
    expect(MODEL_SPECS['kokoro'].include('voices/am_adam.bin')).toBe(false);
    expect(MODEL_SPECS['vitpose'].include('preprocessor_config.json')).toBe(true);
    expect(MODEL_SPECS['vitpose'].include('onnx/model.onnx')).toBe(false);
  });
});
