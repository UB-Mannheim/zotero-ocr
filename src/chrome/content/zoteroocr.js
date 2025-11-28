// zoteroocr.js

// See https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules.
Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.import("resource://gre/modules/Subprocess.jsm");

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
                    log("Error closing progress window:")
                    log(e);
                }
            }
        };
    } catch (e) {
        log("Error creating progress window:")
        log(e);
        // Return dummy functions in case of failure
        return {
            updateProgress: () => false,
            updateMessage: () => {},
            close: () => {}
        };
    }
}


Zotero.OCR = new function() {

    this.openPreferenceWindow = function(paneID, action) {
        var io = { pane: paneID, action: action };
        window.openDialog(
            'chrome://zoteroocr/content/preferences.xul',
            'zoteroocr-preferences-windowname',
            'chrome,titlebar,toolbar,centerscreen' + Zotero.Prefs.get('browser.preferences.instantApply', true) ? 'dialog=no' : 'modal', io
        );
    };

    // disable or enable the nested option to overwrite PDF
    this.updatePDFOverwritePref = function() {
        setTimeout(() => {
            document.getElementById('checkbox-zoteroocr-overwrite-pdf').disabled = !document.getElementById('checkbox-zoteroocr-output-pdf').checked;
        });
    };

    this.recognize = Zotero.Promise.coroutine(function*() {

        let logString;

        const progress = createZoteroProgressWindow("Initializing...", 0);

        let checkExternalCmd = Zotero.Promise.coroutine(function*(exeName, exePref, possiblePath) {
            // Look for the pdftoppm  or tesseract executable in the settings and at commonly used locations.
            // If it is found, the settings are updated.
            // Otherwise the last possible location is returned.
            let externalCmd = Zotero.Prefs.get(exePref);
            let externalCmdFound = false;
            if (!externalCmd) {
                // look for externalCmd in various possible directories
                for (externalCmd of possiblePath) {
                    log("will try to locate " + externalCmd);
                    externalCmd += exeName;
                    if (Zotero.isWin) {
                        externalCmd += ".exe";
                    }
                    try {
                        externalCmdFound = yield OS.File.exists(externalCmd);
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
        })

        try {
            /*
                Check the settings and alternative possible locations for pdftoppm and tesseract.
                If the last possible option doesn't exist, display an error message and quit.
            */

            let pdftoppmPaths = ["", "/usr/local/bin/", "/usr/bin/", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/", "/run/current-system/sw/bin/"];
            let pdftoppm = yield checkExternalCmd("pdftoppm", "zoteroocr.pdftoppmPath", pdftoppmPaths);
            if (!(yield OS.File.exists(pdftoppm))) {
                window.alert("No pdftoppm executable found, last check: " + pdftoppm);
                return;
            }

            let ocrEnginePaths = ["", "/usr/local/bin/", "/usr/bin/", "C:\\Program Files\\Tesseract-OCR\\", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/", "/run/current-system/sw/bin/"];
            let ocrEngine = yield checkExternalCmd("tesseract", "zoteroocr.ocrPath", ocrEnginePaths);
            if (!(yield OS.File.exists(ocrEngine))) {
                window.alert("No tesseract executable found, last check: " + ocrEngine);
                return;
            }

            // Use the special pdfinfo variant in the zotero directory (which comes along Zotero)
            // See https://developer.mozilla.org/en-US/docs/Archive/Add-ons/Code_snippets/File_I_O#Getting_special_files
            // and https://dxr.mozilla.org/mozilla-central/source/xpcom/io/nsDirectoryServiceDefs.h.
            let zdir = FileUtils.getDir('GreBinD', []);
            let pdfinfo = zdir.clone();
            pdfinfo.append("pdfinfo");
            pdfinfo = pdfinfo.path;
            if (Zotero.isWin) {
                pdfinfo = pdfinfo + ".exe";
            }
            if (!(yield OS.File.exists(pdfinfo))) {
                alert("No " + pdfinfo + " executable found.");
                return;
            }

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
                            yield Zotero.getActiveZoteroPane().createEmptyParent(pdfItem);
                        }
                        item = Zotero.Items.get(item.parentItemID);
                    } else {
                        alert("Item is attachment but not PDF and will be ignored.");
                        continue;
                    }
                } else {
                    let pdfAttachments = item.getAttachments(false)
                        .map(itemID => Zotero.Items.get(itemID))
                        .filter(att => att.isFileAttachment() && att.attachmentContentType == 'application/pdf');
                    if (pdfAttachments.length == 0) {
                        alert("No PDF found for the selected item.");
                        continue;
                    }
                    if (pdfAttachments.length > 1) {
                        alert("There are several PDFs attached to this item. Only the first one will be processed.");
                    }
                    pdfItem = pdfAttachments[0];
                }
                let pdf = pdfItem.getFilePath();
                let base = pdf.replace(/\.pdf$/, '');
                let basename = pdfItem.attachmentFilename.replace(/\.pdf$/, '');
                let dir = OS.Path.dirname(pdf);
                let infofile = OS.Path.join(dir, 'pdfinfo.txt');
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
                    pdftoppmCmdArgs = [...pdftoppmCmdArgs, '-jpeg', '-jpegopt', 'quality=' + jpegQuality + ',progressive=' + jpegProgressive + ',optimize=' + jpegOptimization, '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, OS.Path.join(dir, basename + '-page')];
                } else {
                    imageFormat = "png";
                    pdftoppmCmdArgs = [...pdftoppmCmdArgs, '-png', '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, OS.Path.join(dir, basename + '-page')];
                }

                progress.updateMessage("Extracting pages...");
                // extract images from PDF
                let imageList = OS.Path.join(dir, basename + '-list.txt');
                let pageCount;
                if (!(yield OS.File.exists(imageList))) {
                    let pdfinfoCmdArgs = [pdf, infofile];
                    logString = log("Running " + pdfinfo + ' ' + pdfinfoCmdArgs.join(' '));

                    let data;
                    try {
                        let proc1 = yield Subprocess.call({
                            command: pdfinfo,
                            arguments: pdfinfoCmdArgs
                        });

                        while ((data = yield proc1.stdout.readString())) {
                            // Display the captured string in the log messages, so that even warnings are logged
                            log(string)

                            logString = log("Received:", data);
                        }

                    } catch (ex) {
                        logString = log("Process error:", ex);
                    }

                    logString = log("Running " + pdftoppm + ' ' + pdftoppmCmdArgs.join(' '));
                    try {
                        let proc2 = yield Subprocess.call({
                            command: pdftoppm,
                            arguments: pdftoppmCmdArgs,
                            stderr: "stdout"
                        });
                        let regex = /(\d+) (\d+) (.+)/;
                        let string;
                        while ((string = yield proc2.stdout.readString())) {
                            let res = regex.exec(string);
                            if (res) {

                                progress.updateMessage(`Extracting page ${res[1]} of ${res[2]}`)
                            }
                            logString = log("line:", string);
                        }
                    } catch (ex) {
                        logString = log("Process error:", ex);
                    }

                    // save the list of images in a separate file
                    // TODO 2025-11-27 adapt to new image filenames
                    let info = yield Zotero.File.getContentsAsync(infofile);
                    let numPages = info.match('Pages:[^0-9]+([0-9]+)')[1];
                    var imageListArray = [];
                    for (let i = 1; i <= parseInt(numPages, 10); i++) {
                        let paddedIndex = "0".repeat(numPages.length) + i;
                        if (imageFormat == "jpg") {
                            imageListArray.push(OS.Path.join(dir, basename + '-page-' + paddedIndex.substr(-numPages.length) + '.jpg'));
                        } else {
                            imageListArray.push(OS.Path.join(dir, basename + '-page-' + paddedIndex.substr(-numPages.length) + '.png'));
                        }
                    }
                    pageCount = imageListArray.length;
                    Zotero.File.putContents(Zotero.File.pathToFile(imageList), imageListArray.join('\n'));
                }  else {
                    // if image-list already exists, must read it to know pageCount
                    let buffer = yield Zotero.File.getContentsAsync(imageList)
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
                // Convert existing instances with older or buggy defaults to English
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
                let proc = yield Subprocess.call({
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

                while ((string = yield proc.stdout.readString())) {
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
                    }
                }

                let {exitCode} = yield proc.wait();
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

                logString = "OCR completed: attaching output"
                progress.updateMessage(logString);

                if (Zotero.Prefs.get("zoteroocr.outputNote")) {
                    let contents = yield Zotero.File.getContentsAsync(ocrbase + '.txt');
                    contents = contents.replace(/(?:\r\n|\r|\n)/g, '<br />');
                    let newNote = new Zotero.Item('note');
                    newNote.setNote(contents);
                    newNote.parentID = item.id;
                    newNote.libraryID = item.libraryID;
                    yield newNote.saveTx();
                }

                if (Zotero.Prefs.get("zoteroocr.outputHocr")) {
                    let contents = yield Zotero.File.getContentsAsync(ocrbase + '.hocr');
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
                        let pagename = 'page-' + i + '.html';
                        let htmlfile = Zotero.File.pathToFile(OS.Path.join(dir, pagename));
                        let pagecontent = preamble + "<div class='ocr_page'" + parts[i] + '<script src="https://unpkg.com/hocrjs"></script>\n</body>\n</html>';
                        Zotero.File.putContents(htmlfile, pagecontent);
                        // Zotero.Attachments.importFromFile() works in group libraries, linkFromFile() does not
                        if (Zotero.Prefs.get("zoteroocr.outputAsCopyAttachment")) {
                            yield Zotero.Attachments.importFromFile({
                                file: OS.Path.join(dir, pagename),
                                contentType: "text/html",
                                libraryID: item.libraryID,
                                parentItemID: item.id,
                            });
                            yield Zotero.File.removeIfExists(OS.Path.join(dir, pagename));
                        } else {
                            yield Zotero.Attachments.linkFromFile({
                                file: OS.Path.join(dir, pagename),
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
                        yield Zotero.Attachments.importFromFile({
                            file: ocrbase + '.pdf',
                            libraryID: item.libraryID,
                            parentItemID: item.id,
                        });
                        yield Zotero.File.removeIfExists(ocrbase + '.pdf');
                    } else {
                        yield Zotero.Attachments.linkFromFile({
                            file: ocrbase + '.pdf',
                            parentItemID: item.id
                        });
                    }
                }

                if (!Zotero.Prefs.get("zoteroocr.outputPNG") && imageListArray) {
                    // delete image list
                    yield Zotero.File.removeIfExists(imageList);
                    // delete PNGs
                    for (let imageName of imageListArray) {
                        yield Zotero.File.removeIfExists(imageName);
                    }
                }
            }
        } catch (error) {
            let alertMessage = "Last ZoteroOCR log message: " + logString + "\n\nZoteroOCR error: " + error.message;
            window.alert(alertMessage);

        } finally {
            progress.close();
        }
    });
};