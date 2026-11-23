# GitHub Copilot Instructions — Haloop

Follow [AGENTS.md](../AGENTS.md) as the canonical source of truth for this repository.

## Project Context

**Haloop** is a local-first, offline-capable **Angular** web application for on-device AI movement coaching, Web Bluetooth wearable telemetry, and daily Scripture study. All AI runs in the browser tab via Chrome Built-in AI (**Gemini Nano**) and **Hugging Face Transformers.js** (WebGPU with WASM CPU fallback).

## Core Rules

1. **Privacy & Local-First:** Never send camera frames, microphone audio, Bluetooth telemetry, prompts, or workout history to external servers. Network calls are only for user-initiated Hugging Face model downloads and static app shell assets.
2. **Angular Standards:** Use standalone components, `ChangeDetectionStrategy.OnPush`, Signals (`signal`, `computed`, `input`, `output`, `linkedSignal`, `resource`), `inject()`, native control flow (`@if`, `@for`, `@switch`), and strict TypeScript without `any`. Offload all ML inference to Web Workers.
3. **Design System & Accessibility:** Align all UI with `docs/mocks/` and consume CSS custom properties from `docs/design-system/tokens/tokens.css`. Support both light and dark themes, WCAG 2.2 AA contrast and keyboard navigation, and every UI state listed in `docs/mocks/manifest.json`.
4. **Workflow & Skills:** Follow specs (`docs/specs/`) → designs (`docs/detailed-designs/`) → mocks (`docs/mocks/`) → incremental test-first slices. Check `.agents/skills/` for detailed workflow instructions.
5. **Verification:** Validate mock changes with `python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write`, and validate app changes with `npm test`, `npm run lint`, and `npm run build`.
