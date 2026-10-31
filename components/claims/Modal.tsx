'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** A simple centred pop-up. Closes on Escape or a click on the backdrop. */
export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  }, [onClose]);
  // rendered at the end of <body> so dark page sections don't restyle it
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal__box">
        <div className="modal__head">
          <h2 className="display h-md" style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="modal__x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
