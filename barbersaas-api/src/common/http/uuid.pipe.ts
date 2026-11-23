import { Injectable, PipeTransform } from '@nestjs/common';
import { AppError } from '../errors/app-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida :id en la ruta. Un id mal formado responde 404 (no 500 por error de cast en Postgres). */
@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) throw AppError.notFound('Recurso');
    return value.toLowerCase();
  }
}
