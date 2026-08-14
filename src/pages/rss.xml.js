import rss from '@astrojs/rss';
import { getAllPosts } from '../lib/notion';
import { SITE } from '../lib/site.config';

export async function GET(context) {
  const posts = await getAllPosts();
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items: posts.map((post) => ({
      title: post.title,
      description: post.excerpt,
      pubDate: new Date(post.publishedAt),
      link: `/blog/${post.slug}`,
      categories: post.tags,
    })),
    customData: `<language>ja-jp</language>`,
  });
}
