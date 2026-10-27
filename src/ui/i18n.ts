/**
 * Interface strings. `en` defines the shape; `zh-CN` must provide every key
 * (enforced by the `Messages` type), so a missing translation is a type error,
 * not a blank label in production.
 *
 * Editorial copy about the author (intro, facts, tagline) is not here — it
 * lives in content/site.ts and can be overridden from /admin.
 */
import type { Locale } from '../shared/i18n.ts';

const en = {
  nav: { intro: 'intro', latest: 'latest', topics: 'topics', more: 'more', articles: 'Articles', search: 'Search', moreLink: 'More', home: 'Home' },
  home: {
    scroll: 'Scroll',
    latest: 'Latest',
    featured: 'Featured',
    topics: 'Topics',
    allArticles: 'All articles →',
    allTopics: 'All topics →',
    readArchive: 'Read the archive →',
    nothingYet: 'Nothing published yet.',
    more: 'More',
    learnMore: 'Learn more',
    moreTopics: 'Self-published books · Excerpts · Elsewhere',
    email: 'Email',
  },
  page: { skip: 'Skip to content', language: 'Language' },
  more: {
    title: 'More',
    publications: 'Self-published',
    elsewhere: 'Elsewhere',
    excerpt: 'Excerpt',
    year: 'Year',
    format: 'Format',
    pages: 'Pages',
    pageCount: (n: number) => `${n} pp.`,
    edition: 'Edition',
    size: 'Size',
    order: 'Order a copy',
    ask: 'Ask for a copy',
    askSubject: (title: string) => `About “${title}”`,
    email: 'Email',
    write: 'Write to me',
    scan: 'Scan',
    qrPending: 'QR code',
    open: 'Open',
  },
  articles: {
    title: 'Articles',
    all: 'All',
    tags: 'Tags',
    tagged: (count: number, tag: string) => `${count} ${count === 1 ? 'article' : 'articles'} tagged “${tag}”.`,
    noneTagged: 'No articles with this tag.',
    empty: 'Nothing published yet.',
  },
  article: {
    readingTime: (minutes: number) => `${minutes} min read`,
    contents: 'Contents',
    unavailable: 'This article could not be loaded from Notion right now. Please try again in a moment.',
    previous: 'Previous',
    next: 'Next',
    more: 'More from the archive',
  },
  pager: { label: 'Pagination', newer: '← Newer', older: 'Older →' },
  search: {
    title: 'Search',
    label: 'Search articles',
    placeholder: 'Titles, tags, text…',
    button: 'Search',
    results: (count: number, query: string) => `${count} ${count === 1 ? 'result' : 'results'} for “${query}”.`,
    none: 'Nothing matched. Try a shorter word or a tag.',
  },
  notFound: {
    title: 'Not found',
    heading: 'Behind the curtain',
    body: 'There is nothing at this address — it may have moved, or never existed.',
    allArticles: 'All articles',
  },
};

export type Messages = typeof en;

const zhCN: Messages = {
  nav: { intro: '引言', latest: '最新', topics: '主题', more: '更多', articles: '文章', search: '搜索', moreLink: '更多', home: '首页' },
  home: {
    scroll: '向下滚动',
    latest: '最新',
    featured: '精选',
    topics: '主题',
    allArticles: '全部文章 →',
    allTopics: '全部主题 →',
    readArchive: '浏览全部文章 →',
    nothingYet: '还没有发布任何文章。',
    more: '更多',
    learnMore: '了解更多',
    moreTopics: '自印出版物 · 选读 · 联系方式',
    email: '邮箱',
  },
  page: { skip: '跳到正文', language: '语言' },
  more: {
    title: '更多',
    publications: '自印出版物',
    elsewhere: '联系',
    excerpt: '选读',
    year: '年份',
    format: '形式',
    pages: '页数',
    pageCount: (n) => `${n} 页`,
    edition: '印量',
    size: '尺寸',
    order: '购买',
    ask: '来信索取',
    askSubject: (title) => `关于《${title}》`,
    email: '邮箱',
    write: '写信给我',
    scan: '扫码',
    qrPending: '二维码',
    open: '打开',
  },
  articles: {
    title: '文章',
    all: '全部',
    tags: '标签',
    tagged: (count, tag) => `标签“${tag}”下共有 ${count} 篇文章。`,
    noneTagged: '这个标签下还没有文章。',
    empty: '还没有发布任何文章。',
  },
  article: {
    readingTime: (minutes) => `阅读约 ${minutes} 分钟`,
    contents: '目录',
    unavailable: '暂时无法从 Notion 读取这篇文章，请稍后再试。',
    previous: '上一篇',
    next: '下一篇',
    more: '更多文章',
  },
  pager: { label: '分页', newer: '← 较新', older: '较早 →' },
  search: {
    title: '搜索',
    label: '搜索文章',
    placeholder: '标题、标签或正文…',
    button: '搜索',
    results: (count, query) => `“${query}”共有 ${count} 条结果。`,
    none: '没有找到匹配的内容，试试更短的词或某个标签。',
  },
  notFound: {
    title: '页面不存在',
    heading: '帷幕之后',
    body: '这个地址什么也没有——它可能已经移走，或者从未存在。',
    allArticles: '全部文章',
  },
};

const MESSAGES: Record<Locale, Messages> = { en, 'zh-CN': zhCN };

export const messages = (locale: Locale): Messages => MESSAGES[locale] ?? en;
