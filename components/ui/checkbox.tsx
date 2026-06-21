// Minimal checkbox — used by the conversation sidebar for batch selection.
// Not a full shadcn component; just enough for our use case.

import * as React from 'react';
import { cn } from '@/lib/utils';

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        type="checkbox"
        ref={ref}
        className={cn(
          'h-4 w-4 rounded border border-input accent-primary cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        {...props}
      />
    );
  },
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
