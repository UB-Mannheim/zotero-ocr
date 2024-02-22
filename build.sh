#!/bin/sh

version="$1"
if [ -z "$version" ]; then
	read -p "Enter new version number: " version
fi

mkdir build-z6
rm -f  build-z6/*.xpi
cd src-z6 && zip -r ../build-z6/zotero-ocr-${version}.xpi chrome/* defaults/* chrome.manifest install.rdf && cd ..

mkdir build-z7
rm -f  build-z7/*.xpi
cd src-z7 && zip -r ../build-z7/zotero-ocr-${version}.xpi * && cd ..
