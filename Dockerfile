# Playwright's own image ships Node.js + Chromium + every system library
# chromium.launch() needs (libnss3, libatk, libgbm, fonts, ...). The tag must
# match the installed playwright version exactly (checked via package-lock.json).
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# Railway injects PORT at runtime; src/server.js already reads process.env.PORT.
EXPOSE 5177

CMD ["node", "src/server.js"]
