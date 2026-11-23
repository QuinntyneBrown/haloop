# Haloop mocks

Static HTML mocks for **Haloop** — an on-device AI movement, coaching, and devotional web app running in Chrome (Gemini Nano built-in APIs + Hugging Face open models via Transformers.js on WebGPU/WASM + Web Bluetooth wearables).

Open [index.html](index.html) directly from disk to browse every page, dialog, and notification in every state.

- Append `?theme=dark` or `?theme=light` to force a theme, or press `t` on any mock.
- Append `?chrome=0` to hide the mock navigation bar and annotation notes for clean screenshots.

## Cast & catalog

<!-- Reusable dataset shared across every mock so stories stay coherent. -->

- **Today**: Monday, 23 November 2026 (morning, 07:15 EST)
- **Primary user**: Micah Osei (`MO`, 11-day streak, preferred language English · KJV, WebGPU enabled on MacBook Air M3 / Chrome 138)
- **Linked Bluetooth devices (2)**:
  - **Polar H10** — Heart-rate chest strap (`72 bpm` resting / `134 bpm` working, `88%` battery, connected)
  - **Coros Pace 3** — Running & cadence watch (`Connected`, `64%` battery, cadence & pace)
  - *Available to pair*: **Wahoo TICKR Fit** (armband HR), **Garmin HRM-Pro Plus**
- **Built into Chrome (Gemini Nano)**:
  - `Prompt API` — Coach conversations and live cues (**Available**)
  - `Summarizer` — Session and weekly recaps (**Available**)
  - `Writer & Rewriter` — Devotional reflections (**Flag off**)
  - `Translator` — Scripture in 12 languages (**Available**)
- **Open models (Hugging Face · Transformers.js · 2 GB cache budget, 286 MB cached by default)**:
  - `Rep counting & form` — `onnx-community/vitpose-base-simple` · Pose estimation · camera · `94 MB` (**Ready**)
  - `Voice commands` — `onnx-community/whisper-base` · Speech to text · `77 MB` (**Ready**)
  - `Coach voice` — `onnx-community/Kokoro-82M-ONNX` · Text to speech · `92 MB` (**Ready**)
  - `Verse search` — `Xenova/all-MiniLM-L6-v2` · Embeddings · KJV index · `23 MB` (**Ready**)
  - `Coach fallback` — `onnx-community/Qwen2.5-0.5B-Instruct` · Text generation, when Nano is off · `480 MB` (**Not downloaded**, or `212 / 480 MB` when downloading)
- **Workouts & history**:
  - Today's plan: **Morning Strength & Mobility** (25 min · 4 movements: Goblet squats, Push-ups, Split squats, Plank hold)
  - Recent sessions:
    1. **Sat 21 Nov** — *Upper Body & Core* · 28 min · 94% form · 138 avg bpm · 124 reps
    2. **Thu 19 Nov** — *Tempo Run & Mobility* · 34 min · 91% form · 149 avg bpm · 5.2 km
    3. **Tue 17 Nov** — *Lower Body Strength* · 31 min · 96% form · 132 avg bpm · 112 reps
    4. **Sun 15 Nov** — *Sabbath Stretch & Walk* · 20 min · 98% form · 102 avg bpm · 2.4 km
- **Daily Scripture**:
  - *Isaiah 40:31 (KJV)* — "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint."
  - *1 Corinthians 9:24 (KJV)* — "Know ye not that they which run in a race run all, but one receiveth the prize? So run, that ye may obtain."
  - *Hebrews 12:1 (KJV)* — "...let us run with patience the race that is set before us."

## Assumptions & open questions

Because these mocks were derived from the exported Magic Patterns `AI Lab` frame, `AppShell.tsx`, `Haloop.tsx`, and prototype stylesheet (without a formal L1/L2 spec), the following assumptions were made and should be confirmed:

1. **Local-first, no mandatory sign-in**: Haloop runs all models in the browser tab with local storage and Web Bluetooth, so no authentication wall is assumed; an onboarding flow (`/welcome`) replaces sign-up. Confirm if cloud sync or accounts are planned.
2. **Settings access**: `AppShell.tsx` lists 6 primary routes (`Today`, `Train`, `Coach`, `History`, `Devices`, `AI Lab`). `Settings` is added to the sidebar footer and topbar so users can manage units, backend preference (WebGPU/WASM), scripture language, and local data export.
3. **Scripture translation**: Default index is KJV (`Xenova/all-MiniLM-L6-v2` embeddings) with on-device translation via Chrome's Translator API in 12 languages.
4. **Offline behaviour**: Because models are cached locally, training, voice, pose estimation, and verse search continue working offline; only downloading new Hugging Face models requires a network connection.

## Verification commands

```sh
python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write
python3 .agents/skills/writing-html-mocks/scripts/screenshot_mocks.py docs/mocks
```

## Coverage

<!-- coverage:start -->

Legend: ✅ mock exists · ➖ not applicable (reason in manifest) · ❌ missing

### Pages

