import { cva } from 'class-variance-authority';

/**
 * Botones de la línea Cognira: esquinas de 8 px, objetivo táctil de 44 px (h-11) en el tamaño
 * normal y foco visible en azul "marca". `brand` es el color de la barbería en la página
 * pública; en el panel equivale al azul Cognira.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca-600 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-marca-700 text-white shadow-sm hover:bg-marca-800',
        brand: 'bg-brand text-brand-foreground shadow-sm hover:opacity-90',
        outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        ghost: 'text-slate-700 hover:bg-slate-100',
        destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
        link: 'text-marca-700 underline-offset-4 hover:underline',
      },
      size: { default: 'h-11 px-4', sm: 'h-9 px-3 text-sm', lg: 'h-12 px-6 text-base', icon: 'size-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
