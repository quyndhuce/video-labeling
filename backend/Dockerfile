FROM python:3.11-slim

WORKDIR /app

# System dependencies for OpenCV, Pillow, and building native extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ make \
    libgl1-mesa-glx libglib2.0-0 \
    wget curl \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU-only first (smaller image, no CUDA)
RUN pip install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install SAM2 from local source
COPY sam2/ /tmp/sam2/
RUN cd /tmp/sam2 && pip install --no-cache-dir -e . && rm -rf /tmp/sam2/.git

# Install remaining requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download SAM2 checkpoint (small model for CPU)
RUN mkdir -p /app/models && \
    wget -q -O /app/models/sam2.1_hiera_small.pt \
    https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt && \
    echo "[SAM2] Checkpoint downloaded successfully"

# Copy application code
COPY app.py config.py ./
COPY routes/ routes/
COPY models/ models/
COPY utils/ utils/

# Create upload directories
RUN mkdir -p uploads/videos uploads/thumbnails uploads/frames uploads/masks

EXPOSE 6800

CMD ["python", "app.py"]
