---
trigger: always_on
---

# Haloop Windsurf Rules

Read and follow `AGENTS.md` at the repository root as the canonical engineering guide.

## Core Guidelines

- **Local-First Privacy:** Every AI model (Chrome Gemini Nano + Hugging Face Transformers.js on WebGPU/WASM), camera pose estimator, voice STT/TTS pipeline, and Web Bluetooth integration runs strictly in the browser tab. Never introduce cloud uploads or telemetry.
- **Angular & TypeScript:** Standalone components, `ChangeDetectionStrategy.OnPush`, Signals, native control flow (`@if`, `@for`, `@switch`), `inject()`, strict TypeScript (no `any`), and Web Workers for ML inference.
- **Design & Accessibility:** Match `docs/mocks/` and use tokens from `docs/design-system/tokens/tokens.css`. Maintain WCAG 2.2 AA compliance in light and dark themes across all states defined in `docs/mocks/manifest.json`.
- **Engineering Workflow:** Follow `.agents/skills/` for requirements (`docs/specs/`), detailed designs (`docs/detailed-designs/`), mocks (`docs/mocks/`), and incremental test-first delivery.
- **Verification:** Run `python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write` for mock edits, and `npm test`, `npm run lint`, and `npm run build` for Angular edits.
