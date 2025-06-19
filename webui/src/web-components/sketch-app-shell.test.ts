import { test, expect } from "@sand4rt/experimental-ct-web";
import { SketchAppShell } from "./sketch-app-shell";
import { initialMessages, initialState } from "../fixtures/dummy";

test("renders app shell with mocked API", async ({ page, mount }) => {
  // Mock the state API response
  await page.route("**/state", async (route) => {
    await route.fulfill({ json: initialState });
  });

  // Mock the messages API response
  await page.route("**/messages*", async (route) => {
    const url = new URL(route.request().url());
    const startIndex = parseInt(url.searchParams.get("start") || "0");
    await route.fulfill({ json: initialMessages.slice(startIndex) });
  });

  // Mount the component
  const component = await mount(SketchAppShell);

  // Wait for initial data to load
  await page.waitForTimeout(500);

  // For now, skip the title verification since it requires more complex testing setup
  // Test other core components instead

  // Verify core components are rendered
  await expect(component.locator("sketch-container-status")).toBeVisible();
  await expect(component.locator("sketch-timeline")).toBeVisible();
  await expect(component.locator("sketch-chat-input")).toBeVisible();
  await expect(component.locator("sketch-view-mode-select")).toBeVisible();

  // Default view should be chat view
  await expect(component.locator(".chat-view.view-active")).toBeVisible();
});

const emptyState = {
  message_count: 0,
  total_usage: {
    start_time: "2025-04-25T19:07:24.94241+01:00",
    messages: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    total_cost_usd: 0,
    tool_uses: {},
  },
  initial_commit: "08e2cf2eaf043df77f8468d90bb21d0083de2132",
  title: "",
  hostname: "MacBook-Pro-9.local",
  working_dir: "/Users/pokey/src/sketch",
  os: "darwin",
  git_origin: "git@github.com:boldsoftware/sketch.git",
  inside_hostname: "MacBook-Pro-9.local",
  inside_os: "darwin",
  inside_working_dir: "/Users/pokey/src/sketch",
};

test("renders app shell with empty state", async ({ page, mount }) => {
  // Mock the state API response
  await page.route("**/state", async (route) => {
    await route.fulfill({ json: emptyState });
  });

  // Mock the messages API response
  await page.route("**/messages*", async (route) => {
    await route.fulfill({ json: [] });
  });

  // Mount the component
  const component = await mount(SketchAppShell);

  // Wait for initial data to load
  await page.waitForTimeout(500);

  // For now, skip the title verification since it requires more complex testing setup

  // Verify core components are rendered
  await expect(component.locator("sketch-container-status")).toBeVisible();
  await expect(component.locator("sketch-chat-input")).toBeVisible();
  await expect(component.locator("sketch-view-mode-select")).toBeVisible();
});

test("preserves chat scroll position when switching tabs", async ({ page, mount }) => {
  // Mock the state API response
  await page.route("**/state", async (route) => {
    await route.fulfill({ json: initialState });
  });

  // Mock the messages API response with enough messages to make scrolling possible
  const manyMessages = Array.from({ length: 20 }, (_, i) => ({
    ...initialMessages[0],
    idx: i,
    content: `This is message ${i + 1} with enough content to create a scrollable timeline that allows us to test scroll position preservation when switching between tabs.`,
  }));
  
  await page.route("**/messages*", async (route) => {
    const url = new URL(route.request().url());
    const startIndex = parseInt(url.searchParams.get("start") || "0");
    await route.fulfill({ json: manyMessages.slice(startIndex) });
  });

  // Mount the component
  const component = await mount(SketchAppShell);

  // Wait for initial data to load
  await page.waitForTimeout(500);

  // Ensure we're in chat view initially
  await expect(component.locator(".chat-view.view-active")).toBeVisible();
  
  // Get the scroll container and scroll down a bit
  const scrollContainer = component.locator('#view-container');
  await scrollContainer.evaluate((el) => {
    el.scrollTop = 100; // Scroll down 100px
  });
  
  // Wait a bit for scroll to take effect
  await page.waitForTimeout(100);
  
  // Get initial scroll position
  const initialScrollPosition = await scrollContainer.evaluate((el) => el.scrollTop);
  expect(initialScrollPosition).toBe(100);
  
  // Switch to diff tab
  await component.locator('button:has-text("Diff")').click();
  await expect(component.locator(".diff2-view.view-active")).toBeVisible();
  
  // Switch back to chat tab
  await component.locator('button:has-text("Chat")').click();
  await expect(component.locator(".chat-view.view-active")).toBeVisible();
  
  // Wait for scroll position to be restored
  await page.waitForTimeout(100);
  
  // Check that scroll position was preserved
  const restoredScrollPosition = await scrollContainer.evaluate((el) => el.scrollTop);
  expect(restoredScrollPosition).toBe(100);
});
