FROM node:20-alpine

# Install build dependencies for better-sqlite3 and FFmpeg for streaming
# Using system FFmpeg instead of ffmpeg-static for better Docker DNS compatibility
# Hardware acceleration packages:
#   - mesa-va-gallium: AMD VAAPI (Radeon/Vega)
#   - intel-media-driver: Intel VAAPI/QSV (newer Intel GPUs)
#   - libva-intel-driver: Intel VAAPI (older Intel GPUs, Haswell-Skylake)
#   - libva-utils: vainfo tool for debugging
# Note: NVIDIA requires nvidia-container-toolkit on host + --gpus flag
RUN apk add --no-cache python3 make g++ ffmpeg \
    mesa-va-gallium intel-media-driver libva-intel-driver libva-utils

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server/index.js"]
