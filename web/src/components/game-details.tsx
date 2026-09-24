import { useRef, useState, type ReactNode } from 'react';
import { PagedContent } from './paged-content.js';

const tabs = ['Moves', 'AI', 'Pipeline'] as const;
type DetailTab = (typeof tabs)[number];

export function GameDetails({
  moves,
  ai,
  pipeline,
  selectedTab,
  onSelectTab,
  decisionId,
}: {
  moves: ReactNode;
  ai: ReactNode;
  pipeline: ReactNode;
  decisionId?: string;
  selectedTab?: DetailTab;
  onSelectTab?: (tab: DetailTab) => void;
}) {
  const [localTab, setLocalTab] = useState<DetailTab>('AI');
  const selected = selectedTab ?? localTab;
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (tab: DetailTab) => {
    setLocalTab(tab);
    onSelectTab?.(tab);
  };
  return (
    <div className="game-details">
      <div className="detail-tabs" role="tablist" aria-label="Game details">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={`detail-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={selected === tab}
            aria-controls={`detail-panel-${tab}`}
            tabIndex={selected === tab ? 0 : -1}
            onClick={() => select(tab)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              select(tabs[next]!);
              buttons.current[next]?.focus();
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab}
          id={`detail-panel-${tab}`}
          role="tabpanel"
          className="detail-panel"
          aria-labelledby={`detail-tab-${tab}`}
          hidden={selected !== tab}
          tabIndex={0}
        >
          <PagedContent
            key={tab === 'AI' ? decisionId : tab}
            label={tab}
            followLatest={tab === 'Moves'}
          >
            {tab === 'Moves' ? moves : tab === 'AI' ? ai : pipeline}
          </PagedContent>
        </div>
      ))}
    </div>
  );
}
