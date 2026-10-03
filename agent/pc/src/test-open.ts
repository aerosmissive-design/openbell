import { chromium, type Page } from "playwright";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function clickFirst(page: Page, names: string[]) {
  for (const name of names) {
    const button = page.getByRole("button", { name }).first();
    if (await button.count()) {
      await button.click({ timeout: 4000 }).catch(() => undefined);
      return name;
    }
  }
  return "";
}

async function show(page: Page, label: string) {
  console.log(`[화면] ${label} ${page.url()}`);
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

console.log("[CGV] 로그인 화면");
await page.goto("https://cgv.co.kr/mem/login?returnUrl=%2Fcnm%2FselectVisitorCnt&nmbrAtktFlag=Y", { waitUntil: "domcontentloaded" });
await show(page, "CGV 로그인");
console.log("[CGV] 인원 선택 화면으로 이동");
await page.goto("https://cgv.co.kr/cnm/selectVisitorCnt", { waitUntil: "domcontentloaded" }).catch(() => undefined);
await show(page, "CGV 인원");
const cgvCount = await clickFirst(page, ["2", "일반 2", "성인 2"]);
console.log(cgvCount ? `[CGV] 인원 버튼 ${cgvCount}` : "[CGV] 인원 버튼을 못 찾음. 화면을 직접 확인.");
const cgvNext = await clickFirst(page, ["선택완료", "좌석선택", "다음"]);
console.log(cgvNext ? `[CGV] ${cgvNext} 클릭. 결제는 안 누름.` : "[CGV] 좌석 이동 버튼을 못 찾음.");
await show(page, "CGV 좌석 시도 후");

console.log("[메가박스] 홈");
await page.goto("https://www.megabox.co.kr/booking", { waitUntil: "domcontentloaded" }).catch(async () => {
  await page.goto("https://www.megabox.co.kr/", { waitUntil: "domcontentloaded" });
});
await show(page, "메가박스 예매");
const megaCount = await clickFirst(page, ["2", "일반2", "성인2"]);
console.log(megaCount ? `[메가박스] 인원 버튼 ${megaCount}` : "[메가박스] 인원 버튼을 못 찾음. 화면을 직접 확인.");
const megaNext = await clickFirst(page, ["좌석선택", "좌석 선택", "다음"]);
console.log(megaNext ? `[메가박스] ${megaNext} 클릭. 결제는 안 누름.` : "[메가박스] 좌석 이동 버튼을 못 찾음.");
await show(page, "메가박스 좌석 시도 후");
console.log("결제 버튼은 누르지 않았다. Enter를 누르면 닫는다.");
const rl = createInterface({ input: stdin, output: stdout });
await rl.question("");
rl.close();
await browser.close();
console.log("TEST_DONE");
