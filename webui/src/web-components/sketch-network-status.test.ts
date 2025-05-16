import { test, expect } from "@sand4rt/experimental-ct-web";
import { SketchNetworkStatus } from "./sketch-network-status";

// Test that the network status component doesn't display visible content
// since we've removed the green dot indicator
test("network status component is not visible", async ({ mount }) => {
  const component = await mount(SketchNetworkStatus, {
    props: {
      connection: "connected",
    },
  });

  // The status container should exist but be hidden with display: none
  await expect(component.locator(".status-container")).toHaveCSS("display", "none");
});

// Test that the network status component remains invisible regardless of connection state
test("network status component is not visible when disconnected", async ({ mount }) => {
  const component = await mount(SketchNetworkStatus, {
    props: {
      connection: "disconnected",
      error: "Connection error",
    },
  });

  // The status container should exist but be hidden with display: none
  await expect(component.locator(".status-container")).toHaveCSS("display", "none");
});
