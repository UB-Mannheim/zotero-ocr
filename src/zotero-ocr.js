// zoteroocr.js

// Formerly documented by https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules
Components.utils.import("resource://gre/modules/FileUtils.jsm");

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

    log(msg) {
        Zotero.debug("ZoteroOCR: " + msg);
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
            doc.getElementById(id)?.remove();
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
        Zotero.debug("entering recognize()");

        async function checkExternalCmd(exeName, exePref, possiblePath) {
            // Look for the pdftoppm  or tesseract executable in the settings and at commonly used locations.
            // If it is found, the settings are updated.
            // Otherwise the last possible location is returned.
            let externalCmd = Zotero.Prefs.get(exePref);
            let externalCmdFound = false;
            if (!externalCmd) {
                // look for externalCmd in various possible directories
                for (externalCmd of possiblePath) {
                    Zotero.debug("will try to locate " + externalCmd);
                    externalCmd += exeName;
                    if (Zotero.isWin) {
                        externalCmd += ".exe";
                    }
                    try {
                        externalCmdFound = await IOUtils.exists(externalCmd);
                    } catch(e) {
                        // if checking one of the possible paths throws an error, definitely count as not found
                        externalCmdFound = false;
                    }
                    
                    if (externalCmdFound) {
                        // found = true;
                        Zotero.debug("Found " + externalCmd);
                        Zotero.Prefs.set(exePref, externalCmd);
                        break;
                    }
                    Zotero.debug("No " + externalCmd);
                }
            }
            if (Zotero.isWin && !(externalCmd.endsWith(".exe"))) {
                externalCmd = externalCmd + ".exe";
            }
            return externalCmd;
        }
    
        /*
            Check the settings and alternative possible locations for pdftoppm and tesseract.
            If the last possible option doesn't exist, display an error message and quit.
        */

        let pdftoppmPaths = ["", "/usr/local/bin/", "/usr/bin/", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/"];
        let pdftoppm = await checkExternalCmd("pdttoppm", "zoteroocr.pdftoppmPath", pdftoppmPaths);
        if (!(await IOUtils.exists(pdftoppm))) {
            window.alert("No pdftoppm executable found, last check: " + pdftoppm);
            return;
        }

        let ocrEnginePaths = ["", "/usr/local/bin/", "/usr/bin/", "C:\\Program Files\\Tesseract-OCR\\", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/"];
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
                }
                else {
                    window.alert("Item is an attachment but not PDF and will be ignored.");
                    continue;
                }
            }
            else {
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
            let pdftoppmCmdArgs;
            if (imageFormat == "jpg" || imageFormat == "jpeg") {
                imageFormat = "jpg";
                let jpegQuality = Zotero.Prefs.get("zoteroocr.jpegQuality");
                let jpegProgressive = Zotero.Prefs.get("zoteroocr.jpegProgressive");
                let jpegOptimization = Zotero.Prefs.get("zoteroocr.jpegOptimization");
                pdftoppmCmdArgs = ['-jpeg', '-jpegopt', 'quality='+jpegQuality+',progressive='+jpegProgressive+',optimize='+jpegOptimization, '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, dir + '/page'];

            } else {
                imageFormat = "png";
                pdftoppmCmdArgs = ['-png', '-r', Zotero.Prefs.get("zoteroocr.outputDPI"), pdf, dir + '/page'];
            }

            // extract images from PDF
            let imageList = PathUtils.join(dir, 'image-list.txt');
            if (!(await IOUtils.exists(imageList))) {
                try {
                    Zotero.debug("Running " + pdftoppm + ' ' + pdftoppmCmdArgs.join(' '));
                    await Zotero.Utilities.Internal.exec(pdftoppm, pdftoppmCmdArgs);
                }
                catch (e) {
                    Zotero.logError(e);
                }

                var imageListArray = [];
                
                await IOUtils.getChildren(dir).then(
                    (entries) => {
                        for (const entry of entries) {
                            Zotero.debug('IOutils.getChildren() ran', entry);
                            if (imageFormat == "jpg") {
                                if (entry.match(/-\d+\.jpg$/)) {
                                    imageListArray.push(entry);
                                }
                            } else {
                                if (entry.match(/-\d+\.png$/)) {
                                    imageListArray.push(entry);
                                }
                            }
                        }
                        Zotero.debug('Files are now:')
                        Zotero.debug(imageListArray);
                        // IOUtils.getChildren() is not guaranteed to return files in alphanumerical order
                        imageListArray.sort();

                        // save the list of images in a separate file
                        Zotero.File.putContents(Zotero.File.pathToFile(imageList), imageListArray.join('\n'));
                    }
                );
            }

            let parameters = [dir + '/image-list.txt'];
            parameters.push(ocrbase);
            parameters.push('--psm');
            parameters.push(Zotero.Prefs.get("zoteroocr.PSMMode"));
            
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
            try {
                Zotero.debug("Running " + ocrEngine + ' ' + parameters.join(' '));
                await Zotero.Utilities.Internal.exec(ocrEngine, parameters);
            }
            catch (e) {
                Zotero.logError(e);
            }

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
                    let pagename = 'page-' + i + '.html';
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
    }
};
