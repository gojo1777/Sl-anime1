const axios = require("axios");
const cheerio = require("cheerio");

const SCRAPER_KEY = "f9ea79e7589a5989220a0c27509c0bf0";

function scraperUrl(targetUrl, render = false, timeout = 25000) {
    let url = `http://api.scraperapi.com/?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(targetUrl)}`;
    if (render) url += `&render=true&timeout=${timeout}`;
    return url;
}

module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const action = req.query.action;

    // ===================== SEARCH =====================
    if (action === "search") {
        const query = req.query.query || req.query.q;
        if (!query) return res.json({ status: false, error: "query required" });

        try {
            const searchUrl = `https://animeclub2.com/?s=${encodeURIComponent(query)}`;
            const { data: html } = await axios.get(scraperUrl(searchUrl), { timeout: 30000 });
            const $ = cheerio.load(html);

            const results = [];
            $("article").each((i, el) => {
                const title = $(el).find("h2.entry-title a, .title a").text().trim() ||
                              $(el).find("meta[property='og:title']").attr("content") || "";
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

        try {
            const { data: html } = await axios.get(scraperUrl(url, true, 25000), { timeout: 30000 });
            const $ = cheerio.load(html);

            const title = $("meta[property='og:title']").attr("content") ||
                          $("h1.entry-title").text().trim() || "";
            const image = $("img[itemprop='image']").attr("src") ||
                          $("meta[property='og:image']").attr("content") || "";

            const is_tv_show = url.includes("/tvshows/");

            const episodes = [];
            if (is_tv_show) {
                $("a.ep-card-link").each((i, el) => {
                    const ep_num = $(el).find(".ep-number").text().trim();
                    const ep_title = $(el).find(".ep-title").text().trim();
                    const ep_link = $(el).attr("href") || "";
                    if (ep_link) episodes.push({ ep_num, title: ep_title, link: ep_link });
                });
            }

            const movie_links = [];
            if (!is_tv_show) {
                $("tr[id^='link-']").each((i, el) => {
                    const quality = $(el).find("strong.quality").text().trim();
                    const href = $(el).find("a").attr("href") || "";
                    if (quality && href) movie_links.push({ quality, link: href });
                });
            }

            return res.json({
                status: true,
                data: { title, image, is_tv_show, episodes, movie_links }
            });
        } catch (err) {
            return res.json({ status: false, error: err.message });
        }
    }

    // ===================== EPISODE (NEW) =====================
    if (action === "episode") {
        const url = req.query.url;
        if (!url) return res.json({ status: false, error: "url required" });

        try {
            const { data: html } = await axios.get(scraperUrl(url, true, 25000), { timeout: 30000 });
            const $ = cheerio.load(html);

            const links = [];
            $("tr[id^='link-']").each((i, el) => {
                const quality = $(el).find("strong.quality").text().trim();
                const href = $(el).find("a").attr("href") || "";
                if (quality && href) links.push({ quality, link: href });
            });

            // Fallback selectors if table not found
            if (!links.length) {
                $("a[href*='/links/']").each((i, el) => {
                    const href = $(el).attr("href") || "";
                    const text = $(el).text().trim() || `Link ${i + 1}`;
                    if (href) links.push({ quality: text, link: href });
                });
            }

            return res.json({ status: true, data: links });
        } catch (err) {
            return res.json({ status: false, error: err.message });
        }
    }

    // ===================== DOWNLOAD =====================
    if (action === "download") {
        const url = req.query.url;
        if (!url) return res.json({ status: false, error: "url required" });

        try {
            const { data: html } = await axios.get(scraperUrl(url, true, 25000), { timeout: 30000 });
            const $ = cheerio.load(html);

            const download_links = [];

            // Google Drive direct links
            $("a[href*='drive.google.com'], a[href*='drive.usercontent.google.com']").each((i, el) => {
                const href = $(el).attr("href") || "";
                const text = $(el).text().trim() || `Link ${i + 1}`;
                if (href) download_links.push({ quality: text, direct_link: href });
            });

            // thenuxgdrive / netlify fallback
            if (!download_links.length) {
                $("a[href*='thenuxgdrive'], a[href*='netlify.app']").each((i, el) => {
                    const href = $(el).attr("href") || "";
                    const text = $(el).text().trim() || `Link ${i + 1}`;
                    if (href) download_links.push({ quality: text, direct_link: href });
                });
            }

            // Any external link fallback
            if (!download_links.length) {
                $("a[href^='http']").each((i, el) => {
                    const href = $(el).attr("href") || "";
                    if (href && !href.includes("animeclub2.com") && !href.includes("scraperapi")) {
                        const text = $(el).text().trim() || `Link ${i + 1}`;
                        download_links.push({ quality: text, direct_link: href });
                    }
                });
            }

            return res.json({ status: true, results: download_links.length, download_links });
        } catch (err) {
            return res.json({ status: false, error: err.message });
        }
    }

    // ===================== DEFAULT =====================
    return res.json({
        status: true,
        message: "AnimeClub API",
        actions: ["search", "details", "episode", "download"]
    });
};
