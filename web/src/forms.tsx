// Form primitives in the Geist style, shared by the login card, the wizard and Settings.
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cx } from './ui'

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex h-8 items-center justify-center rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-50',
        variant === 'primary' && 'bg-gray-1000 text-background-100 hover:opacity-90',
        variant === 'secondary' && 'border border-gray-alpha-400 bg-background-100 hover:bg-gray-alpha-100',
        variant === 'danger' && 'bg-red-700 text-white hover:opacity-90',
        className,
      )}
    />
  )
}

export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId() // unique per field, so two forms on one page never share ids
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-gray-900">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'h-8 w-full rounded-md border border-gray-alpha-400 bg-background-100 px-2.5 text-[13px] outline-none focus:border-gray-700',
        className,
      )}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        'h-8 w-full rounded-md border border-gray-alpha-400 bg-background-100 px-2 text-[13px] outline-none focus:border-gray-700',
        className,
      )}
    />
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[12px] text-red-900">
      {children}
    </p>
  )
}
