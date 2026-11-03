import type {TooltipValueType} from 'recharts'

import {cn} from 'cn'
import * as React from 'react'
import * as RechartsPrimitive from 'recharts'

// Format: [THEME_NAME, CSS_SELECTOR]
const THEMES = [
  ['light', ''],
  ['dark', "[data-mode='dark']"],
] as const

const INITIAL_DIMENSION = {width: 320, height: 200} as const

type TooltipNameType = number | string

type CssVariables = React.CSSProperties &
  Record<`--${string}`, string | undefined>

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | {color?: string; theme?: never}
    | {color?: never; theme: Record<(typeof THEMES)[number][0], string>}
  )
>

interface ChartContextProps {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />')
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >['children']
  initialDimension?: {
    width: number
    height: number
  }
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id ?? uniqueId.replaceAll(':', '')}`
  const contextValue = React.useMemo(() => ({config}), [config])

  return (
    <ChartContext.Provider value={contextValue}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          // oxlint-disable-next-line uz/no-hardcoded-colors -- the [stroke=...] selectors match recharts' default strokes so Theme tokens replace them
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer
          initialDimension={initialDimension}
        >
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

function ChartStyle({id, config}: {id: string; config: ChartConfig}) {
  const colorConfig = Object.entries(config).filter(
    ([, itemConfig]) => itemConfig.theme ?? itemConfig.color
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style>
      {THEMES.map(
        ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme] ?? itemConfig.color

    return color ? `  --color-${key}: ${color};` : null
  })
  .join('\n')}
}
`
      ).join('\n')}
    </style>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: 'line' | 'dot' | 'dashed'
    nameKey?: string
    labelKey?: string
  } & Omit<
    RechartsPrimitive.DefaultTooltipContentProps<
      TooltipValueType,
      TooltipNameType
    >,
    'accessibilityLayer'
  >) {
  const {config} = useChart()

  const tooltipLabel = React.useMemo(() => {
    const items = payload ?? []
    const [item] = items

    if (hideLabel || !item) {
      return null
    }

    const key = String(labelKey ?? item.dataKey ?? item.name ?? 'value')
    const itemConfig = getPayloadConfigFromPayload(config, item, key)

    const value =
      !labelKey && isString(label)
        ? (config[label]?.label ?? label)
        : itemConfig?.label

    if (labelFormatter) {
      return (
        <div className={cn('font-medium', labelClassName)}>
          {labelFormatter(value, items)}
        </div>
      )
    }

    if (!value) {
      return null
    }

    return <div className={cn('font-medium', labelClassName)}>{value}</div>
  }, [
    label,
    labelFormatter,
    payload,
    hideLabel,
    labelClassName,
    config,
    labelKey,
  ])

  if (!active || !payload?.length) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== 'dot'

  return (
    <div
      className={cn(
        'grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        className
      )}
    >
      {nestLabel ? null : tooltipLabel}
      <div className="grid gap-1.5">
        {payload
          .filter(item => item.type !== 'none')
          .map((item, index) => {
            const key = String(nameKey ?? item.name ?? item.dataKey ?? 'value')
            const itemConfig = getPayloadConfigFromPayload(config, item, key)

            return (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- rows can share every key recharts gives them, and each render rebuilds the list
                key={index}
                className={cn(
                  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
                  indicator === 'dot' && 'items-center'
                )}
              >
                {formatter && item.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    <ChartTooltipIndicator
                      item={item}
                      icon={itemConfig?.icon}
                      color={color}
                      indicator={indicator}
                      hideIndicator={hideIndicator}
                      nestLabel={nestLabel}
                    />
                    <div
                      className={cn(
                        'flex flex-1 justify-between leading-none',
                        nestLabel ? 'items-end' : 'items-center'
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">
                          {itemConfig?.label ?? item.name}
                        </span>
                      </div>
                      {item.value !== undefined && (
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {formatValue(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: React.ComponentProps<'div'> & {
  hideIcon?: boolean
  nameKey?: string
} & RechartsPrimitive.DefaultLegendContentProps) {
  const {config} = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className
      )}
    >
      {payload
        .filter(item => item.type !== 'none')
        .map((item, index) => {
          const key = String(nameKey ?? item.dataKey ?? 'value')
          const itemConfig = getPayloadConfigFromPayload(config, item, key)

          return (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- rows can share every key recharts gives them, and each render rebuilds the list
              key={index}
              className={cn(
                'flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground'
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              {itemConfig?.label}
            </div>
          )
        })}
    </div>
  )
}

function ChartTooltipIndicator({
  item,
  icon: Icon,
  color,
  indicator,
  hideIndicator,
  nestLabel,
}: {
  item: RechartsPrimitive.TooltipPayloadEntry
  icon: React.ComponentType | undefined
  color: string | undefined
  indicator: 'line' | 'dot' | 'dashed'
  hideIndicator: boolean
  nestLabel: boolean
}) {
  if (Icon) {
    return <Icon />
  }

  if (hideIndicator) {
    return null
  }

  const indicatorColor = color ?? item.payload?.fill ?? item.color

  const style: CssVariables = {
    '--color-bg': indicatorColor,
    '--color-border': indicatorColor,
  }

  return (
    <div
      className={cn(
        'shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)',
        {
          'h-2.5 w-2.5': indicator === 'dot',
          'w-1': indicator === 'line',
          'w-0 border-[1.5px] border-dashed bg-transparent':
            indicator === 'dashed',
          'my-0.5': nestLabel && indicator === 'dashed',
        }
      )}
      style={style}
    />
  )
}

function formatValue(value: TooltipValueType) {
  return isNumber(value) ? value.toLocaleString() : String(value)
}

function isNumber(value: TooltipValueType): value is number {
  return typeof value === 'number'
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload:
    | RechartsPrimitive.TooltipPayloadEntry
    | RechartsPrimitive.LegendPayload,
  key: string
) {
  const itemValue = new Map(Object.entries(payload)).get(key)
  const dataValue = new Map(Object.entries(payload.payload ?? {})).get(key)

  let configLabelKey = key

  if (isString(itemValue)) {
    configLabelKey = itemValue
  } else if (isString(dataValue)) {
    configLabelKey = dataValue
  }

  return configLabelKey in config ? config[configLabelKey] : config[key]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
}
