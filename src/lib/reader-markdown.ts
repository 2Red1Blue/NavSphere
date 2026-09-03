import GithubSlugger from 'github-slugger'
import { toString } from 'mdast-util-to-string'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

export interface ReaderHeading {
  id: string
  text: string
  level: number
  /** Source offset lets the renderer reuse the exact AST-derived slug. */
  sourceOffset?: number
}

export interface ReaderContentMetadata {
  content?: string | null
  content_quality?: string | null
  content_format?: string | null
  fulltext_publication_allowed?: boolean | number | null
}

const readerParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter)

/**
 * Normalize transport-level differences without rewriting Markdown semantics.
 * Frontmatter is removed only when remark recognizes a complete leading block.
 */
export function normalizeReaderMarkdown(
  raw: string,
  articleTitle?: string,
  articleSummary?: string,
): string {
  const source = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')

  const tree = readerParser.parse(source)
  const firstNode = tree.children[0]
  const frontmatterEnd = firstNode?.type === 'yaml'
    ? firstNode.position?.end.offset
    : undefined
  const body = frontmatterEnd === undefined
    ? source
    : source.slice(frontmatterEnd)

  const normalizedBody = body.replace(/^\n+|\n+$/g, '')
  let withoutDuplicateTitle = normalizedBody
  if (articleTitle) {
    const bodyTree = readerParser.parse(normalizedBody)
    const leadingNode = bodyTree.children[0]
    if (
      leadingNode?.type === 'heading'
      && leadingNode.depth === 1
      && toString(leadingNode).trim() === articleTitle.trim()
      && leadingNode.position?.end.offset !== undefined
    ) {
      withoutDuplicateTitle = normalizedBody
        .slice(leadingNode.position.end.offset)
        .replace(/^\n+/, '')
    }
  }

  return stripTrailingGeneratedSummary(withoutDuplicateTitle, articleSummary)
}

function visibleHeadingText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const value = node as {
    type?: string
    value?: string
    url?: string
    children?: unknown[]
  }
  if (value.type === 'text' || value.type === 'inlineCode') return value.value ?? ''
  if (value.type === 'footnoteReference') return ''
  if (value.type === 'link') {
    const url = value.url ?? ''
    if (/^#(?:fn|fnref|user-content-fn)/i.test(url)) return ''
  }
  return (value.children ?? []).map(visibleHeadingText).join('')
}

function normalizedComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripTrailingGeneratedSummary(markdown: string, articleSummary?: string): string {
  if (!articleSummary?.trim()) return markdown

  const tree = readerParser.parse(markdown)
  let lastHeadingIndex = -1
  for (let index = tree.children.length - 1; index >= 0; index -= 1) {
    if (tree.children[index]?.type === 'heading') {
      lastHeadingIndex = index
      break
    }
  }
  if (lastHeadingIndex < 0) return markdown

  const heading = tree.children[lastHeadingIndex]
  if (
    heading.type !== 'heading'
    || heading.depth !== 2
    || visibleHeadingText(heading).trim() !== 'AI 摘要'
    || heading.position?.start.offset === undefined
  ) {
    return markdown
  }

  const firstTrailingNode = tree.children[lastHeadingIndex + 1]
  if (
    !firstTrailingNode
    || normalizedComparableText(toString(firstTrailingNode))
      !== normalizedComparableText(articleSummary)
  ) {
    return markdown
  }

  const generatedMetadata = /^(?:核心观点|核心方法论|评分)\s*:/
  const remainingNodes = tree.children.slice(lastHeadingIndex + 2)
  if (remainingNodes.some((node) => (
    node.type !== 'paragraph'
    || !generatedMetadata.test(normalizedComparableText(toString(node)))
  ))) {
    return markdown
  }

  return markdown.slice(0, heading.position.start.offset).replace(/\n+$/, '')
}

/** Extract the visible h2-h4 outline from parsed Markdown, excluding code. */
export function extractMarkdownHeadings(markdown: string): ReaderHeading[] {
  const headings: ReaderHeading[] = []
  const slugger = new GithubSlugger()
  const tree = readerParser.parse(markdown)

  visit(tree, 'heading', (node) => {
    if (node.depth < 2 || node.depth > 4) return

    const text = visibleHeadingText(node).replace(/<[^>]*>/g, '').trim()
    if (!text) return

    headings.push({
      id: slugger.slug(text),
      text,
      level: node.depth,
      sourceOffset: node.position?.start.offset,
    })
  })

  return headings
}

/** Full text is public only when every field in the content contract agrees. */
export function canRenderFullContent(metadata: ReaderContentMetadata): boolean {
  return Boolean(
    metadata.content?.trim()
      && metadata.content_quality === 'verified_fulltext'
      && metadata.content_format === 'markdown_v1'
      && (metadata.fulltext_publication_allowed === true
        || metadata.fulltext_publication_allowed === 1),
  )
}
