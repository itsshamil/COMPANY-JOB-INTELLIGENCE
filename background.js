/**
 * Company Job Intelligence – Background Service Worker
 * Handles message routing, storage, and side panel control
 */

// Enable side panel on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "COMPANY_DETECTED") {
    // Store company data for the sidebar to consume
    chrome.storage.local.set({
      detectedCompany: {
        key: msg.companyKey,
        name: msg.companyName,
        hostname: msg.hostname,
        domain: msg.domain,
        faviconUrl: msg.faviconUrl,
        isKnown: msg.isKnown,
        hasCareerSignals: msg.hasCareerSignals,
        careerPaths: msg.careerPaths || [],
        pageUrl: msg.pageUrl || '',
        scrapedJobs: msg.scrapedJobs || [],
        pageContent: msg.pageContent || '',
        timestamp: Date.now()
      }
    });

    // Update the extension badge
    chrome.action.setBadgeText({ text: "✓", tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: "#00F5D4", tabId: sender.tab?.id });
  }

  if (msg.type === "OPEN_SIDE_PANEL") {
    // Open side panel for the sender's tab
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(console.error);
    }
  }
});

// Open side panel when notification is clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.sidePanel.open({ tabId: tabs[0].id }).catch(console.error);
    }
  });
});

// Clear stored company when tab navigates away
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
});