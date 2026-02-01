#!/bin/bash
# Setup script for the transcription backend

set -e

echo "Setting up transcription backend..."

# Step 1: Install basic requirements
echo "Installing basic requirements..."
pip install -r requirements.txt

# Step 2: Install FunASR separately (it has complex dependencies)
echo "Installing FunASR..."
pip install --upgrade funasr modelscope

# Step 3: Verify installation
echo "Verifying installation..."
python -c "import torch; print(f'PyTorch {torch.__version__} installed')"
python -c "import funasr; print(f'FunASR installed successfully')"

echo "Setup complete! You can now run: python transcription_server.py"
