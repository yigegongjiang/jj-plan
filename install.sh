#!/usr/bin/env bash
#
# jjplan installer / updater.
# Usage: curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
#        curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash -s -- --uninstall
#
# Downloads the latest jjplan CLI binary from GitHub Releases and drops it
# into ~/.local/bin/jjplan. Idempotent: re-running upgrades to the latest
# release.

set -euo pipefail

REPO="yigegongjiang/jj-plan"
ASSET="jjplan-macos-arm64"
DEST="${HOME}/.local/bin/jjplan"

usage() {
  cat <<'EOF'
usage: install.sh [install|update|--uninstall]
EOF
}

ACTION="${1:-install}"
if [ "$#" -gt 1 ]; then
  echo "jjplan: too many installer arguments" >&2
  usage >&2
  exit 2
fi

case "$ACTION" in
  install|update|--install|--update) ;;
  uninstall|--uninstall)
    if [ -e "$DEST" ]; then
      rm -f "$DEST"
      echo "removed: $DEST"
    else
      echo "not installed: $DEST"
    fi
    echo "config kept: ${HOME}/.jjplan/config.json"
    exit 0
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  *)
    echo "jjplan: unknown installer action: $ACTION" >&2
    usage >&2
    exit 2
    ;;
esac

URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
TMP="$(mktemp "${TMPDIR:-/tmp}/jjplan.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

echo "downloading ${URL}"
curl -fL --progress-bar "$URL" -o "$TMP"
chmod +x "$TMP"

mkdir -p "$(dirname "$DEST")"
mv "$TMP" "$DEST"
trap - EXIT

echo "installed: $DEST"
"$DEST" --version || true

case ":$PATH:" in
  *":${HOME}/.local/bin:"*) ;;
  *)
    echo
    echo "warning: ${HOME}/.local/bin is not in your PATH."
    echo "  add this to ~/.zshrc or ~/.bashrc:"
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac
