FROM node:20-alpine

# Install git and rsync (required by pando CLI)
RUN apk add --no-cache git rsync bash

# Configure git for test operations
RUN git config --global user.email "test@example.com" && \
    git config --global user.name "Test User" && \
    git config --global init.defaultBranch main

# Create working directory
WORKDIR /app

# Keep container running for exec commands
CMD ["tail", "-f", "/dev/null"]
