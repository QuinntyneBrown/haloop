# Amazon Q Developer Rules — Haloop

Read and follow `AGENTS.md` at the repository root as the canonical engineering guide for **Haloop**.

## Core Constraints

- **Local-First & Zero Cloud Relay:** All AI models (Chrome Built-in Gemini Nano and Hugging Face Transformers.js on WebGPU/WASM), camera pose estimation, voice STT/TTS, and Web Bluetooth telemetry must execute strictly inside the browser tab.
- **Modern Angular:** Use standalone components, `ChangeDetectionStrategy.OnPush`, Signals, `inject()`, native control flow (`@if`, `@for`, `@switch`), strict TypeScript (no `any`), and Web Workers for ML inference.
- **Design System & Accessibility:** Follow `docs/mocks/` and `docs/design-system/tokens/tokens.css`. Maintain WCAG 2.2 AA compliance in light and dark themes and cover all states in `docs/mocks/manifest.json`.
- **Project Skills:** Read the relevant `.agents/skills/*/SKILL.md` before executing requirements, design, mock, design-system, Angular, or incremental implementation tasks.
- **Verification:** Run `python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write` after mock edits, and `npm test`, `npm run lint`, and `npm run build` after app edits.
