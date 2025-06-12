import { test, expect } from "@sand4rt/experimental-ct-web";
import { MobileChatInput } from "./mobile-chat-input";

test("allows Enter key to create newlines without sending message", async ({ mount }) => {
  const component = await mount(MobileChatInput, {
    props: {
      disabled: false,
    },
  });

  // Find the textarea
  const textarea = component.locator("textarea");
  await expect(textarea).toBeVisible();

  // Type some text
  await textarea.fill("First line");
  
  // Press Enter - should NOT send message, should create new line
  await textarea.press("Enter");
  
  // Type more text
  await textarea.type("Second line");
  
  // Verify that the textarea contains both lines
  const textareaValue = await textarea.inputValue();
  expect(textareaValue).toBe("First line\nSecond line");
  
  // Verify that no message was sent (component should still have the text)
  await expect(textarea).toHaveValue("First line\nSecond line");
});

test("displays correct placeholder text for mobile", async ({ mount }) => {
  const component = await mount(MobileChatInput, {
    props: {
      disabled: false,
    },
  });

  const textarea = component.locator("textarea");
  await expect(textarea).toHaveAttribute("placeholder", "Type your message here and tap Send...");
});

test("send button is visible and clickable", async ({ mount }) => {
  const component = await mount(MobileChatInput, {
    props: {
      disabled: false,
    },
  });

  const sendButton = component.locator(".send-button");
  await expect(sendButton).toBeVisible();
  await expect(sendButton).not.toBeDisabled();
});

test("can send message using send button", async ({ mount }) => {
  let sentMessage = "";
  
  const component = await mount(MobileChatInput, {
    props: {
      disabled: false,
    },
    // Mock the message sending
    on: {
      message: (event: CustomEvent) => {
        sentMessage = event.detail.content;
      },
    },
  });

  const textarea = component.locator("textarea");
  const sendButton = component.locator(".send-button");

  // Type a multi-line message
  await textarea.fill("Line 1\nLine 2\nLine 3");
  
  // Click send button
  await sendButton.click();
  
  // Verify that the message was sent with newlines preserved
  expect(sentMessage).toBe("Line 1\nLine 2\nLine 3");
  
  // Verify that textarea is cleared after sending
  await expect(textarea).toHaveValue("");
});
