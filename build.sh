#!/bin/sh

version="$1"
if [ -z "$version" ]; then
	read -p "Enter new version number: " version
fi

mkdir -p build
(cd src && zip -DX -r ../build/zotero-ocr-${version}.xpi * -x ".*")
