// zoteroocr.js

// See https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules.
Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");

Zotero.OCR = new function() {

	this.openPreferenceWindow = function(paneID, action) {
		var io = {pane: paneID, action: action};
		window.openDialog(
				'chrome://zoteroocr/content/preferences.xul',
				'zoteroocr-preferences-windowname',
				'chrome,titlebar,toolbar,centerscreen' + Zotero.Prefs.get('browser.preferences.instantApply', true) ? 'dialog=no' : 'modal', io
		);
	};

	// disable or enable the nested option to overwrite PDF
	this.updatePDFOverwritePref = function () {
		setTimeout(() => {
			document.getElementById('checkbox-zoteroocr-overwrite-pdf').disabled = !document.getElementById('checkbox-zoteroocr-output-pdf').checked;
		});
	};

	this.recognize = Zotero.Promise.coroutine(function* () {

		let checkExternalCmd = Zotero.Promise.coroutine(function* (exeName, exePref, possiblePath) {
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
                        externalCmdFound = yield OS.File.exists(externalCmd);
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
        })
    
        /*
            Check the settings and alternative possible locations for pdftoppm and tesseract.
            If the last possible option doesn't exist, display an error message and quit.
        */

        let pdftoppmPaths = ["", "/usr/local/bin/", "/usr/bin/", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/"];
        let pdftoppm = yield checkExternalCmd("pdttoppm", "zoteroocr.pdftoppmPath", pdftoppmPaths);
        if (!(yield OS.File.exists(pdftoppm))) {
            window.alert("No pdftoppm executable found, last check: " + pdftoppm);
            return;
        }

        let ocrEnginePaths = ["", "/usr/local/bin/", "/usr/bin/", "C:\\Program Files\\Tesseract-OCR\\", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/"];
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
				}
				else {
					alert("Item is attachment but not PDF and will be ignored.");
					continue;
				}
			}
			else {
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
			let dir = OS.Path.dirname(pdf);
			let infofile = dir + '/pdfinfo.txt';
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
			let imageList = OS.Path.join(dir, 'image-list.txt');
			if (!(yield OS.File.exists(imageList))) {
				try {
					let pdfinfoCmdArgs = [pdf, infofile];
					Zotero.debug("Running " + pdfinfo + ' ' + pdfinfoCmdArgs.join(' '));
					yield Zotero.Utilities.Internal.exec(pdfinfo, pdfinfoCmdArgs);

					Zotero.debug("Running " + pdftoppm + ' ' + pdftoppmCmdArgs.join(' '));
					yield Zotero.Utilities.Internal.exec(pdftoppm, pdftoppmCmdArgs);
				}
				catch (e) {
					Zotero.logError(e);
				}
				// save the list of images in a separate file
				let info = yield Zotero.File.getContentsAsync(infofile);
				let numPages = info.match('Pages:[^0-9]+([0-9]+)')[1];
				var imageListArray = [];
				for (let i = 1; i <= parseInt(numPages, 10); i++) {
					let paddedIndex = "0".repeat(numPages.length) + i;
					if (imageFormat == "jpg") {
						imageListArray.push(dir + '/page-' + paddedIndex.substr(-numPages.length) + '.jpg');
					} else {
						imageListArray.push(dir + '/page-' + paddedIndex.substr(-numPages.length) + '.png');
					}
				}
				Zotero.File.putContents(Zotero.File.pathToFile(imageList), imageListArray.join('\n'));
			}

			let parameters = [dir + '/image-list.txt'];
			parameters.push(ocrbase);
			parameters.push('--psm');
			parameters.push(Zotero.Prefs.get("zoteroocr.PSMMode"));
			
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
			try {
				Zotero.debug("Running " + ocrEngine + ' ' + parameters.join(' '));
				yield Zotero.Utilities.Internal.exec(ocrEngine, parameters);
			}
			catch (e) {
				Zotero.logError(e);
			}

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
	});

};
