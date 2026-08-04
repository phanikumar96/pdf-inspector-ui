// Runs the pdf-inspector WebAssembly build off the main thread so large PDFs
// never freeze the UI. Extraction is synchronous once init() resolves.
import init, { processPdf, version } from './vendor/pdf_inspector_wasm.js';

let ready;

function ensureReady() {
  if (!ready) ready = init().then(() => version());
  return ready;
}

self.onmessage = async (event) => {
  const { id, type, bytes, options } = event.data;

  try {
    if (type === 'init') {
      const v = await ensureReady();
      self.postMessage({ id, ok: true, version: v });
      return;
    }

    if (type === 'process') {
      await ensureReady();
      const started = performance.now();
      const result = processPdf(new Uint8Array(bytes), options);
      // Wall-clock includes the JS<->WASM boundary, the engine reports its own.
      result.wallTimeMs = Math.round(performance.now() - started);
      self.postMessage({ id, ok: true, result });
      return;
    }

    throw new Error(`unknown message type: ${type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
};
