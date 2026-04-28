#!/bin/sh
set -e

if [ "${CHANNELER_SKIP_CONTAINER_CHECKS:-false}" != "true" ]; then
  if [ -d /dev/dri ] || [ -n "${TRANSCODE_QSV_DEVICE:-}" ] || [ "${TRANSCODE_BACKEND:-auto}" = "qsv" ] || [ "${CHANNELER_RUN_QSV_CHECK:-false}" = "true" ]; then
    /usr/local/bin/channeler-qsv-check --warn-only || true
  fi
fi

exec "$@"
