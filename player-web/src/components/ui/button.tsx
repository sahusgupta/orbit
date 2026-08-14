import { Button as BaseButton } from '@base-ui/react/button';
import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'danger';
type ButtonSize = 'default' | 'compact';

export function buttonClassName(tone: ButtonTone = 'primary', size: ButtonSize = 'default', className = '') {
  return `button button--${tone} button--${size} ${className}`.trim();
}

export function Button({
  tone = 'primary',
  size = 'default',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: ButtonSize }) {
  return <BaseButton type={type} className={buttonClassName(tone, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  children,
  tone = 'primary',
  size = 'default',
  className = '',
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  children: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
}) {
  return <Link href={href} className={buttonClassName(tone, size, className)} {...props}>{children}</Link>;
}
