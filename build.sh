#!/bin/sh

version="$1"
if [ -z "$version" -a -d .git ]; then
  version=$(git describe --tags)
fi
if [ -z "$version" ]; then
  read -p "Enter new version number: " version
fi


rm -f zotero-ocr-${version}.xpi
cd src
zip -9r ../zotero-ocr-${version}.xpi *
cd ..
jq ".addons[\"zotero-ocr@uni-mannheim.de\"].updates[0].update_hash = \"sha256:$(shasum -a 256 zotero-ocr-${version}.xpi | cut -d' ' -f1)\"" updates.json.tmpl | \
jq ".addons[\"zotero-ocr@uni-mannheim.de\"].updates[0].version = \"${version}\"" > updates.json
