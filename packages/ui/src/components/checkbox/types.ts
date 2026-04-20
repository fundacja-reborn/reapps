import type { WithElementRef } from "bits-ui";
import type { HTMLInputAttributes } from "svelte/elements";
import { Checkbox as CheckboxPrimitive } from "bits-ui";

export type CheckboxProps = WithElementRef<HTMLInputAttributes> &
	CheckboxPrimitive.RootProps;