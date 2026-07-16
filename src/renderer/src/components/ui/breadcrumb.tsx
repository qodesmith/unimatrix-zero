import type {ComponentProps} from 'react'

import {mergeProps} from '@base-ui/react/merge-props'
import {useRender} from '@base-ui/react/use-render'
import {ChevronRightIcon, MoreHorizontalIcon} from 'lucide-react'

import {cn} from '@/lib/utils'

function Breadcrumb({className, ...props}: ComponentProps<'nav'>) {
  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      className={cn(className)}
      {...props}
    />
  )
}

function BreadcrumbList({className, ...props}: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm wrap-break-word',
        className
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({className, ...props}: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  )
}

function BreadcrumbLink({
  className,
  render,
  ...props
}: useRender.ComponentProps<'a'>) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>(
      {
        className: cn('hover:text-foreground transition-colors', className),
      },
      props
    ),
    render,
    state: {
      slot: 'breadcrumb-link',
    },
  })
}

function BreadcrumbPage({className, ...props}: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the span element is part of the public API (ComponentProps<'span'>) and the current page is intentionally a non-navigable anchor stand-in
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn('text-foreground font-normal', className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn('[&>svg]:size-3.5', className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  )
}

function BreadcrumbEllipsis({className, ...props}: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn(
        'flex size-5 items-center justify-center [&>svg]:size-4',
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}
