import { expect, test } from "@playwright/test";

const widths = [375, 768, 1024, 1440];
const paths = ["/", "/launch", "/coin/kiln", "/coin/harbor", "/does-not-exist"];

for (const width of widths) {
  for (const path of paths) {
    test(`${path} has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        return Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth;
      });
      expect(overflow, `${path} at ${width}`).toBeLessThanOrEqual(1);
    });
  }
}

test("production builds ignore query-string demo states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/coin/kiln?state=success");
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0x4c1a9e20b7d4")).toHaveCount(0);
});
