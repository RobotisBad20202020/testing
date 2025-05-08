# Use a base image with Node and Debian tools
FROM node:18-slim

# Install poppler-utils (for pdf-poppler to work)
RUN apt-get update && \
    apt-get install -y poppler-utils && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the entire project
COPY . .

# Create output directory for OCR images (optional, can also be dynamic)
RUN mkdir -p output_images

# Expose the port your app uses
EXPOSE 3000

# Start your app
CMD ["node", "index.js"]
