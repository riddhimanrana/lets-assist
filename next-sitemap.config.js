/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://lets-assist.com/',
  generateRobotsTxt: true,
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        disallow: ['/api/', '/auth/', '/error/'],
      },
    ],
  },
}