/** Correo al dueño cuando el WhatsApp de su barbería se desvincula (sin I/O). */
export function disconnectedEmail(p: { shopName: string; phone: string | null; url: string }) {
  return {
    subject: `El WhatsApp de ${p.shopName} se desconectó`,
    body: [
      'Hola:',
      '',
      `El WhatsApp de ${p.shopName}${p.phone ? ` (${p.phone})` : ''} se desvinculó de Cognira Barber.`,
      'Mientras tanto, las confirmaciones y los recordatorios quedan en el Registro para que los envíes a mano.',
      '',
      'Para reconectarlo, entra aquí y vuelve a escanear el código QR con el celular de la barbería:',
      p.url,
      '',
      'Suele pasar si se cerró la sesión en "Dispositivos vinculados", se cambió de celular o el teléfono estuvo apagado muchos días.',
      '',
      'Cognira Barber',
    ].join('\n'),
  };
}
