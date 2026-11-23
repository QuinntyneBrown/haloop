# JetBrains Junie Guidelines — Haloop

Read and follow `AGENTS.md` at the repository root as the canonical engineering guide for **Haloop**.

## Key Rules

- **Privacy & Local-First:** All AI inference (Chrome Gemini Nano + Transformers.js on WebGPU/WASM), camera/mic processing, and Web Bluetooth telemetry stay inside the browser tab. Never add server uploads or tracking.
- **Angular Architecture:** Standalone components, `ChangeDetectionStrategy.OnPush`, Signals, native control flow (`@if`, `@for`, `@switch`), `inject()`, strict TypeScript without `any`, and Web Workers for ML pipelines.
- **Design & Accessibility:** Match `docs/mocks/` and consume tokens from `docs/design-system/tokens/tokens.css`. Ensure WCAG 2.2 AA compliance across light/dark themes and all states in `docs/mocks/manifest.json`.
- **Workflow & Skills:** Check `.agents/skills/*/SKILL.md` before creating specs, design docs, HTML mocks, design tokens, or incremental code slices.
- **Verification:** Run `python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write` for mock updates, and `npm test`, `npm run lint`, and `npm run build` for Angular code.
