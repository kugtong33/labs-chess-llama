import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PageLayout {
  page: number;
  count: number;
  stride: number;
}

/** Browser column fragmentation keeps even long prose available without scrolling. */
export function PagedContent({
  children,
  label,
  followLatest = false,
}: {
  children: ReactNode;
  label: string;
  followLatest?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<PageLayout>({
    page: 0,
    count: 1,
    stride: 0,
  });
  const initialized = useRef(false);

  useLayoutEffect(() => {
    const container = viewport.current;
    const content = flow.current;
    if (!container || !content) return;
    let frame = 0;
    const measure = () => {
      const width = content.getBoundingClientRect().width;
      if (!width || !container.clientHeight) return;
      const gap = Number.parseFloat(getComputedStyle(content).columnGap) || 0;
      const stride = width + gap;
      const count = Math.max(
        1,
        Math.ceil((content.scrollWidth + gap - 1) / stride),
      );
      setLayout((previous) => {
        const atEnd =
          !initialized.current || previous.page === previous.count - 1;
        const page =
          followLatest && atEnd
            ? count - 1
            : Math.min(previous.page, count - 1);
        initialized.current = true;
        return previous.page === page &&
          previous.count === count &&
          previous.stride === stride
          ? previous
          : { page, count, stride };
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const resize =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(schedule);
    resize?.observe(container);
    const mutations = new MutationObserver(schedule);
    mutations.observe(content, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    content.addEventListener('toggle', schedule, true);
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      content.removeEventListener('toggle', schedule, true);
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [followLatest]);

  return (
    <div className="paged-content" aria-label={label}>
      <div className="page-viewport" ref={viewport}>
        <div
          ref={flow}
          className="page-flow"
          style={{ transform: `translateX(${-layout.page * layout.stride}px)` }}
          onFocusCapture={(event) => {
            // Keyboard focus can enter a later column; turn to that page instead
            // of letting the browser scroll an ancestor to reveal the control.
            if (!layout.stride || event.target === event.currentTarget) return;
            const target = event.target.getBoundingClientRect();
            const origin = event.currentTarget.getBoundingClientRect();
            const page = Math.max(
              0,
              Math.min(
                layout.count - 1,
                Math.floor((target.left - origin.left) / layout.stride),
              ),
            );
            setLayout((previous) =>
              previous.page === page ? previous : { ...previous, page },
            );
          }}
        >
          {children}
        </div>
      </div>
      <div className="page-controls" role="group" aria-label={`${label} pages`}>
        <button
          type="button"
          className="button secondary"
          disabled={layout.page === 0}
          onClick={() =>
            setLayout((previous) => ({ ...previous, page: previous.page - 1 }))
          }
        >
          Previous
        </button>
        <span aria-live="polite" aria-atomic="true">
          Page {layout.page + 1} of {layout.count}
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={layout.page >= layout.count - 1}
          onClick={() =>
            setLayout((previous) => ({ ...previous, page: previous.page + 1 }))
          }
        >
          Next
        </button>
      </div>
    </div>
  );
}
