import axios from "axios";
import * as cheerio from "cheerio";

const SCRAPER_KEY = "f9ea79e7589a5989220a0c27509c0bf0";

function scraperUrl(targetUrl, render = false, timeout = 25000) {
    let url = `http://api.scraperapi.com/?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(targetUrl)}`;
    if (render) url += `&render=true&timeout=${timeout}`;
    return url;
}

async function fetchHtml(targetUrl, render = false, renderTimeout = 25000, axiosTimeout = 35000) {
    const { data } = await axios.get(scraperUrl(targetUrl, render, renderTimeout), { timeout: axiosTimeout });
    return data;
}

export default async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const action = req.query.action;

    // ===================== SEARCH =====================
    if (action === "search") {
        const query = req.query.query || req.query.q;
        if (!query) return res.json({ status: false, error: "query required" });
        try {
            const html = await fetchHtml(`https://animeclub2.com/?s=${encodeURIComponent(query)}`);
            const $ = cheerio.load(html);
            const results = [];
            $("article").each((i, el) => {
                const title = $(el).find("h2.entry-title a, .title a").text().trim();
                const link = $(el).find("h2.entry-title a, .title a").attr("href") || "";
                const image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || "";
                const type = link.includes("/movies/") ? "Movie" : "Anime";
                if (title && link) results.push({ title, link, image, type });
            });
            return res.json({ status: true, data: results });
        } catch (err) {
            return res.json({ status: false, error: err.message });
        }
    }

    // ===================== DETAILS =====================
    if (action === "details") {
        const url = req.query.url;
        if (!url) return res.json({ status: false, error: "url required" });

        const is_tv_show = url.includes("/tvshows/");

        // Try up to 2 times (ScraperAPI render sometimes needs a retry)
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                // Longer render timeout for episode-heavy pages
                const html = await fetchHtml(url, true, 30000, 40000);
                const $ = cheerio.load(html);

                const title = $("meta[property='og:title']").attr("content") ||
                              $("h1.entry-title").text().trim() || "";
                const image = $("img[itemprop='image']").attr("src") ||
                              $("meta[property='og:image']").attr("content") || "";

                const episodes = [];
                if (is_tv_show) {
                    // Primary selector
                    $("a.ep-card-link").each((i, el) => {
                        const ep_num = $(el).find(".ep-number").text().trim();
                        const ep_title = $(el).find(".ep-title").text().trim();
                        const ep_link = $(el).attr("href") || "";
                        if (ep_link) episodes.push({ ep_num, title: ep_title, link: ep_link });
                    });

                    // Fallback selectors if primary fails
                    if (!episodes.length) {
                        $("a[href*='/episodes/']").each((i, el) => {
                            const href = $(el).attr("href") || "";
                            const text = $(el).text().trim();
                            if (href && text) episodes.push({ ep_num: `Episode ${i + 1}`, title: text, link: href });
                        });
                    }
                }

                const movie_links = [];
                if (!is_tv_show) {
                    $("tr[id^='link-']").each((i, el) => {
                        const quality = $(el).find("strong.quality").text().trim();
                        const href = $(el).find("a").attr("href") || "";
                        if (quality && href) movie_links.push({ quality, link: href });
                    });

                    // Fallback
                    if (!movie_links.length) {
                        $("a[href*='/links/']").each((i, el) => {
                            const href = $(el).attr("href") || "";
                            const text = $(el).text().trim() || `Link ${i + 1}`;
                            if (href) movie_links.push({ quality: text, link: href });
                        });
                    }
                }

                // If TV show but no episodes found, retry
                if (is_tv_show && !episodes.length && attempt < 2) {
                    console.log(`Attempt ${attempt}: no episodes found, retrying...`);
                    continue;
                }

                return res.json({ status: true, data: { title, image, is_tv_show, episodes, movie_links } });

            } catch (err) {
                if (attempt === 2) return res.json({ status: false, error: err.message });
                console.log(`Attempt ${attempt} failed: ${err.message}, retrying...`);
            }
        }
    }

    // ===================== EPISODE =====================
    if (action === "episode") {
        const url = req.query.url;
        if (!url) return res.json({ status: false, error: "url required" });

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const html = await fetchHtml(url, true, 30000, 40000);
                const $ = cheerio.load(html);

                const links = [];
                $("tr[id^='link-']").each((i, el) => {
                    const quality = $(el).find("strong.quality").text().trim();
                    const href = $(el).find("a").attr("href") || "";
                    if (quality && href) links.push({ quality, link: href });
                });

                if (!links.length) {
                    $("a[href*='/links/']").each((i, el) => {
                        const href = $(el).attr("href") || "";
                        const text = $(el).text().trim() || `Link ${i + 1}`;
                        if (href) links.push({ quality: text, link: href });
                    });
                }

                if (!links.length && attempt < 2) {
                    console.log(`Attempt ${attempt}: no episode links, retrying...`);
                    continue;
                }

                return res.json({ status: true, data: links });
            } catch (err) {
                if (attempt === 2) return res.json({ status: false, error: err.message });
            }
        }
    }

    // ===================== DOWNLOAD =====================
    if (action === "download") {
        const url = req.query.url;
        if (!url) return res.json({ status: false, error: "url required" });
        try {
            const html = await fetchHtml(url, true, 25000, 35000);
            const $ = cheerio.load(html);
            const download_links = [];

            $("a[href*='drive.google.com'], a[href*='drive.usercontent.google.com']").each((i, el) => {
                const href = $(el).attr("href") || "";
                const text = $(el).text().trim() || `Link ${i + 1}`;
                if (href) download_links.push({ quality: text, direct_link: href });
            });

            if (!download_links.length) {
                $("a[href*='thenuxgdrive'], a[href*='netlify.app']").each((i, el) => {
                    const href = $(el).attr("href") || "";
                    const text = $(el).text().trim() || `Link ${i + 1}`;
                    if (href) download_links.push({ quality: text, direct_link: href });
                });
            }

            if (!download_links.length) {
                $("a[href^='http']").each((i, el) => {
                    const href = $(el).attr("href") || "";
                    if (href && !href.includes("animeclub2.com") && !href.includes("scraperapi")) {
                        download_links.push({ quality: $(el).text().trim() || `Link ${i + 1}`, direct_link: href });
                    }
                });
            }

            return res.json({ status: true, results: download_links.length, download_links });
        } catch (err) {
            return res.json({ status: false, error: err.message });
        }
    }

    return res.json({ status: true, message: "AnimeClub API", actions: ["search", "details", "episode", "download"] });
};
