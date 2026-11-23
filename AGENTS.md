## 1. Project Overview

**Haloop** is a local-first, privacy-by-design movement coaching, wearable telemetry, and daily devotional web application. Every AI model runs inside the browser tab—combining Chrome's built-in **Gemini Nano** APIs (`Prompt`, `Summarizer`, `Writer`/`Rewriter`, `Translator`) with **Hugging Face** open models executed via **Transformers.js** on **WebGPU** (with automatic WebAssembly CPU fallback) and direct **Web Bluetooth** wearable connectivity.

### Non-Negotiable Product Invariants

1. **Zero cloud relay:** Camera frames, microphone audio, Web Bluetooth heart-rate/cadence streams, Coach prompts, and workout history must **never** leave the browser.
2. **Offline-capable by default:** Training, pose estimation, voice commands, Kokoro TTS cues, and KJV verse search must work offline once models are cached. Network calls are allowed only when explicitly downloading open models from Hugging Face or loading the static app shell.
3. **Graceful degradation:** Every Chrome Built-in AI API, WebGPU backend, camera/mic stream, and Web Bluetooth feature must degrade cleanly (e.g., `Qwen2.5-0.5B-Instruct` fallback when Gemini Nano is unavailable, WASM CPU fallback when WebGPU is unavailable, `/unsupported` guidance page).
4. **No mandatory accounts:** First-run onboarding (`/welcome`) replaces sign-up; all user state lives in browser storage (IndexedDB / Cache API) with local export.
5. **Respect the model cache budget:** Track cached Hugging Face model sizes against the user-configured cache budget (default 2 GB; 286 MB for the 4 core models).

---

## 2. Architecture & Target Stack

- **Frontend Framework:** Modern standalone, zoneless **Angular** (`src/app/`) using Signals (`signal`, `computed`, `input`, `output`, `linkedSignal`, `resource`) and native control flow (`@if`, `@for`, `@switch`).
- **On-Device AI (Chrome Built-in):**
  - `Prompt API` — Coach conversations & live workout cues
  - `Summarizer API` — Session & weekly recaps
  - `Writer & Rewriter API` — Devotional reflections (flag-gated: `chrome://flags/#writer-api-for-gemini-nano`)
  - `Translator API` — Scripture translation in 12 languages
- **On-Device Open Models (Hugging Face · Transformers.js in Web Workers):**
  - `onnx-community/vitpose-base-simple` (~94 MB) — Camera pose estimation & rep counting
  - `onnx-community/whisper-base` (~77 MB) — Voice commands (STT)
  - `onnx-community/Kokoro-82M-ONNX` (~92 MB) — Spoken coaching cues (TTS)
  - `Xenova/all-MiniLM-L6-v2` (~23 MB) — Semantic KJV Scripture embeddings
  - `onnx-community/Qwen2.5-0.5B-Instruct` (~480 MB) — Optional Coach text generation fallback
- **Browser APIs:** WebGPU / WASM, Web Workers, Web Bluetooth, `MediaDevices.getUserMedia`, IndexedDB, Cache API, Service Worker (PWA).
- **Primary Routes:** `/` (Today), `/train` (Train), `/coach` (Coach), `/history` (History), `/history/:id` (Session detail), `/devices` (Devices), `/lab` (AI Lab), `/settings` (Settings), `/welcome` (Onboarding), `/offline` (Offline), `/unsupported` (Unsupported browser), `/404` (Not found).

---

## 3. Repository Layout & Skills

```text
.agents/skills/        # Project skills — read the relevant SKILL.md before running these workflows
docs/mocks/            # Static HTML mocks for all 12 pages, 5 dialogs, 3 notification families
docs/design-system/    # Extracted DTCG design tokens (tokens.json, tokens.css) and contrast audit
docs/specs/            # L1/L2 software requirements and acceptance criteria (create before new features)
docs/detailed-designs/ # C4, class, and sequence design docs per subsystem (create from specs)
docs/estimates/        # Effort estimates and progress tracking
src/                   # Target Angular application workspace
```

### Mandatory Workflow & Project Skills

Always follow this lifecycle and consult the matching skill in `.agents/skills/` before acting:

1. **Requirements first** → `.agents/skills/engineering-requirements/SKILL.md` (`docs/specs/`)
2. **Detailed designs** → `.agents/skills/writing-software-design-documents/SKILL.md` (`docs/detailed-designs/`)
3. **HTML mocks before UI code** → `.agents/skills/writing-html-mocks/SKILL.md` (`docs/mocks/`)
4. **Design system extraction** → `.agents/skills/extracting-design-systems/SKILL.md` (`docs/design-system/`)
5. **Angular scaffolding & code** → `.agents/skills/angular-new-app/SKILL.md` and `.agents/skills/angular-developer/SKILL.md`
6. **Incremental, test-first delivery** → `.agents/skills/implementing-incrementally/SKILL.md`
7. **Effort & progress tracking** → `.agents/skills/estimating-designs/SKILL.md` (`docs/estimates/`)

---

## 4. Coding, UI & Accessibility Standards

### Angular & TypeScript
- Use **standalone components** (do not set `standalone: true` explicitly on Angular 20+ where it is the default), `ChangeDetectionStrategy.OnPush`, and `inject()` for DI.
- Prefer **Signals** over RxJS for local and derived component state; use RxJS only where streams/events genuinely warrant it (e.g., Web Bluetooth notifications, Web Worker message pipelines).
- Use `input()` / `output()` functions, native template control flow (`@if`, `@for`, `@switch`), and strict TypeScript (never use `any`; prefer `unknown` and narrow).
- Keep all ML inference (`@huggingface/transformers`), pose tracking, STT, TTS, and embedding search inside **Web Workers** so the UI thread stays responsive.
- Do **not** use `ngClass` or `ngStyle`; prefer direct `[class.foo]` / `[style.bar]` bindings.

### Design System & Accessibility
- Treat `docs/mocks/` and `docs/design-system/tokens/tokens.css` as the visual contract. Consume semantic CSS custom properties (`--color-bg-canvas`, `--color-fg-default`, `--color-halo`, `--space-*`, `--radius-*`, `--text-*`) instead of raw hex values or ad-hoc pixels.
- Every screen must handle all states defined in `docs/mocks/manifest.json` (`default`, `loading`, `empty`, `error`, plus domain states like `paused`, `downloading`, `wasm`, `submitting`, `invalid`, `success`).
- Enforce **WCAG 2.2 AA** in both light and dark themes: semantic landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`), skip link, full keyboard operability, visible focus rings, `aria-live` announcements for toasts/banners/rep counts, and `prefers-reduced-motion` support.

---

## 5. Verification Commands

Run the relevant checks after every change before finishing:

- **HTML mocks integrity & coverage:**
  ```bash
  python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write
  ```
- **Angular application (once scaffolded):**
  ```bash
  npm test
  npm run lint
  npm run build
  ```

---

## 6. Git & Pull Request Conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, `chore(scope): ...`.
- Deliver changes in small, reviewable vertical slices.
- Never commit secrets, `.env` files, or generated cache artifacts (`.cache/`, `docs/mocks/.cache/`).
- Update `CHANGELOG.md` and relevant docs when user-visible behavior changes.
