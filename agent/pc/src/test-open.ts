import { chromium } from "playwright";

const targets = [
  ["CGV", "https://cgv.co.kr/mem/login?returnUrl=%2Fcnm%2FselectVisitorCnt&nmbrAtktFlag=Y"],
  ["MEGABOX", "https://www.megabox.co.kr/"],
];
const browser = await chromium.launch({ headless: false });
for (const [name, url] of targets) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(`[OK] ${name} opened ${page.url()}`);
  console.log("[OK] payment button was not clicked");
  await page.close();
}
await browser.close();
console.log("TEST_DONE");
