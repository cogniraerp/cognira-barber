import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    RequestContext.run(
      { requestId, ip: req.ip, userAgent: req.header('user-agent')?.slice(0, 300) },
      next,
    );
  }
}
