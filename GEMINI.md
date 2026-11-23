# GEMINI.md — Haloop

Read and follow [AGENTS.md](AGENTS.md) as the canonical engineering specification for **Haloop**.

## Key Reminders for Gemini / Antigravity

- **Local-first & privacy-by-design:** All AI inference (Chrome Gemini Nano + Hugging Face Transformers.js on WebGPU/WASM), camera pose estimation, voice STT/TTS, and Web Bluetooth telemetry run strictly in the browser tab. Never add cloud uploads or telemetry.
- **Design-before-code:** Consult `docs/mocks/` and `docs/design-system/tokens/tokens.css` before writing UI code. Every screen must support light/dark themes, WCAG 2.2 AA accessibility, and all states in `docs/mocks/manifest.json`.
- **Use project skills:** Before running requirements, design docs, mocks, design system, Angular, or incremental implementation tasks, read the relevant `SKILL.md` in `.agents/skills/`.
- **Modern Angular:** Standalone components, `ChangeDetectionStrategy.OnPush`, Signals, native control flow (`@if`, `@for`, `@switch`), `inject()`, strict TypeScript, and Web Workers for ML pipelines.
- **Verify before finishing:** Run `python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write` after mock edits, and `npm test`, `npm run lint`, and `npm run build` after application edits.