| Screen | default | loading | empty | error | paused | submitting | no-results | downloading | wasm | invalid | success | Requirements |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Today (`today`) | [✅](pages/today/default.html) | [✅](pages/today/loading.html) | [✅](pages/today/empty.html) | [✅](pages/today/error.html) |  |  |  |  |  |  |  |  |
| Train (`train`) | [✅](pages/train/default.html) | [✅](pages/train/loading.html) | [✅](pages/train/empty.html) | [✅](pages/train/error.html) | [✅](pages/train/paused.html) |  |  |  |  |  |  |  |
| Coach (`coach`) | [✅](pages/coach/default.html) | [✅](pages/coach/loading.html) | [✅](pages/coach/empty.html) | [✅](pages/coach/error.html) |  | [✅](pages/coach/submitting.html) |  |  |  |  |  |  |
| History (`history`) | [✅](pages/history/default.html) | [✅](pages/history/loading.html) | [✅](pages/history/empty.html) | [✅](pages/history/error.html) |  |  | [✅](pages/history/no-results.html) |  |  |  |  |  |
| Session detail (`session-detail`) | [✅](pages/session-detail/default.html) | [✅](pages/session-detail/loading.html) | ➖ | [✅](pages/session-detail/error.html) |  |  |  |  |  |  |  |  |
| Devices (`devices`) | [✅](pages/devices/default.html) | [✅](pages/devices/loading.html) | [✅](pages/devices/empty.html) | [✅](pages/devices/error.html) |  |  |  |  |  |  |  |  |
| AI Lab (`ai-lab`) | [✅](pages/ai-lab/default.html) | [✅](pages/ai-lab/loading.html) | [✅](pages/ai-lab/empty.html) | [✅](pages/ai-lab/error.html) |  |  |  | [✅](pages/ai-lab/downloading.html) | [✅](pages/ai-lab/wasm.html) |  |  |  |
| Settings (`settings`) | [✅](pages/settings/default.html) | [✅](pages/settings/loading.html) | ➖ | [✅](pages/settings/error.html) |  | [✅](pages/settings/submitting.html) |  |  |  | [✅](pages/settings/invalid.html) | [✅](pages/settings/success.html) |  |
| Welcome & setup (`onboarding`) | [✅](pages/onboarding/default.html) | [✅](pages/onboarding/loading.html) | ➖ | [✅](pages/onboarding/error.html) |  |  |  |  |  | [✅](pages/onboarding/invalid.html) | [✅](pages/onboarding/success.html) |  |
| Page not found (404) (`not-found`) | [✅](pages/not-found/default.html) | ➖ | ➖ | ➖ |  |  |  |  |  |  |  |  |
| Offline mode (`offline`) | [✅](pages/offline/default.html) | ➖ | ➖ | ➖ |  |  |  |  |  |  |  |  |
| Unsupported browser (`unsupported-browser`) | [✅](pages/unsupported-browser/default.html) | ➖ | ➖ | ➖ |  |  |  |  |  |  |  |  |

### Dialogs

| Screen | default | busy | invalid | failed | Requirements |
|---|---|---|---|---|---|
| Remove cached model (`remove-model`) | [✅](dialogs/remove-model/default.html) | [✅](dialogs/remove-model/busy.html) | ➖ | [✅](dialogs/remove-model/failed.html) |  |
| Pair Bluetooth device (`pair-device`) | [✅](dialogs/pair-device/default.html) | [✅](dialogs/pair-device/busy.html) | [✅](dialogs/pair-device/invalid.html) | [✅](dialogs/pair-device/failed.html) |  |
| Finish workout (`end-workout`) | [✅](dialogs/end-workout/default.html) | [✅](dialogs/end-workout/busy.html) | [✅](dialogs/end-workout/invalid.html) | [✅](dialogs/end-workout/failed.html) |  |
| Search Scripture (`verse-search`) | [✅](dialogs/verse-search/default.html) | [✅](dialogs/verse-search/busy.html) | [✅](dialogs/verse-search/invalid.html) |  |  |
| Enable Chrome built-in AI (`chrome-flags`) | [✅](dialogs/chrome-flags/default.html) | [✅](dialogs/chrome-flags/busy.html) | ➖ |  |  |

### Notifications

| Screen | info | success | warning | danger | stacked | persistent | Requirements |
|---|---|---|---|---|---|---|---|
| Model cache toast (`model-toast`) | [✅](notifications/model-toast/info.html) | [✅](notifications/model-toast/success.html) | [✅](notifications/model-toast/warning.html) | [✅](notifications/model-toast/danger.html) | [✅](notifications/model-toast/stacked.html) |  |  |
| Device connection toast (`device-toast`) | [✅](notifications/device-toast/info.html) | [✅](notifications/device-toast/success.html) | [✅](notifications/device-toast/warning.html) | [✅](notifications/device-toast/danger.html) |  |  |  |
| System status banner (`offline-banner`) | [✅](notifications/offline-banner/info.html) | [✅](notifications/offline-banner/success.html) | [✅](notifications/offline-banner/warning.html) | [✅](notifications/offline-banner/danger.html) |  | [✅](notifications/offline-banner/persistent.html) |  |

<!-- coverage:end -->
