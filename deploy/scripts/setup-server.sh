#!/bin/sh
# Prepara un VPS Ubuntu 24.04 nuevo (correr UNA vez, como root):
#   ssh root@IP 'sh -s' < deploy/scripts/setup-server.sh
# Instala Docker, abre solo SSH/HTTP/HTTPS, crea 2 GB de swap y activa las actualizaciones de seguridad.
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl ufw rsync unattended-upgrades
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
dpkg-reconfigure -f noninteractive unattended-upgrades
mkdir -p /opt/cognira
echo "Listo. Ahora, desde tu máquina: SERVER=root@IP sh deploy/scripts/deploy.sh"
