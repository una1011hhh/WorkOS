#!/bin/sh
set -eu

node scripts/write-runtime-config.mjs
exec "$@"
