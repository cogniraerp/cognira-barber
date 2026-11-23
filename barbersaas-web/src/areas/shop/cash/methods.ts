import { ArrowDownLeft, ArrowUpRight, Banknote, CreditCard, Landmark, LogOut, QrCode, Receipt, RotateCcw, ShoppingBag, Smartphone, Wallet, type LucideIcon } from 'lucide-react';

export type Method = 'cash' | 'yape' | 'plin' | 'card' | 'transfer' | 'other' | 'online';
export const METHOD: Record<Method, { label: string; icon: LucideIcon }> = {
  cash: { label: 'Efectivo', icon: Banknote },
  yape: { label: 'Yape', icon: Smartphone },
  plin: { label: 'Plin', icon: Smartphone },
  card: { label: 'Tarjeta', icon: CreditCard },
  transfer: { label: 'Transferencia', icon: Landmark },
  other: { label: 'Otro', icon: Wallet },
  online: { label: 'En línea', icon: QrCode },
};
/** Métodos que se eligen a mano (el pago "En línea" solo nace de un cobro por link/QR pagado). */
export const METHOD_ORDER: Method[] = ['cash', 'yape', 'plin', 'card', 'transfer', 'other'];
/** Para filtros y reportes. */
export const ALL_METHODS: Method[] = [...METHOD_ORDER, 'online'];

export type Kind = 'income' | 'expense' | 'withdrawal' | 'sale' | 'refund';
/** Entradas suman a la caja; salidas restan. Icono + texto, nunca solo color. */
export const KIND: Record<Kind, { label: string; icon: LucideIcon; in: boolean; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  sale: { label: 'Venta', icon: ShoppingBag, in: true, tone: 'info' },
  income: { label: 'Ingreso', icon: ArrowDownLeft, in: true, tone: 'success' },
  expense: { label: 'Egreso', icon: Receipt, in: false, tone: 'warning' },
  withdrawal: { label: 'Retiro', icon: LogOut, in: false, tone: 'neutral' },
  refund: { label: 'Devolución', icon: RotateCcw, in: false, tone: 'danger' },
};
export const OUT_ICON = ArrowUpRight;

/** Conceptos frecuentes (sugerencias, no obligatorios). */
export const CONCEPTS: Record<'income' | 'expense' | 'withdrawal', string[]> = {
  income: ['Pago adelantado', 'Cambio (sencillo)', 'Otro ingreso'],
  expense: ['Compra de insumos', 'Limpieza', 'Pago de servicios', 'Movilidad', 'Almuerzo del equipo'],
  withdrawal: ['Depósito al banco', 'Retiro del dueño', 'Pago a proveedor'],
};
