#!/bin/sh
# Backup diario de Postgres (pg_dump, formato custom comprimido).
#   backup.sh now   → un backup ahora
#   backup.sh loop  → todos los días a las 03:30 de Lima (08:30 UTC)
# Copia local en /backups (se conservan BACKUP_KEEP_DAYS días) y, si hay BACKUP_S3_BUCKET,
# una copia fuera del servidor (Cloudflare R2 / S3).
set -eu
: "${PGHOST:=db}" "${PGUSER:=postgres}" "${PGDATABASE:=barbersaas}" "${BACKUP_KEEP_DAYS:=14}"
export PGHOST PGUSER PGDATABASE

run_backup() {
  ts=$(date -u +%Y%m%d-%H%M)
  file="/backups/${PGDATABASE}-${ts}.dump"
  echo "[backup] $(date -u +%FT%TZ) → $file"
  pg_dump -Fc -Z 6 -f "$file.part"
  mv "$file.part" "$file"
  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    endpoint=""
    [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint="--endpoint-url $BACKUP_S3_ENDPOINT"
    # shellcheck disable=SC2086
    aws s3 cp $endpoint --only-show-errors "$file" "s3://${BACKUP_S3_BUCKET}/postgres/$(basename "$file")"
    echo "[backup] copia subida a s3://${BACKUP_S3_BUCKET}/postgres/"
  fi
  find /backups -name "${PGDATABASE}-*.dump" -mtime "+${BACKUP_KEEP_DAYS}" -delete
}

case "${1:-loop}" in
  now) run_backup ;;
  loop)
    while true; do
      now=$(date -u +%s)
      target=$(date -u -d "$(date -u +%Y-%m-%d) 08:30:00" +%s)
      [ "$now" -ge "$target" ] && target=$((target + 86400))
      echo "[backup] próximo backup en $(( (target - now) / 60 )) min"
      sleep $((target - now))
      run_backup || echo "[backup] ERROR: falló el backup" >&2
    done
    ;;
  *) echo "uso: backup.sh now|loop" >&2; exit 2 ;;
esac
