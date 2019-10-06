// zoteroocr.js

Components.utils.import("resource://gre/modules/FileUtils.jsm");

Zotero.OCR = new function() {

	this.recognize = Zotero.Promise.coroutine(function* () {
		var ocrEngine = Zotero.Prefs.get("zoteroocr.ocrPath") || "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
		alert(ocrEngine);
		// TODO analyze the installed languages and scripts
		var items = Zotero.getActiveZoteroPane().getSelectedItems();
		let dir = FileUtils.getDir('AChrom', []).parent;
		let pdfinfo = dir.clone();
		pdfinfo.append("pdfinfo.exe");
		let pdftoppm = dir.clone();
		pdftoppm.append("pdftoppm.exe");
		
		for (let item of items) {
			// find the PDF
			let pdfItem;
			if (item.isAttachment()) {
				if (item.isFileAttachment() && item.attachmentContentType == 'application/pdf') {
					pdfItem = item;
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
			let dir = OS.Path.dirname(pdf);
			// TODO filter out PDFs which have already a text layer
			
			// extract images from PDF
			let imageList = OS.Path.join(dir, 'image-list.txt');
			if (!(yield OS.File.exists(imageList))) {
				try {
					yield Zotero.Utilities.Internal.exec(pdfinfo, [pdf, base + '.info.txt']);
					yield Zotero.Utilities.Internal.exec(pdftoppm, ['-png', '-r', 300, pdf, dir + '\\page' ]);
				}
				catch (e) {
					Zotero.logError(e);
				}
				// save the list of images in a separate file
				let info = yield Zotero.File.getContentsAsync(base + '.info.txt');
				let numPages = info.match('Pages:[^0-9]+([0-9]+)')[1];
				let imageListString = '';
				for (let i=1; i<=parseInt(numPages, 10); i++) {
					let paddedIndex = "0".repeat(numPages.length) + i;
					imageListString += dir + '\\page-' + paddedIndex.substr(-numPages.length) + '.png\n';
				}
				Zotero.File.putContents(Zotero.File.pathToFile(imageList), imageListString);
			}
			
			try {
				// TODO Is the differentiation for the output files with the additional '.ocr' useful in the end? Or should we overwrite the PDF and simplify the name of the hocr file?
				yield Zotero.Utilities.Internal.exec(ocrEngine, [dir + '\\image-list.txt', base + '.ocr', '-l', 'deu', 'hocr', 'txt', 'pdf']);
			}
			catch (e) {
				Zotero.logError(e);
			}
			
			// add note with full text
			// TODO is this useful at all?
			let contents = yield Zotero.File.getContentsAsync(base + '.ocr.txt');
			let newNote = new Zotero.Item('note');
			newNote.setNote(contents);
			newNote.parentID = item.id;
			yield newNote.saveTx();
			
			// create attachments with link to output formats
			for (let format of ['pdf', 'hocr']) {
				yield Zotero.Attachments.linkFromFile({
					file: base + '.ocr.' + format,
					parentItemID: item.id
				});
			}
		}
	});
};
