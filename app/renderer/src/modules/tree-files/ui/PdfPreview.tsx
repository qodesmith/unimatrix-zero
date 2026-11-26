import type {PdfFile} from '../pdf'
import type {TreeFile} from '@uz/contract/tree-files'

import {Refusal} from '#modules/bridge/main'
import {Spinner} from '#shadcn/ui/spinner'
import {useEffect, useRef, useState} from 'react'

import {usePdf} from '../preview-queries'

/** Pages this far outside the panel are drawn before they scroll in. */
const DRAW_AHEAD = '100% 0px'

interface PageProps {
  pdf: PdfFile
  number: number
  width: number
}

function Page({pdf, number, width}: PageProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const element = canvas.current

    if (!element) return undefined

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setNear(true)
      },
      {rootMargin: DRAW_AHEAD}
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = canvas.current

    if (!near || !element || width === 0) return undefined

    const drawing = new AbortController()

    pdf.drawPage(number, element, width, drawing.signal).catch(() => {
      // A canceled draw, or a page pdf.js can't draw: it stays blank.
    })

    return () => drawing.abort()
  }, [pdf, number, width, near])

  return (
    <canvas
      ref={canvas}
      aria-label={`Page ${number}`}
      className="w-full rounded-sm border border-border bg-background"
      style={near ? undefined : {aspectRatio: `1 / ${pdf.firstPageRatio}`}}
    />
  )
}

function Pages({pdf}: {pdf: PdfFile}) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!frame) return undefined

    const observer = new ResizeObserver(() => setWidth(frame.clientWidth))

    observer.observe(frame)

    return () => observer.disconnect()
  }, [frame])

  return (
    <div ref={setFrame} className="flex flex-col gap-3">
      {Array.from({length: pdf.pageCount}, (_, index) => (
        <Page key={index} pdf={pdf} number={index + 1} width={width} />
      ))}
    </div>
  )
}

/** Through pdf.js only: never a frame, where Chromium's viewer would show it. */
export function PdfPreview({file}: {file: TreeFile}) {
  const pdf = usePdf(file)

  if (pdf.isPending) return <Spinner />

  if (pdf.isError) return <Refusal error="This PDF can’t be shown here." />

  return <Pages pdf={pdf.data} />
}
