import { NavLink, Outlet } from 'react-router-dom';

import { RuntimeStatus } from './runtime-status.js';

const navigation = [
  { to: '/', label: 'Play', end: true },
  { to: '/history', label: 'History', end: false },
  { to: '/settings', label: 'Settings', end: false },
] as const;

export function Layout() {
  return (
    <div className="app-shell">
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
