# PDF Inspector UI

A zero-dependency web demo for [pdf-inspector](https://github.com/firecrawl/pdf-inspector) by [Firecrawl](https://firecrawl.dev): drop in a PDF, get structured Markdown back. The Rust parser is compiled to WebAssembly and runs **entirely in your browser** — no backend, no upload, no API key.

Built using pdf-inspector (Firecrawl) by **Phani Siginamsetty** with ♥

**[▶ Live demo](https://phanikumar96.github.io/pdf-inspector-ui/)**

![PDF Inspector Web UI — a 7-page tagged PDF parsed to Markdown in 86 ms, entirely in the browser](docs/screenshot.jpg)

## Run it locally

```bash
python3 serve.py          # http://127.0.0.1:8000
python3 serve.py 8777     # or pick a port
```

Any static file server works (`npx serve .`, `caddy file-server`, …). Opening `index.html` from `file://` will **not** work — ES modules and WebAssembly need an `http://` origin.

## What it does

- **Three inputs** — drag & drop / file picker, a remote PDF URL, or four bundled sample PDFs for an instant demo.
- **Live stats** — PDF type, page count, classifier confidence, parse time, word/char counts, pages containing tables or columns, pages needing OCR, encoding-issue flag.
- **Three views** — rendered Markdown preview, raw Markdown, and the full JSON result.
- **Copy & download icons** — copy the current output to the clipboard, or download it as `<name>.md` / `<name>.json`.
- **Extraction options** — `fidelity` vs `compact` profile, page selection (`1,3,5-10`), page markers, image placeholders, and a password field for encrypted PDFs.
- Light/dark theme, responsive layout, and parsing on a Web Worker so big documents never freeze the UI.

Typical in-browser results: a 15-page 2.1 MB paper parses in ~190 ms; a 3-page table-heavy datasheet in ~55 ms.

## Files

```
index.html      markup
styles.css      theme + layout (no framework)
app.js          controller: input, options, stats, copy/download
md.js           ~150-line Markdown → HTML renderer (escapes first, then renders)
worker.js       loads the WASM engine off the main thread
serve.py        static server, stdlib only
vendor/         pdf_inspector_wasm.js + .wasm — the compiled Rust engine
samples/        sample PDFs from the pdf-inspector test fixtures
```

Total third-party JavaScript: **none**. The only binary dependency is the pdf-inspector WASM build itself.

## Deploy

Static files with no build step, and the single-threaded WASM build needs no cross-origin isolation headers — so any static host works. Point GitHub Pages, Cloudflare Pages, Netlify, or Vercel at this repo root with **no build command** and **no output directory**.

## Updating the engine

`vendor/` holds the WebAssembly build of the [pdf-inspector](https://github.com/firecrawl/pdf-inspector) Rust crate. To refresh it from a checkout of that repo:

```bash
cargo install wasm-pack --version 0.15.0 --locked   # once
wasm-pack build wasm --target web --release --out-dir /tmp/wasm-out
cp /tmp/wasm-out/pdf_inspector_wasm.js \
   /tmp/wasm-out/pdf_inspector_wasm_bg.wasm \
   /tmp/wasm-out/pdf_inspector_wasm.d.ts \
   path/to/pdf-inspector-web-ui/vendor/
```

## Notes

- **URL input and CORS.** The browser fetches the URL directly. Hosts that don't send `Access-Control-Allow-Origin` will block that, so the demo retries through a public read-only relay (`corsproxy.io`, then `allorigins.win`) — those third parties see the URL you requested. For anything sensitive, download the file and use the Upload tab, where the bytes never leave your machine.
- **Scanned PDFs.** pdf-inspector does no OCR. Image-only documents are classified (`Scanned` / `ImageBased`) with the pages needing OCR listed, and the preview says so instead of showing text.
- **JSON view.** The `markdown` field is elided in the on-screen JSON for readability; copy and download contain the complete object.

## License

MIT — see [LICENSE](LICENSE). The bundled WebAssembly engine in `vendor/` is MIT-licensed from [firecrawl/pdf-inspector](https://github.com/firecrawl/pdf-inspector); the sample PDFs come from that project's test fixtures.
