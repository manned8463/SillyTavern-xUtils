import React from 'react';
import { createRoot } from 'react-dom/client';
import { settingsManager, XUtilsSettings } from './components/Settings.js';
import Handlebars from 'handlebars';
import { Generator } from 'sillytavern-utils-lib';
import { st_echo } from 'sillytavern-utils-lib/config';
import {
  migrateCorruptedSchemaPresetRequiredMetadata,
  migrateInvalidNumericSettings,
  migrateLegacyAutoMode,
  migrateLegacyPromptTemplates,
  migrateLegacyRenamedSettings,
} from './config.js';
import { migrateLegacyExtensionStorage } from './legacy-migration.js';
import { createTrackerActions } from './ui/tracker-actions.js';
import { initializeGlobalUI } from './ui/ui-init.js';
import { ensureXUtilsSystemPromptPresetInstalled } from './system-prompt.js';
import {
  renderTracker,
} from './tracker.js';

// --- Constants and Globals ---
const globalContext = SillyTavern.getContext();
const generator = new Generator();
const pendingRequests = new Map<number, string>();
const initialLegacyMigration = migrateLegacyExtensionStorage(globalContext);
const renderTrackerWithDeps = (messageId: number) =>
  renderTracker(messageId, { context: globalContext, document, handlebars: Handlebars });

// --- Handlebars Helper ---
if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: any, separator: any) {
    if (Array.isArray(array)) {
      return array.join(typeof separator === 'string' ? separator : ', ');
    }
    return '';
  });
}

const comparisonHelpers: Record<string, (a: any, b: any) => boolean> = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

for (const [name, compare] of Object.entries(comparisonHelpers)) {
  if (Handlebars.helpers[name]) {
    continue;
  }
  Handlebars.registerHelper(name, function (this: any, a: any, b: any, options: any) {
    if (typeof options === 'object' && options && typeof options.fn === 'function') {
      return compare(a, b) ? options.fn(this) : options.inverse(this);
    }
    return compare(a, b);
  });
}

// --- Core Logic Functions (ported from original index.ts) ---

// --- Main Application Entry ---

function renderReactSettings() {
  const settingsContainer = document.getElementById('extensions_settings');
  if (!settingsContainer) {
    console.error('xUtils: Extension settings container not found.');
    return;
  }

  let reactRootEl = document.getElementById('xutils-react-settings-root');
  if (!reactRootEl) {
    reactRootEl = document.createElement('div');
    reactRootEl.id = 'xutils-react-settings-root';
    settingsContainer.appendChild(reactRootEl);
  }

  const root = createRoot(reactRootEl);
  root.render(
    <React.StrictMode>
      <XUtilsSettings />
    </React.StrictMode>,
  );
}

async function main() {
  const legacyMigration = initialLegacyMigration;
  const settings = settingsManager.getSettings();
  const didMigrateLegacySettings = [
    migrateLegacyAutoMode(settings),
    migrateLegacyPromptTemplates(settings),
    migrateCorruptedSchemaPresetRequiredMetadata(settings),
    migrateInvalidNumericSettings(settings),
    migrateLegacyRenamedSettings(settings),
  ].some(Boolean);

  if (didMigrateLegacySettings || legacyMigration.settings) {
    settingsManager.saveSettings();
  }

  if (legacyMigration.chatMetadata && typeof globalContext.saveMetadataDebounced === 'function') {
    globalContext.saveMetadataDebounced();
  }

  if (legacyMigration.chatMessages && typeof globalContext.saveChat === 'function') {
    await globalContext.saveChat();
  }

  try {
    await ensureXUtilsSystemPromptPresetInstalled();
  } catch (error) {
    console.warn('xUtils: failed to ensure the recommended system prompt preset exists.', error);
  }

  const actions = createTrackerActions({
    globalContext,
    settingsManager,
    generator,
    pendingRequests,
    renderTrackerWithDeps,
    importMetaUrl: import.meta.url,
  });

  renderReactSettings();
  initializeGlobalUI({
    globalContext,
    settingsManager,
    actions,
    renderTrackerWithDeps,
  });
}

settingsManager
  .initializeSettings()
  .then(main)
  .catch((error) => {
    console.error(error);
    st_echo('error', 'xUtils data migration failed. Check console for details.');
  });
