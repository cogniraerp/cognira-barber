import { describe, expect, it } from 'vitest';
import { detectImageType } from './image-type';

const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);

describe('detectImageType', () => {
  it('reconoce PNG, JPEG, WEBP e ICO', () => {
    expect(detectImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe('png');
    expect(detectImageType(pad([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(detectImageType(webp)?.ext).toBe('webp');
    expect(detectImageType(pad([0, 0, 1, 0]))?.ext).toBe('ico');
  });

  it('rechaza SVG, HTML y basura aunque se llamen .png', () => {
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('<html><body>hola</body></html>'))).toBeNull();
    expect(detectImageType(Buffer.from('abc'))).toBeNull();
  });
});
