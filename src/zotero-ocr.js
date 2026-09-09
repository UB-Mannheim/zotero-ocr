// zotero-ocr.js

// More information about the modules at https://searchfox.org/mozilla-central/source/dom/chrome-webidl
if (Zotero.version >= "8" || Zotero.version >= "10") {
    ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
    ChromeUtils.defineESModuleGetters(globalThis, {
        Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
    });
} else {
    Components.utils.import("resource://gre/modules/FileUtils.jsm");
    // Components.utils.import("resource://gre/modules/Subprocess.jsm");
    ChromeUtils.defineESModuleGetters(globalThis, {
        Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
    });
}


function log(msg) {
    let message = "ZoteroOCR: " + msg;
    Zotero.debug(message);
    return message;
}

// Set while a recognition run is in progress, to avoid concurrent runs
// interfering with each other's intermediate files.
let recognizing = false;

function createZoteroProgressWindow(message, initialProgress = 0) {
    try {
        // Create a progress window using Zotero's API
        const progressWindow = new Zotero.ProgressWindow({
            closeOnClick: false
        });

        // Set the headline/title
        progressWindow.changeHeadline("Zotero OCR");

        // Show the window first before adding items
        progressWindow.show();

        // Create a determined progress bar after showing the window
        const icon = "chrome://zotero/skin/attachment-pdf.svg";
        const progressBar = new progressWindow.ItemProgress(icon, message);

        // Set initial progress
        if (initialProgress > 0) {
            progressBar.setProgress(initialProgress);
        }

        return {
            updateProgress: (progress) => {
                try {
                    const validProgress = Math.min(100, Math.max(0, progress));
                    progressBar.setProgress(validProgress);
                    return validProgress === 100;
                } catch (e) {
                    log("Error updating progress:");
                    log(e);
                    return false;
                }
            },
            updateMessage: (newMessage) => {
                try {
                    progressBar.setText(newMessage);
                } catch (e) {
                    log("Error updating message:");
                    log(e);
                }
            },
            close: () => {
                try {
                    progressWindow.close();
                } catch (e) {
                    log("Error closing progress window:");
                    log(e);
                }
            }
        };
    } catch (e) {
        log("Error creating progress window:");
        log(e);
        // Return dummy functions in case of failure
        return {
            updateProgress: () => false,
            updateMessage: () => {},
            close: () => {}
        };
    }
}


function waitForWorkerMessage(worker, type, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        function onMessage(event) {
            if (event.data && event.data.type === type) {
                cleanup();
                resolve(event.data);
            }
        }
        function onWorkerError(event) {
            cleanup();
            reject(new Error(event.message || "Worker error"));
        }
        function cleanup() {
            clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onWorkerError);
        }
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for the pdf.js worker"));
        }, timeoutMs);
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onWorkerError);
        worker.postMessage({ type: "ping" });
    });
}

async function fetchText(url) {
    // Try the standard fetch() first.
    try {
        const text = await (await fetch(url)).text();
        if (text) {
            return { text, via: "fetch" };
        }
    } catch (e) {
        log("fetch failed for " + url + ": " + e);
    }
    // Then NetUtil.asyncFetch(), which uses the channel stack and can read
    // chrome:// resources that fetch() refuses.
    try {
        const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
        const ab = await NetUtil.asyncFetch(url, null, { binary: true });
        const text = new TextDecoder().decode(ab);
        if (text) {
            return { text, via: "NetUtil" };
        }
    } catch (e) {
        log("NetUtil.asyncFetch failed for " + url + ": " + e);
    }
    return null;
}

