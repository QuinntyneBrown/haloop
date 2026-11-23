# Changelog

All notable changes to **Haloop** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Root `README.md` aligned with the expected on-device AI, WebGPU, and Web Bluetooth final implementation.
- Open-source community and governance documentation (`LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `CHANGELOG.md`, and `.github/` issue/PR templates).
- AI coding agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/haloop.mdc`, `.windsurf/rules/haloop.md`, `.clinerules`, `.junie/guidelines.md`, `.amazonq/rules/haloop.md`).
- Static HTML mock suite (`docs/mocks/`) covering all 12 pages, 5 dialogs, and 3 notification families in light and dark themes across all required states.
- Extracted design system tokens and contrast audit (`docs/design-system/`).
- L1/L2 software requirements specifications (`docs/specs/L1.md`, `docs/specs/L2.md`) covering 13 L1s and 34 L2s with Given/When/Then acceptance criteria.
- Detailed software design tree (`docs/detailed-designs/`) across 5 subsystems and 10 vertical features with 50 rendered PlantUML C4, class, and sequence diagrams.
- Standalone, zoneless Angular 22 Haloop application (`src/app/`) implementing all 12 routes, 5 modal dialogs, 3 notification families, dedicated ML Web Worker (`ml-inference.worker.ts`), Chrome Built-in AI adapters, Web Bluetooth GATT parsers, IndexedDB local persistence, PWA manifest/service worker, and WCAG 2.2 AA light/dark tokens.
- Acceptance test suite (Vitest) and Playwright CLI end-to-end walkthrough (`e2e/haloop-walkthrough.spec.ts`) with video capture.
