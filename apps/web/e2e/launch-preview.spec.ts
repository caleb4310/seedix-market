import { expect, test } from "@playwright/test";

test("launch preview follows the form and pre-IPO can be empty", async ({ page }) => {
  await page.goto("/launch");
  await page.getByPlaceholder("North star").fill("North star");
  await page.getByPlaceholder("NSTR").fill("NSTR");
  const preview = page.locator(".preview-side");
  await expect(preview.getByRole("heading", { name: /North star/ })).toBeVisible();
  await expect(preview.getByText("$NSTR").first()).toBeVisible();
  await expect(preview.getByText("80% to 1% over 10s")).toBeVisible();
  await page.getByRole("tab", { name: "Pre-IPO" }).click();
  await expect(
    page.getByText("No pre-IPO tokens on Elysium yet.").or(page.getByLabel("Backing token")),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Any coin" }).click();
  await expect(page.getByText("Unverified token").first()).toBeVisible();
  await expect(page.getByText("PAIR PAIR", { exact: true })).toHaveCount(0);
  await expect(page.locator(".hold-label")).toHaveText("Connect your wallet");
});
