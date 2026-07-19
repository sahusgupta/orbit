import { useEffect, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { BarChart3, ChevronLeft, ChevronRight, CircleUserRound, Gamepad2, LayoutDashboard, Menu, Search, Settings, Trophy, Users, X } from 'lucide-react';
import { cn } from '../lib/utils';

export type PrimaryDestination = 'floor' | 'players' | 'games' | 'tournaments' | 'reports' | 'settings';
export type ShellCommand = { id: string; label: string; group?: string; keywords?: string; action: () => void };

type AppShellProps = {
  active: PrimaryDestination;
  clubName: string;
  operator?: string;
  saveState?: string;
  onNavigate: (destination: PrimaryDestination) => void;
  onSignOut: () => void;
  commands?: ShellCommand[];
  children: ReactNode;
};

const destinations = [
  { id: 'floor', label: 'Floor', icon: LayoutDashboard },
  { id: 'players', label: 'Players', icon: Users },
  { id: 'games', label: 'Games', icon: Gamepad2 },
  { id: 'tournaments', label: 'Tournaments', icon: Trophy },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings }
] as const;

export default function AppShell({ active, clubName, operator, saveState, onNavigate, onSignOut, commands = [], children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen((open) => !open); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const navigate = (destination: PrimaryDestination) => { onNavigate(destination); setMobileOpen(false); };
  const defaultCommands: ShellCommand[] = destinations.map((item) => ({ id: `open-${item.id}`, label: `Open ${item.label}`, group: 'Navigation', action: () => navigate(item.id) }));

  return (
    <div className={cn('orbit-shell', collapsed && 'sidebar-collapsed', mobileOpen && 'mobile-sidebar-open')}>
      <button className="orbit-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
      <aside className="orbit-sidebar">
        <div className="orbit-sidebar-brand"><img src="./orbit-icon.png" alt="" /><span>Orbit</span><button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button></div>
        <button className="orbit-command-trigger" onClick={() => setCommandOpen(true)}><Search size={17} /><span>Search or jump to</span><kbd>Ctrl K</kbd></button>
        <nav className="orbit-sidebar-nav">
          {destinations.map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} onClick={() => navigate(id)} title={label}><Icon size={19} /><span>{label}</span></button>)}
        </nav>
        <div className="orbit-sidebar-footer">
          <div className="orbit-account-summary"><CircleUserRound size={20} /><div><strong>{operator || 'No operator'}</strong><span>{clubName}</span></div></div>
          <div className="orbit-sync-state"><i className={saveState === 'error' ? 'error' : ''} /><span>{saveState === 'error' ? 'Sync issue' : 'Synced'}</span></div>
          <button className="orbit-signout" onClick={onSignOut}>Sign out</button>
        </div>
        <button className="orbit-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20} /></button>
      </aside>
      <div className="orbit-mobile-scrim" onClick={() => setMobileOpen(false)} />
      <div className="orbit-shell-content">{children}</div>
      <nav className="orbit-bottom-nav">{destinations.slice(0, 3).map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={20} /><span>{label}</span></button>)}<button onClick={() => setMobileOpen(true)}><Menu size={20} /><span>More</span></button></nav>

      <Dialog.Root open={commandOpen} onOpenChange={setCommandOpen}>
        <Dialog.Portal><Dialog.Overlay className="command-overlay" /><Dialog.Content className="command-dialog"><Dialog.Title className="sr-only">Command palette</Dialog.Title><Command label="Orbit command palette"><div className="command-input-row"><Search size={18} /><Command.Input placeholder="Search players, tables, actions…" /></div><Command.List><Command.Empty>No matching command.</Command.Empty>{Array.from(new Set([...defaultCommands, ...commands].map((item) => item.group || 'Actions'))).map((group) => <Command.Group key={group} heading={group}>{[...defaultCommands, ...commands].filter((item) => (item.group || 'Actions') === group).map((item) => <Command.Item key={item.id} keywords={item.keywords?.split(' ')} onSelect={() => { setCommandOpen(false); item.action(); }}>{item.label}</Command.Item>)}</Command.Group>)}</Command.List></Command></Dialog.Content></Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
