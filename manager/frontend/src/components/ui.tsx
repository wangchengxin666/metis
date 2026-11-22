import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { MoreHorizontal, X } from 'lucide-react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'emerald'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variants: Record<string, string> = {
      default: 'brand-btn-primary shadow-xs font-medium',
      secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700/80',
      outline: 'border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-800/80 text-zinc-200',
      ghost: 'hover:bg-zinc-800/70 text-zinc-300 hover:text-zinc-100',
      destructive: 'bg-rose-600/90 text-white hover:bg-rose-500 shadow-xs font-medium',
      emerald: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-xs font-medium',
    }
    const sizes: Record<string, string> = {
      default: 'h-10 px-4 py-2 text-sm',
      sm: 'h-9 px-3.5 text-sm',
      lg: 'h-11 px-6 text-base',
      icon: 'h-9 w-9',
    }
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--brand-radius-md)] transition-all brand-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--brand-radius-lg)] border border-zinc-800/90 bg-zinc-900/75 text-zinc-100 shadow-sm backdrop-blur-xs',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-5 sm:p-6', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-semibold leading-snug tracking-tight text-base', className)} {...props} />
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-zinc-400 leading-relaxed', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6 pt-0', className)} {...props} />
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
}) {
  const variants: Record<string, string> = {
    default: 'brand-btn-primary',
    secondary: 'bg-zinc-800 text-zinc-200 border border-zinc-700/80',
    outline: 'text-zinc-300 border border-zinc-700/80 bg-zinc-900/50',
    success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    destructive: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--brand-radius-sm)] px-2.5 py-0.5 text-xs font-medium transition-colors',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/90 px-3.5 py-2 text-sm text-zinc-100 shadow-xs transition-colors placeholder:text-zinc-500 brand-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[88px] w-full rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/90 px-3.5 py-2.5 text-sm text-zinc-100 shadow-xs placeholder:text-zinc-500 brand-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-10 w-full rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-950/90 px-3.5 py-2 text-sm text-zinc-100 shadow-xs brand-ring',
      className,
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-sm font-medium leading-none text-zinc-300 select-none', className)}
      {...props}
    />
  )
}

export function Progress({ value = 0, className }: { value?: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  const barColor =
    clamped > 85 ? 'bg-rose-500' : clamped > 65 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-zinc-800', className)}>
      <div
        className={cn('h-full transition-all duration-300', barColor)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxWidth = 'max-w-2xl',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  maxWidth?: string
}) {
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={cn(
          'relative w-full rounded-[var(--brand-radius-lg)] border border-zinc-800 bg-zinc-900 p-6 sm:p-7 shadow-2xl max-h-[92vh] overflow-y-auto',
          maxWidth,
        )}
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-800/80">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
            {description && <p className="text-sm text-zinc-400 mt-1 leading-relaxed">{description}</p>}
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export interface ActionMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  dividerBefore?: boolean
}

export function ActionMenu({
  items,
  header,
  label = 'More actions',
  trigger,
}: {
  items: ActionMenuItem[]
  header?: React.ReactNode
  label?: string
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number; openUp: boolean }>({
    top: 0,
    right: 0,
    openUp: false,
  })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScrollOrResize = (e: Event) => {
      if (e.type === 'scroll' && menuRef.current && menuRef.current.contains(e.target as Node)) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const openUp = spaceBelow < 260 && rect.top > 260
      const menuMinWidth = 208
      const maxRight = Math.max(12, window.innerWidth - menuMinWidth)
      setPos({
        top: openUp ? rect.top - 6 : rect.bottom + 6,
        right: Math.max(12, Math.min(maxRight, window.innerWidth - rect.right)),
        openUp,
      })
    }
    setOpen((v) => !v)
  }

  return (
    <div className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={handleToggle}
        className={cn(
          trigger
            ? 'inline-flex items-center cursor-pointer'
            : 'inline-flex h-9 w-9 items-center justify-center rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100 transition-colors cursor-pointer',
        )}
      >
        {trigger || <MoreHorizontal className="h-4 w-4" />}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              transform: pos.openUp ? 'translateY(-100%)' : undefined,
            }}
            className="z-[70] min-w-48 rounded-[var(--brand-radius-md)] border border-zinc-800 bg-zinc-900 p-1.5 shadow-2xl animate-in fade-in duration-100"
          >
            {header && (
              <div className="px-2.5 py-2 border-b border-zinc-800/80 mb-1 text-xs text-zinc-400">
                {header}
              </div>
            )}
            {items.map((item, idx) => (
              <React.Fragment key={`${item.label}-${idx}`}>
                {item.dividerBefore && <div className="my-1 border-t border-zinc-800/80" />}
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onClick()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[var(--brand-radius-sm)] px-2.5 py-2 text-sm transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed',
                    item.danger
                      ? 'text-rose-400 hover:bg-rose-950/50'
                      : 'text-zinc-200 hover:bg-zinc-800/80',
                  )}
                >
                  {item.icon && <span className="shrink-0">{item.icon}</span>}
                  <span className="truncate">{item.label}</span>
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
