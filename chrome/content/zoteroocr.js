Zotero.OCR = {};

Zotero.OCR.recognize = function() {
	var ocrEngine = Zotero.Prefs.get("zoteroocr.ocrPath") || "tesseract";
	var items = ZoteroPane.getSelectedItems();
	alert(items.length); // TODO delete this debug line
	for (let item of items) {
		if (!item.isAttachment()) {
			let pdfAttachments = item.getAttachments(false)
				.map(itemID => Zotero.Items.get(itemID))
				.filter(item => item.isFileAttachment() && item.attachmentContentType == 'application/pdf');
			if (pdfAttachments.length > 0) {
				item = pdfAttachments[0]; // TODO handle all possible pdf attachments?
			}
		}
		if (item.isAttachment() && item.attachmentContentType == "application/pdf") {
			let pdf = item.getFilePath();
			let out = pdf.replace(/\.pdf$/, '.txt');
			// TODO continue here, possibly with something like...
			Zotero.Utilities.Internal.exec(ocrEngine, [pdf, out, '-l deu', 'hocr']);
		} else {
			alert("No PDF attachments found");
		}
	}
};
