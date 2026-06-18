export const api = typeof browser !== "undefined" ? browser : chrome;

export function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}
