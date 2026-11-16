import { buildLabel } from '../platform/buildInfo';

/**
 * Non-gameplay app chrome: a small build-id pill that opens the
 * About/Diagnostics panel, a non-blocking "Update ready" banner, and an offline
 * "while you were away" summary toast. Online/offline readiness now lives in the
 * Admin menu; the diagnostics panel still reports it. Buttons meet the 48px
 * touch target.
 */
export interface DiagnosticsSnapshot {
  [label: string]: string;
}

export interface SaveActions {
  onExport: () => void | Promise<void>;
  onImport: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
}

export class AppChrome {
  private readonly root: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private offlineReady = false;
  private getDiagnostics: () => DiagnosticsSnapshot = () => ({});
  private saveActions: SaveActions | null = null;
  private saveStatus = 'writer';
  private saveDetail = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', {
      position: 'absolute',
      inset: '0',
      zIndex: '40',
      pointerEvents: 'none',
      font: '13px system-ui, sans-serif',
      color: '#e8f0ea',
    });

    // The build id + diagnostics live in the Admin menu, which calls openAbout().

    // --- update banner (bottom-center, hidden by default) ---
    this.banner = el('div', {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: 'calc(env(safe-area-inset-bottom) + 16px)',
      display: 'none',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 14px',
      borderRadius: '10px',
      background: 'rgba(20,42,30,0.96)',
      border: '1px solid rgba(143,230,172,0.4)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      pointerEvents: 'auto',
    });

    // Transient "while you were away" summary toast, top-left.
    this.toast = el('div', {
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 8px)',
      left: 'calc(env(safe-area-inset-left) + 8px)',
      padding: '4px 10px',
      borderRadius: '8px',
      background: 'rgba(47,107,67,0.95)',
      opacity: '0',
      transition: 'opacity 0.2s',
    });

    this.banner.classList.add('elaris-surface');
    this.toast.classList.add('elaris-surface');
    this.root.append(this.banner, this.toast);
    parent.appendChild(this.root);
  }

  setDiagnosticsProvider(fn: () => DiagnosticsSnapshot): void {
    this.getDiagnostics = fn;
  }

  setSaveActions(actions: SaveActions): void {
    this.saveActions = actions;
  }

  setSaveStatus(status: string, detail = ''): void {
    this.saveStatus = status;
    this.saveDetail = detail;
  }

  flashSaved(text = 'Saved'): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    window.setTimeout(() => {
      this.toast.style.opacity = '0';
    }, 1100);
  }

  /** Offline-precache readiness, surfaced by the Admin menu and diagnostics. */
  get isOfflineReady(): boolean {
    return this.offlineReady;
  }

  markOfflineReady(): void {
    this.offlineReady = true;
  }

  showUpdateReady(applyUpdate: () => Promise<void>): void {
    this.banner.textContent = '';
    const label = el('span', {});
    label.textContent = 'Update ready';
    const update = button('Save & update', async () => {
      update.disabled = true;
      update.textContent = 'Updating…';
      await applyUpdate();
    });
    const later = button('Later', () => {
      this.banner.style.display = 'none';
    });
    later.style.background = 'transparent';
    later.style.border = '1px solid rgba(255,255,255,0.25)';
    this.banner.append(label, update, later);
    this.banner.style.display = 'flex';
  }

  /** Open the About/Diagnostics panel (build id, live metrics, save actions). */
  openAbout(): void {
    const readDiagnostics = (): DiagnosticsSnapshot => ({
      Build: buildLabel(),
      Offline: this.offlineReady ? 'Ready offline' : 'Online only',
      Save: this.saveStatus === 'writer' ? 'Active (this window)' : `${this.saveStatus}${this.saveDetail ? ` — ${this.saveDetail}` : ''}`,
      ...this.getDiagnostics(),
    });
    const diag = readDiagnostics();

    const overlay = el('div', {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
      pointerEvents: 'auto',
      zIndex: '20',
    });
    const panel = el('div', {
      maxWidth: 'min(92vw, 380px)',
      width: '100%',
      maxHeight: '80vh',
      overflow: 'auto',
      padding: '18px',
      borderRadius: '12px',
      background: '#0f1512',
      border: '1px solid rgba(255,255,255,0.15)',
    });
    panel.classList.add('elaris-surface');
    const h = el('h2', { margin: '0 0 12px', fontSize: '18px' });
    h.textContent = 'Elaris — Diagnostics';
    panel.appendChild(h);

    const diagnosticValues = new Map<string, HTMLSpanElement>();

    for (const [k, v] of Object.entries(diag)) {
      const row = el('div', {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '6px 0',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      });
      const key = el('span', { opacity: '0.7' });
      key.textContent = k;
      const val = el('span', { textAlign: 'right', fontVariantNumeric: 'tabular-nums' });
      val.textContent = v;
      diagnosticValues.set(k, val);
      row.append(key, val);
      panel.appendChild(row);
    }

    let refreshTimer: number | undefined;
    const dismiss = (): void => {
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
      overlay.remove();
    };

    if (this.saveActions) {
      const actions = this.saveActions;
      const row = el('div', { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' });
      row.append(
        button('Export save', () => actions.onExport()),
        button('Import save', () => actions.onImport()),
      );
      const reset = button('Reset save', () => {
        if (window.confirm('Reset save? This permanently clears local progress for this game.')) {
          void actions.onReset();
          dismiss();
        }
      });
      reset.dataset.tone='danger';
      reset.style.background = '#6b2f2f';
      row.appendChild(reset);
      panel.appendChild(row);
    }

    const close = button('Close', dismiss);
    close.style.marginTop = '12px';
    panel.appendChild(close);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });
    this.root.appendChild(overlay);
    refreshTimer = window.setInterval(() => {
      const next = readDiagnostics();
      for (const [key, value] of diagnosticValues) value.textContent = next[key] ?? '—';
    }, 500);
    close.focus();
  }
}

// --- tiny DOM helpers ---

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  return node;
}

function button(text: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = el('button', {
    minHeight: '40px',
    padding: '8px 14px',
    borderRadius: '8px',
    border: 'none',
    background: '#2f6b43',
    color: '#e8f0ea',
    font: '14px system-ui, sans-serif',
    cursor: 'pointer',
    pointerEvents: 'auto',
  }) as HTMLButtonElement;
  b.classList.add('elaris-button');
  b.textContent = text;
  b.addEventListener('click', () => void onClick());
  return b;
}
