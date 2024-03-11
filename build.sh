#!/bin/sh

version="$1"
if [ -z "$version" ]; then
	read -p "Enter new version number: " version
fi


rm -f zotero-ocr-${version}.xpi
cd src
zip -9r ../zotero-ocr-${version}.xpi *
