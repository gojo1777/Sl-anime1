import axios from "axios";
import * as cheerio from "cheerio";

const SCRAPER_API_KEY = "f9ea79e7589a5989220a0c27509c0bf0";

function scraperUrl(targetUrl, render = false) {
  const timeout = render ? "&timeout=25000" : "";
  return `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}${render ? "&render=true" : ""}${timeout}&url=${encodeURIComponent(targetUrl)}`;
}

export default async function handler(req, res) {
  try {
    const { action, query, url } = req.query;

    if (!action) return res.status(400).json({ status: false, message: "action missing" });

    // 1. Search
    if (action === "search") {
      const { data } = await axios.get(scraperUrl(`https://animeclub2.com/?s=${encodeURIComponent(query)}`));
      const $ = cheerio.load(data);
      const results = [];
      $("article").each((i, el) => {
        results.push({
          title: $(el).find(".title").text().trim(),
          link: $(el).find("a").attr("href"),
          image: $(el).find("img").attr("src"),
          type: $(el).find(".sh_type").text().trim() || "Anime"
        });
      });
      return res.json({ status: true, data: results });
    }

    // 2. Details — ONE render=true request only
    if (action === "details" || action === "anime") {
      const { data } = await axios.get(scraperUrl(url, true));
      const $ = cheerio.load(data);

      const title = $("meta[property='og:title']").attr("content") ?? "";
      const image = $("img[itemprop='image']").attr("src") ?? "";

      const episodes = [];
      $("a.ep-card-link").each((i, el) => {
        const link = $(el).attr("href") ?? "";
        const epNum = $(el).find(".ep-number").text().trim();
        const epTitle = $(el).find(".ep-title").text().trim();
        if (link) episodes.push({ ep_num: epNum, title: epTitle, link });
      });

      const movie_links = [];
      $("tr[id^='link-']").each((i, el) => {
        const link = $(el).find("a[href*='/links/']").attr("href");
        const quality = $(el).find("strong.quality").text().trim() || "Download";
        if (link && !movie_links.some(l => l.link === link)) {
          movie_links.push({ quality, link });
        }
      });

      return res.json({
        status: true,
        data: {
          title,
          image,
          is_tv_show: episodes.length > 0,
          episodes: episodes.length > 0 ? episodes : null,
          movie_links: movie_links.length > 0 ? movie_links : null
        }
      });
    }

    // 3. Download — render=true to bypass ad countdown
    if (action === "download") {
      // Direct /links/ URL
      if (url.includes("/links/")) {
        const { data: linkHtml } = await axios.get(scraperUrl(url, true));
        const driveMatch = linkHtml.match(/https:\/\/drive\.google\.com\/[a-zA-Z0-9?%=\-_/.]+/);
        if (driveMatch) {
          const fileId = driveMatch[0].match(/[-\w]{25,}/);
          if (fileId) {
            const directLink = `https://drive.usercontent.google.com/download?id=${fileId[0]}&export=download&authuser=0`;
            return res.json({ status: true, results: 1, download_links: [{ quality: "Download", direct_link: directLink }] });
          }
        }
        return res.json({ status: true, results: 0, download_links: [] });
      }

      // Episode/movie page — find /links/ then resolve
      const { data: pageHtml } = await axios.get(scraperUrl(url, true));
      const $page = cheerio.load(pageHtml);
      const linkPages = [];
      $page("a[href*='/links/']").each((i, el) => {
        const rowLink = $page(el).attr("href");
        const quality = $page(el).closest("tr").find("strong.quality").text().trim() || "Download";
        if (rowLink && !linkPages.some(p => p.rowLink === rowLink)) {
          linkPages.push({ quality, rowLink });
        }
      });

      const final_links = [];
      for (const item of linkPages) {
        try {
          const { data: linkHtml } = await axios.get(scraperUrl(item.rowLink, true));
          const driveMatch = linkHtml.match(/https:\/\/drive\.google\.com\/[a-zA-Z0-9?%=\-_/.]+/);
          if (driveMatch) {
            const fileId = driveMatch[0].match(/[-\w]{25,}/);
            if (fileId) {
              const directLink = `https://drive.usercontent.google.com/download?id=${fileId[0]}&export=download&authuser=0`;
              if (!final_links.some(l => l.direct_link === directLink)) {
                final_links.push({ quality: item.quality, direct_link: directLink });
              }
            }
          }
        } catch (e) { continue; }
      }
      return res.json({ status: true, results: final_links.length, download_links: final_links });
    }

    return res.status(400).json({ status: false, message: "invalid action" });

  } catch (err) {
    return res.status(500).json({ status: false, error: err.message });
  }
}
