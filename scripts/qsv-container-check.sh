#!/bin/sh
set -u

FFMPEG_BIN="${FFMPEG_PATH:-ffmpeg}"
QSV_DEVICE="${TRANSCODE_QSV_DEVICE:-/dev/dri/renderD128}"
WARN_ONLY=false
FAILURES=0

if [ "${1:-}" = "--warn-only" ]; then
  WARN_ONLY=true
fi

log() {
  printf '%s\n' "[intel-gpu-check] $*"
}

fail() {
  printf '%s\n' "[intel-gpu-check] FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}

log "checking Intel GPU container support"
log "ffmpeg=${FFMPEG_BIN}"
log "device=${QSV_DEVICE}"

if ! command -v "$FFMPEG_BIN" >/dev/null 2>&1; then
  fail "FFmpeg binary is not available"
else
  if "$FFMPEG_BIN" -hide_banner -encoders 2>/dev/null | grep -q 'h264_vaapi'; then
    log "FFmpeg encoder h264_vaapi is available"
  else
    fail "FFmpeg does not list h264_vaapi"
  fi
  if "$FFMPEG_BIN" -hide_banner -encoders 2>/dev/null | grep -q 'h264_qsv'; then
    log "FFmpeg encoder h264_qsv is available"
  else
    fail "FFmpeg does not list h264_qsv"
  fi
fi

if [ ! -d /dev/dri ]; then
  fail "/dev/dri is not mounted into the container"
else
  log "/dev/dri contents: $(ls -1 /dev/dri 2>/dev/null | tr '\n' ' ')"
fi

if [ ! -e "$QSV_DEVICE" ]; then
  fail "QSV render device does not exist: ${QSV_DEVICE}"
else
  if [ ! -r "$QSV_DEVICE" ]; then
    fail "QSV render device is not readable: ${QSV_DEVICE}"
  fi
  if [ ! -w "$QSV_DEVICE" ]; then
    fail "QSV render device is not writable: ${QSV_DEVICE}"
  fi
fi

if command -v vainfo >/dev/null 2>&1 && [ -e "$QSV_DEVICE" ]; then
  if vainfo --display drm --device "$QSV_DEVICE" >/tmp/channeler-vainfo.log 2>&1; then
    log "vainfo can inspect ${QSV_DEVICE}"
  else
    fail "vainfo failed for ${QSV_DEVICE}: $(tail -n 5 /tmp/channeler-vainfo.log | tr '\n' ' ')"
  fi
fi

if command -v "$FFMPEG_BIN" >/dev/null 2>&1 && [ -e "$QSV_DEVICE" ]; then
  if "$FFMPEG_BIN" \
    -hide_banner \
    -loglevel error \
    -vaapi_device "$QSV_DEVICE" \
    -f lavfi \
    -i testsrc2=size=1280x720:rate=30 \
    -frames:v 30 \
    -vf format=nv12,hwupload \
    -an \
    -c:v h264_vaapi \
    -qp 23 \
    -f null - >/tmp/channeler-vaapi-ffmpeg.log 2>&1; then
    log "FFmpeg VAAPI validation encode passed"
  else
    fail "FFmpeg VAAPI validation encode failed: $(tail -n 20 /tmp/channeler-vaapi-ffmpeg.log | tr '\n' ' ')"
  fi

  if "$FFMPEG_BIN" \
    -hide_banner \
    -loglevel error \
    -init_hw_device "vaapi=va:${QSV_DEVICE}" \
    -init_hw_device "qsv=qsv@va" \
    -filter_hw_device qsv \
    -f lavfi \
    -i testsrc2=size=1280x720:rate=30 \
    -frames:v 30 \
    -vf format=nv12 \
    -an \
    -c:v h264_qsv \
    -preset veryfast \
    -b:v 3000k \
    -maxrate 4000k \
    -bufsize 6000k \
    -f null - >/tmp/channeler-qsv-ffmpeg.log 2>&1; then
    log "FFmpeg QSV validation encode passed using VAAPI-derived QSV init"
  else
    fail "FFmpeg QSV validation encode failed: $(tail -n 20 /tmp/channeler-qsv-ffmpeg.log | tr '\n' ' ')"
  fi
fi

if [ "$FAILURES" -gt 0 ]; then
  if [ "$WARN_ONLY" = true ]; then
    log "QSV check completed with ${FAILURES} issue(s); continuing because --warn-only was used"
    exit 0
  fi
  log "QSV check failed with ${FAILURES} issue(s)"
  exit 1
fi

log "QSV check passed"
