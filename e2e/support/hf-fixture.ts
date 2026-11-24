import type { Page } from '@playwright/test';

const CORE_MODELS = [
  { id: 'vitpose', repo: 'onnx-community/vitpose-base-simple' },
  { id: 'whisper', repo: 'onnx-community/whisper-base' },
  { id: 'kokoro', repo: 'onnx-community/Kokoro-82M-v1.0-ONNX' },
  { id: 'minilm', repo: 'Xenova/all-MiniLM-L6-v2' },
];

const TREE = [
  { type: 'file', path: 'config.json', size: 64 },
  { type: 'file', path: 'tokenizer.json', size: 128 },
  { type: 'file', path: 'tokenizer_config.json', size: 96 },
  { type: 'file', path: 'vocab.txt', size: 32 },
  { type: 'file', path: 'onnx/model_quantized.onnx', size: 4096 },
];

/**
 * Makes the AI Lab hermetic: the four core models start out genuinely cached (manifest + files in Cache Storage),
 * and any Hugging Face request is answered locally with small, correctly sized files. No real download happens.
 */
export async function installHuggingFaceFixture(page: Page): Promise<void> {
  await page.addInitScript(
    ({ models, tree }) => {
      if (localStorage.getItem('e2e-model-cache-seeded')) return;
      localStorage.setItem('e2e-model-cache-seeded', '1');
      void (async () => {
        const weights = await caches.open('transformers-cache');
        const state = await caches.open('haloop-ml-state');
        for (const model of models) {
          for (const file of tree) {
            await weights.put(
              `https://huggingface.co/${model.repo}/resolve/main/${file.path}`,
              new Response(new Uint8Array(file.size)),
            );
          }
          await state.put(
            `/haloop-ml-state/model-manifest/${model.id}`,
            new Response(JSON.stringify({ repoId: model.repo, files: tree })),
          );
        }
      })();
    },
    { models: CORE_MODELS, tree: TREE },
  );

  await page.route('https://huggingface.co/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/models/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TREE) });
      return;
    }
    const path = url.split('/resolve/main/')[1];
    const file = TREE.find((f) => f.path === path);
    await route.fulfill({
      status: file ? 200 : 404,
      contentType: 'application/octet-stream',
      body: Buffer.alloc(file?.size ?? 0),
    });
  });
}
