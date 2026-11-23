#!/bin/sh
# Sube el código al servidor y lo (re)construye. Correr desde la raíz del proyecto:
#   SERVER=root@IP sh deploy/scripts/deploy.sh
# deploy/.env vive solo en el servidor: no se sube ni se borra.
set -eu
: "${SERVER:?Define SERVER=usuario@ip}"
DEST="${DEST:-/opt/cognira}"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude storage --exclude coverage \
  --exclude playwright-report --exclude test-results --exclude '.env' --exclude '.env.*' \
  --exclude 'src/generated' --exclude '*.log' --exclude tsconfig.tsbuildinfo \
  barbersaas-api barbersaas-web deploy "$SERVER:$DEST/"
ssh "$SERVER" "cd $DEST/deploy && test -f .env || { echo 'Falta $DEST/deploy/.env (copia .env.example)'; exit 1; }; docker compose up -d --build && docker image prune -f >/dev/null && docker compose ps"
