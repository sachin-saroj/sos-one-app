/* ═══════════════════════════════════════════════════════════
   SOS ONE — ELECTRON DESKTOP APP
   Single-file JavaScript: Storage, Location, SMS Simulation,
   SOS Controller, Contacts, Navigation, and App Init
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════
   UTILITY HELPERS
   ═══════════════════════════════════════════════════════════ */

const Utils = (() => {
  // DOM helpers
  const $ = (sel, parent = document) => parent.querySelector(sel);
  const $$ = (sel, parent = document) => parent.querySelectorAll(sel);

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Toast notifications
  function showToast(message, type = 'info', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const iconMap = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = `${iconMap[type] || ''} ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Cooldown management
  const cooldowns = new Map();

  function isCooldown(key, durationMs = 30000) {
    const lastTime = cooldowns.get(key);
    if (!lastTime) return false;
    return (Date.now() - lastTime) < durationMs;
  }

  function setCooldown(key) { cooldowns.set(key, Date.now()); }

  function getCooldownRemaining(key, durationMs = 30000) {
    const lastTime = cooldowns.get(key);
    if (!lastTime) return 0;
    return Math.max(0, Math.ceil((durationMs - (Date.now() - lastTime)) / 1000));
  }

  function isOnline() { return navigator.onLine; }

  function onNetworkChange(callback) {
    window.addEventListener('online', () => callback(true));
    window.addEventListener('offline', () => callback(false));
  }

  return { $, $$, escapeHtml, showToast, isCooldown, setCooldown, getCooldownRemaining, isOnline, onNetworkChange };
})();


/* ═══════════════════════════════════════════════════════════
   STORAGE SERVICE (localStorage-based for Electron)
   Uses localStorage + JSON instead of IndexedDB for simplicity
   ═══════════════════════════════════════════════════════════ */

const StorageService = (() => {
  const CONTACTS_KEY = 'sos_one_contacts';
  const HISTORY_KEY = 'sos_one_history';
  const SETTINGS_KEY = 'sos_one_settings';

  function getContacts() {
    try {
      return JSON.parse(localStorage.getItem(CONTACTS_KEY)) || [];
    } catch { return []; }
  }

  function saveContacts(contacts) {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
  }

  // Contacts CRUD
  function addContact(contact) {
    const contacts = getContacts();
    // Check for duplicate phone
    const normalized = normalizePhone(contact.phone);
    if (contacts.some(c => c.phone === normalized)) {
      throw Object.assign(new Error('Duplicate phone'), { name: 'ConstraintError' });
    }
    const newContact = {
      id: Date.now(),
      name: contact.name,
      phone: normalized,
      relationship: contact.relationship || '',
      createdAt: new Date().toISOString()
    };
    contacts.push(newContact);
    saveContacts(contacts);
    return newContact.id;
  }

  function updateContact(id, updates) {
    const contacts = getContacts();
    const index = contacts.findIndex(c => c.id === id);
    if (index === -1) throw new Error(`Contact ${id} not found`);
    if (updates.phone) updates.phone = normalizePhone(updates.phone);
    contacts[index] = { ...contacts[index], ...updates, updatedAt: new Date().toISOString() };
    saveContacts(contacts);
  }

  function deleteContact(id) {
    const contacts = getContacts().filter(c => c.id !== id);
    saveContacts(contacts);
  }

  function getAllContacts() { return getContacts(); }
  function getContactCount() { return getContacts().length; }

  // Settings
  function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
  }

  function getSetting(key, defaultValue = null) {
    const settings = getSettings();
    return settings[key] !== undefined ? settings[key] : defaultValue;
  }

  function setSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function initDefaults() {
    const defaults = {
      sosMessage: '🚨 EMERGENCY SOS! I need immediate help! My location: {LOCATION_LINK} — Sent via SOS One',
      countdownSeconds: 3
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (getSetting(key) === null) setSetting(key, value);
    }
  }

  // Alert History
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  }

  function logAlert(alert) {
    const history = getHistory();
    history.unshift({ ...alert, id: Date.now(), timestamp: new Date().toISOString() });
    // Keep max 50 entries
    if (history.length > 50) history.length = 50;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  // Phone normalization
  function normalizePhone(phone) {
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('0') && cleaned.length >= 10) cleaned = '+91' + cleaned.substring(1);
    if (!cleaned.startsWith('+') && cleaned.length === 10) cleaned = '+91' + cleaned;
    return cleaned;
  }

  return {
    addContact, updateContact, deleteContact, getAllContacts, getContactCount,
    getSetting, setSetting, initDefaults,
    logAlert,
    normalizePhone
  };
})();


/* ═══════════════════════════════════════════════════════════
   LOCATION SERVICE
   ═══════════════════════════════════════════════════════════ */

const LocationService = (() => {
  let cachedCoords = null;

  async function getCurrentPosition(timeout = 8000) {
    if ('geolocation' in navigator) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: timeout,
            maximumAge: 60000
          });
        });
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
          cached: false
        };
        cachedCoords = coords;
        console.log('[Location] GPS acquired:', coords.lat, coords.lng);
        return coords;
      } catch (e) {
        console.warn('[Location] Geolocation failed:', e.message);
      }
    }

    // Fallback: cached
    if (cachedCoords) {
      console.log('[Location] Using cached coords');
      return { ...cachedCoords, cached: true };
    }

    // Mock fallback for demo
    console.log('[Location] Using mock location (Delhi)');
    return { lat: 28.6139, lng: 77.2090, accuracy: 500, cached: false, mock: true };
  }

  function buildMapsLink(coords) {
    if (!coords) return '';
    return `https://maps.google.com/maps?q=${coords.lat},${coords.lng}`;
  }

  function formatCoords(coords) {
    if (!coords) return 'Location unavailable';
    const lat = coords.lat.toFixed(6);
    const lng = coords.lng.toFixed(6);
    return `${lat}, ${lng}` + (coords.accuracy ? ` (±${coords.accuracy}m)` : '') + (coords.mock ? ' [Mock]' : '');
  }

  async function checkPermission() {
    try {
      if ('permissions' in navigator) {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        return result.state;
      }
    } catch {}
    return 'prompt';
  }

  return { getCurrentPosition, buildMapsLink, formatCoords, checkPermission };
})();


