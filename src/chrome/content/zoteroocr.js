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

		// Look for the tesseract executable in the settings and at commonly used locations.
		// If it is found, the settings are updated.
		// Otherwise abort with an alert.
		let ocrEngine = Zotero.Prefs.get("zoteroocr.ocrPath");
		let found = false;
		if (ocrEngine) {
			let pathOrFile = FileUtils.File(ocrEngine);
			// If a directory is given, then try for the standard name of the tool.
			if (pathOrFile.isDirectory()) {
				if (Zotero.isWin) {
					ocrEngine = OS.Path.join(ocrEngine, "tesseract.exe");
				}
				else {
					ocrEngine = OS.Path.join(ocrEngine, "tesseract");
				}
				Zotero.Prefs.set("zoteroocr.ocrPath", ocrEngine);
			}
			found = yield OS.File.exists(ocrEngine);
		}
		else {
			let path = ["", "/usr/local/bin/", "/usr/bin/", "C:\\Program Files\\Tesseract-OCR\\", "/opt/homebrew/bin/", "/usr/local/homebrew/bin/"];
			for (ocrEngine of path) {
				ocrEngine += "tesseract";
				if (Zotero.isWin) {
					ocrEngine += ".exe";
				}
				if (yield OS.File.exists(ocrEngine)) {
					found = true;
					Zotero.debug("Found " + ocrEngine);
					Zotero.Prefs.set("zoteroocr.ocrPath", ocrEngine);
					break;
				}
				Zotero.debug("No " + ocrEngine);
			}
		}
		if (!found) {
			alert("Tesseract executable not found. Tried: " + ocrEngine);
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

		// Look for a specific path in the preferences for pdftoppm
		let pdftoppm = Zotero.Prefs.get("zoteroocr.pdftoppmPath");
		if (!pdftoppm) {
			// alternatively use the also the Zotero directory to look for pdftoppm
			pdftoppm = zdir.clone();
			pdftoppm.append("pdftoppm");
			pdftoppm = pdftoppm.path;
		}
		if (Zotero.isWin && !(pdftoppm.endsWith(".exe"))) {
			pdftoppm = pdftoppm + ".exe";
		}
		if (!(yield OS.File.exists(pdftoppm))) {
			alert("No " + pdftoppm + " executable found.");
			return;
		}

		let items = Zotero.getActiveZoteroPane().getSelectedItems();
		for (let item of items) {
			// find the PDF
			let pdfItem;
			if (item.isAttachment()) {
				if (item.isFileAttachment() && item.attachmentContentType == 'application/pdf') {
					pdfItem = item;
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

			// extract images from PDF
			let imageList = OS.Path.join(dir, 'image-list.txt');
			if (!(yield OS.File.exists(imageList))) {
				try {
					Zotero.debug("Running " + pdfinfo + ' ' + pdf + ' ' + infofile);
					yield Zotero.Utilities.Internal.exec(pdfinfo, [pdf, infofile]);
					Zotero.debug("Running " + pdftoppm + ' -png -r 300 ' + pdf + ' ' + dir + '/page');
					yield Zotero.Utilities.Internal.exec(pdftoppm, ['-png', '-r', 300, pdf, dir + '/page']);
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
					imageListArray.push(dir + '/page-' + paddedIndex.substr(-numPages.length) + '.png');
				}
				Zotero.File.putContents(Zotero.File.pathToFile(imageList), imageListArray.join('\n'));
			}

			let parameters = [dir + '/image-list.txt'];
			parameters.push(ocrbase);
			if (Zotero.Prefs.get("zoteroocr.language")) {
				parameters.push('-l');
				parameters.push(Zotero.Prefs.get("zoteroocr.language"));
			}
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
					let pagecontent = preamble + "<div class='ocr_page'" + parts[i] +	'<script src="https://unpkg.com/hocrjs"></script>\n</body>\n</html>';
					Zotero.File.putContents(htmlfile, pagecontent);
					yield Zotero.Attachments.linkFromFile({
						file: OS.Path.join(dir, pagename),
						contentType: "text/html",
						parentItemID: item.id
					});
				}
			}

			// attach PDF if it is a new one
			if (Zotero.Prefs.get("zoteroocr.outputPDF") && !(Zotero.Prefs.get("zoteroocr.overwritePDF"))) {
				yield Zotero.Attachments.linkFromFile({
					file: ocrbase + '.pdf',
					parentItemID: item.id
				});
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
