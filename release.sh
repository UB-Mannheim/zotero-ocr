#!/bin/sh

read -p "Enter new version number: " version


##############
## Update install.rdf
##############

perl -pi -e "s/em:version=\"[^\"]*/em:version=\"$version/;" "install.rdf"
rm "install.rdf.bak"
git add "install.rdf"


##############
## Update update.rdf
##############

perl -pi -e "s/<em:version>[^<]*/<em:version>$version/;" \
          -e "s/<em:updateLink>[^<]*/<em:updateLink>https:\/\/github.com\/UB-Mannheim\/zotero-ocr\/releases\/download\/$version\/zotero-ocr-$version.xpi/;" \
          -e "s/<em:updateInfoURL>[^<]*/<em:updateInfoURL>https:\/\/github.com\/UB-Mannheim\/zotero-ocr\/releases\/tag\/$version/;" \
    update.rdf
git add "update.rdf"
rm "update.rdf.bak"


git commit -m "Release $version" 1>&2


./build.sh "$version"
