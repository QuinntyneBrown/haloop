# Changelog

All notable changes to **Haloop** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Coach replies now stream token-by-token: `LanguageModel.promptStreaming()` for Gemini Nano (echo stub never shown) and `TextStreamer` chunks from the Qwen2.5-0.5B worker, rendered live as escaped text in the in-progress bubble (#2).
- Root `README.md` aligned with the expected on-device AI, WebGPU, and Web Bluetooth final implementation.
- Open-source community and governance documentation (`LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `CHANGELOG.md`, and `.github/` issue/PR templates).
- AI coding agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/haloop.mdc`, `.windsurf/rules/haloop.md`, `.clinerules`, `.junie/guidelines.md`, `.amazonq/rules/haloop.md`).
- Static HTML mock suite (`docs/mocks/`) covering all 12 pages, 5 dialogs, and 3 notification families in light and dark themes across all required states.
- Extracted design system tokens and contrast audit (`docs/design-system/`).
- L1/L2 software requirements specifications (`docs/specs/L1.md`, `docs/specs/L2.md`) covering 13 L1s and 34 L2s with Given/When/Then acceptance criteria.
- Detailed software design tree (`docs/detailed-designs/`) across 5 subsystems and 10 vertical features with 50 rendered PlantUML C4, class, and sequence diagrams.
- Standalone, zoneless Angular 22 Haloop application (`src/app/`) implementing all 12 routes, 5 modal dialogs, 3 notification families, dedicated ML Web Worker (`ml-inference.worker.ts`), Chrome Built-in AI adapters, Web Bluetooth GATT parsers, IndexedDB local persistence, PWA manifest/service worker, and WCAG 2.2 AA light/dark tokens.
- Acceptance test suite (Vitest) and Playwright CLI end-to-end walkthrough (`e2e/haloop-walkthrough.spec.ts`) with video capture.
- Real on-device `onnx-community/Qwen2.5-0.5B-Instruct` Coach fallback inference in the ML Web Worker via `@huggingface/transformers` (`q4f16`, WebGPU with automatic WASM CPU fallback, honouring the Settings backend preference). WebGPU is used only when an fp16-capable adapter exists and a load-time output check passes; a failed session, a lost GPU device, or garbage output falls back to WASM CPU. Transformers.js is loaded lazily on the first Qwen request, models resolve from the local browser cache only, and the ONNX Runtime WASM binaries are served from the app origin, so cached Coach prompts make zero outbound requests. Replies are labelled with the engine actually used (`Qwen2.5-0.5B-Instruct · WebGPU`, `· WASM CPU`, or `Deterministic fallback`) (L2-012, L2-027, L2-030).
- AI Lab `Download` / `Remove` for the Coach fallback now really fetches Qwen2.5-0.5B-Instruct from Hugging Face into Cache Storage (with live MB progress and a failure toast) and really clears it; the `Ready` state reflects the actual cache and survives reloads (L2-022, L2-023, L2-027).

### Fixed

- Service worker activation no longer deletes non-shell caches, which would have wiped downloaded on-device models on every app-shell update.
- AI Lab no longer marks the Coach fallback `Ready` when the browser could not persist the downloaded model (for example in a private window or with storage exhausted); the download is reported as failed instead.
- The Coach fallback now recovers when a failed WebGPU session leaves ONNX Runtime unusable inside the ML Web Worker (seen on a Qualcomm Adreno GPU): the device is remembered as WASM-CPU-only and the request is replayed once on a fresh worker, instead of every prompt silently dropping to the deterministic reply.
- `MlWorkerClient` settles pending requests with their local fallbacks when the ML Web Worker crashes instead of leaving callers waiting forever.
