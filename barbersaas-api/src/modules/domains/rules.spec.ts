import { describe, expect, it } from 'vitest';
import { evaluateDns, instructions, isApex, normalizeDomain } from './rules';

const root = 'cognirabarber.pe';

describe('normalizeDomain', () => {
  it('limpia protocolo, ruta, puerto, mayúsculas y punto final', () => {
    expect(normalizeDomain(' https://Reservas.ElBarbas.PE:443/agenda ', root)).toEqual({
      ok: true,
      domain: 'reservas.elbarbas.pe',
    });
    expect(normalizeDomain('elbarbas.com.', root)).toEqual({ ok: true, domain: 'elbarbas.com' });
  });
  it('rechaza IPs, nombres inválidos y nuestro propio dominio', () => {
    expect(normalizeDomain('192.168.1.1', root).ok).toBe(false);
    expect(normalizeDomain('localhost', root).ok).toBe(false);
    expect(normalizeDomain('-malo.pe', root).ok).toBe(false);
    expect(normalizeDomain('a..pe', root).ok).toBe(false);
    expect(normalizeDomain('el-clasico.cognirabarber.pe', root).ok).toBe(false);
    expect(normalizeDomain('', root).ok).toBe(false);
  });
});

describe('instrucciones y verificación DNS', () => {
  it('subdominio → CNAME; dominio raíz (también .com.pe) → A', () => {
    expect(isApex('reservas.elbarbas.pe')).toBe(false);
    expect(isApex('elbarbas.pe')).toBe(true);
    expect(isApex('elbarbas.com.pe')).toBe(true);
    const i = instructions('reservas.elbarbas.pe', 'tok', 'el-barbas.cognirabarber.pe', [
      '1.2.3.4',
    ]);
    expect(i.txt).toEqual({
      name: '_cognira-verify.reservas.elbarbas.pe',
      value: 'cognira-verify=tok',
    });
    expect(i.point).toEqual({
      type: 'CNAME',
      name: 'reservas.elbarbas.pe',
      value: 'el-barbas.cognirabarber.pe',
    });
    expect(instructions('elbarbas.pe', 'tok', 'x', ['1.2.3.4']).point).toMatchObject({
      type: 'A',
      value: '1.2.3.4',
    });
  });

  it('pide el TXT exacto y que el dominio apunte a nosotros (CNAME o A)', () => {
    const target = 'el-barbas.cognirabarber.pe';
    const base = { txt: [['cognira-verify=tok']], cname: [], a: [], targetA: ['1.2.3.4'] };
    expect(evaluateDns({ ...base, cname: ['EL-BARBAS.cognirabarber.pe.'] }, 'tok', target).ok).toBe(
      true,
    );
    expect(evaluateDns({ ...base, a: ['1.2.3.4'] }, 'tok', target).ok).toBe(true);
    const noPoint = evaluateDns({ ...base, a: ['9.9.9.9'] }, 'tok', target);
    expect(noPoint).toMatchObject({ ok: false, txtOk: true, pointOk: false });
    expect(noPoint.error).toMatch(/no apunta/);
    const noTxt = evaluateDns(
      { ...base, txt: [['cognira-verify=otro']], a: ['1.2.3.4'] },
      'tok',
      target,
    );
    expect(noTxt).toMatchObject({ ok: false, txtOk: false });
    // TXT largo partido en trozos
    expect(
      evaluateDns({ ...base, txt: [['cognira-ver', 'ify=tok']], a: ['1.2.3.4'] }, 'tok', target)
        .txtOk,
    ).toBe(true);
  });
});