/* ═══════════════════════════════════════════════════════════
   SMS SIMULATION SERVICE (Desktop — no real SMS)
   ═══════════════════════════════════════════════════════════ */

const SMSService = (() => {
  function getDefaultTemplate() {
    return '🚨 EMERGENCY SOS!\nI need immediate help!\n\n📍 My Location:\n{LOCATION_LINK}\n\n⏰ Time: {TIME}\n\n— Sent via SOS One';
  }

  function buildMessage(template, coords) {
    const locationLink = coords ? LocationService.buildMapsLink(coords) : 'Location unavailable';
    let message = template || getDefaultTemplate();
    message = message.replace('{LOCATION_LINK}', locationLink);
    message = message.replace('{COORDS}', coords ? `${coords.lat}, ${coords.lng}` : 'N/A');
    message = message.replace('{TIME}', new Date().toLocaleTimeString());
    message = message.replace('{DATE}', new Date().toLocaleDateString());
    return message;
  }

  /**
   * Simulate sending SMS (Desktop mode)
   * Shows confirmation instead of opening sms: URI
   */
  function simulateSend(contacts, message) {
    console.log('[SMS] ═══ SIMULATED SMS SEND ═══');
    console.log('[SMS] Recipients:', contacts.map(c => `${c.name} (${c.phone})`).join(', '));
    console.log('[SMS] Message:', message);
    console.log('[SMS] ═══════════════════════════');
    return true;
  }

  return { getDefaultTemplate, buildMessage, simulateSend };
})();


/* ═══════════════════════════════════════════════════════════
   SOS CONTROLLER
   ═══════════════════════════════════════════════════════════ */