async function createPdfJsWorker() {
    // The Worker constructor rejects chrome:// and add-on resource:// script
    // URLs, so fetch the script and create the worker from a Blob URL instead.
    const rootURI = (typeof ZoteroOCR !== "undefined" && ZoteroOCR.rootURI) || "";
    const urls = [
        rootURI + "chrome/content/pdfjs-render-worker.js",
        "chrome://zoteroocr/content/pdfjs-render-worker.js",
    ];
    let source = null;
    for (const url of urls) {
        const result = await fetchText(url);
        if (result) {
            source = result.text;
            log("Loaded pdf.js worker script via " + result.via + " (" + source.length + " chars) from " + url);
            break;
        }
    }
    if (!source) {
        throw new Error("Could not obtain the pdf.js worker script");
    }
    const blob = new Blob([source], { type: "text/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(blobUrl);
    worker.__blobUrl = blobUrl;
    return worker;
}

function terminatePdfJsWorker(worker) {
    if (!worker) {
        return;
    }
    try {
        worker.terminate();
    } catch (e) {
        // ignore
    }
    if (worker.__blobUrl) {
        try {
            URL.revokeObjectURL(worker.__blobUrl);
        } catch (e) {
            // ignore
        }
    }
}

async function loadPdfJs() {

    // Try to use the pdf.js library that ships with Zotero's built-in PDF reader,
    // so that the extension does not need pdftoppm to convert PDF pages to images.
    // The location of the library changed between Zotero versions, so try several known paths.
    const candidates = [
        "resource://zotero/reader/pdf/build/pdf.mjs",
        "resource://zotero/pdf.js/build/pdf.mjs",
    ];

    // pdf.js patches Map.prototype when it is loaded, which fails in the
    // parent-process chrome scope, because built-in prototypes are not
    // extensible there. So first try to run it in a dedicated worker, which
    // has its own realm with extensible prototypes, as Zotero's own document
    // worker does.
    try {
        const worker = await createPdfJsWorker();
        const pong = await waitForWorkerMessage(worker, "pong");
        if (pong.ok) {
            log("pdf.js worker ready (" + pong.base + ")");
            if (pong.workerModuleError) {
                log("pdf.worker.mjs could not be loaded in the worker: " + pong.workerModuleError);
            }
            return { worker, base: pong.base };
        }
        terminatePdfJsWorker(worker);
        log("pdf.js worker failed to load pdf.js: " + pong.error);
    } catch (e) {
        log("pdf.js worker not available: " + e);
    }

    // Fallback: import the library on the main thread (works on Zotero
    // versions where built-in prototypes are extensible in the chrome scope)
    for (const uri of candidates) {
        try {
            const pdfjsLib = await ChromeUtils.importESModule(uri);
            // Importing the worker module makes pdf.js run on the main thread,
            // so that no separate Web Worker is needed.
            const pdfjsWorker = await ChromeUtils.importESModule(uri.replace(/pdf\.mjs$/, "pdf.worker.mjs"));
            if (pdfjsWorker && pdfjsWorker.WorkerMessageHandler) {
                globalThis.pdfjsWorker = pdfjsWorker;
            }
            return { pdfjsLib, base: uri.replace(/build\/pdf\.mjs$/, "") };
        } catch (e) {
            log("pdf.js not available at " + uri + ": " + e);
        }
    }
    return null;
}

async function runPdftoppm({ pdftoppm, dir, pdftoppmCmdArgs, progress }) {
    let proc = await Subprocess.call({
        command: pdftoppm,
        workdir: dir,
        arguments: pdftoppmCmdArgs,
        stderr: "stdout"
    })
    let regex = /(\d+) (\d+) (.+)/;
    let string;

    const errorRegex = /Error /
    let errorLog = ''
    let errorLogOn = false

    while ((string = await proc.stdout.readString())) {
        // Display the captured string in the log messages, so that even warnings are logged
        log(string)

        if (!errorLogOn) {
            errorLogOn = string.match(errorRegex)
        }

        if (errorLogOn) {
            errorLog += string
        }

        let res = regex.exec(string);
        if (res) {
            progress.updateMessage(`Extracting page ${res[1]} of ${res[2]}`)
        }
    }

    if (errorLogOn) {
        throw new Error(errorLog)
    }
    return true;
}

async function renderPagesWithPdfJs(pdfJs, args) {
    if (pdfJs.worker) {
        return await renderPagesWithPdfJsWorker({ worker: pdfJs.worker }, args);
    }
    return await renderPagesWithPdfJsDirect({ pdfjsLib: pdfJs.pdfjsLib, base: pdfJs.base }, args);
}

async function renderPagesWithPdfJsWorker({ worker }, { pdf, dir, baseKey, imageFormat, dpi, jpegQuality, progress }) {

    log("Rendering PDF pages with pdf.js (worker)");
    const writtenFiles = [];
    const writePromises = [];
    let done = false;
    let workerError = null;

    function onMessage(event) {
        const msg = event.data;
        if (!msg) {
            return;
        }
        if (msg.type === "started") {
            log("Rendering " + msg.numPages + " pages at " + dpi + " DPI");
        } else if (msg.type === "progress") {
            progress.updateMessage(`Extracting page ${msg.i} of ${msg.numPages}`);
            progress.updateProgress(Math.round(msg.i * 100 / msg.numPages));
        } else if (msg.type === "image") {
            writePromises.push(
                IOUtils.write(PathUtils.join(dir, msg.filename), new Uint8Array(msg.buffer))
                    .then(() => writtenFiles.push(msg.filename))
                    .catch((e) => { workerError = "Failed to write " + msg.filename + ": " + e; })
            );
        } else if (msg.type === "error") {
            workerError = msg.error;
        } else if (msg.type === "done") {
            done = true;
        }
    }

    function onWorkerError(event) {
        workerError = String(event.message || "Worker crashed");
    }

    try {
        const data = await IOUtils.read(pdf);
        const buffer = data.buffer ?? data;
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onWorkerError);
        worker.postMessage(
            { type: "render", data: { buffer, dpi, baseKey, imageFormat, jpegQuality } },
            [buffer]
        );
        while (!done && !workerError) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    } finally {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onWorkerError);
    }
    await Promise.all(writePromises);

    if (workerError) {
        log("pdf.js worker rendering failed: " + workerError);
        // remove partially written images so that the pdftoppm fallback (if any) starts clean
        for (const filename of writtenFiles) {
            try {
                await Zotero.File.removeIfExists(PathUtils.join(dir, filename));
            } catch (e) {
                // ignore
            }
        }
        return false;
    }
    return true;
}

