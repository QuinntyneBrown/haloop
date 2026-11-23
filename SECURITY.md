# Security Policy

Haloop is designed around a **local-first, zero-cloud-relay** privacy model. Protecting users' camera streams, voice input, biometric telemetry, and local data is a core priority.

## Supported Versions

Because Haloop is currently in pre-1.0 active development, security fixes are applied directly to the `main` branch. Once `1.0.0` is released, the latest minor release line will receive security patches.

| Version | Supported |
| --- | --- |
| `main` (unreleased) | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, report vulnerabilities privately using one of the following channels:

1. **GitHub Private Vulnerability Reporting (Preferred):** Navigate to the **Security** tab of `https://github.com/QuinntyneBrown/haloop` and click **Report a vulnerability**.
2. **Email:** Send an encrypted or plain-text report to `quinntynebrown@gmail.com` with the subject line `[SECURITY] Haloop: <short description>`.

### What to Include

To help us reproduce and remediate the issue quickly, please include:

- A clear description of the vulnerability and its potential impact.
- Step-by-step reproduction instructions, proof-of-concept code, or screenshots.
- Affected browser version, OS, and enabled Chrome flags (if relevant).
- Any suggested mitigations or patches.

### Response Timeline

- **Acknowledgment:** Within **3 business days** of receiving your report.
- **Triage & Severity Assessment:** Within **7 business days**.
- **Remediation & Coordinated Disclosure:** We aim to patch confirmed high/critical vulnerabilities within **30 days** and coordinate public disclosure once a fix is available.

## Security Scope & Threat Model

We are especially interested in reports involving:

- **Privacy leaks:** Any unintended transmission of camera frames, microphone audio, Bluetooth telemetry, chat prompts, or local workout data over the network.
- **XSS / Injection:** Cross-site scripting or prompt-injection escalation in Coach conversations, Scripture rendering, or imported workout data.
- **Model Integrity & Supply Chain:** Tampering, unpinned or untrusted model loading, or unsafe deserialization in Transformers.js / ONNX Runtime Web workers.
- **Browser API Misuse:** Improper permission handling for Web Bluetooth, WebGPU, Camera/Microphone (`getUserMedia`), Service Workers, or Content Security Policy (CSP) bypasses.

### Out of Scope

- Vulnerabilities exclusively within Google Chrome's built-in Gemini Nano runtime or upstream ONNX/Hugging Face model weights (please report those to the Chromium Security team or respective model maintainers, though we welcome a heads-up if a mitigation is needed in Haloop).
- Denial-of-service caused solely by a user manually exceeding local GPU memory or browser storage quotas.
