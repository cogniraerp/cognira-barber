import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { LegalShell } from './legal-shell';
import { LEGAL_UPDATED, useLegal } from './use-legal';

function Prose({ children }: { children: ReactNode }) {
  return (
    <article className="grid gap-4 rounded-xl border bg-white p-6 text-sm leading-relaxed text-slate-700 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
      {children}
    </article>
  );
}

/** Términos y condiciones del servicio (contrato con las barberías que usan Cognira Barber). */
export function TermsPage() {
  const l = useLegal();
  return (
    <LegalShell title="Términos y condiciones" subtitle={`Vigentes desde el ${LEGAL_UPDATED}`}>
      <Prose>
        <p>
          Estos términos regulan el uso de {l.tradeName}, software de gestión y reservas para barberías que ofrece{' '}
          <strong>{l.legalName}</strong> (RUC {l.ruc}), con domicilio en {l.address} («Cognira»). Al crear una cuenta, aceptas estos términos y la{' '}
          <Link to="/privacidad" className="underline">Política de privacidad</Link>.
        </p>
        <h2>1. El servicio</h2>
        <p>
          Cognira da a cada barbería un panel para gestionar su agenda, clientes, caja, inventario y comisiones, y una página pública de reservas.
          Las funciones disponibles dependen del plan contratado.
        </p>
        <h2>2. Cuentas</h2>
        <ul>
          <li>Debes dar datos veraces y mantener tu contraseña en reserva. Eres responsable de lo que se haga con tu cuenta.</li>
          <li>El titular (dueño) de cada barbería decide quién entra a su panel y con qué permisos.</li>
        </ul>
        <h2>3. Planes, pagos y prueba gratuita</h2>
        <ul>
          <li>Los precios están en soles (PEN) e incluyen los impuestos que correspondan. La suscripción se paga por adelantado, mensual o anual.</li>
          <li>Si una factura no se paga, avisamos por correo y WhatsApp; pasados los días de gracia, el panel se suspende hasta regularizar el pago. Tus datos no se borran por la suspensión.</li>
          <li>Puedes cambiar de plan desde Configuración → Suscripción. Al subir de plan se cobra la diferencia proporcional; al bajar, el cambio rige desde el siguiente periodo.</li>
        </ul>
        <h2>4. Cobros a tus clientes</h2>
        <p>
          Si conectas tu pasarela de pagos (por ejemplo, Mercado Pago o Izipay), el dinero va directo a tu cuenta en esa pasarela. Cognira no lo recibe
          ni cobra comisión por esas operaciones. La relación con tus clientes (precios, adelantos, devoluciones y comprobantes) es tuya.
        </p>
        <h2>5. Tus datos y los de tus clientes</h2>
        <p>
          Los datos que registras siguen siendo tuyos. Respecto de los datos de tus clientes, tú eres el titular del banco de datos y Cognira actúa
          como encargado del tratamiento, según la Ley N.° 29733 y su reglamento. Detalles en la Política de privacidad.
        </p>
        <h2>6. Uso aceptable</h2>
        <p>No puedes usar el servicio para enviar spam, suplantar a terceros, vulnerar la seguridad del sistema ni para fines ilícitos.</p>
        <h2>7. Disponibilidad y responsabilidad</h2>
        <p>
          Trabajamos para que el servicio esté disponible y respaldamos la información a diario, pero puede haber interrupciones por mantenimiento o
          causas ajenas. En lo que la ley permita, la responsabilidad de Cognira se limita al monto pagado por el servicio en los últimos 3 meses.
        </p>
        <h2>8. Baja</h2>
        <p>Puedes cancelar tu suscripción cuando quieras. Podrás descargar tus datos durante 30 días; luego se eliminan, salvo lo que la ley obligue a conservar.</p>
        <h2>9. Reclamos y ley aplicable</h2>
        <p>
          Puedes escribirnos a {l.email} o registrar un reclamo en nuestro{' '}
          <Link to="/libro-reclamaciones" className="underline">Libro de Reclamaciones</Link>. Estos términos se rigen por las leyes del Perú.
        </p>
      </Prose>
    </LegalShell>
  );
}

/** Política de privacidad (Ley N.° 29733 de Protección de Datos Personales y su reglamento). */
export function PrivacyPage() {
  const l = useLegal();
  return (
    <LegalShell title="Política de privacidad" subtitle={`Vigente desde el ${LEGAL_UPDATED}`}>
      <Prose>
        <p>
          <strong>{l.legalName}</strong> (RUC {l.ruc}), con domicilio en {l.address}, es responsable del tratamiento de los datos personales de las
          personas que crean una cuenta en {l.tradeName}, conforme a la Ley N.° 29733 y su reglamento (D.S. N.° 016-2024-JUS).
        </p>
        <h2>1. Qué datos tratamos</h2>
        <ul>
          <li><strong>Usuarios del panel:</strong> nombre, correo, teléfono, contraseña (guardada cifrada, nunca en claro) y registros de acceso.</li>
          <li><strong>Barberías:</strong> razón social, RUC, dirección, datos de facturación y del plan.</li>
          <li><strong>Clientes de las barberías:</strong> nombre, celular, correo (si lo dan), historial de citas y compras, y las notas que registre la barbería.</li>
        </ul>
        <h2>2. Para qué los usamos</h2>
        <ul>
          <li>Dar el servicio: agenda, reservas, recordatorios, caja y reportes.</li>
          <li>Facturar y cobrar la suscripción, y avisar de pagos pendientes.</li>
          <li>Seguridad, prevención de fraude y cumplimiento de obligaciones legales.</li>
        </ul>
        <p>No vendemos datos personales ni los usamos para publicidad de terceros.</p>
        <h2>3. Clientes de las barberías</h2>
        <p>
          Cuando reservas en la página de una barbería, esa barbería es la titular de tus datos y Cognira los trata por encargo suyo, solo para gestionar
          tus citas y avisos. Para ejercer tus derechos, puedes dirigirte a la barbería o escribirnos.
        </p>
        <h2>4. Con quién los compartimos</h2>
        <p>Con proveedores que nos ayudan a dar el servicio, bajo contrato y solo para ese fin:</p>
        <ul>
          <li>alojamiento de servidores y almacenamiento de archivos (pueden estar fuera del Perú: es un flujo transfronterizo);</li>
          <li>envío de correos y mensajes de WhatsApp;</li>
          <li>pasarelas de pago, cuando la barbería o el cliente pagan en línea.</li>
        </ul>
        <h2>5. Cuánto tiempo</h2>
        <p>Mientras la cuenta esté activa y, después, el tiempo que exijan las normas tributarias y de protección al consumidor.</p>
        <h2>6. Tus derechos</h2>
        <p>
          Puedes pedir acceso, rectificación, cancelación u oposición (derechos ARCO) escribiendo a {l.email} con una copia de tu documento de identidad.
          Respondemos en los plazos de ley. Si no estás conforme, puedes reclamar ante la Autoridad Nacional de Protección de Datos Personales del
          Ministerio de Justicia y Derechos Humanos.
        </p>
        <h2>7. Seguridad</h2>
        <p>
          Usamos conexiones cifradas, contraseñas con hash, credenciales de integraciones cifradas y aislamiento de datos entre barberías a nivel de base
          de datos.
        </p>
        <h2>8. Almacenamiento local</h2>
        <p>La app guarda en tu navegador tu sesión y preferencias (por ejemplo, el idioma). No usamos cookies de publicidad.</p>
      </Prose>
    </LegalShell>
  );
}
