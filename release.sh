#!/bin/sh

version="$1"
if [ -z "$version" ]; then
        read -p "Enter new version number: " version
fi


##############
## Update install.rdf and manifest.json
##############

perl -pi.bak -e "s/em:version=\"[^\"]*/em:version=\"$version/;" src/install.rdf
if cmp -s src/install.rdf.bak src/install.rdf; then
  # Nothing changed, restore original file and timestamp.
  mv src/install.rdf.bak src/install.rdf
fi
perl -pi.bak -e "s/\"version\": \"[^\"]*\"/\"version\": \"$version\"/" src/manifest.json
if cmp -s src/manifest.json.bak src/manifest.json; then
  # Nothing changed, restore original file and timestamp.
  mv src/manifest.json.bak src/manifest.json
fi


##############
## Create updates.json and update.rdf
##############

./build.sh "$version"

perl -pi -e "s/\"version\": \"[^\"]*\",/\"version\": \"${version}\",/" updates.json
perl -pi -e "s/\"update_link\": \"[^\"]*\",/\"update_link\": \"https:\/\/github.com\/UB-Mannheim\/zotero-ocr\/releases\/download\/${version}\/zotero-ocr-${version}.xpi\",/" updates.json
perl -pi -e "s/\"update_hash\": \"[^\"]*\",/\"update_hash\": \"sha256:$(shasum -a 256 build\/zotero-ocr-${version}.xpi | cut -d' ' -f1)\",/" updates.json
cp -p updates.json update.rdf

git add src/install.rdf src/manifest.json update.rdf updates.json
git commit -m "Release $version" &&
git tag -a -m "Release $version" "$version"