async function renderPagesWithPdfJsDirect({ pdfjsLib, base }, { pdf, dir, baseKey, imageFormat, dpi, jpegQuality, progress }) {

    // Render the pages of `pdf` into `dir` using the same file naming scheme
    // as pdftoppm (baseKey-page-N.<ext>, N zero-padded to the page count).
    // Note: pdf.js always renders the CropBox, so this path is only used
    // when the useCropBox preference is not explicitly disabled.
    let loadingTask = null;
    const writtenFiles = [];
    try {
        log("Rendering PDF pages with pdf.js");
        const data = await IOUtils.read(pdf);
        loadingTask = pdfjsLib.getDocument({
            data,
            wasmUrl: base + "web/wasm/",
            cMapUrl: base + "web/cmaps/",
            cMapPacked: true,
            standardFontDataUrl: base + "web/standard_fonts/",
        });
        const doc = await loadingTask.promise;
        const numPages = doc.numPages;
        log("Rendering " + numPages + " pages at " + dpi + " DPI");
        const scale = dpi / 72;
        const digitCount = String(numPages).length;
        const isPng = imageFormat == "png";
        for (let i = 1; i <= numPages; i++) {
            const page = await doc.getPage(i);
            try {
                const viewport = page.getViewport({ scale });
                const width = Math.ceil(viewport.width);
                const height = Math.ceil(viewport.height);
                let canvas;
                if (typeof OffscreenCanvas !== "undefined") {
                    canvas = new OffscreenCanvas(width, height);
                } else {
                    canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
                    canvas.width = width;
                    canvas.height = height;
                }
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
                const blob = canvas.convertToBlob
                    ? await canvas.convertToBlob(options)
                    : await new Promise((resolve) => canvas.toBlob(resolve, options.type, options.quality));
                const filename = baseKey + "-page-" + String(i).padStart(digitCount, "0") + (isPng ? ".png" : ".jpg");
                await IOUtils.write(PathUtils.join(dir, filename), new Uint8Array(await blob.arrayBuffer()));
                writtenFiles.push(filename);
                progress.updateMessage(`Extracting page ${i} of ${numPages}`);
                progress.updateProgress(Math.round(i * 100 / numPages));
            } finally {
                page.cleanup();
            }
        }
        return true;
    } catch (e) {
        log("pdf.js rendering failed: " + e);
        // remove partially written images so that the pdftoppm fallback (if any) starts clean
        for (const filename of writtenFiles) {
            try {
                await Zotero.File.removeIfExists(PathUtils.join(dir, filename));
            } catch (e2) {
                // ignore
            }
        }
        return false;
    } finally {
        if (loadingTask) {
            try {
                await loadingTask.destroy();
            } catch (e) {
                // ignore
            }
        }
    }
}


