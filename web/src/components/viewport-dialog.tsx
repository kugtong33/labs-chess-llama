import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ViewportDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    if (element?.showModal) element.showModal();
    else element?.setAttribute('open', '');
    return () => {
      element?.close?.();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="viewport-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={heading}>{title}</h2>
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>,
    document.body,
  );
}
