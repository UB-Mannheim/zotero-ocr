var ZoteroOCR;

function log(msg) {
	Zotero.debug("Zotero OCR: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting");

	Zotero.PreferencePanes.register({
		image: 'chrome/skin/default/zoteroocr/ocr-symbol.svg',
		pluginID: 'zotero-ocr@bib.uni-mannheim.de',
		src: rootURI + 'prefs.xhtml'
	});

	Services.scriptloader.loadSubScript(rootURI + 'zotero-ocr.js');
	ZoteroOCR.init({ id, version, rootURI });
	ZoteroOCR.addToAllWindows();
}

function onMainWindowLoad({ window }) {
	ZoteroOCR.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZoteroOCR.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	ZoteroOCR.removeFromAllWindows();
	ZoteroOCR = undefined;
}

function uninstall() {
	log("Uninstalled");
}
