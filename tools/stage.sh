#!/bin/sh
# Copy the publishable files (the page and its modules) into a staging folder.
set -e
dest="${1:?usage: tools/stage.sh <dest>}"
rm -rf "$dest"
mkdir -p "$dest"
cp index.html "$dest/"
cp -r src "$dest/src"
find "$dest" -type f | sed "s|^$dest/||" | sort
