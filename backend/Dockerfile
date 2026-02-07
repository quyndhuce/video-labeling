FROM python:3.11-slim

WORKDIR /app

# System dependencies for Pillow
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py config.py ./
COPY routes/ routes/
COPY models/ models/
COPY utils/ utils/

# Create upload directories
RUN mkdir -p uploads/videos uploads/thumbnails uploads/frames uploads/masks

EXPOSE 6800

CMD ["python", "app.py"]
