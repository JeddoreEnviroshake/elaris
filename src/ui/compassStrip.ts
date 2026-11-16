import type { CompassMark, CompassPip, CompassTargetKind } from '../presentation/compass';
import { BEACON_COLOR } from './mapMarkers';

const PIP_COLORS: Readonly<Record<CompassTargetKind, string>> = {
  site: '#f0c674',
  cache: BEACON_COLOR,
  bed: '#b8e6c5',
};

/**
 * A fixed strip across the top of the first-person view with a bearing pip for
 * each discovered site, the death cache and the nearest bed.
 *
 * Comfort rule: nothing here animates. There are no CSS transitions; pips and
 * letters are placed directly from the heading each frame, so they slide only
 * because the player turned (or walked), never on their own.
 */
export class CompassStrip {
  private readonly root: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly marks = new Map<string, HTMLSpanElement>();
  private readonly pips = new Map<string, HTMLDivElement>();
  private signature = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.dataset.compassStrip = '';
    this.root.setAttribute('aria-hidden', 'true');
    Object.assign(this.root.style, {
      position: 'absolute',
      top: 'calc(env(safe-area-inset-top) + 8px)',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'clamp(150px, calc(100vw - 420px), 340px)',
      height: '30px',
      borderRadius: '6px',
      background: 'rgba(14,22,17,0.62)',
      border: '1px solid rgba(232,214,170,0.35)',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '9',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.track = document.createElement('div');
    Object.assign(this.track.style, { position: 'absolute', inset: '0 8px' } satisfies Partial<CSSStyleDeclaration>);
    const ahead = document.createElement('div');
    Object.assign(ahead.style, {
      position: 'absolute', left: '50%', top: '0', width: '2px', height: '6px', marginLeft: '-1px',
      background: 'rgba(255,255,255,0.85)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.append(this.track, ahead);
    parent.appendChild(this.root);
  }

  /** Called every frame by WorldScene; `active` is whether first person is on. */
  update(active: boolean, marks: readonly CompassMark[], pips: readonly CompassPip[]): void {
    this.root.style.display = active ? 'block' : 'none';
    if (!active) return;
    const signature = marks.map((mark) => `${mark.label}${mark.offset.toFixed(3)}`).join('|')
      + '#' + pips.map((pip) => `${pip.id}${pip.offset.toFixed(3)}${pip.distanceTiles}${pip.label}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    const seenMarks = new Set<string>();
    for (const mark of marks) {
      seenMarks.add(mark.label);
      let node = this.marks.get(mark.label);
      if (!node) {
        node = document.createElement('span');
        Object.assign(node.style, {
          position: 'absolute', top: '7px', transform: 'translateX(-50%)',
          color: mark.label.length === 1 ? '#f5ecd6' : 'rgba(245,236,214,0.55)',
          font: `${mark.label.length === 1 ? 800 : 600} 11px system-ui, sans-serif`,
        } satisfies Partial<CSSStyleDeclaration>);
        node.textContent = mark.label;
        this.track.appendChild(node);
        this.marks.set(mark.label, node);
      }
      node.style.display = 'block';
      node.style.left = `${50 + mark.offset * 50}%`;
    }
    for (const [label, node] of this.marks) if (!seenMarks.has(label)) node.style.display = 'none';

    const seenPips = new Set<string>();
    for (const pip of pips) {
      seenPips.add(pip.id);
      let node = this.pips.get(pip.id);
      if (!node) {
        node = document.createElement('div');
        node.dataset.compassPip = pip.kind;
        Object.assign(node.style, {
          position: 'absolute', bottom: '3px', width: '9px', height: '9px', marginLeft: '-4.5px',
          borderRadius: pip.kind === 'site' ? '2px' : '50%',
          transform: pip.kind === 'site' ? 'rotate(45deg)' : 'none',
          background: PIP_COLORS[pip.kind],
          boxShadow: '0 0 0 1.5px rgba(14,22,17,0.85)',
        } satisfies Partial<CSSStyleDeclaration>);
        this.track.appendChild(node);
        this.pips.set(pip.id, node);
      }
      node.dataset.compassPipId = pip.id;
      node.title = `${pip.label} · ${pip.distanceTiles} tiles`;
      node.style.display = 'block';
      node.style.left = `${50 + pip.offset * 50}%`;
      // Nearest last in the list, so nearest on top.
      this.track.appendChild(node);
    }
    for (const [id, node] of this.pips) {
      if (!seenPips.has(id)) {
        node.remove();
        this.pips.delete(id);
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}

/**
 * The search progress ring: around the crosshair in first person, a little
 * above centre in the overhead view (where the character stands). Filled
 * directly from the sim's progress each frame, with no easing.
 */
export class SearchProgressRing {
  private readonly root: HTMLDivElement;
  private readonly arc: SVGCircleElement;
  private static readonly RADIUS = 15;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.dataset.searchProgress = '';
    this.root.setAttribute('role', 'progressbar');
    this.root.setAttribute('aria-label', 'Searching');
    Object.assign(this.root.style, {
      position: 'absolute', left: '50%', top: '50%', width: '40px', height: '40px',
      margin: '-20px 0 0 -20px', pointerEvents: 'none', zIndex: '9', display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('width', '40');
    svg.setAttribute('height', '40');
    const track = document.createElementNS(ns, 'circle');
    const arc = document.createElementNS(ns, 'circle');
    for (const [circle, color, width] of [[track, 'rgba(14,22,17,0.6)', '5'], [arc, '#f0c674', '3']] as const) {
      circle.setAttribute('cx', '20');
      circle.setAttribute('cy', '20');
      circle.setAttribute('r', String(SearchProgressRing.RADIUS));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', width);
    }
    const circumference = 2 * Math.PI * SearchProgressRing.RADIUS;
    arc.setAttribute('stroke-dasharray', String(circumference));
    arc.setAttribute('stroke-dashoffset', String(circumference));
    arc.setAttribute('transform', 'rotate(-90 20 20)');
    arc.setAttribute('stroke-linecap', 'round');
    svg.append(track, arc);
    this.root.appendChild(svg);
    this.arc = arc;
    parent.appendChild(this.root);
  }

  /** `progress` is 0..1, or null when nothing is being searched. */
  update(progress: number | null, firstPerson: boolean): void {
    if (progress === null) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = 'block';
    this.root.style.top = firstPerson ? '50%' : '42%';
    this.root.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    const circumference = 2 * Math.PI * SearchProgressRing.RADIUS;
    this.arc.setAttribute('stroke-dashoffset', String(circumference * (1 - progress)));
  }

  destroy(): void {
    this.root.remove();
  }
}
