import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://html.duckduckgo.com/html/?q=latest+world+cup+game', { waitUntil: 'networkidle2' });
  const html = await page.content();
  console.log("HTML length:", html.length);
  const results = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.result')).map(el => {
      const title = el.querySelector('.result__title')?.textContent?.trim();
      const snippet = el.querySelector('.result__snippet')?.textContent?.trim();
      return { title, snippet };
    });
  });
  console.log(results);
  await browser.close();
})();