ZoteroOCR = {
    id: null,
    version: null,
    rootURI: null,
    initialized: false,
    addedElementIDs: [],

    init({ id, version, rootURI }) {
        if (this.initialized) return;
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        this.initialized = true;
    },

    addToWindow(window) {
        let doc = window.document;

        // Use Fluent for localization
        window.MozXULElement.insertFTLIfNeeded("zotero-ocr.ftl");

        // Add menu option
        let menuitem = doc.createXULElement('menuitem');
        menuitem.id = 'zotero-ocr-item-menu';
        menuitem.class = 'menuitem-iconic zotero-menuitem-ocr'
        menuitem.setAttribute('data-l10n-id', 'ocr-selected-pdfs');
        doc.getElementById('zotero-itemmenu').appendChild(menuitem);
        menuitem.addEventListener('command', () => {
            ZoteroOCR.recognize(window);
        });
        this.storeAddedElement(menuitem);
    },

    addToAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
    },

    storeAddedElement(elem) {
        if (!elem.id) {
            throw new Error("Element must have an id");
        }
        this.addedElementIDs.push(elem.id);
    },

    removeFromWindow(window) {
        var doc = window.document;
        // Remove all elements added to DOM
        for (let id of this.addedElementIDs) {
            doc.getElementById(id).remove();
        }
        doc.querySelector('[href="zotero-ocr.ftl"]').remove();
    },

    removeFromAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.removeFromWindow(win);
        }
    },

    async recognize(window) {

        if (recognizing) {
            window.alert("Zotero OCR is already running. Please wait until it has finished.");
            return;
        }
        recognizing = true;

        let logString;

        logString = log("entering recognize()");

        const progress = createZoteroProgressWindow("Initializing...", 0);

        async function checkExternalCmd(exeName, exePref, possiblePath) {

            // Look for the pdftoppm  or tesseract executable in the settings and at commonly used locations.
            // If it is found, the settings are updated.
            // Otherwise the last possible location is returned.
            let externalCmd = Zotero.Prefs.get(exePref) || "";
            // First of all, emove unncessary quotes from Windows paths
            if (externalCmd.match(/"/g)) {
                let unquotedCmd = externalCmd.replace(/"/g, '');
                Zotero.Prefs.set(exePref, unquotedCmd);
                externalCmd = unquotedCmd;
            }
            let externalCmdFound = false;
            if (!externalCmd) {
                // look for externalCmd in various possible directories
                for (externalCmd of possiblePath) {
                    logString = log("will try to locate " + externalCmd);
                    externalCmd += exeName;
                    if (Zotero.isWin) {
                        externalCmd += ".exe";
                    }
                    try {
                        externalCmdFound = await IOUtils.exists(externalCmd);
                    } catch (e) {
                        // if checking one of the possible paths throws an error, definitely count as not found
                        externalCmdFound = false;
                    }

                    if (externalCmdFound) {
                        // found = true;
                        logString = log("Found " + externalCmd);
                        Zotero.Prefs.set(exePref, externalCmd);
                        break;
                    }
                    logString = log("No " + externalCmd);
                }
            }
            if (Zotero.isWin && !(externalCmd.endsWith(".exe"))) {
                externalCmd = externalCmd + ".exe";
            }
            return externalCmd;
        }

        let pdfJs = null;

        try {

            /*
                Check the settings and alternative possible locations for tesseract.
                If the last possible option doesn't exist, display an error message and quit.
                PDF pages are rendered with the pdf.js library that ships with Zotero
                if it is available; otherwise pdftoppm is required and looked up the same way.
            */

            let ocrEnginePaths = ["", "/usr/local/bin/", "/usr/bin/", "C:\\Program Files\\Tesseract-OCR\\", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/", "/run/current-system/sw/bin/"];
            let ocrEngine = await checkExternalCmd("tesseract", "zoteroocr.ocrPath", ocrEnginePaths);
            if (!(await IOUtils.exists(ocrEngine))) {
                window.alert("No tesseract executable found, last check: " + ocrEngine);
                return;
            }

            // pdf.js always renders the CropBox, so it cannot be used if the user
            // explicitly disabled the CropBox or forced pdftoppm
            if (!Zotero.Prefs.get("zoteroocr.forcePdftoppm")
                    && Zotero.Prefs.get("zoteroocr.useCropBox") !== false) {
                pdfJs = await loadPdfJs();
            }

            let pdftoppm = null;
            if (!pdfJs) {
                let pdftoppmPaths = ["", "/usr/local/bin/", "/usr/bin/", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/", "/run/current-system/sw/bin/"];
                pdftoppm = await checkExternalCmd("pdftoppm", "zoteroocr.pdftoppmPath", pdftoppmPaths);
                if (!(await IOUtils.exists(pdftoppm))) {
                    window.alert("No pdftoppm executable found, last check: " + pdftoppm);
                    return;
                }
            }

            // Proceed with the actual selected items, process if the item is a PDF.

            let items = Zotero.getActiveZoteroPane().getSelectedItems();
            for (let item of items) {
                // find the PDF
                let pdfItem;
                if (item.isAttachment()) {
                    if (item.isFileAttachment() && item.attachmentContentType == 'application/pdf') {
                        pdfItem = item;
                        // if the PDF has no parent item, there is no reasonable place to attach the output files
                        // => create an empty parent item to keep things tidy
                        if (pdfItem.isTopLevelItem()) {
                            await Zotero.getActiveZoteroPane().createEmptyParent(pdfItem);
                        }
                        item = Zotero.Items.get(item.parentItemID);
                    } else {
                        window.alert("Item is an attachment but not PDF and will be ignored.");
                        continue;
                    }
                } else {
                    let pdfAttachments = item.getAttachments(false)
                        .map(itemID => Zotero.Items.get(itemID))
                        .filter(att => att.isFileAttachment() && att.attachmentContentType == 'application/pdf');
                    if (pdfAttachments.length == 0) {
                        window.alert("No PDF found for the selected item.");
                        continue;
                    }
                    if (pdfAttachments.length > 1) {
                        window.alert("There are several PDFs attached to this item. Only the first one will be processed.");
                    }
                    pdfItem = pdfAttachments[0];
                }

                let pdf = pdfItem.getFilePath();
                let baseKey = pdfItem.key;
                let baseTitle = pdfItem.getDisplayTitle();
                let dir = PathUtils.parent(pdf);
                let baseFilename = PathUtils.filename(pdf).replace(/\.pdf$/, '')
                let ocrbase = Zotero.Prefs.get("zoteroocr.overwritePDF") ? baseFilename : baseFilename + '.ocr';
                // TODO filter out PDFs which have already a text layer ?

                // build the pdftoppm arguments based on hidden preferences:
                // => will produce a PDF output with reasonable size and image quality
                // File format: JPEG by default instead of PNG
                // JPEG quality 70/100 (pdftoppm default is 75)
                // JPEG Hufmann tables optimization: yes (pdftoppm default is no)
                // Use progressive JPEG: yes (pdftoppm default is no)
                let imageFormat = Zotero.Prefs.get("zoteroocr.imageFormat");
                let pdftoppmCmdArgs = ['-progress'];
                if (Zotero.Prefs.get("zoteroocr.useCropBox")) {
                    pdftoppmCmdArgs = [...pdftoppmCmdArgs, '-cropbox']
                }
                if (imageFormat == "jpg" || imageFormat == "jpeg") {
                    imageFormat = "jpg";
                    let jpegQuality = Zotero.Prefs.get("zoteroocr.jpegQuality");
                    let jpegProgressive = Zotero.Prefs.get("zoteroocr.jpegProgressive");
                    let jpegOptimization = Zotero.Prefs.get("zoteroocr.jpegOptimization");
                    pdftoppmCmdArgs = [...pdftoppmCmdArgs, '-jpeg', '-jpegopt', 'quality=' + jpegQuality + ',progressive=' + jpegProgressive + ',optimize=' + jpegOptimization, '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, baseKey + '-page'];
                } else {
                    imageFormat = "png";
                    pdftoppmCmdArgs = [...pdftoppmCmdArgs, '-png', '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, baseKey + '-page'];
                }

                logString = "Extracting pages...";
                progress.updateMessage(logString);
                // extract images from PDF
                let imageList = PathUtils.join(dir, baseKey + '-list.txt');
                let pageCount;
                let imageListArray = [];
                if (!(await IOUtils.exists(imageList))) {
                    let extracted = false;
                    if (pdfJs) {
                        logString = log("Rendering pages with pdf.js");
                        extracted = await renderPagesWithPdfJs(pdfJs, {
                            pdf,
                            dir,
                            baseKey,
                            imageFormat,
                            dpi: parseInt(Zotero.Prefs.get("zoteroocr.outputDPI"), 10) || 300,
                            jpegQuality: parseInt(Zotero.Prefs.get("zoteroocr.jpegQuality"), 10) || 70,
                            progress
                        });
                    }
                    if (!extracted) {
                        if (!pdftoppm) {
                            // pdf.js is unavailable or failed: look for pdftoppm as a fallback
                            let pdftoppmPaths = ["", "/usr/local/bin/", "/usr/bin/", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/", "/run/current-system/sw/bin/"];
                            pdftoppm = await checkExternalCmd("pdftoppm", "zoteroocr.pdftoppmPath", pdftoppmPaths);
                            if (!(await IOUtils.exists(pdftoppm))) {
                                throw new Error("No pdftoppm executable found, last check: " + pdftoppm);
                            }
                        }
                        if (pdfJs) {
                            logString = log("pdf.js failed, falling back to pdftoppm");
                        }
                        logString = log("Running " + pdftoppm + ' ' + pdftoppmCmdArgs.join(' '));
                        await runPdftoppm({ pdftoppm, dir, pdftoppmCmdArgs, progress });
                    }

                    await IOUtils.getChildren(dir).then(
                        (entries) => {
                            let imgRegexp;
                            if (imageFormat == "jpg") {
                                imgRegexp = new RegExp(baseKey + "-page-\\d+\\.jpg$");
                            } else {
                                imgRegexp = new RegExp(baseKey + "-page-\\d+\\.png$");
                            }
                            for (const entry of entries) {
                                if (entry.match(imgRegexp)) {
                                    imageListArray.push(PathUtils.filename(entry));
                                }
                            }
                            // IOUtils.getChildren() is not guaranteed to return files in alphanumerical order
                            imageListArray.sort();
                            pageCount = imageListArray.length;

                            // save the list of images in a separate file
                            Zotero.File.putContents(Zotero.File.pathToFile(imageList), imageListArray.join('\n'));
                        }
                    );
                } else {
                    // if image-list already exists, read it to know pageCount and image names
                    let buffer = await Zotero.File.getContentsAsync(imageList)
                    imageListArray = buffer.split(/\r?\n/).filter((line) => line.length > 0)
                    pageCount = imageListArray.length
                }

                let parameters = [imageList];
                parameters.push(ocrbase);

                parameters.push('--psm');
                // PSM 2 is not implemented in tesseract
                const validModes = ["0", "1", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"]
                let PSMMode = Zotero.Prefs.get("zoteroocr.psmmode");
                // If PSMMode isn't an integer in the tesseract-required range, overwrite the value
                if (validModes.indexOf(PSMMode) < 0) {
                    PSMMode = "3";
                    Zotero.Prefs.set("zoteroocr.psmmode", PSMMode);
                }
                parameters.push(PSMMode);

                let ocrLanguage = Zotero.Prefs.get("zoteroocr.language");
                // Convert existing instances with older or buggy defaults to English OCR
                if (!ocrLanguage || ocrLanguage === 'undefined') {
                    ocrLanguage = 'eng';
                    Zotero.Prefs.set("zoteroocr.language", ocrLanguage);
                }
                parameters.push('-l');
                parameters.push(ocrLanguage);

                parameters.push('txt');
                if (Zotero.Prefs.get("zoteroocr.outputPDF")) {
                    parameters.push('pdf');
                }
                if (Zotero.Prefs.get("zoteroocr.outputHocr")) {
                    parameters.push('hocr');
                }
                
                progress.updateMessage("Processing... please be patient");
                logString = log("Running " + ocrEngine + ' ' + parameters.join(' '));


                let proc = await Subprocess.call({
                    command: ocrEngine,
                    workdir: dir,
                    arguments: parameters,
                    stderr: "stdout"
                })
                const pageRegex = /Page (\d+) :/
                let string
                
                // Detect errors but ignore most Leptonica messages
                // reported by functions such as boxClipToRectangle, pixScanForForeground...
                // indicating recognition problems on one page or another but no critical tesseract failure.
                // Based on the function names in Leptonica's src/allheaders.h
                // using only those that should be specific enough (ca. 2400 matches out of 2750)
                const errorRegex = /Error(?! in ((bbuffer|bmf|box|ccb|dewarp|dna|fpix|gplot|jb|l_amap|l_aset|l_binary|l_byte|l_clear|l_colorfill|l_convert|l_generate|l_get|l_hash|l_hmap|l_make|l_pdf|l_png|l_product|l_ps|l_rbtree|l_set|l_uncompress|lheap|lqueue|lstack|num|pix|pixacc|pixacomp|pixcmap|pixcomp|pms|projective|pta|ptr|rasterop|rch|recog|sa|sarray|sel|sudoku|wshed)a{0,2}[A-Z0-9]|lept_|l_bootnum))/
                let errorLog = ''
                let errorLogOn = false

                while ((string = await proc.stdout.readString())) {
                    // logString = log(ocrEngine + " output \n" + string)
                    // Display the captured string in the log messages, so that even warnings are logged
                    logString = log(string)

                    if (!errorLogOn) {
                        errorLogOn = string.match(errorRegex)
                    }
                    
                    if (errorLogOn) {
                        errorLog += string
                    }

                    const res = string.match(pageRegex)
                    if (res) {
                        let current = parseInt(res[1])
                        // display page count starting at 1 instead ot zero
                        progress.updateMessage(`Processing page ${current + 1} of ${pageCount}`)
                        logString = log(`page: ${current + 1}`)
                    }
                }

                let {exitCode} = await proc.wait();
                log(`\nError code is ${exitCode}`);

                if (errorLogOn || (exitCode !== 0)) {
                //if (errorLogOn) {
                    // for logs longer than 24 lines, keep only the head and tail
                    const maxLogLines = 24;
                    let errorLines = errorLog.split(/\r?\n|\r|\n/g);
                    if (errorLines.length > maxLogLines) {
                        let head = errorLines.slice(0, maxLogLines / 2).join('\n');
                        let tail = errorLines.slice(-maxLogLines / 2).join('\n');
                        let skippedLines = errorLines.length - maxLogLines;
                        errorLog = head + `\n...\n[ skipping ${skippedLines} lines ]\n...\n` + tail;
                    }

                    if (!errorLog) {
                        errorLog = "An error occurred"
                    }
                    throw new Error(errorLog)
                }
                
                logString = "OCR completed: attaching output";
                progress.updateMessage(logString);

                if (Zotero.Prefs.get("zoteroocr.outputNote")) {
                    let contents = await Zotero.File.getContentsAsync(PathUtils.join(dir, ocrbase + '.txt'));
                    contents = contents.replace(/(?:\r\n|\r|\n)/g, '<br />');
                    let newNote = new Zotero.Item('note');
                    newNote.setNote(contents);
                    newNote.parentID = item.id;
                    newNote.libraryID = item.libraryID;
                    await newNote.saveTx();
                }

                if (Zotero.Prefs.get("zoteroocr.outputHocr")) {
                    let contents = await Zotero.File.getContentsAsync(PathUtils.join(dir, ocrbase + '.hocr'));
                    // replace the absolute paths of images with relative ones
                    let escapedDir = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    let regexp = new RegExp(escapedDir + "/", 'g');
                    contents = contents.replace(regexp, '');
                    // split content into the preamble and pages
                    contents = contents.replace("</body>\n</html>", '');
                    let parts = contents.split("<div class='ocr_page'");
                    let preamble = parts[0];
                    // create new html attachments including hocrjs for individual pages
                    let maximumPagesAsHtml = parseInt(Zotero.Prefs.get("zoteroocr.maximumPagesAsHtml"));
                    let upperLimit = parts.length;
                    if (!(isNaN(maximumPagesAsHtml)) && (maximumPagesAsHtml + 1 < upperLimit)) {
                        upperLimit = maximumPagesAsHtml + 1;
                    }
                    for (let i = 1; i < upperLimit; i++) {
                        let pagename = baseKey + '-page-' + i + '.html';
                        let absolutePagename = PathUtils.join(dir, pagename);
                        let htmlfile = Zotero.File.pathToFile(absolutePagename);
                        let pagecontent = preamble + "<div class='ocr_page'" + parts[i] + '<script src="https://unpkg.com/hocrjs"></script>\n</body>\n</html>';
                        Zotero.File.putContents(htmlfile, pagecontent);
                        // Zotero.Attachments.importFromFile() works in group libraries, linkFromFile() does not
                        if (Zotero.Prefs.get("zoteroocr.outputAsCopyAttachment")) {
                            await Zotero.Attachments.importFromFile({
                                file: absolutePagename,
                                contentType: "text/html",
                                libraryID: item.libraryID,
                                parentItemID: item.id,
                                title: 'page-' + i + '.html'
                            });
                            await Zotero.File.removeIfExists(absolutePagename);
                        } else {
                            await Zotero.Attachments.linkFromFile({
                                file: absolutePagename,
                                contentType: "text/html",
                                parentItemID: item.id,
                                title: 'page-' + i + '.html'
                            });
                        }
                    }
                }

                // attach PDF if it is a new one
                if (Zotero.Prefs.get("zoteroocr.outputPDF") && !(Zotero.Prefs.get("zoteroocr.overwritePDF"))) {
                    // Zotero.Attachments.importFromFile() works in group libraries, linkFromFile() does not
                    let absolutePdfFilename = PathUtils.join(dir, ocrbase + '.pdf');
                    if (Zotero.Prefs.get("zoteroocr.outputAsCopyAttachment")) {
                        await Zotero.Attachments.importFromFile({
                            file: absolutePdfFilename,
                            libraryID: item.libraryID,
                            parentItemID: item.id,
                            title: baseTitle + '.ocr'
                        });
                        await Zotero.File.removeIfExists(absolutePdfFilename);
                    } else {
                        await Zotero.Attachments.linkFromFile({
                            file: absolutePdfFilename,
                            parentItemID: item.id,
                            title: baseTitle + '.ocr'
                        });
                    }
                }

                if (!Zotero.Prefs.get("zoteroocr.outputPNG") && imageListArray.length) {
                    // delete image list
                    await Zotero.File.removeIfExists(PathUtils.join(imageList));
                    // delete PNGs
                    for (let imageName of imageListArray) {
                        await Zotero.File.removeIfExists(PathUtils.join(dir, imageName));
                    }
                }
            }

        } catch (error) {
            let alertMessage = "Last ZoteroOCR log message: " + logString + "\n\nZoteroOCR error: " + error.message;
            window.alert(alertMessage);

        } finally {
            recognizing = false;
            if (pdfJs && pdfJs.worker) {
                terminatePdfJsWorker(pdfJs.worker);
            }
            progress.close();
        }
    }

};