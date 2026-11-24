import type {Database} from '#modules/database/main'
import type {ExtractionResult} from '#modules/extraction/main'
import type {Extraction} from '@uz/contract/extraction'

import {schema} from '#modules/database/main'
import {extractionCandidate} from '#modules/extraction/main'
import {EXTRACTOR_VERSION} from '@uz/contract/extraction'
import {and, eq, isNotNull} from 'drizzle-orm'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  EXTRACTED_TEXT_NAME,
  exists,
  extractionPath,
  extractionsPath,
  isFolder,
  pageImageName,
} from './originals'
import {extractionOf} from './prompts'

/** Never throws for the window's sake: a failure comes back as `failed`. */
export type Extractor = (bytes: Uint8Array) => Promise<ExtractionResult>

type ReadResult = Extract<ExtractionResult, {type: 'read'}>

interface ExtractionDeps {
  db: Pick<Database, 'select'>
  dir: string
  extract: Extractor
}

const FAILED: Extraction = {status: 'failed', version: EXTRACTOR_VERSION}

/** True when it wrote a text file: a scan may have no text at all. */
async function writeFiles(folder: string, result: ReadResult) {
  const file = {mode: 0o600, flag: 'wx'}
  const hasText = /\S/u.test(result.text)
  await fs.mkdir(folder, {mode: 0o700})

  if (hasText) {
    await fs.writeFile(
      path.join(folder, EXTRACTED_TEXT_NAME),
      result.text,
      file
    )
  }

  for (const {page, bytes} of result.pageImages) {
    await fs.writeFile(path.join(folder, pageImageName(page)), bytes, file)
  }

  return hasText
}

/** Loses a race to an identical job by taking the folder it placed. */
async function moveIntoPlace(temporary: string, target: string) {
  try {
    await fs.rename(temporary, target)
  } catch (error) {
    if (!(await exists(target))) throw error
  }
}

async function keepExtraction(
  dir: string,
  sha256: string,
  result: ReadResult
): Promise<Extraction> {
  const target = extractionPath(dir, sha256, EXTRACTOR_VERSION)
  await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700})
  const temporary = path.join(extractionsPath(dir), `.${randomUUID()}.tmp`)

  try {
    const text = await writeFiles(temporary, result)
    await moveIntoPlace(temporary, target)

    return {
      status: 'read',
      version: EXTRACTOR_VERSION,
      text,
      pageImages: result.pageImages.map(({page}) => page),
      imagesStopped: result.imagesStopped,
    }
  } finally {
    await fs.rm(temporary, {recursive: true, force: true})
  }
}

/** Another add of the same bytes read by this extractor, its files in place. */
async function reusable({db, dir}: ExtractionDeps, sha256: string) {
  const rows = db
    .select({extraction: schema.attachments.extraction})
    .from(schema.attachments)
    .where(
      and(
        eq(schema.attachments.sha256, sha256),
        isNotNull(schema.attachments.extraction)
      )
    )
    .all()

  for (const row of rows) {
    const extraction = extractionOf(row)

    if (
      extraction?.status === 'read' &&
      extraction.version === EXTRACTOR_VERSION &&
      (await isFolder(extractionPath(dir, sha256, EXTRACTOR_VERSION)))
    ) {
      return extraction
    }
  }

  return null
}

async function extracted(
  deps: ExtractionDeps,
  sha256: string,
  bytes: Uint8Array
) {
  const result = await deps.extract(bytes)

  switch (result.type) {
    case 'read':
      return keepExtraction(deps.dir, sha256, result)
    case 'unsupported':
      return null
    case 'failed':
      return FAILED
    default:
      throw new Error('Unknown extraction result.')
  }
}

/**
 * Null when the bytes are none of the formats; never throws, so a file that
 * can't be read still attaches and goes by its path.
 */
export async function extractionFor(
  deps: ExtractionDeps,
  file: {sha256: string; bytes: Uint8Array}
): Promise<Extraction | null> {
  if (extractionCandidate(file.bytes) === null) return null

  try {
    return (
      (await reusable(deps, file.sha256)) ??
      (await extracted(deps, file.sha256, file.bytes))
    )
  } catch {
    return FAILED
  }
}
