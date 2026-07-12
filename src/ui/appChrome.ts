import { buildInfo, buildLabel } from '../platform/buildInfo';

/**
 * Non-gameplay app chrome: a small status pill (build id + offline readiness),
 * a non-blocking "Update ready" banner, and an About/Diagnostics panel. Status
 * uses icon + text, never color alone. Buttons meet the 48px touch target.
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
  private readonly pill: HTMLButtonElement;
  private readonly offlineDot: HTMLSpanElement;
  private readonly offlineText: HTMLSpanElement;
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
      pointerEvents: 'none',
      font: '13px system-ui, sans-serif',
      color: '#e8f0ea',
    });

    // --- status pill (top-left, opens About) ---
    this.pill = el('button', {
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 8px)',
      left: 'calc(env(safe-area-inset-left) + 8px)',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      minHeight: '32px',
      padding: '4px 10px',
      borderRadius: '16px',
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(0,0,0,0.35)',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
      pointerEvents: 'auto',
    }) as HTMLButtonElement;
    this.offlineDot = el('span', {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: '#c9a227',
      flex: '0 0 auto',
    });
    this.offlineText = el('span', {});
    this.offlineText.textContent = 'Online only';
    const buildSpan = el('span', { opacity: '0.7' });
    buildSpan.textContent = buildInfo.commit;
    this.pill.append(this.offlineDot, this.offlineText, sep(), buildSpan);
    this.pill.addEventListener('click', () => this.openAbout());
    this.pill.setAttribute('aria-label', 'App status and diagnostics');

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

    // Transient "Saved" toast near the pill.
    this.toast = el('div', {
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 48px)',
      left: 'calc(env(safe-area-inset-left) + 8px)',
      padding: '4px 10px',
      borderRadius: '8px',
      background: 'rgba(47,107,67,0.95)',
      opacity: '0',
      transition: 'opacity 0.2s',
    });

    this.root.append(this.pill, this.banner, this.toast);
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

  markOfflineReady(): void {
    this.offlineReady = true;
    this.offlineDot.style.background = '#4cc07f';
    this.offlineText.textContent = 'Ready offline';
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

  private openAbout(): void {
    const diag: DiagnosticsSnapshot = {
      Build: buildLabel(),
      Offline: this.offlineReady ? 'Ready offline' : 'Online only',
      Save: this.saveStatus === 'writer' ? 'Active (this window)' : `${this.saveStatus}${this.saveDetail ? ` — ${this.saveDetail}` : ''}`,
      ...this.getDiagnostics(),
    };

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
    const h = el('h2', { margin: '0 0 12px', fontSize: '18px' });
    h.textContent = 'Elaris — Diagnostics';
    panel.appendChild(h);

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
      row.append(key, val);
      panel.appendChild(row);
    }

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
          overlay.remove();
        }
      });
      reset.style.background = '#6b2f2f';
      row.appendChild(reset);
      panel.appendChild(row);
    }

    const close = button('Close', () => overlay.remove());
    close.style.marginTop = '12px';
    panel.appendChild(close);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    this.root.appendChild(overlay);
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

function sep(): HTMLSpanElement {
  const s = el('span', { opacity: '0.35' });
  s.textContent = '·';
  return s;
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
  b.textContent = text;
  b.addEventListener('click', () => void onClick());
  return b;
}
