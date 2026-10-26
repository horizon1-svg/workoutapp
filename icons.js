// icons.js — small inline SVG icon set, Feather-style outline icons.
// Deliberately hand-drawn/inline (not an external icon font or CDN) so the
// packaged Android app keeps working with zero network access.
function icon(name, size, extraClass) {
  size = size || 20;
  extraClass = extraClass ? ' ' + extraClass : '';
  if (name === 'flame') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" class="icon icon-flame${extraClass}">
      <path d="M12 2.3c-1.1 3.7-5.7 5.9-5.7 11a5.7 5.7 0 0 0 11.4 0c0-2.7-1.5-3.7-1.9-6.3-.3 2.1-1.3 3.2-2.3 3.2-1.4 0-1.9-1.8-1.6-3.4.2-1.6.4-3.1.1-4.5z"/>
    </svg>`;
  }
  const shapes = {
    home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h4.5v-5h3v5H18v-9"/>',
    history: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.5V12l3 2.3"/>',
    settings: '<line x1="4" y1="6" x2="20" y2="6"/><circle cx="15" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="9" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="16" cy="18" r="2"/>',
    dumbbell: '<rect x="1.3" y="9" width="3" height="6" rx="1"/><rect x="19.7" y="9" width="3" height="6" rx="1"/><line x1="6" y1="12" x2="18" y2="12"/><rect x="4.3" y="6.3" width="2.3" height="11.4" rx="1.1"/><rect x="17.4" y="6.3" width="2.3" height="11.4" rx="1.1"/>',
    moon: '<path d="M20 14.2A8.3 8.3 0 1 1 9.8 4a6.8 6.8 0 0 0 10.2 10.2z"/>',
    play: '<polygon points="7,4 19,12 7,20"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/>',
    skipForward: '<polygon points="5,4 15,12 5,20"/><line x1="19" y1="4" x2="19" y2="20"/>',
    check: '<polyline points="4,13 9,18 20,6"/>',
    chevronUp: '<polyline points="6,15 12,9 18,15"/>',
    chevronDown: '<polyline points="6,9 12,15 18,9"/>',
    chevronLeft: '<polyline points="15,18 9,12 15,6"/>',
    clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 8V12.3l2.6 1.8"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.8 1.3 5 1.3 5h-13.6s1.3-1.2 1.3-5z"/><path d="M9.7 18a2.3 2.3 0 0 0 4.6 0"/>',
    list: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
    swap: '<polyline points="17,1 21,5 17,9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7,23 3,19 7,15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    reset: '<polyline points="1,4 1,10 7,10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  };
  const inner = shapes[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-${name}${extraClass}">${inner}</svg>`;
}
