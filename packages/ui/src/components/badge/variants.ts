import { type VariantProps, cva } from 'class-variance-authority';

export const badgeVariants = cva(
	'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground hover:bg-primary/90',
				secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
				destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
				outline: 'text-foreground border border-input'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	}
);

export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
