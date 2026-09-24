import { useEffect } from 'react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';

import { useSettings } from '../api/queries.js';
import { RuntimeStatus } from './runtime-status.js';

const navigation = [
  { to: '/', label: 'Play', end: true },
  { to: '/history', label: 'History', end: false },
  { to: '/settings', label: 'Settings', end: false },
] as const;

export function Layout() {
  const settings = useSettings();
  const isGame = useMatch('/games/:id') !== null;

  useEffect(() => {
    const theme = settings.data?.theme;
    if (!theme || theme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [settings.data?.theme]);

  return (
    <div className={`app-shell${isGame ? ' play-shell' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <NavLink className="brand" to="/" aria-label="chess-llama home">
          <span className="brand-mark" aria-hidden="true">
            ♞
          </span>
          <span>
            <strong>chess</strong>-llama
          </span>
        </NavLink>
        <nav aria-label="Primary navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <RuntimeStatus />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer>
        <span>Local-first · GPL-3.0</span>
        <span>Stockfish shortlist + llama.cpp decision</span>
      </footer>
    </div>
  );
}
