# Zotero OCR

[![LGTM Grade](https://img.shields.io/lgtm/grade/javascript/github/UB-Mannheim/zotero-ocr)](https://github.com/UB-Mannheim/zotero-ocr/blob/master/LICENSE)
[![Latest release](https://img.shields.io/github/v/release/UB-Mannheim/zotero-ocr)](https://github.com/UB-Mannheim/zotero-ocr/releases)
![Release Date](https://img.shields.io/github/release-date/UB-Mannheim/zotero-ocr?color=9cf)
[![License](https://img.shields.io/github/license/UB-Mannheim/zotero-ocr)](https://github.com/UB-Mannheim/zotero-ocr/blob/master/LICENSE)
![Downloads latest release](https://img.shields.io/github/downloads/UB-Mannheim/zotero-ocr/latest/total?color=yellow)

This Zotero plugin adds the functionality to perform an OCR for the PDFs
selected in Zotero. It can add a new PDF including the recognized text,
a note with the recognized text only, and HTML (HOCR) file(s).
Tesseract OCR is used for the text recognition itself.


## Prerequisites

- Tesseract OCR is installed
  - for Windows see https://github.com/UB-Mannheim/tesseract/wiki
  - for Linux, Mac see https://github.com/tesseract-ocr/tessdoc/blob/master/Installation.md
- `pdftoppm` from poppler library is downloaded and installed


## Installation

To install the extension:

* Download the XPI file of the [latest release](https://github.com/UB-Mannheim/zotero-ocr/releases).
* In Zotero, go to Tools → Add-ons and drag the .xpi onto the Add-ons window.
* Possibly, adjust the path to Tesseract in the add-on options.


## Configuration

The configuration can be accessed under Tools → Zotero OCR Preferences:

![Zotero OCR Preferences](./screenshots/Zotero-OCR-Preferences.png)

Moreover, these options are saved as Zotero preferences variables, which
are also available through the
[Config Editor](https://www.zotero.org/support/preferences/advanced).


## Build and release

Run `build.sh` script, which creates a new `.xpi` file.

For a new release, run the script `release.sh`, push the code changes, publish a [new release on GitHub](https://github.com/UB-Mannheim/zotero-ocr/releases/new) and attach the `.xpi` file there.


## Development

After any code changes one can build a new extension file by `./build.sh <version>`.
Then in Zotero go to `Tools`, `Add-ons`, `Install Add-on From File...`
and choose there the newly created `.xpi`-file. Zotero will restart with the
newly built add-on version.

If any error occurs then you will see more details in the `Help`, `Report Error...`
dialog. For some debugging messages you can activate in Zotero the debugging
in the `Help`, `Debug Output Logging`.


## License

Zotero OCR is free and Open Source software.
The source code is released under [GNU Affero General Public License v3](LICENSE).
