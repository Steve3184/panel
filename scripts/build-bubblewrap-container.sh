#!/bin/sh
set -eu

: "${BWRAP_VERSION:?BWRAP_VERSION is required}"
: "${BWRAP_SHA256:?BWRAP_SHA256 is required}"

apk add --no-cache build-base ca-certificates curl file libcap-dev libcap-static meson ninja pkgconf xz

archive="/tmp/bubblewrap.tar.xz"
source_dir="/tmp/bubblewrap-${BWRAP_VERSION}"
curl --fail --location --silent --show-error \
    "https://github.com/containers/bubblewrap/releases/download/v${BWRAP_VERSION}/bubblewrap-${BWRAP_VERSION}.tar.xz" \
    --output "$archive"
echo "${BWRAP_SHA256}  ${archive}" | sha256sum -c -
tar -xJf "$archive" -C /tmp

meson setup "$source_dir/_build" "$source_dir" \
    --buildtype=release \
    --default-library=static \
    -Dprefer_static=true \
    -Dc_args=-Wno-error=format-overflow \
    -Dc_link_args=-static \
    -Dselinux=disabled \
    -Dsupport_setuid=false \
    -Dman=disabled \
    -Dbash_completion=disabled \
    -Dzsh_completion=disabled \
    -Dtests=false
meson compile -C "$source_dir/_build"

install -m 0755 "$source_dir/_build/bwrap" /out/bwrap
install -m 0644 "$source_dir/COPYING" /out/COPYING
strip /out/bwrap
if ! file /out/bwrap | tee /tmp/bwrap-file-info | grep -q 'statically linked'; then
    echo 'Bubblewrap release binary is dynamically linked.' >&2
    exit 1
fi
/out/bwrap --version
