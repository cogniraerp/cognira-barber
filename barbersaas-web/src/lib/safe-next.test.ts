import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('acepta rutas internas', () => expect(safeNext('/s/el-clasico?x=1')).toBe('/s/el-clasico?x=1'));
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', null])('rechaza %s', (v) =>
    expect(safeNext(v)).toBeNull(),
  );
});
