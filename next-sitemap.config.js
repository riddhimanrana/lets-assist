const fg = require("fast-glob");

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: "https://lets-assist.com/",
  generateIndexSitemap: false,
  generateRobotsTxt: true,
  // make sure outDir is your public folder (default)
  outDir: "./public",

  // ignore API / auth folders
  exclude: [
    "/api/*",
    "/auth/*",
    "/error",
    "/admin/*",
    "/account/*",
    "/dashboard",
    "/(landing)",         // Hidden group folder
    "*/[id]*",            // Exclude dynamic patterns
    "*/[projectId]*",
    "*/[username]*",
    "*/[token]*",
    "/opengraph-image",
    "/logout",
  ],

  // manually pick up all app routes
  additionalPaths: async (config) => {
    // find all your page.tsx (or .js/.jsx/.tsx) under /app
    const pages = await fg("app/**/page.{js,jsx,ts,tsx}", {
      cwd: process.cwd(),
      dot: false,
    });

    return Promise.all(
      pages
        .filter((file) => {
          // Filter out dynamic routes and internal groups from additionalPaths
          return (
            !file.includes("[") &&
            !file.includes("]") &&
            !file.includes("(landing)")
          );
        })
        .map((file) => {
          // turn "app/foo/bar/page.tsx" → "/foo/bar"
          let urlPath = file.replace(/^app/, "").replace(/\/page\..+$/, "");
          if (urlPath === "") urlPath = "/";
          return config.transform(config, urlPath);
        }),
    );
  },

  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/error",
          "/admin/",
          "/account/",
          "/dashboard",
          "/logout",
        ],
      },
    ],
  },
};
