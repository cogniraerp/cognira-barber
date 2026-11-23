import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { Prisma } from '../../generated/prisma/client';
import { AppError, ErrorCode } from './app-error';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  instance?: string;
  errors?: Array<{ path: string; message: string }>;
  [k: string]: unknown;
}

const HTTP_CODE: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
};

/** Respuestas de error en formato RFC 9457 (application/problem+json). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const problem = toProblem(exception);
    problem.instance = req.originalUrl;

    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}

export function toProblem(e: unknown): ProblemDetails {
  if (e instanceof AppError) {
    return { ...e.details, type: 'about:blank', title: e.message, status: e.status, code: e.code };
  }
  if (e instanceof ZodValidationException) {
    const zodError = e.getZodError() as { issues: Array<{ path: PropertyKey[]; message: string }> };
    return {
      type: 'about:blank',
      title: 'Datos inválidos',
      status: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_FAILED,
      errors: zodError.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.message,
      })),
    };
  }
  if (e instanceof HttpException) {
    const status = e.getStatus();
    return {
      type: 'about:blank',
      title: e.message,
      status,
      code: HTTP_CODE[status] ?? ErrorCode.INTERNAL,
    };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      return {
        type: 'about:blank',
        title: 'Registro duplicado',
        status: 409,
        code: ErrorCode.CONFLICT,
      };
    }
    if (e.code === 'P2025') {
      return {
        type: 'about:blank',
        title: 'No encontrado',
        status: 404,
        code: ErrorCode.NOT_FOUND,
      };
    }
  }
  return {
    type: 'about:blank',
    title: 'Error interno',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL,
  };
}
