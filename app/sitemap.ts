import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/services", "/products", "/about", "/contact", "/build", "/factory"];

  return routes.map((route, index) => ({
    url: `https://airealsolutions.com${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: index === 0 ? 1 : route === "/build" ? 0.95 : route === "/factory" ? 0.9 : 0.8,
  }));
}
