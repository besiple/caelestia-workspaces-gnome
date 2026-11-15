#!/usr/bin/env bash
set -e

UUID="caelestia-workspaces@besiple"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
REPO_URL="https://github.com/besiple/caelestia-workspaces-gnome.git"

echo "🌌 Installing Caelestia Slidefade Workspaces ($UUID)..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
TEMP_DIR=""

if [ ! -f "$SCRIPT_DIR/extension.js" ] || [ ! -f "$SCRIPT_DIR/caelestia_impl.js" ]; then
    echo "📦 Downloading latest files from GitHub..."
    TEMP_DIR=$(mktemp -d)
    git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
    SOURCE_DIR="$TEMP_DIR"
else
    SOURCE_DIR="$SCRIPT_DIR"
fi

mkdir -p "$DEST"
cp -f "$SOURCE_DIR/metadata.json" "$DEST/"
cp -f "$SOURCE_DIR/extension.js" "$DEST/"
cp -f "$SOURCE_DIR/caelestia_impl.js" "$DEST/"

# Pack bundle and install via gnome-extensions (live registration)
python3 -c "
import os, zipfile
dest = '$DEST'
zip_path = '/tmp/$UUID.zip'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ['metadata.json', 'extension.js', 'caelestia_impl.js']:
        fpath = os.path.join(dest, name)
        if os.path.exists(fpath):
            z.write(fpath, name)
"
if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions install --force "/tmp/$UUID.zip" 2>/dev/null || true
fi
rm -f "/tmp/$UUID.zip"

if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

# Clean disabled-extensions and add to enabled-extensions
python3 -c "
import subprocess, re

uuid = '$UUID'
def get_list(key):
    try:
        out = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', key]).decode().strip()
        return re.findall(r\"'([^']+)'\", out)
    except:
        return []

def set_list(key, items):
    val = '[' + ', '.join(f\"'{x}'\" for x in items) + ']'
    try:
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', key, val])
    except:
        pass

disabled = [x for x in get_list('disabled-extensions') if x != uuid]
set_list('disabled-extensions', disabled)

enabled = get_list('enabled-extensions')
if uuid not in enabled:
    enabled.append(uuid)
    set_list('enabled-extensions', enabled)
"

if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" 2>/dev/null || true
fi

if [ -n "$XDG_RUNTIME_DIR" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.DisableExtension "$UUID" >/dev/null 2>&1 || true
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.EnableExtension "$UUID" >/dev/null 2>&1 || true
fi

echo ""
echo "✨ Caelestia Slidefade Workspaces successfully installed!"
echo "👉 Switch workspaces (Super+Alt+Left/Right or trackpad swipe) to enjoy fluid slidefade!"
