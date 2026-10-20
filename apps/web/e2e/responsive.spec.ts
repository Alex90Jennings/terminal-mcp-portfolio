import { expect, test } from "@playwright/test";
import { open, output, prompt, runCommand } from "./fixtures";

test.beforeEach(async ({ page }) => open(page));

test("nothing scrolls sideways, even after wide output", async ({ page }) => {
  for (const command of [
    "projects",
    "skills",
    "projects total-guess all",
    "contact",
  ])
    await runCommand(page, command);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the terminal and the copyright line fill the viewport, and the prompt stays on screen", async ({
  page,
}) => {
  await runCommand(page, "projects zim all");
  const viewport = page.viewportSize();
  const terminal = await page.getByRole("main").boundingBox();
  const footer = await page.getByRole("contentinfo").boundingBox();
  expect((terminal?.height ?? 0) + (footer?.height ?? 0)).toBeCloseTo(
    viewport?.height ?? 0,
    -1,
  );
  await output(page)
    .getByRole("heading", { level: 2, name: "ZIM Connections" })
    .last()
    .scrollIntoViewIfNeeded();
  await prompt(page).scrollIntoViewIfNeeded();
  await expect(prompt(page)).toBeInViewport();
});

test("the copyright line sits below the terminal, always on screen", async ({
  page,
}) => {
  const footer = page.getByRole("contentinfo");
  await expect(footer).toHaveText("© 2026 Alex Jennings · Built by AJ");
  await runCommand(page, "projects zim all");
  await expect(footer).toBeInViewport();
});

test.describe("on phones", () => {
  test.skip(({ isMobile }) => !isMobile, "touch behaviour");

  test("the welcome fits the screen: the suggested questions and the prompt are visible without scrolling", async ({
    page,
  }) => {
    await expect(
      output(page).getByRole("button", { name: "Why should we hire Alex?" }),
    ).toBeInViewport();
    await expect(prompt(page)).toBeInViewport();
  });

  test("…including a small phone (375 × 667)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await expect(
      output(page).getByRole("button", { name: "Why should we hire Alex?" }),
    ).toBeInViewport();
    await expect(prompt(page)).toBeInViewport();
  });

  test("quick commands are one row of chips, each large enough to tap (44px)", async ({
    page,
  }) => {
    const toolbar = page.getByRole("navigation", { name: "Quick commands" });
    expect((await toolbar.boundingBox())?.height).toBeLessThan(64);
    for (const button of await toolbar.getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("tapping a command does not pop up the keyboard", async ({ page }) => {
    await expect(prompt(page)).not.toBeFocused();
    await page
      .getByRole("navigation", { name: "Quick commands" })
      .getByRole("button", { name: "projects" })
      .tap();
    await expect(
      output(page).getByRole("heading", { name: "Available projects" }),
    ).toBeVisible();
    await expect(prompt(page)).not.toBeFocused();
  });

  test("tapping a project in the list opens it", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Quick commands" })
      .getByRole("button", { name: "projects" })
      .tap();
    await output(page).getByRole("button", { name: "Total Guess" }).tap();
    await expect(
      output(page).getByRole("heading", { level: 2, name: "Total Guess" }),
    ).toBeVisible();
  });

  test("the prompt uses 16px text so iOS does not zoom in on focus", async ({
    page,
  }) => {
    const size = await prompt(page).evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("the on-screen keyboard is set up for commands, not prose", async ({
    page,
  }) => {
    await expect(prompt(page)).toHaveAttribute("autocapitalize", "none");
    await expect(prompt(page)).toHaveAttribute("autocorrect", "off");
    await expect(prompt(page)).toHaveAttribute("spellcheck", "false");
    await expect(prompt(page)).toHaveAttribute("enterkeyhint", "go");
  });
});
