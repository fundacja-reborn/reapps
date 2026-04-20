type ClassValue = ClassArray | ClassDictionary | string | number | null | boolean | undefined;
type ClassDictionary = Record<string, any>;
type ClassArray = ClassValue[];

/**
 * Combines class names conditionally
 * Similar to clsx but lightweight implementation
 */
export function cn(...inputs: ClassValue[]): string {
  let i = 0;
  let tmp;
  let str = '';
  const len = inputs.length;

  for (; i < len; i++) {
    if ((tmp = inputs[i])) {
      if (typeof tmp === 'string') {
        str && (str += ' ');
        str += tmp;
      } else if (typeof tmp === 'number') {
        str && (str += ' ');
        str += tmp;
      } else if (Array.isArray(tmp)) {
        if ((tmp = cn.apply(null, tmp))) {
          str && (str += ' ');
          str += tmp;
        }
      } else if (typeof tmp === 'object') {
        for (const key in tmp) {
          if (tmp[key]) {
            str && (str += ' ');
            str += key;
          }
        }
      }
    }
  }

  return str;
}

/**
 * Merge class names with Tailwind CSS conflict resolution
 * Last class wins for conflicting utilities
 */
export function twMerge(...inputs: ClassValue[]): string {
  const classes = cn(...inputs);
  if (!classes) return '';

  // Simple implementation - for full tailwind-merge functionality,
  // the actual library should be used
  const classArray = classes.split(' ');
  const classMap = new Map<string, string>();

  // Group classes by their prefix (e.g., 'text-', 'bg-', 'p-', etc.)
  classArray.forEach(cls => {
    if (!cls) return;
    
    // Handle arbitrary value classes like p-[10px]
    const match = cls.match(/^(.+?)-(?:\[.+\]|.+)$/);
    if (match) {
      const prefix = match[1];
      classMap.set(prefix, cls);
    } else {
      // Handle classes without prefixes
      classMap.set(cls, cls);
    }
  });

  return Array.from(classMap.values()).join(' ');
}

/**
 * Creates a class name string from a template literal
 */
export function tw(strings: TemplateStringsArray, ...values: any[]): string {
  let result = '';
  
  strings.forEach((string, i) => {
    result += string;
    if (i < values.length) {
      result += values[i];
    }
  });
  
  return result.trim().replace(/\s+/g, ' ');
}

/**
 * Checks if a class name exists in a string
 */
export function hasClass(classString: string, className: string): boolean {
  return classString.split(' ').includes(className);
}

/**
 * Adds a class to a class string if it doesn't exist
 */
export function addClass(classString: string, className: string): string {
  if (hasClass(classString, className)) {
    return classString;
  }
  return cn(classString, className);
}

/**
 * Removes a class from a class string
 */
export function removeClass(classString: string, className: string): string {
  return classString
    .split(' ')
    .filter(cls => cls !== className)
    .join(' ');
}

/**
 * Toggles a class in a class string
 */
export function toggleClass(classString: string, className: string, force?: boolean): string {
  if (force === undefined) {
    return hasClass(classString, className) 
      ? removeClass(classString, className)
      : addClass(classString, className);
  }
  
  return force 
    ? addClass(classString, className)
    : removeClass(classString, className);
}
