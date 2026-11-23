#!/bin/sh
# Imprime secretos nuevos para deploy/.env (cópialos y guárdalos en tu gestor de contraseñas).
set -eu
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "APP_DB_PASSWORD=$(openssl rand -hex 24)"
echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)"
