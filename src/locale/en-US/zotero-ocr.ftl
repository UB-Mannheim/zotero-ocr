ocr-selected-pdfs =
    .label = OCR selected PDF(s)

ocr-preferences =
    .label = Zotero OCR Preferences

ocr-pref-parameters = OCR parameters

ocr-pref-programs = Programs

ocr-pref-search-paths =
    .value = When empty, some standard locations are searched for it.

ocr-pref-pdftoppm-help =
    .value = If the pdf.js library bundled with Zotero can render the PDF pages, this is ignored.

ocr-pref-tesseract-path =
    .value = Full location of the tesseract executable:

ocr-pref-pdftoppm-path =
    .value = Full location of the pdftoppm executable:

ocr-pref-language =
    .value = Choose a language/script you want to use for recognition (default is eng):

ocr-pref-dpi =
    .value = Output pdf dpi (default is 300):

ocr-pref-psm =
    .value = Tesseract Page Segmentation Mode - integer from 0 to 13 (inclusive)

ocr-pref-output-options = Output options

ocr-pref-output-note =
    .label = Save output as a note

ocr-pref-output-pdf =
    .label = Save output as a PDF with text layer

ocr-pref-overwrite-pdf =
    .label = Overwrite the initial PDF with the output

ocr-pref-output-hocr =
    .label = Save output as a HTML/hocr file(s)

ocr-pref-max-html-pages =
    .value = Maximum number of pages for which an individual HTML attachment is created:

ocr-pref-output-png =
    .label = Save the intermediate images as well in the folder

ocr-pref-copy-attachment =
    .label = Import the resulting PDF as a copy instead of as a file link

ocr-already-running = Zotero OCR is already running. Please wait until it has finished.
ocr-executable-not-found = No { $program } executable found, last check: { $path }
ocr-not-pdf = Item is an attachment but not PDF and will be ignored.
ocr-no-pdf = No PDF found for the selected item.
ocr-multiple-pdfs = There are several PDFs attached to this item. Only the first one will be processed.
ocr-progress-initializing = Initializing...
ocr-progress-extracting = Extracting pages...
ocr-progress-extracting-page = Extracting page { $page } of { $total }
ocr-progress-processing = Processing... please be patient
ocr-progress-processing-page = Processing page { $page } of { $total }
ocr-progress-completed = OCR completed: attaching output
ocr-error-generic = An error occurred
ocr-error-skipped-lines = [ skipping { $count } lines ]
ocr-error-details =
    Last ZoteroOCR log message: { $log }

    ZoteroOCR error: { $error }
