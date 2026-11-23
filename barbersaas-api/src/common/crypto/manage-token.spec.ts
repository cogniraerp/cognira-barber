import { describe, expect, it } from 'vitest';
import { ManageTokenService } from './manage-token';

const svc = (key = Buffer.alloc(32, 1)) =>
  new ManageTokenService({ ENCRYPTION_KEY: key.toString('base64') } as never);
const id = '6f1c2a4e-1b2c-4d3e-8f90-123456789abc';

describe('ManageTokenService', () => {
  it('firma y verifica', () => expect(svc().verify(svc().sign(id))).toBe(id));
  it('rechaza firmas alteradas, ids cambiados y otra clave', () => {
    const tok = svc().sign(id);
    expect(svc().verify(tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A'))).toBeNull();
    expect(svc().verify(tok.replace(id, '6f1c2a4e-1b2c-4d3e-8f90-123456789abd'))).toBeNull();
    expect(svc(Buffer.alloc(32, 2)).verify(tok)).toBeNull();
    expect(svc().verify('basura')).toBeNull();
  });
});
