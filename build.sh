#!/bin/sh

version="$1"
if [ -z "$version" ]; then
	read -p "Enter new version number: " version
fi

if [ -d build ]; then
	if [ -f build/*.xpi ]; then
		rm -f  build/*.xpi
	fi
else
	mkdir build
fi
cd src && zip -r ../build/zotero-ocr-${version}.xpi * -x "*.DS_Store" && cd ..
