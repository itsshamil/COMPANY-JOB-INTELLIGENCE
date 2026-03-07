/**
 * Company Job Intelligence – Popup Script
 */

const COMPANIES = [
    "Google", "Microsoft", "Amazon", "Apple", "Meta", "Netflix",
    "Tesla", "Adobe", "Salesforce", "Uber", "Spotify", "X", "LinkedIn", "IBM", "Oracle"
];

document.addEventListener('DOMContentLoaded', () => {
    // Populate company chips
    const grid = document.getElementById('company-grid');
    COMPANIES.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'company-chip';
        chip.textContent = name;
        grid.appendChild(chip);
    });

    // Check detection status
    chrome.storage.local.get('detectedCompany', (result) => {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        const btn = document.getElementById('open-panel-btn');

        if (result.detectedCompany) {
            const company = result.detectedCompany;
            dot.classList.add('active');
            text.innerHTML = `<span class="status-company">${company.name}</span> detected`;
            btn.disabled = false;
        } else {
            dot.classList.add('inactive');
            text.textContent = 'No company detected on this page';
            btn.disabled = true;
        }
    });

    // Open side panel button
    document.getElementById('open-panel-btn').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.sidePanel.open({ tabId: tabs[0].id }).then(() => {
                    // Send message to content scripts to close the banner
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'SIDEBAR_OPENED' }).catch(() => {
                        // Ignore errors if content script isn't loaded
                    });
                    setTimeout(() => window.close(), 100);
                }).catch(console.error);
            }
        });
    });
});
