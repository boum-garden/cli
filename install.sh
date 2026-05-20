#!/usr/bin/env bash
# Install the `boum` CLI from source.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/install.sh | bash
#
# Env vars:
#   BOUM_REPO      Git URL to clone (default: https://github.com/boum-garden/cli.git)
#   BOUM_REF       Git ref to check out (default: main)
#   BOUM_SUBDIR    Subdir inside the repo that holds the CLI (default: .)
#   BOUM_PREFIX    Install dir for the symlink (default: $HOME/.local/bin)
#   BOUM_LIB_DIR   Place to keep the built source (default: $HOME/.local/lib/boum-cli)

set -euo pipefail

BOUM_REPO="${BOUM_REPO:-https://github.com/boum-garden/cli.git}"
BOUM_REF="${BOUM_REF:-main}"
BOUM_SUBDIR="${BOUM_SUBDIR:-.}"
BOUM_PREFIX="${BOUM_PREFIX:-$HOME/.local/bin}"
BOUM_LIB_DIR="${BOUM_LIB_DIR:-$HOME/.local/lib/boum-cli}"

die() { echo "error: $*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"
}

require git
require node
require npm

node_major=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
if [ "$node_major" -lt 18 ]; then
  die "boum-cli requires Node.js >= 18 (found $node_major)"
fi

mkdir -p "$(dirname "$BOUM_LIB_DIR")" "$BOUM_PREFIX"

if [ -d "$BOUM_LIB_DIR/.git" ]; then
  echo "==> updating existing checkout in $BOUM_LIB_DIR"
  git -C "$BOUM_LIB_DIR" fetch --depth=1 origin "$BOUM_REF"
  git -C "$BOUM_LIB_DIR" checkout -q FETCH_HEAD
else
  echo "==> cloning $BOUM_REPO ($BOUM_REF) into $BOUM_LIB_DIR"
  rm -rf "$BOUM_LIB_DIR"
  git clone --depth=1 --branch "$BOUM_REF" "$BOUM_REPO" "$BOUM_LIB_DIR"
fi

cli_dir="$BOUM_LIB_DIR/$BOUM_SUBDIR"
[ -d "$cli_dir" ] || die "cli directory not found at $cli_dir"

echo "==> installing dependencies"
( cd "$cli_dir" && npm ci --omit=dev --silent 2>/dev/null \
  || npm install --omit=dev --silent )

echo "==> installing devDependencies for build"
( cd "$cli_dir" && npm install --silent )

echo "==> building"
( cd "$cli_dir" && npm run build --silent )

bin_target="$cli_dir/dist/index.js"
[ -f "$bin_target" ] || die "build did not produce $bin_target"
chmod +x "$bin_target"

link_path="$BOUM_PREFIX/boum"
ln -sf "$bin_target" "$link_path"

echo
echo "==> installed: $link_path -> $bin_target"
case ":$PATH:" in
  *":$BOUM_PREFIX:"*) ;;
  *) echo "note: $BOUM_PREFIX is not on your PATH. Add it to your shell profile:"
     echo "      export PATH=\"$BOUM_PREFIX:\$PATH\"" ;;
esac

echo
echo "Try it:"
echo "  boum --help"
echo "  boum auth signin"
