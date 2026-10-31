/**
 * Built-in tag pairs (English ↔ 简体中文) for common writing topics.
 *
 * Tags in Notion are written once, in whichever language the article uses;
 * these pairs let `Fiction` and `小说` count as one topic, shown as “Fiction”
 * on the English interface and “小说” on the Chinese one. Add your own pairs
 * in /admin → Settings → “Tag pairs” (same format; yours take precedence), or
 * write a tag in Notion as `Fiction / 小说`.
 *
 * Format: `English names = 中文名`, several names per side separated by
 * commas; the first one is the label used when the archive itself does not
 * use any name of that language for the topic.
 */
export const BUILTIN_TAG_GLOSSARY = `
Fiction = 小说
Short story, Short stories = 短篇小说
Essay, Essays = 随笔, 散文
Poetry, Poem, Poems = 诗歌, 诗
Notes, Note = 笔记, 札记
Diary, Journal = 日记
Review, Reviews = 评论
Book review, Book reviews = 书评
Translation, Translations = 翻译
Interview, Interviews = 访谈
Reading, Books = 阅读, 读书
Film, Cinema, Movies = 电影
Music = 音乐
Photography, Photos = 摄影
Travel = 旅行
Art = 艺术
Memoir = 回忆录
Letters, Letter = 书信
Theatre, Theater, Drama = 戏剧
Philosophy = 哲学
Else, Other, Others, Misc = 其他
History = 历史
City, Cities = 城市
Dreams, Dream = 梦
Self-publishing, Zine, Zines = 自出版, 独立出版
Life = 生活
Technology, Tech = 科技, 技术
Writing = 写作
`;
