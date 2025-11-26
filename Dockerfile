FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Expose port (Railway will override this, but good practice)
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
