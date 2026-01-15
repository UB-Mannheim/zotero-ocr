// zotero-ocr.js

// More information about the modules at https://searchfox.org/mozilla-central/source/dom/chrome-webidl
if (Zotero.version >= "8") {
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

        let logString;

        logString = log("entering recognize()");

        const progress = createZoteroProgressWindow("Initializing...", 0);

        async function checkExternalCmd(exeName, exePref, possiblePath) {

            // Look for the pdftoppm  or tesseract executable in the settings and at commonly used locations.
            // If it is found, the settings are updated.
            // Otherwise the last possible location is returned.
            let externalCmd = Zotero.Prefs.get(exePref);
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

        try {

            /*
                Check the settings and alternative possible locations for pdftoppm and tesseract.
                If the last possible option doesn't exist, display an error message and quit.
            */

            let pdftoppmPaths = ["", "/usr/local/bin/", "/usr/bin/", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/", "/run/current-system/sw/bin/"];
            let pdftoppm = await checkExternalCmd("pdftoppm", "zoteroocr.pdftoppmPath", pdftoppmPaths);
            if (!(await IOUtils.exists(pdftoppm))) {
                window.alert("No pdftoppm executable found, last check: " + pdftoppm);
                return;
            }

            let ocrEnginePaths = ["", "/usr/local/bin/", "/usr/bin/", "C:\\Program Files\\Tesseract-OCR\\", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/", "/run/current-system/sw/bin/"];
            let ocrEngine = await checkExternalCmd("tesseract", "zoteroocr.ocrPath", ocrEnginePaths);
            if (!(await IOUtils.exists(ocrEngine))) {
                window.alert("No tesseract executable found, last check: " + ocrEngine);
                return;
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
                let base = pdf.replace(/\.pdf$/, '');
                let basename = pdfItem.attachmentFilename.replace(/\.pdf$/, '');
                let dir = PathUtils.parent(pdf);
                let ocrbase = Zotero.Prefs.get("zoteroocr.overwritePDF") ? base : base + '.ocr';
                // TODO filter out PDFs which have already a text layer

                // build the pdftoppm arguments based on hidden preferences:
                // => will produce a PDF output with reasonable size and image quality
                // File format: JPEG by default instead of PNG
                // JPEG quality 70/100 (pdftoppm default is 75)
                // JPEG Hufmann tables optimization: yes (pdftoppm default is no)
                // Use progressive JPEG: yes (pdftoppm default is no)
                let imageFormat = Zotero.Prefs.get("zoteroocr.imageFormat");
                let pdftoppmCmdArgs = ['-progress'];
                if (imageFormat == "jpg" || imageFormat == "jpeg") {
                    imageFormat = "jpg";
                    let jpegQuality = Zotero.Prefs.get("zoteroocr.jpegQuality");
                    let jpegProgressive = Zotero.Prefs.get("zoteroocr.jpegProgressive");
                    let jpegOptimization = Zotero.Prefs.get("zoteroocr.jpegOptimization");
                    pdftoppmCmdArgs = [...pdftoppmCmdArgs, '-jpeg', '-jpegopt', 'quality=' + jpegQuality + ',progressive=' + jpegProgressive + ',optimize=' + jpegOptimization, '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, PathUtils.join(dir, basename + '-page')];

                } else {
                    imageFormat = "png";
                    pdftoppmCmdArgs = [...pdftoppmCmdArgs, '-png', '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, PathUtils.join(dir, basename + '-page')];
                }

                logString = "Extracting pages...";
                progress.updateMessage(logString);
                // extract images from PDF
                let imageList = PathUtils.join(dir, basename + '-list.txt');
                let pageCount;
                if (!(await IOUtils.exists(imageList))) {
                    logString = log("Running " + pdftoppm + ' ' + pdftoppmCmdArgs.join(' '));
                    let proc = await Subprocess.call({
                        command: pdftoppm,
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

                    var imageListArray = [];

                    await IOUtils.getChildren(dir).then(
                        (entries) => {
                            let imgRegexp;
                            if (imageFormat == "jpg") {
                                imgRegexp = new RegExp(basename + "-page-\\d+\\.jpg$");
                            } else {
                                imgRegexp = new RegExp(basename + "-page-\\d+\\.png$");
                            }
                            for (const entry of entries) {
                                if (entry.match(imgRegexp)) {
                                    imageListArray.push(entry);
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
                    // if image-list already exists, must read it to know pageCount
                    let buffer = await Zotero.File.getContentsAsync(imageList)
                    let lines = buffer.split(/[^\r\n]+/g)
                    pageCount = lines.length - 1
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
                    errorLines = errorLog.split(/\r?\n|\r|\n/g);
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
                    let contents = await Zotero.File.getContentsAsync(ocrbase + '.txt');
                    contents = contents.replace(/(?:\r\n|\r|\n)/g, '<br />');
                    let newNote = new Zotero.Item('note');
                    newNote.setNote(contents);
                    newNote.parentID = item.id;
                    newNote.libraryID = item.libraryID;
                    await newNote.saveTx();
                }

                if (Zotero.Prefs.get("zoteroocr.outputHocr")) {
                    let contents = await Zotero.File.getContentsAsync(ocrbase + '.hocr');
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
                        let pagename = basename + '-page-' + i + '.html';
                        let htmlfile = Zotero.File.pathToFile(PathUtils.join(dir, pagename));
                        let pagecontent = preamble + "<div class='ocr_page'" + parts[i] + '<script src="https://unpkg.com/hocrjs"></script>\n</body>\n</html>';
                        Zotero.File.putContents(htmlfile, pagecontent);
                        // Zotero.Attachments.importFromFile() works in group libraries, linkFromFile() does not
                        if (Zotero.Prefs.get("zoteroocr.outputAsCopyAttachment")) {
                            await Zotero.Attachments.importFromFile({
                                file: PathUtils.join(dir, pagename),
                                contentType: "text/html",
                                libraryID: item.libraryID,
                                parentItemID: item.id,
                            });
                            await Zotero.File.removeIfExists(PathUtils.join(dir, pagename));
                        } else {
                            await Zotero.Attachments.linkFromFile({
                                file: PathUtils.join(dir, pagename),
                                contentType: "text/html",
                                parentItemID: item.id
                            });
                        }
                    }
                }

                // attach PDF if it is a new one
                if (Zotero.Prefs.get("zoteroocr.outputPDF") && !(Zotero.Prefs.get("zoteroocr.overwritePDF"))) {
                    // Zotero.Attachments.importFromFile() works in group libraries, linkFromFile() does not
                    if (Zotero.Prefs.get("zoteroocr.outputAsCopyAttachment")) {
                        await Zotero.Attachments.importFromFile({
                            file: ocrbase + '.pdf',
                            libraryID: item.libraryID,
                            parentItemID: item.id,
                        });
                        await Zotero.File.removeIfExists(ocrbase + '.pdf');
                    } else {
                        await Zotero.Attachments.linkFromFile({
                            file: ocrbase + '.pdf',
                            parentItemID: item.id
                        });
                    }
                }

                if (!Zotero.Prefs.get("zoteroocr.outputPNG") && imageListArray) {
                    // delete image list
                    await Zotero.File.removeIfExists(imageList);
                    // delete PNGs
                    for (let imageName of imageListArray) {
                        await Zotero.File.removeIfExists(imageName);
                    }
                }
            }

        } catch (error) {
            let alertMessage = "Last ZoteroOCR log message: " + logString + "\n\nZoteroOCR error: " + error.message;
            window.alert(alertMessage);

        } finally {
            progress.close();
        }
    }

};