const SOSController = (() => {
  let countdownInterval = null;
  let countdownValue = 3;
  let isTriggering = false;
  let elements = {};

  function init() {
    elements = {
      sosButton: Utils.$('#sos-button'),
      countdownOverlay: Utils.$('#countdown-overlay'),
      countdownNumber: Utils.$('#countdown-number'),
      countdownCancel: Utils.$('#countdown-cancel'),
      countdownRingProgress: Utils.$('#countdown-ring-progress'),
      confirmationOverlay: Utils.$('#confirmation-overlay'),
      confirmDismiss: Utils.$('#confirm-dismiss'),
      confirmContactsList: Utils.$('#confirm-contacts-list'),
      confirmLocationLink: Utils.$('#confirm-location-link'),
      confirmLocationText: Utils.$('#confirm-location-text'),
      confirmTime: Utils.$('#confirm-time'),
      confirmMessage: Utils.$('#confirm-message'),
      noContactsWarning: Utils.$('#no-contacts-warning')
    };

    if (elements.sosButton) {
      elements.sosButton.addEventListener('click', handleSOSTap);
    }

    if (elements.countdownCancel) {
      elements.countdownCancel.addEventListener('click', cancelCountdown);
    }

    if (elements.confirmDismiss) {
      elements.confirmDismiss.addEventListener('click', dismissConfirmation);
    }

    console.log('[SOS] Controller initialized');
  }

  function handleSOSTap() {
    if (isTriggering) return;

    if (Utils.isCooldown('sos', 30000)) {
      const remaining = Utils.getCooldownRemaining('sos', 30000);
      Utils.showToast(`Please wait ${remaining}s before sending another alert`, 'warning');
      return;
    }

    const contactCount = StorageService.getContactCount();
    if (contactCount === 0) {
      Utils.showToast('Add emergency contacts first!', 'error');
      navigateToScreen('contacts');
      return;
    }

    startCountdown();
  }

  function startCountdown() {
    isTriggering = true;
    countdownValue = StorageService.getSetting('countdownSeconds', 3);
    const totalSeconds = countdownValue;

    elements.countdownOverlay.classList.add('active');
    elements.countdownNumber.textContent = countdownValue;
    elements.sosButton.classList.add('counting');

    const circumference = 2 * Math.PI * 120;
    if (elements.countdownRingProgress) {
      elements.countdownRingProgress.style.strokeDasharray = circumference;
      elements.countdownRingProgress.style.strokeDashoffset = '0';
    }

    countdownInterval = setInterval(() => {
      countdownValue--;

      if (countdownValue <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        elements.countdownOverlay.classList.remove('active');
        elements.sosButton.classList.remove('counting');
        executeSOS();
        return;
      }

      elements.countdownNumber.textContent = countdownValue;

      if (elements.countdownRingProgress) {
        const progress = (totalSeconds - countdownValue) / totalSeconds;
        elements.countdownRingProgress.style.strokeDashoffset = circumference * progress;
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    isTriggering = false;
    elements.countdownOverlay.classList.remove('active');
    elements.sosButton.classList.remove('counting');

    StorageService.logAlert({
      latitude: null,
      longitude: null,
      contactsNotified: [],
      status: 'cancelled',
      message: 'Alert cancelled by user'
    });

    Utils.showToast('SOS cancelled', 'info');
    console.log('[SOS] Countdown cancelled');
  }

  async function executeSOS() {
    console.log('[SOS] ===== EXECUTING SOS ALERT =====');

    // 1. Get GPS location (or mock)
    let coords = null;
    try {
      coords = await LocationService.getCurrentPosition(8000);
    } catch (e) {
      console.warn('[SOS] Location failed:', e);
    }

    // 2. Build message
    const template = StorageService.getSetting('sosMessage');
    const message = SMSService.buildMessage(template, coords);

    // 3. Load contacts
    const contacts = StorageService.getAllContacts();
    const contactNames = contacts.map(c => c.name);

    // 4. Simulate SMS send
    SMSService.simulateSend(contacts, message);

    // 5. Send native notification via Electron
    if (window.electronAPI) {
      window.electronAPI.notifyAlertSent({
        contactCount: contacts.length,
        hasLocation: !!coords
      });
    }

    // 6. Log alert
    StorageService.logAlert({
      latitude: coords?.lat || null,
      longitude: coords?.lng || null,
      contactsNotified: contactNames,
      status: 'sent',
      message: message
    });

    // 7. Set cooldown
    Utils.setCooldown('sos');

    // 8. Show confirmation
    showConfirmation(coords, contactNames, message);

    isTriggering = false;
    console.log('[SOS] ===== ALERT COMPLETE =====');
  }

  function showConfirmation(coords, contactNames, message) {
    if (elements.confirmContactsList) {
      elements.confirmContactsList.textContent = contactNames.join(', ');
    }

    if (coords) {
      const link = LocationService.buildMapsLink(coords);
      if (elements.confirmLocationLink) {
        elements.confirmLocationLink.href = link;
        elements.confirmLocationLink.textContent = 'Open in Maps ↗';
        // Make the link open in system browser
        elements.confirmLocationLink.onclick = (e) => {
          e.preventDefault();
          if (window.electronAPI) {
            window.electronAPI.openExternal(link);
          }
        };
      }
      if (elements.confirmLocationText) {
        elements.confirmLocationText.textContent = LocationService.formatCoords(coords);
      }
    } else {
      if (elements.confirmLocationLink) {
        elements.confirmLocationLink.textContent = 'Location unavailable';
        elements.confirmLocationLink.removeAttribute('href');
        elements.confirmLocationLink.onclick = null;
      }
      if (elements.confirmLocationText) {
        elements.confirmLocationText.textContent = '';
      }
    }

    if (elements.confirmTime) {
      elements.confirmTime.textContent = new Date().toLocaleTimeString();
    }

    if (elements.confirmMessage) {
      elements.confirmMessage.textContent = message;
    }

    elements.confirmationOverlay.classList.add('active');
  }

  function dismissConfirmation() {
    elements.confirmationOverlay.classList.remove('active');
  }

  function updateContactsWarning() {
    const count = StorageService.getContactCount();
    if (elements.noContactsWarning) {
      elements.noContactsWarning.style.display = count === 0 ? 'block' : 'none';
    }
  }

  return { init, updateContactsWarning, cancelCountdown };
})();


/* ═══════════════════════════════════════════════════════════
   CONTACTS CONTROLLER
   ═══════════════════════════════════════════════════════════ */

const ContactsController = (() => {
  let elements = {};
  let editingContactId = null;

  function init() {
    elements = {
      contactList: Utils.$('#contact-list'),
      addContactBtn: Utils.$('#add-contact-btn'),
      contactModal: Utils.$('#contact-modal'),
      modalTitle: Utils.$('#contact-modal-title'),
      nameInput: Utils.$('#contact-name-input'),
      phoneInput: Utils.$('#contact-phone-input'),
      relationshipChips: Utils.$$('.relationship-chip'),
      saveContactBtn: Utils.$('#save-contact-btn'),
      cancelContactBtn: Utils.$('#cancel-contact-btn'),
      contactCountBadge: Utils.$('#contact-count-badge')
    };

    if (elements.addContactBtn) {
      elements.addContactBtn.addEventListener('click', () => openModal());
    }

    if (elements.cancelContactBtn) {
      elements.cancelContactBtn.addEventListener('click', closeModal);
    }

    if (elements.saveContactBtn) {
      elements.saveContactBtn.addEventListener('click', saveContact);
    }

    elements.relationshipChips.forEach(chip => {
      chip.addEventListener('click', () => {
        elements.relationshipChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // "Go to contacts" link from no-contacts warning
    const goToBtn = Utils.$('#go-to-contacts-btn');
    if (goToBtn) {
      goToBtn.addEventListener('click', () => navigateToScreen('contacts'));
    }

    renderContacts();
    console.log('[Contacts] Controller initialized');
  }

  function renderContacts() {
    const contacts = StorageService.getAllContacts();
    if (!elements.contactList) return;

    if (contacts.length === 0) {
      elements.contactList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">👥</div>
          <div class="empty-state__title">No Emergency Contacts</div>
          <div class="empty-state__desc">Add up to 5 trusted contacts who will receive your SOS alerts</div>
        </div>
      `;
    } else {
      elements.contactList.innerHTML = contacts.map(c => createContactCard(c)).join('');

      // Bind edit/delete
      contacts.forEach(contact => {
        const editBtn = Utils.$(`#edit-contact-${contact.id}`);
        const deleteBtn = Utils.$(`#delete-contact-${contact.id}`);
        if (editBtn) editBtn.addEventListener('click', () => openModal(contact));
        if (deleteBtn) deleteBtn.addEventListener('click', () => deleteContact(contact.id, contact.name));
      });
    }

    if (elements.addContactBtn) {
      elements.addContactBtn.style.display = contacts.length >= 5 ? 'none' : 'flex';
    }

    if (elements.contactCountBadge) {
      elements.contactCountBadge.textContent = `${contacts.length}/5`;
    }

    SOSController.updateContactsWarning();
  }

  function createContactCard(contact) {
    const initial = contact.name.charAt(0).toUpperCase();
    const avatarClass = {
      'family': 'contact-card__avatar--family',
      'friend': 'contact-card__avatar--friend'
    }[contact.relationship?.toLowerCase()] || 'contact-card__avatar--other';

    const phone = contact.phone;
    const displayPhone = phone.startsWith('+91') && phone.length === 13
      ? `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`
      : phone;

    return `
      <div class="contact-card" data-id="${contact.id}">
        <div class="contact-card__avatar ${avatarClass}">${initial}</div>
        <div class="contact-card__info">
          <div class="contact-card__name">${Utils.escapeHtml(contact.name)}</div>
          <div class="contact-card__phone">${displayPhone}</div>
        </div>
        ${contact.relationship ? `<span class="contact-card__tag">${Utils.escapeHtml(contact.relationship)}</span>` : ''}
        <div class="contact-card__actions">
          <button class="contact-card__btn" id="edit-contact-${contact.id}" aria-label="Edit ${contact.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="contact-card__btn contact-card__btn--delete" id="delete-contact-${contact.id}" aria-label="Delete ${contact.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function openModal(contact = null) {
    editingContactId = contact ? contact.id : null;

    if (elements.modalTitle) {
      elements.modalTitle.textContent = contact ? 'Edit Contact' : 'Add Emergency Contact';
    }

    if (elements.nameInput) elements.nameInput.value = contact ? contact.name : '';
    if (elements.phoneInput) elements.phoneInput.value = contact ? contact.phone : '';

    elements.relationshipChips.forEach(chip => {
      chip.classList.remove('active');
      if (contact && chip.dataset.value === contact.relationship) chip.classList.add('active');
    });

    if (!contact && elements.relationshipChips.length > 0) {
      elements.relationshipChips[0].classList.add('active');
    }

    if (elements.contactModal) elements.contactModal.classList.add('active');

    setTimeout(() => {
      if (elements.nameInput) elements.nameInput.focus();
    }, 300);
  }

  function closeModal() {
    if (elements.contactModal) elements.contactModal.classList.remove('active');
    editingContactId = null;
    if (elements.nameInput) elements.nameInput.value = '';
    if (elements.phoneInput) elements.phoneInput.value = '';
  }

  function saveContact() {
    const name = elements.nameInput?.value?.trim();
    const phone = elements.phoneInput?.value?.trim();
    const activeChip = Utils.$('.relationship-chip.active');
    const relationship = activeChip?.dataset?.value || '';

    if (!name) {
      Utils.showToast('Please enter a name', 'error');
      elements.nameInput?.focus();
      return;
    }

    if (!phone || phone.length < 10) {
      Utils.showToast('Please enter a valid phone number', 'error');
      elements.phoneInput?.focus();
      return;
    }

    try {
      if (editingContactId) {
        StorageService.updateContact(editingContactId, { name, phone, relationship });
        Utils.showToast(`${name} updated!`, 'success');
      } else {
        if (StorageService.getContactCount() >= 5) {
          Utils.showToast('Maximum 5 contacts allowed', 'warning');
          return;
        }
        StorageService.addContact({ name, phone, relationship });
        Utils.showToast(`${name} added!`, 'success');
      }
      closeModal();
      renderContacts();
    } catch (error) {
      if (error.name === 'ConstraintError') {
        Utils.showToast('This phone number already exists', 'error');
      } else {
        Utils.showToast('Failed to save contact', 'error');
        console.error('[Contacts] Save error:', error);
      }
    }
  }

  function deleteContact(id, name) {
    if (!confirm(`Remove ${name} from emergency contacts?`)) return;
    try {
      StorageService.deleteContact(id);
      Utils.showToast(`${name} removed`, 'info');
      renderContacts();
    } catch (error) {
      Utils.showToast('Failed to delete contact', 'error');
    }
  }

  return { init, renderContacts };
})();


/* ═══════════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════════ */

function navigateToScreen(screenName) {
  Utils.$$('.screen').forEach(screen => screen.classList.remove('active'));
  const target = Utils.$(`#screen-${screenName}`);
  if (target) target.classList.add('active');

  Utils.$$('.bottom-nav__item').forEach(item => item.classList.remove('active'));
  const targetNav = Utils.$(`[data-screen="${screenName}"]`);
  if (targetNav) targetNav.classList.add('active');

  if (screenName === 'contacts') {
    ContactsController.renderContacts();
  } else if (screenName === 'sos') {
    SOSController.updateContactsWarning();
  }
}


/* ═══════════════════════════════════════════════════════════
   APP INITIALIZATION
   ═══════════════════════════════════════════════════════════ */

const App = (() => {
  function init() {
    console.log('[App] ═══ SOS One Desktop Initializing ═══');

    // 1. Initialize storage defaults
    StorageService.initDefaults();
    console.log('[App] Storage ready');

    // 2. Initialize controllers
    SOSController.init();
    ContactsController.init();
    console.log('[App] Controllers ready');

    // 3. Setup navigation
    setupNavigation();

    // 4. Setup window controls
    setupWindowControls();

    // 5. Setup network status
    setupNetworkStatus();

    // 6. Setup helpline click handlers
    setupHelplineLinks();

    // 7. Pre-fetch location
    LocationService.getCurrentPosition(5000).catch(() => {});

    // 8. Navigate to SOS screen
    navigateToScreen('sos');

    console.log('[App] ═══ SOS One Desktop Ready ═══');
  }

  function setupNavigation() {
    Utils.$$('.bottom-nav__item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const screen = item.dataset.screen;
        if (screen) navigateToScreen(screen);
      });
    });
  }

  function setupWindowControls() {
    const minimizeBtn = Utils.$('#btn-minimize');
    const closeBtn = Utils.$('#btn-close');

    if (minimizeBtn && window.electronAPI) {
      minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
    }

    if (closeBtn && window.electronAPI) {
      closeBtn.addEventListener('click', () => window.electronAPI.close());
    }
  }

  function setupNetworkStatus() {
    const dot = Utils.$('.status-dot');
    const text = Utils.$('.status-text');

    function updateStatus(online) {
      if (dot) dot.classList.toggle('status-dot--offline', !online);
      if (text) text.textContent = online ? 'Ready' : 'Offline';
    }

    updateStatus(Utils.isOnline());
    Utils.onNetworkChange(updateStatus);
  }

  function setupHelplineLinks() {
    // Intercept helpline tel: links to open via system
    Utils.$$('.helpline-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const href = card.getAttribute('href');
        if (href && window.electronAPI) {
          window.electronAPI.openExternal(href);
        } else if (href) {
          window.open(href, '_blank');
        }
      });
    });
  }

  return { init };
})();


// ═══ BOOT ═══
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
