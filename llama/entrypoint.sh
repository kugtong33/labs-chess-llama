#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
node "$script_directory/model-bootstrap.mjs"
exec "$@"
