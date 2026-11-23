FROM postgres:17-alpine
RUN apk add --no-cache aws-cli
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
CMD ["backup.sh", "loop"]
