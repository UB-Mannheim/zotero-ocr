var ZoteroOCR;

function log(msg) {
	Zotero.debug("Zotero OCR: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting");
	// log("id=" + id + ", version=" + version + ", rootURI=" + rootURI);

	log("Starting (register)");
	Zotero.PreferencePanes.register({
		pluginID: 'zotero-ocr@uni-mannheim.de',
		src: rootURI + 'prefs.xhtml'
	});

	log("Starting (loadSubScript)");
	Services.scriptloader.loadSubScript(rootURI + 'zoteroocr.js');
	log("Starting (init)");
	ZoteroOCR.init({ id, version, rootURI });
	log("Starting (addToAllWindows)");
	ZoteroOCR.addToAllWindows();
	log("Starting finished");
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
