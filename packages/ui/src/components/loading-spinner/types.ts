import type { HTMLAttributes } from "svelte/elements";
import type { WithElementRef } from "bits-ui";

export type LoadingSpinnerProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
	size?: 'sm' | 'md' | 'lg';
};
