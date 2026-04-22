#!/usr/bin/env bash
set -euo pipefail

IMAGE="emmettmoore/channeler"
TAG="${1:-latest}"
FULL="${IMAGE}:${TAG}"

echo "Select target architecture:"
echo "  1) linux/amd64        (Intel)"
echo "  2) linux/arm64        (Apple Silicon / ARM)"
echo "  3) linux/amd64,linux/arm64  (both)"
read -rp "Choice [1-3]: " choice

case "$choice" in
  1) PLATFORM="linux/amd64" ;;
  2) PLATFORM="linux/arm64" ;;
  3) PLATFORM="linux/amd64,linux/arm64" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

CACHE_REF="${IMAGE}:cache"
VERSION="$(date +%Y%m%d)-$(git rev-parse --short HEAD)"

echo "Building ${FULL} for ${PLATFORM} (version: ${VERSION})..."
docker buildx build \
  --platform "$PLATFORM" \
  --cache-from "type=registry,ref=${CACHE_REF}" \
  --cache-to "type=registry,ref=${CACHE_REF},mode=max" \
  --build-arg "VERSION=${VERSION}" \
  -t "$FULL" \
  --push .

echo "Done: ${FULL}"
