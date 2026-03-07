/**
 * Company Job Intelligence – Options Page Script
 */

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('api-key-input');
    const saveBtn = document.getElementById('save-btn');
    const testBtn = document.getElementById('test-btn');
    const clearBtn = document.getElementById('clear-btn');
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const statusEl = document.getElementById('status-msg');
    const cacheInfo = document.getElementById('cache-info');

    // Load existing key
    chrome.storage.sync.get('geminiApiKey', (result) => {
        if (result.geminiApiKey) {
            input.value = result.geminiApiKey;
            showStatus('API key is configured ✓', 'success');
        }
    });

    // Show cache info
    updateCacheInfo();

    // Save API key
    saveBtn.addEventListener('click', () => {
        const key = input.value.trim();
        if (!key) {
            showStatus('Please enter an API key', 'error');
            return;
        }
        chrome.storage.sync.set({ geminiApiKey: key }, () => {
            showStatus('API key saved successfully! ✓', 'success');
        });
    });

    // Test connection
    testBtn.addEventListener('click', async () => {
        const key = input.value.trim();
        if (!key) {
            showStatus('Please enter an API key first', 'error');
            return;
        }

        showStatus('Testing connection...', 'success');

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Reply with just the word "connected"' }] }],
                    generationConfig: { maxOutputTokens: 10 }
                })
            });

            if (res.ok) {
                showStatus('✅ Connection successful! Gemini AI is ready.', 'success');
                // Also save the key on successful test
                chrome.storage.sync.set({ geminiApiKey: key });
            } else {
                const err = await res.json();
                showStatus(`❌ Error: ${err.error?.message || 'Invalid API key'}`, 'error');
            }
        } catch (e) {
            showStatus(`❌ Connection failed: ${e.message}`, 'error');
        }
    });

    // Clear API key
    clearBtn.addEventListener('click', () => {
        input.value = '';
        chrome.storage.sync.remove('geminiApiKey', () => {
            showStatus('API key removed. Extension will use offline data.', 'success');
        });
    });

    // Clear cache
    clearCacheBtn.addEventListener('click', () => {
        chrome.storage.local.get(null, (items) => {
            const cacheKeys = Object.keys(items).filter(k => k.startsWith('ai_cache_'));
            if (cacheKeys.length === 0) {
                showStatus('No cached data to clear', 'success');
                return;
            }
            chrome.storage.local.remove(cacheKeys, () => {
                showStatus(`Cleared ${cacheKeys.length} cached entries ✓`, 'success');
                updateCacheInfo();
            });
        });
    });

    function showStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = `status ${type}`;
    }

    function updateCacheInfo() {
        chrome.storage.local.get(null, (items) => {
            const cacheKeys = Object.keys(items).filter(k => k.startsWith('ai_cache_'));
            cacheInfo.textContent = `${cacheKeys.length} companies cached`;
        });
    }
});
