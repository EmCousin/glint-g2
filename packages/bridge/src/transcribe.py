import os
import sys

import numpy as np
from faster_whisper import WhisperModel


pcm = sys.stdin.buffer.read()
if not pcm:
    raise ValueError("No microphone audio received")

audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
model = WhisperModel(
    os.environ.get("WHISPER_MODEL", "base"),
    device="cpu",
    compute_type="int8",
)
segments, _info = model.transcribe(
    audio,
    language=os.environ.get("WHISPER_LANGUAGE") or None,
    vad_filter=True,
    beam_size=5,
)
sys.stdout.write("".join(segment.text for segment in segments).strip())
