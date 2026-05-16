#!/usr/bin/env bash
# Install/update/uninstall jjplan + jjask into ~/.local/bin/. Idempotent.
# One action covers both binaries; there is no per-binary mode.

set -euo pipefail

REPO="yigegongjiang/jj-plan"
BIN_DIR="${HOME}/.local/bin"

BINARIES=(jjplan jjask)

asset_for() {
  case "$1" in
    jjplan) echo "jjplan-macos-arm64" ;;
    jjask)  echo "jjask-macos-arm64"  ;;
    *) echo "install.sh: unknown binary $1" >&2; exit 2 ;;
  esac
}

usage() {
  cat <<'EOF'
usage: install.sh [install|update|uninstall]
  install/update: download jjplan + jjask
  uninstall:      remove jjplan + jjask (config kept)
EOF
}

install_one() {
  local name="$1"
  local asset url tmp dest
  asset="$(asset_for "$name")"
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
  tmp="$(mktemp "${TMPDIR:-/tmp}/${name}.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT

  echo "downloading ${url}"
  curl -fL --progress-bar "$url" -o "$tmp"
  chmod +x "$tmp"

  dest="${BIN_DIR}/${name}"
  mv "$tmp" "$dest"
  trap - EXIT

  echo "installed: $dest"
  "$dest" --version || true
}

uninstall_one() {
  local name="$1"
  local dest="${BIN_DIR}/${name}"
  if [ -e "$dest" ]; then
    rm -f "$dest"
    echo "removed: $dest"
  else
    echo "not installed: $dest"
  fi
}

ACTION="${1:-install}"
if [ "$#" -gt 1 ]; then
  echo "install.sh: too many arguments" >&2
  usage >&2
  exit 2
fi

case "$ACTION" in
  install|update|--install|--update) ACTION="install" ;;
  uninstall|--uninstall) ACTION="uninstall" ;;
  help|-h|--help) usage; exit 0 ;;
  *)
    echo "install.sh: unknown action '$ACTION'" >&2
    usage >&2
    exit 2
    ;;
esac

if [ "$ACTION" = "uninstall" ]; then
  for n in "${BINARIES[@]}"; do
    uninstall_one "$n"
  done
  echo "config kept: ${HOME}/.jjplan/config.json"
  exit 0
fi

mkdir -p "$BIN_DIR"

for n in "${BINARIES[@]}"; do
  install_one "$n"
done

case ":$PATH:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo
    echo "warning: ${BIN_DIR} is not in your PATH."
    echo "  add this to ~/.zshrc or ~/.bashrc:"
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac
