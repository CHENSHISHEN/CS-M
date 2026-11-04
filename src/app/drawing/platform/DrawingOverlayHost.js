import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

// The portal renders into document.body, outside the .platform-v3 view root, so
// the host container must carry the app's current theme class itself. Reading it
// from the live view root (instead of hardcoding pv-theme-light) keeps dark-theme
// sessions from losing their skin in menus/popovers; light is the fallback.
const currentThemeClass = () => {
  try {
    const root = document.querySelector('.platform-v3');
    if (root?.classList.contains('pv-theme-dark')) return 'pv-theme-dark';
  } catch (err) { /* fall through to light */ }
  return 'pv-theme-light';
};

export const OverlayPortal = ({ children, onClose, className = '' }) => {
  useEffect(() => {
    const handleKeyDown = e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose && onClose(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return ReactDOM.createPortal(
    <div className={`platform-v3 ${currentThemeClass()} er-overlay-root ${className}`}>
      {children}
    </div>,
    document.body
  );
};

/**
 * calculateClampedPosition
 * Computes viewport fixed coordinates (left, top) ensuring popovers/menus
 * do not clip outside the window bounds.
 */
export const calculateClampedPosition = ({
  anchorRect,
  overlayWidth = 240,
  overlayHeight = 300,
  placement = 'bottom-start', // 'bottom-start', 'right-start', 'pointer'
  pointer = null,
  margin = 12
}) => {
  const vpWidth = window.innerWidth;
  const vpHeight = window.innerHeight;

  let left = 0;
  let top = 0;

  if (placement === 'pointer' && pointer) {
    left = pointer.x;
    top = pointer.y;
    // Check right overflow
    if (left + overlayWidth > vpWidth - margin) {
      left = Math.max(margin, pointer.x - overlayWidth);
    }
    // Check bottom overflow
    if (top + overlayHeight > vpHeight - margin) {
      top = Math.max(margin, pointer.y - overlayHeight);
    }
    return { left, top };
  }

  if (!anchorRect) {
    return { left: margin, top: margin };
  }

  if (placement === 'right-start') {
    left = anchorRect.right + 8;
    top = anchorRect.top;
    // If overflowing right edge, flip to left of anchor
    if (left + overlayWidth > vpWidth - margin) {
      left = Math.max(margin, anchorRect.left - overlayWidth - 8);
    }
    // Clamping vertical
    if (top + overlayHeight > vpHeight - margin) {
      top = Math.max(margin, vpHeight - overlayHeight - margin);
    }
  } else {
    // Default: bottom-start
    left = anchorRect.left;
    top = anchorRect.bottom + 4;
    // If overflowing right edge
    if (left + overlayWidth > vpWidth - margin) {
      left = Math.max(margin, vpWidth - overlayWidth - margin);
    }
    // If overflowing bottom, flip above anchor
    if (top + overlayHeight > vpHeight - margin) {
      top = Math.max(margin, anchorRect.top - overlayHeight - 4);
    }
  }

  return { left, top };
};
