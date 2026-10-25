ocr-selected-pdfs =
    .label = Reconnaître le texte du/des PDF(s)

ocr-preferences =
    .label = Préférences Zotero OCR

ocr-pref-parameters = Paramètres OCR

ocr-pref-programs = Programmes

ocr-pref-search-paths =
    .value = Si le champ est vide, des emplacements standard seront examinés.

ocr-pref-parallel =
    .value = Nombre de processus parallèles :

ocr-pref-parallel-help1 =
    .value = Utilisé pour le rendu des pages par pdf.js et pour Tesseract OCR.

ocr-pref-parallel-help2 =
    .value = 1 désactive le parallélisme (défaut : 2) ; les valeurs supérieures à 4 sont limitées à 4.

ocr-pref-pdftoppm-help =
    .value = Ignoré si le module pdf.js de Zotero peut interpréter les pages du PDF.

ocr-pref-tesseract-path =
    .value = Emplacement exact de l'exécutable tesseract :

ocr-pref-pdftoppm-path =
    .value = Emplacement exact de l'exécutable pdftoppm :

ocr-pref-language =
    .value = Choisissez une langue/écriture pour la reconnaissance du texte (valeur par default : eng) :

ocr-pref-dpi =
    .value = Résolution du PDF de sortie (dpi) (valeur par défaut : 300) :

ocr-pref-psm =
    .value = Tesseract Page Segmentation Mode - nombre entier entre 0 et 13 (inclus)

ocr-pref-output-options = Options de sortie

ocr-pref-output-note =
    .label = Enregistrer le texte reconnu comme note

ocr-pref-output-pdf =
    .label = Enregistrer le texte reconnu dans un PDF avec une couche texte

ocr-pref-overwrite-pdf =
    .label = Remplacer le PDF initial par le PDF produit

ocr-pref-output-hocr =
    .label = Enregistrer le texte reconnu au format HTML/hocr

ocr-pref-max-html-pages =
    .value = Nombre maximal de pages pour lesquelles un fichier joint HTML sera créé :

ocr-pref-output-png =
    .label = Conserver les images intermédiaire dans le dossier

ocr-pref-copy-attachment =
    .label = Importer le PDF produit comme fichier joint au lieu de lié

ocr-already-running = Zotero OCR est déjà en cours d'exécution. Veuillez attendre la fin du traitement.
ocr-executable-not-found = Aucun exécutable { $program } trouvé, dernier emplacement vérifié : { $path }
ocr-not-pdf = Le document est un fichier joint mais pas un PDF, il sera ignoré.
ocr-no-pdf = Aucun PDF trouvé pour le document sélectionné.
ocr-multiple-pdfs = Plusieurs PDFs sont joints à ce document. Seul le premier sera traité.
ocr-progress-initializing = Initialisation...
ocr-progress-extracting = Extraction des pages...
ocr-progress-extracting-page = Extraction de la page { $page } sur { $total }
ocr-progress-processing = Traitement... veuillez patienter
ocr-progress-processing-page = Traitement de la page { $page } sur { $total }
ocr-progress-completed = OCR terminée : import du résultat
ocr-progress-parallel-headline = Zotero OCR - { $count } processus parallèles
ocr-progress-parallel = Traitement de { $pages } pages avec { $count } processus parallèles
ocr-progress-sequential-headline = Zotero OCR - séquentiel (pdfunite introuvable)
ocr-progress-sequential = pdfunite introuvable - traitement de { $count } pages séquentiellement
ocr-error-generic = Une erreur s'est produite
ocr-error-skipped-lines = [ { $count } lignes ignorées ]
ocr-error-details =
    Dernier message de ZoteroOCR : { $log }

    Erreur ZoteroOCR : { $error }
