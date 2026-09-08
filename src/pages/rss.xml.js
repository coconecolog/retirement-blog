import rss from "@astrojs/rss";
import { getAllPosts } from "@/lib/posts";
import { SITE_NAME, SITE_DESCRIPTION } from "@/consts";

export async function GET(context) {
  const posts = getAllPosts();
  return rss({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts.map((post) => ({
      title: post.title,
      description: post.description,
      pubDate: new Date(post.publishedAt),
      link: `/blog/${post.slug}`,
      categories: post.tags,
    })),
    customData: `<language>ja</language>`,
  });
}
