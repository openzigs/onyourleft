#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Encodes the menus' music loop (#2057) from the original WAV: "Upbeat Game
# Loop - Aurora Ride" by Venus17, Freesound 841299, Creative Commons 0.
#
#   encode-menu-music.sh <original.wav>           # write the committed file
#   encode-menu-music.sh <original.wav> --check   # encode to a temporary file
#                                                 # and compare it byte for byte
#
# The WAV is not committed: Freesound serves the original only to a signed-in
# account, so it is downloaded by hand from the page below. Its SHA-256 is
# checked before anything is encoded, so a different download is refused
# rather than encoded under this file's name.
#
# Ogg Opus at 96 kbit/s, stereo, 48 kHz (Opus has no 44.1 kHz mode, so the
# input is resampled). ⚠️ The loop must stay seamless: an exact 16 bars at
# 123 bpm. No filter here pads or trims, the encoder's pre-skip (312 samples)
# is written into the header for a decoder to drop, and the last page's
# granule position ends the stream on the last input sample, so a decoder
# gives back exactly as many samples as the resampled input has.
# `menu-music.test.ts` beside this file reads both numbers out of the
# committed file and holds them to that.
#
# `-fflags +bitexact` and `-flags:a +bitexact` leave out the encoder's version
# tag and the random stream serial, so the same input and the same pinned tool
# make the same bytes, which is what --check relies on.
set -euo pipefail

# --- Pins -------------------------------------------------------------------
SOURCE_URL="https://freesound.org/people/Venus17/sounds/841299/"
SOURCE_SHA256="8f4f23f822c32d5d46cd7dc1334841ea474321b6071504acbc2e71b3e29e48b0"
# What ran it. A different libopus may encode differently, so --check is only
# meaningful with this version; ASSETS.toml's `tool` says the same.
PINNED_FFMPEG="ffmpeg version 8.0.1"
PINNED_TOOL="FFmpeg 8.0.1 with libopus 1.6.1"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="${HERE}/../../public/audio/upbeat-game-loop-aurora-ride.ogg"

usage() {
  sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

INPUT="${1:-}"
CHECK=0
if [ -z "${INPUT}" ] || [ "${INPUT}" = "--help" ]; then
  usage
  exit 2
fi
if [ "${2:-}" = "--check" ]; then
  CHECK=1
elif [ -n "${2:-}" ]; then
  usage
  exit 2
fi

if [ ! -f "${INPUT}" ]; then
  echo "encode-menu-music: ${INPUT}: no such file; download the original WAV from ${SOURCE_URL}" >&2
  exit 1
fi

got="$(shasum -a 256 "${INPUT}" | cut -d' ' -f1)"
if [ "${got}" != "${SOURCE_SHA256}" ]; then
  echo "encode-menu-music: ${INPUT}: SHA-256 ${got}, not the original's ${SOURCE_SHA256}; refusing to encode a different file" >&2
  exit 1
fi

version="$(ffmpeg -hide_banner -version | head -n 1)"
case "${version}" in
  "${PINNED_FFMPEG}"*) ;;
  *)
    echo "encode-menu-music: found '${version}', but the committed file was made by ${PINNED_TOOL}; a different encoder makes different bytes" >&2
    exit 1
    ;;
esac

target="${OUTPUT}"
if [ "${CHECK}" -eq 1 ]; then
  scratch="$(mktemp -d)"
  trap 'rm -rf "${scratch}"' EXIT
  target="${scratch}/menu-music.ogg"
fi

mkdir -p "$(dirname "${OUTPUT}")"
ffmpeg -hide_banner -loglevel error -y \
  -i "${INPUT}" \
  -map 0:a:0 -map_metadata -1 \
  -ar 48000 \
  -c:a libopus -b:a 96k -vbr on -compression_level 10 -application audio -frame_duration 20 \
  -fflags +bitexact -flags:a +bitexact \
  "${target}"

if [ "${CHECK}" -eq 1 ]; then
  if cmp -s "${target}" "${OUTPUT}"; then
    echo "encode-menu-music: the committed file is what ${PINNED_TOOL} makes from the original"
  else
    echo "encode-menu-music: the committed file differs from what ${PINNED_TOOL} makes from the original" >&2
    exit 1
  fi
else
  echo "encode-menu-music: wrote ${OUTPUT} ($(wc -c <"${OUTPUT}" | tr -d ' ') bytes); its SHA-256 is $(shasum -a 256 "${OUTPUT}" | cut -d' ' -f1)"
fi
