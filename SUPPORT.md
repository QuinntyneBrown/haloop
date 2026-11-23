# Support

Need help running Haloop, configuring Chrome's built-in AI APIs, or troubleshooting WebGPU / Web Bluetooth? Here is where to get assistance.

## Where to Ask

- **Questions & General Help:** Open a topic in [GitHub Discussions](https://github.com/QuinntyneBrown/haloop/discussions) (or an issue labeled `question` if Discussions are not enabled).
- **Bug Reports:** File an issue using the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md).
- **Feature Ideas:** File an issue using the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md).
- **Security Issues:** **Do not** post publicly. See [SECURITY.md](SECURITY.md).

## Common Troubleshooting

### Chrome Built-in AI (Gemini Nano) shows "Flag off" or "Unavailable"

1. Ensure you are running **Google Chrome 138+** on a supported desktop platform.
2. Open `chrome://flags/#writer-api-for-gemini-nano` (and related built-in AI flags as shown in **AI Lab** → `/lab`), switch to **Enabled**, and relaunch Chrome.
3. If your browser does not support Gemini Nano, download the optional local fallback model (`onnx-community/Qwen2.5-0.5B-Instruct`) from **AI Lab**.

### WebGPU is unavailable or pose estimation is slow

- Verify hardware acceleration is enabled in `chrome://settings/system`.
- Haloop automatically falls back to **WebAssembly (CPU)** mode; you can also switch backends explicitly in **Settings** (`/settings`).

### Web Bluetooth device will not pair

- Web Bluetooth requires a secure context (`https://` or `http://localhost`) and a user gesture (clicking **Pair device**).
- Make sure the heart-rate strap or watch is awake, in pairing mode, and not exclusively bound to another phone app.

### Model cache budget exceeded

- Open **AI Lab** (`/lab`) to inspect cached Hugging Face models and remove unused models, or raise the cache budget in **Settings** (`/settings`).
