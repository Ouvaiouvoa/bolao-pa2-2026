#!/usr/bin/env bash
# Downloads the on-premise models into CMF_MODELS_DIR (default ./.models):
#  - ASR: NVIDIA Parakeet TDT 0.6B v3 (int8, sherpa-onnx export) — 25 European languages incl. pt.
#  - TTS: Piper pt_BR "faber" voice — used ONLY to regenerate the test fixture (npm run fixture:generate).
# Sources: github.com/k2-fsa/sherpa-onnx releases. Models are not committed to git.
set -euo pipefail
DIR="${CMF_MODELS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/.models}"
BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download"
mkdir -p "$DIR"
fetch() {
  local url="$1" name="$2"
  if [ -d "$DIR/$name" ]; then echo "✓ $name já instalado"; return; fi
  echo "↓ $name"
  curl -fSL --retry 4 --retry-delay 2 "$url" | tar xj -C "$DIR"
  echo "✓ $name ($(du -sh "$DIR/$name" | cut -f1))"
}
fetch "$BASE/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
if [ "${CMF_SKIP_TTS:-0}" != "1" ]; then
  fetch "$BASE/tts-models/vits-piper-pt_BR-faber-medium.tar.bz2" "vits-piper-pt_BR-faber-medium"
fi
echo "sha256 (registre no inventário de modelos):"
sha256sum "$DIR"/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/*.onnx | sed "s#$DIR/##"
