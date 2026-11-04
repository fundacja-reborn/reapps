import { type VariantProps, tv } from "tailwind-variants";

export const alertVariants = tv({
	base: "[&>svg]:text-foreground relative w-full rounded-lg border p-4 [&>svg]:absolute [&>svg]:inset-s-4 [&>svg]:top-4 [&>svg~*]:ps-7",
	variants: {
		variant: {
			default: "bg-background text-foreground",
			destructive:
				"border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

export type AlertVariant = VariantProps<typeof alertVariants>["variant"];
