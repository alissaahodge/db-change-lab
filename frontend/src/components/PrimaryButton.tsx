import type { ComponentProps } from 'react';

type PrimaryButtonProps = Omit<ComponentProps<'button'>, 'className'>;

export function PrimaryButton({
  children,
  type = 'button',
  ...props
}: PrimaryButtonProps) {
  return (
    <button {...props} type={type} className="primary">
      {children} <span aria-hidden="true">↗</span>
    </button>
  );
}
