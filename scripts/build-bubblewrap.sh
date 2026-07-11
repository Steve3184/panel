#!/bin/sh
set -eu

BWRAP_VERSION='0.11.2'
BWRAP_SHA256='69abc30005d2186baf7737feacd8da35633b93cf5af38838ecff17c5f8e924f6'
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_DIR=${1:-"$ROOT_DIR/build/bubblewrap"}
ARCH=${2:-$(uname -m)}

case "$ARCH" in
    x86_64|x64|amd64)
        DOCKER_ARCH='amd64'
        BUILD_IMAGE='alpine@sha256:7c8cb692ae09657cbc4a3f3cbd0e8d5a2690ba38386aaaf252dbb060bf5eb2e6'
        ;;
    aarch64|arm64)
        DOCKER_ARCH='arm64'
        BUILD_IMAGE='alpine@sha256:2c9d26f410d032d5b1525aa8a873e238b05b90c4ae8618743d4311f0cc827e37'
        ;;
    *) echo "Unsupported Bubblewrap build architecture: $ARCH" >&2; exit 1 ;;
esac

command -v docker >/dev/null 2>&1 || {
    echo 'Docker is required to build the portable Bubblewrap binary.' >&2
    exit 1
}

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

docker run --rm \
    --platform "linux/$DOCKER_ARCH" \
    -e "BWRAP_VERSION=$BWRAP_VERSION" \
    -e "BWRAP_SHA256=$BWRAP_SHA256" \
    -v "$ROOT_DIR/scripts/build-bubblewrap-container.sh:/build.sh:ro" \
    -v "$TEMP_DIR:/out" \
    "$BUILD_IMAGE" \
    /bin/sh /build.sh

mkdir -p "$OUTPUT_DIR"
install -m 0755 "$TEMP_DIR/bwrap" "$OUTPUT_DIR/bwrap"
install -m 0644 "$TEMP_DIR/COPYING" "$OUTPUT_DIR/COPYING"

PROBE_WORKSPACE="$TEMP_DIR/sandbox-workspace"
mkdir -p "$PROBE_WORKSPACE"
touch "$PROBE_WORKSPACE/visible"
if "$OUTPUT_DIR/bwrap" --unshare-user --ro-bind / / /bin/true 2>/dev/null; then
    "$OUTPUT_DIR/bwrap" \
        --die-with-parent \
        --new-session \
        --unshare-all \
        --share-net \
        --proc /proc \
        --dev /dev \
        --ro-bind /usr /usr \
        --ro-bind-try /bin /bin \
        --ro-bind-try /lib /lib \
        --ro-bind-try /lib64 /lib64 \
        --bind "$PROBE_WORKSPACE" /workspace \
        --chdir /workspace \
        -- /bin/sh -c 'test -f /workspace/visible'
else
    printf 'Warning: unprivileged user namespaces unavailable, skipping sandbox probe\n' >&2
fi

printf 'bubblewrap %s (%s)\n' "$BWRAP_VERSION" "$DOCKER_ARCH" > "$OUTPUT_DIR/VERSION"
printf 'Built Bubblewrap %s for linux/%s in %s\n' "$BWRAP_VERSION" "$DOCKER_ARCH" "$OUTPUT_DIR"
