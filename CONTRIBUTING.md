# Contributing to Haloop

Thank you for your interest in contributing to **Haloop**! This document outlines our engineering workflow, coding standards, and pull request process.

## Code of Conduct

All contributors and participants are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## Engineering Philosophy

Haloop follows a disciplined **specs -> designs -> mocks -> design system -> incremental implementation** workflow:

1. **Requirements first (`docs/specs/`):** Define L1/L2 requirements and testable acceptance criteria before introducing new behavior.
2. **Design documents (`docs/detailed-designs/`):** Document subsystem boundaries, C4/class/sequence diagrams, and vertical slices for non-trivial features.
3. **Mocks & design tokens (`docs/mocks/`, `docs/design-system/`):** Every user-facing page, dialog, and notification must be represented in every state (default, loading, empty, error, invalid, busy, etc.) in both light and dark themes before frontend code is written.
4. **Incremental, test-first slices:** Deliver changes in small, independently verifiable pull requests with tests written alongside or before implementation.
5. **Local-first & privacy-by-design:** Never introduce cloud telemetry, third-party trackers, or server uploads of user camera, audio, biometric, or devotional data.

## Ways to Contribute

- **Report bugs:** Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template with browser version, WebGPU/WASM status, and reproduction steps.
- **Propose features:** Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template to discuss new capabilities before writing code.
- **Improve mocks, design tokens, or accessibility:** Fix contrast, keyboard navigation, responsive layout, or missing UI states in `docs/mocks/` and `docs/design-system/`.
- **Implement features & fixes:** Pick an open issue, comment to coordinate, and submit a focused pull request.
- **Improve documentation:** Clarify setup steps, Chrome Built-in AI flags, or architecture diagrams.

## Development Workflow

### 1. Fork & Branch

Create a short-lived branch from `main` using a descriptive prefix:

- `feat/<short-name>` — New feature or vertical slice
- `fix/<short-name>` — Bug fix
- `docs/<short-name>` — Documentation, specs, mocks, or design system updates
- `chore/<short-name>` — Tooling, dependencies, or CI maintenance

### 2. Coding & UI Standards

- **Angular & TypeScript:**
  - Use standalone components, `ChangeDetectionStrategy.OnPush`, and Angular Signals (`signal`, `computed`, `input`, `output`, `linkedSignal`, `resource`).
  - Use native control flow (`@if`, `@for`, `@switch`) and `inject()` for dependency injection.
  - Keep strict TypeScript enabled; avoid `any`.
  - Run ML inference (`@huggingface/transformers`) inside dedicated Web Workers so the main thread remains responsive at 60 fps.
- **Design System & Accessibility:**
  - Consume CSS custom properties from `docs/design-system/tokens/tokens.css` rather than hard-coding colors, spacing, or radii.
  - Maintain **WCAG 2.2 AA** compliance: semantic HTML landmarks, keyboard operability, visible focus rings, `aria-live` regions for dynamic feedback, and verified contrast in both light and dark themes.
- **Static Mocks Verification:**
  If you edit files in `docs/mocks/`, run:
  ```bash
  python3 .agents/skills/writing-html-mocks/scripts/check_mocks.py docs/mocks --write
  ```

### 3. Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional-scope>): <short imperative summary>
```

Examples:
- `feat(train): add VitPose rep counter worker`
- `fix(devices): handle Web Bluetooth disconnect cleanly`
- `docs(mocks): add offline banner persistent state`

### 4. Pull Request Checklist

Before requesting review, verify that:

- [ ] Your PR targets a single, well-scoped vertical slice or fix.
- [ ] Relevant tests are added and passing (`npm test` once the app workspace is active).
- [ ] Lint and production build succeed cleanly.
- [ ] Any UI changes match `docs/mocks/` and `docs/design-system/` in both light and dark modes.
- [ ] Accessibility (keyboard navigation, focus management, ARIA labels, contrast) has been verified.
- [ ] Documentation (`README.md`, `CHANGELOG.md`, specs, or mocks) is updated if behavior changed.

## License

By contributing to Haloop, you agree that your contributions will be licensed under the [MIT License](LICENSE).
