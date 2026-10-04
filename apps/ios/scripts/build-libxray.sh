#!/usr/bin/env bash
# Builds Frameworks/LibXray.xcframework (Xray-core for iOS) from XTLS/libXray
# with its official gomobile build script. Needs macOS with Xcode, Go 1.24+
# and python3. Takes several minutes.
set -euo pipefail

LIBXRAY_VERSION="${LIBXRAY_VERSION:-v26.9.30}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/build/libXray"
OUT="$ROOT/Frameworks/LibXray.xcframework"

if [[ -d "$OUT" && "${FORCE:-0}" != "1" ]]; then
	echo "LibXray.xcframework already exists (FORCE=1 to rebuild)"
	exit 0
fi

command -v go >/dev/null || { echo "Go is required: brew install go" >&2; exit 1; }
command -v xcodebuild >/dev/null || { echo "Xcode is required" >&2; exit 1; }

rm -rf "$WORK"
git clone --depth 1 --branch "$LIBXRAY_VERSION" https://github.com/XTLS/libXray.git "$WORK"
cd "$WORK"
GOBIN_DIR="$(go env GOPATH)/bin"
export PATH="$PATH:$GOBIN_DIR"
python3 build/main.py apple gomobile

rm -rf "$OUT"
mkdir -p "$ROOT/Frameworks"
mv "$WORK/LibXray.xcframework" "$OUT"
echo "Built $OUT"
