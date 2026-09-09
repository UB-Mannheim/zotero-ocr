// pdfjs-render-worker.js
//
// Renders PDF pages to images using the pdf.js library that ships with
// Zotero's built-in PDF reader.
//
// pdf.js cannot be imported directly from the parent-process chrome scope:
// it patches Map.prototype at import time, and built-in prototypes are not
// extensible there. Running it inside a dedicated worker avoids this, as
// Zotero's own document worker does.

const PDFJS_CANDIDATES = [
    "resource://zotero/reader/pdf/build/pdf.mjs",
    "resource://zotero/pdf.js/build/pdf.mjs",
];

// Minimal DOM shim for the few pdf.js code paths that assume a document
// object. Rendering pages to an OffscreenCanvas without annotations or a
// text layer only needs these.
if (typeof document === "undefined") {
    const makeElement = (tag) => {
        if (tag === "canvas") {
            return new OffscreenCanvas(300, 150);
        }
        return {
            style: {},
            classList: { add() {} },
            setAttribute() {},
            remove() {},
            appendChild() {},
            _value: "",
            get value() { return this._value; },
            set value(v) { this._value = v; },
        };
    };
    globalThis.document = {
        baseURI: "about:blank",
        createElement: makeElement,
        body: { append() {} },
        fonts: { add() {}, delete() {} },
    };
}

let pdfjsLib = null;
let pdfjsBase = null;
let pdfjsWorkerError = null;

function errorMessage(e) {
    if (e && e.name && e.message) {
        return e.name + ": " + e.message;
    }
    return String(e);
}

async function getLib() {
    if (!pdfjsLib) {
        let lastError;
        for (const uri of PDFJS_CANDIDATES) {
            try {
                const module = await import(uri);
                pdfjsLib = module.default ?? module;
                pdfjsBase = uri.replace(/build\/pdf\.mjs$/, "");
                // Make pdf.js run on this worker's own thread instead of
                // trying to spawn a nested Web Worker.
                try {
                    const workerModule = await import(uri.replace(/pdf\.mjs$/, "pdf.worker.mjs"));
                    if (workerModule && workerModule.WorkerMessageHandler) {
                        globalThis.pdfjsWorker = workerModule;
                    } else {
                        pdfjsWorkerError = "pdf.worker.mjs has no WorkerMessageHandler export";
                    }
                } catch (e) {
                    pdfjsWorkerError = errorMessage(e);
                }
                return pdfjsLib;
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError;
    }
    return pdfjsLib;
}

// Set the JFIF density of a JPEG so that image readers (and tesseract)
// know the real resolution. Canvas-generated JPEGs have no density set.
function setJpegDensity(bytes, dpi) {
    if (bytes.length < 2 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
        return;
    }
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xFF) {
            return;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xDA) {
            return; // start of scan data: no more markers
        }
        const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (marker === 0xE0 // APP0
            && segmentLength >= 16
            && bytes[offset + 4] === 0x4A // "JFIF"
            && bytes[offset + 5] === 0x46
            && bytes[offset + 6] === 0x49
            && bytes[offset + 7] === 0x46) {
            if (bytes[offset + 11] === 0) {
                bytes[offset + 11] = 1; // dots per inch
                bytes[offset + 12] = dpi >> 8;
                bytes[offset + 13] = dpi & 0xFF;
                bytes[offset + 14] = dpi >> 8;
                bytes[offset + 15] = dpi & 0xFF;
            }
            return;
        }
        offset += 2 + segmentLength;
    }
}

async function render({ buffer, dpi, baseKey, imageFormat, jpegQuality }) {
    const lib = await getLib();
    const loadingTask = lib.getDocument({
        data: new Uint8Array(buffer),
        wasmUrl: pdfjsBase + "web/wasm/",
        cMapUrl: pdfjsBase + "web/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: pdfjsBase + "web/standard_fonts/",
        // Avoid the default computation, which references document.baseURI
        // and is not available in a worker.
        useWorkerFetch: false,
        // No document.fonts in a worker; render text as glyph paths.
        disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    try {
        const numPages = doc.numPages;
        self.postMessage({ type: "started", numPages });
        const scale = dpi / 72;
        const digitCount = String(numPages).length;
        const isPng = imageFormat == "png";
        for (let i = 1; i <= numPages; i++) {
            const page = await doc.getPage(i);
            try {
                const viewport = page.getViewport({ scale });
                const width = Math.ceil(viewport.width);
                const height = Math.ceil(viewport.height);
                const canvas = new OffscreenCanvas(width, height);
                const context = canvas.getContext("2d", { alpha: false });
                if (!context) {
                    throw new Error("Could not get a 2d canvas context");
                }
                // do not render annotations, as pdftoppm doesn't by default
                await page.render({ canvasContext: context, viewport, annotationMode: 0 }).promise;
                const options = { type: isPng ? "image/png" : "image/jpeg" };
                if (!isPng) {
                    options.quality = jpegQuality / 100;
                }
                const blob = await canvas.convertToBlob(options);
                const imageBuffer = await blob.arrayBuffer();
                if (!isPng) {
                    setJpegDensity(new Uint8Array(imageBuffer), dpi);
                }
                // same file naming scheme as pdftoppm (baseKey-page-N.<ext>,
                // N zero-padded to the page count)
                const filename = baseKey + "-page-" + String(i).padStart(digitCount, "0") + (isPng ? ".png" : ".jpg");
                self.postMessage({ type: "image", filename, buffer: imageBuffer }, [imageBuffer]);
                self.postMessage({ type: "progress", i, numPages });
            } finally {
                page.cleanup();
            }
        }
        self.postMessage({ type: "done" });
    } finally {
        try {
            await loadingTask.destroy();
        } catch (e) {
            // ignore
        }
    }
}

self.addEventListener("message", async (event) => {
    const { type, data } = event.data;
    try {
        if (type === "ping") {
            try {
                await getLib();
                self.postMessage({ type: "pong", ok: true, base: pdfjsBase, workerModuleError: pdfjsWorkerError || null });
            } catch (e) {
                self.postMessage({ type: "pong", ok: false, error: errorMessage(e) });
            }
        } else if (type === "render") {
            await render(data);
        }
    } catch (e) {
        self.postMessage({ type: "error", error: errorMessage(e) + (e && e.stack ? "\n" + e.stack.split("\n").slice(0, 3).join("\n") : "") });
    }
});
