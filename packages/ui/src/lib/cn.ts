import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names, with later Tailwind utilities winning over earlier ones.
 *
 * Plain `clsx` would leave both `p-2` and `p-4` in the output and let CSS source
 * order decide — which makes component props unreliable overrides. `twMerge`
 * resolves the conflict in favour of the caller.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
