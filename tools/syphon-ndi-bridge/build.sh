#!/bin/bash
# arm64 ネイティブ Syphon→NDI ブリッジをビルド
set -e
cd "$(dirname "$0")"

clang -arch arm64 -fobjc-arc -O2 \
  -framework Foundation \
  -framework Metal \
  -o syphon2ndi \
  syphon2ndi.m

echo "ビルド完了: $(pwd)/syphon2ndi"
file syphon2ndi
