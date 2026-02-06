#!/usr/bin/env python3
"""Inspect callable methods on a loaded TTS model.

Usage examples:
  # List all public callable attributes + signatures
  python inspect_model.py

  # Show signature and docstring for a specific method
  python inspect_model.py --method generate

  # Use a different model id
  python inspect_model.py --model mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit
"""

import argparse
import inspect
import sys

from mlx_audio.tts.utils import load_model


def list_callables(model):
    """Print public callable members of `model` with signatures."""
    members = [(n, m) for n, m in inspect.getmembers(model, predicate=callable) if not n.startswith("_")]
    if not members:
        print("No public callables found on the model.")
        return

    for name, member in members:
        try:
            sig = inspect.signature(member)
        except (ValueError, TypeError):
            sig = "(signature unknown)"
        print(f"{name}{sig}")


def show_method(model, method_name):
    """Show signature and docstring for a named method on `model`."""
    member = getattr(model, method_name, None)
    if member is None:
        print(f"No attribute named '{method_name}' on model.")
        return

    try:
        sig = inspect.signature(member)
    except (ValueError, TypeError):
        sig = "(signature unknown)"

    doc = inspect.getdoc(member) or "(no docstring available)"

    print(f"Method: {method_name}")
    print(f"Signature: {sig}\n")
    print("Docstring:\n")
    print(doc)


def main():
    parser = argparse.ArgumentParser(description="Inspect callable methods on a TTS model")
    parser.add_argument("--model", default="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit", help="Model id to load")
    parser.add_argument("--method", help="If provided, show signature and docstring for this method")
    args = parser.parse_args()

    print(f"Loading model: {args.model}")
    try:
        model = load_model(args.model)
    except Exception as e:
        print("Failed to load model:\n", e, file=sys.stderr)
        sys.exit(1)

    print(f"Model loaded: {type(model)}\n")

    if args.method:
        show_method(model, args.method)
    else:
        print("Public callable methods and signatures:\n")
        list_callables(model)
        print("\nTip: use --method <name> to view a method's docstring and signature")


if __name__ == "__main__":
    main()

# from mlx_audio.tts.utils import load_model

# model = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit")

# print(model.get_supported_languages())