// chat.js — FormData uploads, preview, typing indicator flowing, robust scrolling, Enter to send
document.addEventListener('DOMContentLoaded', () => {
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const uploadBtn = document.getElementById('uploadBtn') || document.querySelector('.image-upload-btn');
  const imageInput = document.getElementById('imageInput');
  const imagePreview = document.getElementById('imagePreview');
  const previewImage = document.getElementById('previewImage');
  const removeImageBtn = document.getElementById('removeImageBtn');
  const chatMessages = document.getElementById('chatMessages');
  const typingIndicator = document.getElementById('typingIndicator');

  let selectedImageDataUrl = null; // preview shown to user
  let pendingFile = null; // actual File object for upload
    // ---------- Dynamic padding to protect last messages (paste inside DOMContentLoaded) ----------
  (function syncMessagesBottomPadding() {
    const chatMessagesEl = document.getElementById('chatMessages');
    const chatInputContainerEl = document.querySelector('.chat-input-container');

    if (!chatMessagesEl || !chatInputContainerEl) return;

    function applyPadding() {
      // compute the height of the input container (including margins)
      const rect = chatInputContainerEl.getBoundingClientRect();
      const inputHeight = Math.ceil(rect.height);
      // add small extra gap
      const gap = 12;
      chatMessagesEl.style.paddingBottom = (inputHeight + gap) + 'px';
    }

    // apply initially
    applyPadding();

    // re-apply on resize and when the input itself changes height
    window.addEventListener('resize', applyPadding);
    // observe input size changes (textarea growing)
    const ro = new ResizeObserver(applyPadding);
    ro.observe(chatInputContainerEl);

    // Also reapply after a short delay when new messages are added (safety)
    const mo = new MutationObserver(() => {
      setTimeout(applyPadding, 60);
    });
    mo.observe(chatMessagesEl, { childList: true, subtree: true });
  })();

  // ---------- utilities ----------
  function ensureTypingInsideMessages() {
    if (!typingIndicator || !chatMessages) return;
    if (typingIndicator.parentElement !== chatMessages) {
      if (typingIndicator.parentElement) typingIndicator.parentElement.removeChild(typingIndicator);
      chatMessages.appendChild(typingIndicator);
    }
  }

  function scrollToBottom(delay = 40) {
    if (!chatMessages) return;
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, delay);
  }

  // Ensure typing sits inside and scroll to bottom on load
  ensureTypingInsideMessages();
  scrollToBottom(0);

  // Observe additions to auto-scroll and bind image loads
  (function observeMutations() {
    if (!chatMessages) return;
    const mo = new MutationObserver((mutations) => {
      let added = false;
      for (const m of mutations) if (m.addedNodes && m.addedNodes.length) { added = true; break; }
      if (added) {
        // ensure images in the new content trigger scroll when they finish loading
        const imgs = chatMessages.querySelectorAll('img');
        imgs.forEach(img => {
          if (!img.__boundToScroll) {
            img.__boundToScroll = true;
            if (!img.complete) {
              img.addEventListener('load', () => scrollToBottom(20));
            }
          }
        });
        scrollToBottom(60);
      }
    });
    mo.observe(chatMessages, { childList: true, subtree: true });
  })();

  // ---------- UI handlers ----------
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      if (imageInput) imageInput.click();
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      // limit 5MB
      if (f.size > 5 * 1024 * 1024) {
        alert('Image must be under 5 MB');
        imageInput.value = '';
        return;
      }
      pendingFile = f;
      const reader = new FileReader();
      reader.onload = (ev) => {
        selectedImageDataUrl = ev.target.result;
        if (previewImage && imagePreview) {
          previewImage.src = selectedImageDataUrl;
          imagePreview.style.display = 'block';
        }
        scrollToBottom();
      };
      reader.readAsDataURL(f);
    });
  }

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
      pendingFile = null;
      selectedImageDataUrl = null;
      if (imageInput) imageInput.value = '';
      if (previewImage) previewImage.src = '';
      if (imagePreview) imagePreview.style.display = 'none';
    });
  }

  // Auto-resize textarea and Enter-to-send
  if (messageInput) {
    messageInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    });

    messageInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatForm && typeof chatForm.requestSubmit === 'function') chatForm.requestSubmit();
        else if (chatForm) chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
  }

  // Create and append a chat bubble. imageUrl optional.
  function addMessage(text, isUser = false, imageUrl = null) {
    if (!chatMessages) return;
    const bubble = document.createElement('article');
    bubble.className = `chat-bubble ${isUser ? 'user-bubble' : 'bot-bubble'} chat-bubble-enter`;
    bubble.setAttribute('role', 'article');
    bubble.setAttribute('aria-label', isUser ? 'Your message' : 'Bot message');

    const content = document.createElement('div');
    content.className = 'bubble-content';

    if (imageUrl) {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = isUser ? 'Uploaded image' : 'Image';
      content.appendChild(img);
    }

    if (text) {
      const p = document.createElement('p');
      p.textContent = text;
      content.appendChild(p);
    }

    const ts = document.createElement('p');
    ts.className = 'timestamp';
    ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    content.appendChild(ts);

    bubble.appendChild(content);

    // insert before typing indicator if it's in the messages container (so typing remains last)
    if (typingIndicator && typingIndicator.parentElement === chatMessages) {
      chatMessages.insertBefore(bubble, typingIndicator);
    } else {
      chatMessages.appendChild(bubble);
    }

    scrollToBottom();
  }

  // Show/hide typing indicator and ensure it's placed inside messages
  function setPending(pending) {
    if (sendBtn) sendBtn.disabled = pending;
    if (uploadBtn) uploadBtn.disabled = pending;
    if (!typingIndicator || !chatMessages) return;
    ensureTypingInsideMessages();
    typingIndicator.style.display = pending ? 'flex' : 'none';
    typingIndicator.setAttribute('aria-hidden', pending ? 'false' : 'true');
    if (pending) scrollToBottom();
  }

  // ---------- Submit handler (FormData) ----------
  if (chatForm) {
    chatForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = (messageInput && messageInput.value.trim()) || '';
      if (!text && !pendingFile) return;

      // Optimistic UI
      addMessage(text || '(image)', true, selectedImageDataUrl);

      // Clear inputs locally
      if (messageInput) { messageInput.value = ''; messageInput.style.height = 'auto'; }
      if (imageInput) imageInput.value = '';
      if (previewImage) previewImage.src = '';
      if (imagePreview) imagePreview.style.display = 'none';
      selectedImageDataUrl = null;

      const fd = new FormData();
      fd.append('message', text);
      if (pendingFile) fd.append('image', pendingFile, pendingFile.name);

      // CSRF
      const csrfEl = document.querySelector('[name=csrfmiddlewaretoken]');
      const csrfToken = csrfEl ? csrfEl.value : null;
      const headers = {};
      if (csrfToken) headers['X-CSRFToken'] = csrfToken;

      setPending(true);

      try {
        const resp = await fetch('/chat/send/', { method: 'POST', body: fd, headers });
        let data;
        const ct = resp.headers.get('Content-Type') || '';
        if (ct.includes('application/json')) data = await resp.json();
        else {
          const txt = await resp.text();
          try { data = JSON.parse(txt); } catch (_) { data = { response: txt }; }
        }

        setPending(false);
        pendingFile = null;

        if (resp.ok && data && data.response) {
          addMessage(data.response, false, data.image_url || null);
        } else {
          const errMsg = (data && data.response) ? data.response : 'Server error. Please try again.';
          addMessage(errMsg, false, null);
          console.error('Server error', resp.status, data);
        }
      } catch (err) {
        setPending(false);
        console.error('Network error', err);
        addMessage('Network error. Check your connection and try again.', false, null);
      }
    });
  }
});
