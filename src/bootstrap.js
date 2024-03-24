var ZoteroOCR;

function log(msg) {
	Zotero.debug("Zotero OCR: " + msg);
}

function install() {
	log("Installed Zotero OCR");
}

async function startup({ id, version, rootURI }) {
	log("Starting Zotero OCR");

	Zotero.PreferencePanes.register({
		pluginID: 'zotero-ocr@bib.uni-mannheim.de',
		src: rootURI + 'prefs.xhtml',
		//scripts: [rootURI + 'prefs.js']
	});

	Services.scriptloader.loadSubScript(rootURI + 'zotero-ocr.js');
	ZoteroOCR.init({ id, version, rootURI });
	ZoteroOCR.addToAllWindows();
	await ZoteroOCR.main();
}

function onMainWindowLoad({ window }) {
	ZoteroOCR.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZoteroOCR.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down Zotero OCR");
	ZoteroOCR.removeFromAllWindows();
	ZoteroOCR = undefined;
}

function uninstall() {
	log("Uninstalled Zotero OCR");
}
