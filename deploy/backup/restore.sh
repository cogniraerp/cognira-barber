#!/bin/sh
# Restaura un backup sobre la base actual (¡reemplaza los datos!).
#   restore.sh /backups/barbersaas-20261201-0830.dump
set -eu
: "${PGHOST:=db}" "${PGUSER:=postgres}" "${PGDATABASE:=barbersaas}"
export PGHOST PGUSER PGDATABASE
[ -f "${1:-}" ] || { echo "uso: restore.sh <archivo.dump>" >&2; exit 2; }
echo "Restaurando $1 en $PGDATABASE (se reemplazan los datos)…"
pg_restore --clean --if-exists --no-owner --role=postgres -d "$PGDATABASE" "$1"
echo "Listo."
