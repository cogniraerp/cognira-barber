import { describe, expect, it } from 'vitest';
import { decodeText } from './customers.controller';
import { parseBirthday } from './customers.service';

describe('parseBirthday', () => {
  it.each([
    ['1990-05-17', '1990-05-17'],
    ['17/05/1990', '1990-05-17'],
    ['7/5/1990', '1990-05-07'],
    ['17-05-1990', '1990-05-17'],
  ])('%s', (raw, iso) => expect(parseBirthday(raw)?.toISOString().slice(0, 10)).toBe(iso));
  it.each(['31/02/1990', '1990-13-01', '05/17/1990', '1800-01-01', '2999-01-01', 'mañana'])(
    'rechaza %s',
    (raw) => expect(parseBirthday(raw)).toBeNull(),
  );
});

describe('decodeText', () => {
  it('UTF-8 y Latin-1 de Excel', () => {
    expect(decodeText(Buffer.from('Peña', 'utf8'))).toBe('Peña');
    expect(decodeText(Buffer.from([0x50, 0x65, 0xf1, 0x61]))).toBe('Peña');
  });
});
