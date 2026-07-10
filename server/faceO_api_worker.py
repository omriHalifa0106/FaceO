#!/usr/bin/env python3
"""
faceO_api_worker.py — Thin extraction wrapper used by faceRecognitionService.ts

Usage:
    python3 faceO_api_worker.py --mode extract --image /path/to/image.jpg

Outputs a JSON array to stdout, one object per detected face:
[
  {
    "region":    { "x": 10, "y": 20, "w": 80, "h": 80 },
    "embedding": [0.123, ...]          // 512-dim ArcFace vector
  },
  ...
]

If no faces are found OR the image can't be read, outputs [].
All diagnostic messages go to stderr so Node can parse stdout cleanly.
"""

import sys
import json
import argparse
import numpy as np

MODEL_NAME = "ArcFace"
DETECTOR   = "retinaface"


def cosine_distance(v1, v2):
    v1 = np.array(v1)
    v2 = np.array(v2)
    denom = np.linalg.norm(v1) * np.linalg.norm(v2)
    if denom == 0:
        return 1.0
    return float(1 - np.dot(v1, v2) / denom)


def extract_embeddings(image_path: str):
    """Return list of {region, embedding} dicts for every face in the image."""
    try:
        from deepface import DeepFace
    except ImportError:
        print("[worker] deepface not installed", file=sys.stderr)
        return []

    try:
        # We enforce detection so the model doesn't try to extract a face from a landscape
        faces = DeepFace.represent(
            img_path=image_path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR,
            enforce_detection=True, 
        )
    except ValueError:
        # DeepFace raises a ValueError when no face is found if enforce_detection=True
        # This is expected behavior for landscape photos, so we just return an empty array silently
        return []
    except Exception as e:
        # Catch actual errors (like file not found, bad format, etc.) and print them to stderr
        print(f"[worker] DeepFace error: {e}", file=sys.stderr)
        return []

    results = []
    for face in faces:
        results.append({
            "region":    face.get("facial_area", {}),
            "embedding": face.get("embedding", []),
        })
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode",  required=True, choices=["extract"])
    parser.add_argument("--image", required=True)
    args = parser.parse_args()

    if args.mode == "extract":
        data = extract_embeddings(args.image)
        print(json.dumps(data))