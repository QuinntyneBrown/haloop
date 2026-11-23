# Estimates

- Overall effort: 42 days
- Complete: 94%

| Subsystem | Effort | Complete |
|---|---:|---:|
| [movement-training](movement-training.md) | 14 days | 95% |
| [ai-coaching](ai-coaching.md) | 9 days | 90% |
| [wearables](wearables.md) | 5 days | 90% |
| [ai-lab](ai-lab.md) | 5 days | 90% |
| [onboarding-shell](onboarding-shell.md) | 9 days | 100% |

## Roadmap

1. `ai-lab` — wire live `@huggingface/transformers` ONNX artifact downloads into Cache Storage / OPFS.
2. `movement-training` — connect live VitPose / Whisper / Kokoro ONNX pipelines inside `ml-inference.worker.ts`.
3. `ai-coaching` — connect live MiniLM KJV vector embeddings and Qwen2.5-0.5B ONNX fallback in worker.
4. `wearables` — bind live BLE GATT notification streams directly into active `/train` telemetry.
